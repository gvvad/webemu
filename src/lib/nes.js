import { Ines } from "./ines.js"
import { BusMain } from "./bus_main.js"
import { RenderCanvas } from "./render_canvas.js"
import { RenderSound } from "./render_sound.js"
import { KeyboardInput } from "./input_keyboard.js"
import { GamepadInput } from "./input_gamepad.js"
import { EObject } from "./eobj.js"

class NES extends EObject {
    constructor() {
        super();
        this._bus = new BusMain(this);
        this._render = new RenderCanvas(this._bus);
        this._soundRender = new RenderSound(this._bus.apu);

        this._isBusy = false;
        this._intervalId = undefined;
        this._worker = undefined;
        this._isSuspend = true;

        this._apuCycleStamp = 0;
        this._cpuCycleStamp = 0;

        this._fps = 60.0988;
        this._frameTime = 1000.0 / this._fps;
        
        this._frameTimeStamp = 0.0;
        this._isTimeStampSync = false;

        this._fraction = 0;
        this._frame = 0;
        this.scanLine = 0;

        this._bus.inputController.setStandardInput(new KeyboardInput());
        this._bus.inputController.setStandardInput(new GamepadInput());

        this._frameDispatcher = this._frameDispatcher.bind(this);
        // this._isBrowser = !!document && !!window;
    }
    get _stateExclude() {
        return ["_isBusy", "_syncTimerId", "_fps", "_keyboardInput", "_gamepadInput",
            "_isBrowser", "_frameDispatcher", "_state", "_isSaveState", "_isLoadState"];
    }
    get bus() { return this._bus; }
    get fps() { return this._fps; }
    get frameTimeS() { return this._frameTime / 1000; }

    get _cyclesPerLine() {
        return this._clsLine + this._cyclesFraction;
    }
    get _cyclesFraction() {
        let b = this._fraction;
        this._fraction = (this._fraction + this._clsLineRest) % 1000;
        return ((this._fraction < b) ? 1 : 0);
    }

    setCanvas(elem) {
        this._render.setDrawContext(elem.getContext("2d"));
    }

    /**@param {AudioContext} context */
    setAudioContext(context) {
        this._soundRender.setContext(context);
    }

    /**@param {Number} id 0 - NTSC; 1 - PAL */
    setSystem(id) {
        switch (id) {
            default:
            case 0: //NTSC
                this._fps = 60.0988;
                this._bus.cpuFrequency = 1789773;
                this._apuStepRate = 7457;
                this._clsLine = 113;
                this._clsLineRest = 667;
                this._totalLines = 261;
                break;
            case 1: //PAL
                this._fps = 50.0070;
                this._bus.cpuFrequency = 1662607;
                this._apuStepRate = 8313;
                this._clsLine = 106;
                this._clsLineRest = 562;
                this._totalLines = 312;
                break;
        }
        this._frameTime = 1000.0 / this._fps;
    }

    /**@param {ArrayBuffer} blobData */
    async loadFile(blobData) {
        await this.powerOff();
        let _rom = new Ines(blobData);
        this._bus.loadRom(_rom);
        this._render.init();

        this.setSystem(this._bus.mapper.rom.system);
    }

    _tileLineHit(tableNum, id, isVFlip, mask = 0xFF) {
        let yInc = isVFlip ? -1 : 1;
        let y = isVFlip ? 7 : 0;
        let offset = id * 16;

        for (let i = 0; i < 8; i++) {
            let tile = this._bus.mapper.getTile(tableNum, offset + y);
            tile |= this._bus.mapper.getTile(tableNum, offset + y + 8);
            tile &= mask;
            if (tile) {
                return i;
            }
            y += yInc;
        }
        return -1;
    }

    _frameDispatcher() {
        this._soundRender.syncTime();
        this._frame++;

        /**Find 'sprite 0 hit' line number */
        let lineHit = -1;
        /**CPU cycles hit offset(horizontal position) */
        let clsHit = 0;

        if (this._bus.ppuBus.u8Oam[0] < 0xF0) {
            let tileId = this._bus.ppuBus.u8Oam[1];
            let isVFlip = !!this._bus.ppuBus.u8Oam[2] & 0x80;
            let isHFlip = !!this._bus.ppuBus.u8Oam[2] & 0x40;
            let mask = 0xFF;
            if (this._bus.ppuBus.u8Oam[3] > 247) {
                if (isHFlip) {
                    mask >>= this._bus.ppuBus.u8Oam[3] - 247;
                } else {
                    mask <<= this._bus.ppuBus.u8Oam[3] - 247;
                }
                mask &= 0xFF;
            }

            let tableNum = (this._bus.ppuBus.rCtrl.h) ? tileId & 0x1 : this._bus.ppuBus.rCtrl.spriteTable;
            if (!this._bus.ppuBus.rCtrl.h) { // 8x8
                lineHit = this._tileLineHit(tableNum, tileId, isVFlip, mask);
            } else {
                lineHit = this._tileLineHit(tableNum, (tileId & 0xFE) | (isVFlip + 0), isVFlip, mask);
                if (lineHit == -1) {
                    lineHit = this._tileLineHit(tableNum, (tileId & 0xFE) | (!isVFlip + 0), isVFlip, mask);
                    if (lineHit != -1) lineHit += 8;
                }
            }
            if (lineHit != -1) {
                lineHit += this._bus.ppuBus.u8Oam[0] + 1;
                clsHit = Math.floor(this._bus.ppuBus.u8Oam[3] / 3);
            }
        }

        this._bus.ppuBus.doFrameBegin();
        this._render.doFramePredraw();

        this.scanLine = 0;
        let jobLineDraw = this._render.doLineDraw.bind(this._render);
        let jobLineHSync = this._bus.ppuBus.doScanLineHSync.bind(this._bus.ppuBus);
        for (; this.scanLine < 240; this.scanLine++) {
            this._ppuCycles = 0;

            this._bus.cpu.scheduler.putJob(20, jobLineDraw);
            //this._render.doLineDraw();
            if (lineHit == this.scanLine && this._bus.ppuBus.rMask.isAllRendering) {
                this._bus.cpu.scheduler.putJob(
                    clsHit,
                    (function () { this.rStatus.isSpriteHit = true; }).bind(this._bus.ppuBus));
            }
            this._bus.cpu.scheduler.putJob(88, jobLineHSync);
            this._cyclesDispatch(this._cyclesPerLine);
        }
        this._render.doShowFrame();

        //set vblank flag after one scanline
        this._bus.cpu.scheduler.putJob(this._clsLine, this._bus.ppuBus.doVBlankBegin.bind(this._bus.ppuBus));
        for (; this.scanLine < this._totalLines; this.scanLine++) {
            this._ppuCycles = 0;
            this._cyclesDispatch(this._cyclesPerLine);
        }
        this._bus.ppuBus.doVBlankEnd();

        this.scanLine++; // -1 scanline
        this._bus.cpu.scheduler.putJob(85, this._bus.ppuBus.doFrameEnd.bind(this._bus.ppuBus));
        this._cyclesDispatch(this._cyclesPerLine);
    }

    powerOn() {
        this._isSuspend = false;
        this._soundRender.start();
        if (!this._intervalId && this._bus.mapper) {
            this._worker = new Promise((function (resolveFunc) {
                this._intervalId = setInterval((resolver) => {
                    let now = performance.now();
                    if (!this._isTimeStampSync) {
                        this._frameTimeStamp = now + this._frameTime;
                        this._isTimeStampSync = true;
                    }

                    if (this._frameTimeStamp < now) {
                        this._frameTimeStamp += this._frameTime;

                        if (this._isBusy) return;
                        if (this._isSuspend) {
                            clearInterval(this._intervalId);
                            this._intervalId = undefined;
                            this._soundRender.shut();
                            this._isTimeStampSync = false;
                            resolver();
                            return;
                        }

                        try {
                            this._isBusy = true;
                            this._frameDispatcher();
                        } catch (e) {
                            console.error(e);
                        } finally {
                            this._isBusy = false;
                        }
                    }
                }, 5, resolveFunc);
            }).bind(this));
        }
    }

    async powerOff() {
        await this.suspend();
        this._bus.resetState();
        this._cpuCycleStamp = 0;
        this._apuCycleStamp = 0;
        this._fraction = 0;
        this._frame = 0;
        this._render.doBlankFrame();
    }

    suspend() {
        this._isSuspend = true;
        return this._worker;
    }

    async reset() {
        await this.suspend();
        this._bus.apu.resetState();
        this._bus.cpu.intReset();
        this.powerOn();
    }

    _cyclesDispatch(cycles) {
        this._cpuCycleStamp += cycles;
        while (this._bus.cpu.cycles <= this._cpuCycleStamp) {
            let c = this._bus.cpu.cycles;
            this._bus.cpu.step();
            this._ppuCycles += (this._bus.cpu.cycles - c) * 3;

            while (this._apuCycleStamp < this._bus.cpu.cycles) {
                this._bus.apu.step();
                this._soundRender.refresh();
                this._apuCycleStamp += this._apuStepRate;
            }
        }
    }

    async saveState() {
        await this.suspend();
        let state = this.getState();
        this.powerOn();
        return state;
    }

    async loadState(state) {
        await this.suspend();
        this.setState(state);
        this.powerOn();
    }
}

export { NES };