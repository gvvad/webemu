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
        if (addr < 0x2000) {
            return this._vRam.getUint8(addr % 0x800);
        }

        if (addr < 0x4000) {    // PPU registers
            return this._ppuBus.read((addr - 0x2000) % 0x8);
        }

        if (addr < 0x4015) {    //APU DMA writeonly
            return;
        }

        if (addr == 0x4015) { return this._apu.status.read(); }

        if (addr == 0x4016) { return ((this._ioReg.read() & 0x1F) | (this.data & 0xE0)); }
        if (addr == 0x4017) { return ((this._apu.frameCounter.read() & 0x1F) | (this.data & 0xE0)); }

        if (addr < 0x4020) { return; }

        if (addr < 0x6000) {    //Expansion mem
            return this._mapper.readExpansion(addr - 0x4020);
        }

        if (addr < 0x8000) {  // SRAM
            return this._mapper.readSram(addr - 0x6000);
        }

        if (addr < 0x10000) { // ROM
            return this._mapper.readPrg(addr - 0x8000);
        }

        return this._read(addr % 0x10000);
    }

    _write(addr) {
        if (addr < 0x2000) {
            // if (addr == 0x0012) {
            //     console.log(this.data);
            // }
            this._vRam.setUint8(addr % 0x800, this.data);
            return;
        }

        if (addr < 0x4000) {    // PPU registers
            this._ppuBus.write((addr - 0x2000) % 0x8, this.data);
            return;
        }

        if (addr < 0x4018) {    // APU & DMA registers
            let num = addr - 0x4000;
            if (num < 0x4) {  // Pulse 1
                this._apu.aPulse[0].write(num, this.data);
                return;
            }
            if (num < 0x8) {  // Pulse 2
                this._apu.aPulse[1].write(num % 4, this.data);
                return;
            }
            if (num < 0xC) {    // Triangle
                this._apu.triangle.write(num % 4, this.data);
                return;
            }
            if (num < 0x10) {   // Noise
                this._apu.noise.write(num % 4, this.data);
                return;
            }
            if (num < 0x14) {   //DMC
                this._apu.dmc.write(num % 4, this.data);
                return;
            }

            if (num == 0x14) {  // DMA
                this._ppuBus.writeOAMDMA(this.data);
                return;
            }
            if (num == 0x15) {  //APU
                this._apu.status.write(this.data);
                return;
            }
            if (num == 0x16) {  //Joypad 1
                this._ioReg.write(this.data);
                return;
            }
            if (num == 0x17) {  //Joypad 2 & APU frame counter
                this._apu.frameCounter.write(this.data);
                return;
            }
        }

        if (addr < 0x4020) { return; }  // 0x4019 - 0x4020 unused

        if (addr < 0x6000) {    //Expansion mem
            this._mapper.writeExpansion(addr - 0x4020, this.data);
            return;
        }

        if (addr < 0x8000) {  // SRAM
            this._mapper.writeSram(addr - 0x6000, this.data);
            return;
        }

        if (addr < 0x10000) { // ROM
            this._mapper.writePrg(addr - 0x8000, this.data);
            return;
        }


        this._write(addr % 0x10000);
    }

}

export { BusMain, IRQLine };