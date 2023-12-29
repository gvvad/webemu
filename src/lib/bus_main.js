import { BusBase } from "./bus_base.js"
import { CPU } from "./cpu.js"
import { BusPPU } from "./bus_ppu.js"
import { APU } from "./apu.js"
import { Register, RegisterGroup } from "./register.js"
import { InputController } from "./input.js"
import { MapperBase } from "./mapper.js"
import { Ines } from "./ines.js"
import { NES } from "./nes.js"

const IRQLine = {
    FrameCounter: 0x0,
    DMC: 0x1,
    Mapper: 0x2
}

class IORegister extends Register {
    /** 
     * $4016 & $4017 Joypad IO register
     * @param {BusMain} bus
     */
    constructor(bus) {
        super();
        this._bus = bus;
    }
    get _stateExclude() {
        return ["_bus"];
    }

    get isControllerLatch() { return !!(this._val & 0x1); }

    write(data) {
        this._val = data;
        if (!this.isControllerLatch) this._bus.inputController.pool();
    }

    read() {
        if (this.isControllerLatch) {
            return this._bus.inputController.pool() & 0x1;
        } else {
            return this._bus.inputController.readBit();
        }
    }
}

class BusMain extends BusBase {
    /**@param {NES} nes */
    constructor(nes) {
        super();
        this._nes = nes;
        this._cpu = new CPU(this);
        this._cpuFrequency = 1789773;

        this._ram = new ArrayBuffer(0x800);
        this._vRam = new DataView(this._ram);
        this._u32Ram = new Uint32Array(this._ram);

        this._ioReg = new IORegister(this);
        this._ppuBus = new BusPPU(this);
        this._apu = new APU(this);

        this._inputController = new InputController();

        /**@type {MapperBase} */
        this._mapper = undefined;
    }
    get _stateExclude() {
        return ["_nes", "_inputController"];
    }
    get nes() { return this._nes; }
    get cpu() { return this._cpu; }
    get cpuFrequency() { return this._cpuFrequency; }
    set cpuFrequency(v) { return this._cpuFrequency = v; }
    get ppuBus() { return this._ppuBus; }
    get apu() { return this._apu; }
    get ioReg() { return this._ioReg; }
    get inputController() { return this._inputController; }
    get mapper() { return this._mapper; }

    /**@param {Ines} rom */
    loadRom(rom) {
        this._mapper = new (MapperBase.getConstructor(rom))(this, rom);
    }

    resetState() {
        super.resetState();
        for (let i = 0; i < this._u32Ram.length; i++) {
            this._u32Ram[i] = 0x0;
            // this._u32Ram[++i] = 0xFFFFFFFF;
        }
    }

    _read(addr) {
        addr %= 0x10000;
        switch (addr >> 12) {
            case 0x0:
            case 0x1:   // Zero page, Stack, RAM [0x0000 - 0x1FFF; Mirrors 0x0000 - 0x07FF]
                return this._vRam.getUint8(addr % 0x800);
            case 0x2:
            case 0x3:   // PPU [0x2000 - 0x3FFF; Mirrors 0x2000 - 0x2007]
                return this._ppuBus.read((addr - 0x2000) % 0x8);
            case 0x4:
                if (addr < 0x4020) {    // APU / Input [0x4000 - 0x401F]
                    switch (addr & 0x1F) {
                        case 0x15:  // APU Status register
                            return this._apu.status.read();
                        case 0x16:
                            return ((this._ioReg.read() & 0x1F) | (this.data & 0xE0));
                        case 0x17:
                            return ((this._apu.frameCounter.read() & 0x1F) | (this.data & 0xE0));
                        default:
                            return;
                    }
                }
            case 0x5:   // Expansion mem [0x4020 - 0x5FFF]
                return this._mapper.readExpansion(addr - 0x4020);
            case 0x6:
            case 0x7:   // SRAM [0x6000 - 0x7FFF]
                return this._mapper.readSram(addr - 0x6000);
            default:    // ROM [0x8000 - 0xFFFF]
                return this._mapper.readPrg(addr - 0x8000);
        }
    }

    _write(addr) {
        addr %= 0x10000;
        switch (addr >> 12) {
            case 0x0:
            case 0x1:   // Zero page, Stack, RAM [Mirrors 0x0 - 0x7FF]
                this._vRam.setUint8(addr % 0x800, this.data);
                return;
            case 0x2:
            case 0x3:   // PPU [Mirrors 0x2000 - 0x2007]
                this._ppuBus.write((addr - 0x2000) % 0x8, this.data);
                return;
            case 0x4:
                if (addr < 0x4020) {    // APU / Input [0x4000 - 0x401F]
                    let num = addr & 0x1F;
                    switch (num) {
                        case 0x00:
                        case 0x01:
                        case 0x02:
                        case 0x03:  // Pulse 1
                            this._apu.aPulse[0].write(num, this.data);
                            return;
                        case 0x04:
                        case 0x05:
                        case 0x06:
                        case 0x07:  // Pulse 2
                            this._apu.aPulse[1].write(num % 4, this.data);
                            return;
                        case 0x08:
                        case 0x09:
                        case 0x0A:
                        case 0x0B:  // Triangle
                            this._apu.triangle.write(num % 4, this.data);
                            return;
                        case 0x0C:
                        case 0x0D:
                        case 0x0E:
                        case 0x0F:  // Noise
                            this._apu.noise.write(num % 4, this.data);
                            return;
                        case 0x10:
                        case 0x11:
                        case 0x12:
                        case 0x13:  // DMC
                            this._apu.dmc.write(num % 4, this.data);
                            return;
                        case 0x14:  // DMA
                            this._ppuBus.writeOAMDMA(this.data);
                            return;
                        case 0x15:  // APU
                            this._apu.status.write(this.data);
                            return;
                        case 0x16:  // Joypad 1
                            this._ioReg.write(this.data);
                            return;
                        case 0x17:  // Joypad 2 & APU frame counter
                            this._apu.frameCounter.write(this.data);
                            return;
                        default:
                            return;
                    }
                }
            case 0x5:   // Expansion mem [0x4020 - 0x5FFF]
                this._mapper.writeExpansion(addr - 0x4020, this.data);
                return;
            case 0x6:
            case 0x7:   // SRAM [0x6000 - 0x7FFF]
                this._mapper.writeSram(addr - 0x6000, this.data);
                return;
            default:    // ROM [0x8000 - 0xFFFF]
                this._mapper.writePrg(addr - 0x8000, this.data);
                return;
        }
    }

}

export { BusMain, IRQLine };