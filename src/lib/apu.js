import { Register, RegisterGroup } from "./register.js"
import { BusMain, IRQLine } from "./bus_main.js";
import { EObject } from "./eobj.js";

const LENGTH_TABLE = [
    10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14,
    12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30
];
//TODO: noise for NTSC, PAL ver need to define
const NOISE_FREQ_TABLE = [
    4811.2, 2405.6, 1202.8, 601.4, 300.7, 200.5, 150.4, 120.3,
    95.3, 75.8, 50.6, 37.9, 25.3, 18.9, 9.5, 4.7
];
const NOISE_PERIOD_TABLE = [
    4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068
];
const DMC_RATE = [428, 380, 340, 320, 286, 254, 226, 214, 190, 160, 142, 128, 106, 84, 72, 54];
// const DMC_RATE = [398, 354, 316, 298, 276, 236, 210, 198, 176, 148, 132, 118, 98, 78, 66, 50];

class APUOscBase extends RegisterGroup {
    /** @param {APU} apu */
    constructor(apu) {
        super(4);
        this._apu = apu;
        this._isEnable = false;
    }
    get _stateExclude() {
        return ["_apu"];
    }
    get isEnable() { return this._isEnable; }
    set isEnable(v) { this._isEnable = !!v; }

    halfFrameClock() { }
    quarterFrameClock() { }
    resetState() {
        super.resetState();
        this._isEnable = false;
    }
}

class APUOscWithLengthCounter extends APUOscBase {
    constructor(apu) {
        super(apu);
        /**Oscilator length parameter */
        this.length = 0;
    }
    get isEnable() { return this._isEnable; }
    set isEnable(v) {
        this._isEnable = !!v;
        if (!this._isEnable) this.length = 0;
    }

    get isHaltLength() { throw "Undefined"; }

    write(num, data) {
        super.write(num, data);
        if (num == 3) {
            if (this.isEnable) this.length = LENGTH_TABLE[(data & 0xF8) >> 3];
        }
    }
    /**Length counter */
    halfFrameClock() {
        if (!this.isHaltLength && this.length) this.length--;
    }
    resetState() {
        super.resetState();
        this.length = 0;
    }
}

class APUOscWithEnvelopeCounter extends APUOscWithLengthCounter {
    constructor(apu) {
        super(apu);
        this.isEnvelopeStart = false;
        this.envelopeCounter = 0;
        this.envelope = 0;
    }

    get envelopeDivider() { throw `Undefined`; }

    write(num, data) {
        super.write(num, data);
        if (num == 3) {
            this.isEnvelopeStart = true;
        }
    }
    /**Envelope counter */
    quarterFrameClock() {
        if (this.isEnvelopeStart) {
            this.isEnvelopeStart = false;
            this.envelope = 15;
            this.envelopeCounter = this.envelopeDivider;
        } else {
            if (--this.envelopeCounter < 0) {
                this.envelopeCounter = this.envelopeDivider;
                if (this.envelope == 0) {
                    if (this.isHaltLength) this.envelope = 15;
                } else {
                    this.envelope--;
                }
            }
        }
    }
    resetState() {
        super.resetState();
        this.isEnvelopeStart = false;
        this.envelopeCounter = 0;
        this.envelope = 0;
    }
}

class APUPulseRegisterGroup extends APUOscWithEnvelopeCounter {
    /**
     * @param {APU} apu 
     * @param {Boolean} altSweep 
     */
    constructor(apu, altSweep = false) {
        super(apu);
        this._altSweep = altSweep;  //Alternative sweep in 1st pulse oscillator
        this.isSweepReload = false;
        this.sweepDivider = 0;
        this.timer = 0;
    }

    write(num, data) {
        super.write(num, data);
        switch (num) {
            case 1:
                this.isSweepReload = true;
                break;
            case 2:
            case 3:
                this.timer = this.timerReload;
                break;
            default:
                break;
        }
    }
    /**Halt length counter / Envelope loop */
    get isHaltLength() { return !!(this._reg[0] & 0x20); }
    /**Amplitude or envelope divider*/
    get envelopeDivider() { return this._reg[0] & 0xF; }

    /**Pulse width [00=12.5%; 01=25%; 10=50%; 11=75% (25% negated)] */
    get duty() { return (this._reg[0] & 0xC0) >> 6; }
    /**Constant amplitude or envelope */
    get isConstAmp() { return !!(this._reg[0] & 0x10); }

    get amplitude() {
        if (this.timer > 0x7FF) return 0;
        if (this.length) {
            if (this.isConstAmp) {
                return this.envelopeDivider;
            } else {
                return this.envelope;
            }
        }
        return 0;
    }

    get isSweepEnable() { return !!(this._reg[1] & 0x80); }
    get sweepPeriod() { return ((this._reg[1] & 0x70) >> 4) + 1; }
    get isSweepNegate() { return !!(this._reg[1] & 0x08); }
    get sweepShift() { return this._reg[1] & 0x07; }

    get timerReload() { return ((this._reg[3] & 0x07) << 8) | this._reg[2]; }
    get frequency() { return Math.floor(this._apu.bus.cpuFrequency / (16 * (this.timer + 1))); }

    halfFrameClock() {
        super.halfFrameClock();
        this.sweepDivider--;
        if (this.sweepDivider == 0) {
            if (this.isSweepEnable && this.sweepShift > 0 && this.timer >= 8 && this.timer <= 0x7FF) {
                let res = this.timer >> this.sweepShift;
                if (this.isSweepNegate) {
                    this.timer -= res;
                    if (this._altSweep) this.timer--;
                } else {
                    this.timer += res;
                }
            }
            this.sweepDivider = this.sweepPeriod;
        }

        if (this.isSweepReload) {
            this.sweepDivider = this.sweepPeriod;
            this.isSweepReload = false;
        }
    }
    resetState() {
        super.resetState();
        this.isSweepReload = false;
        this.sweepDivider = 0;
        this.timer = 0;
    }
}

class APUTriangleRegisterGroup extends APUOscWithLengthCounter {
    constructor(apu) {
        super(apu);
        this.isLinearReload = false;
        this.linearCounter = 0;
        this._sequenceIndex = 0;
    }
    /**Linear control and length halt flag*/
    get isHaltLength() { return !!(this._reg[0] & 0x80); }

    get timer() { return ((this._reg[3] & 0x07) << 8) | this._reg[2]; }
    get frequency() { return Math.floor(this._apu.bus.cpuFrequency / (32 * (this.timer + 1))); }
    get linearCounterReload() { return this._reg[0] & 0x7F; }
    get amplitude() {
        if (this.length && this.linearCounter) {
            return 15;
        }
        return 0;
    }

    write(num, data) {
        super.write(num, data);
        // this.isLinearReload = true;
        switch (num) {
            case 0:
                // this.isLinearReload = this.isHaltLength;
                break;
            case 3:
                this.isLinearReload = true;
                break;
            default:
                break;
        }
    }

    /**Sweep counter */
    quarterFrameClock() {
        if (this.isLinearReload) {
            this.linearCounter = this.linearCounterReload;
        } else if (this.linearCounter) {
            this.linearCounter--;
        }
        if (!this.isHaltLength) {
            this.isLinearReload = false;
        }
    }
    resetState() {
        super.resetState();
        this.isLinearReload = false;
        this.linearCounter = 0;
        this._sequenceIndex = 0;
    }
}

class APUNoiseRegisterGroup extends APUOscWithEnvelopeCounter {
    constructor(apu) {
        super(apu);
        this._sRateCache = this._apu.bus.cpuFrequency / this.period;
    }

    write(num, data) {
        super.write(num, data);
        if (num == 2) {
            this._sRateCache = this._apu.bus.cpuFrequency / this.period;
        }
    }

    /**Halt length counter / Envelope loop */
    get isHaltLength() { return !!(this._reg[0] & 0x20); }
    /**Amplitude or envelope divider*/
    get envelopeDivider() { return this._reg[0] & 0xF; }

    /**Constant amplitude or envelope */
    get isConstAmp() { return !!(this._reg[0] & 0x10); }
    /**false - white noise, true - buzzing */
    get mode() { return !!(this._reg[2] & 0x80); }

    get p() { return this._reg[2] & 0xF; }
    get period() { return NOISE_PERIOD_TABLE[this.p]; }
    get sampleRate() { return this._sRateCache; }
    /**Buzzing noise frequency */
    get frequency() { return NOISE_FREQ_TABLE[this.p]; }

    get amplitude() {
        if (this.length) {
            if (this.isConstAmp) {
                return this.envelopeDivider;
            } else {
                return this.envelope;
            }
        }
        return 0;
    }
    resetState() {
        super.resetState();
        this._sRateCache = this._apu.bus.cpuFrequency / this.period;
    }
}

class APUDMCRegisterGroup extends APUOscBase {
    /** @param {APU} apu */
    constructor(apu) {
        super(apu);
        /**
         * @type {Function} 
         * @param {Number} action 0 - direct, 1 - dmc
         */
        this._callback = Function.prototype;
        this._pcmBuffer = new Uint8ClampedArray(1024 * 32);
        this._pcmCyclesBuffer = new Uint32Array(1024 * 32);
        this._pcmBufferPos = 0;
        this._isBufferFill = false;
        this._current = 0;
    }
    get isEnable() { return this._isEnable; }
    set isEnable(v) {
        let a = !this._isEnable && v;
        this._isEnable = v;
        if (a) this._pushDPCM();
    }
    get pcmBuffer() { return this._pcmBuffer; }
    get pcmBufferPos() { return this._pcmBufferPos; }
    get pcmCyclesBuffer() { return this._pcmCyclesBuffer; }
    get isBufferFill() {
        let res = this._isBufferFill;
        this._isBufferFill = false;
        return res;
    }

    get isIrq() { return !!(this._reg[0] & 0x80); }
    get isLoop() { return !!(this._reg[0] & 0x40); }
    get rateIndex() { return this._reg[0] & 0x0F; }
    get dmcRate() { return DMC_RATE[this.rateIndex]; }
    get dmcRateFrequency() { return this._apu.bus.cpuFrequency / this.dmcRate; }
    get sample() { return this._reg[1] & 0x7F; }
    get address() { return (this._reg[2] * 64) + 0xC000; }
    get length() { return (this._reg[3] * 16) + 1; }

    setCallback(callback) { this._callback = callback; }

    /**
     * Iterate buffer indexes from startPos to current (last written)
     * @param {Number} startPos start position index
     * @returns {Iterator}
     */
    pcmBufferIndexRange(startPos) {
        let range = { scope: this, from: startPos }
        range[Symbol.iterator] = function () {
            const iter = {
                i: this.from,
                scope: this.scope,
                next() {
                    if (this.scope._pcmBufferPos == this.i) return { done: true };
                    let res = this.i;
                    this.i = ++this.i % this.scope._pcmBuffer.length;
                    return {
                        value: res,
                        done: false
                    }
                }
            };
            return iter;
        }
        return range;
    }

    pcmBufferLength(startPos) {
        let len = 0;
        if (startPos <= this._pcmBufferPos) {
            len = this._pcmBufferPos - startPos;
        } else {
            len = this._pcmBuffer.length - startPos;
            len += this._pcmBufferPos;
        }
        return len;
    }

    write(num, data) {
        super.write(num, data);
        if (num == 1) { // 4011
            this._current = data & 0x7F;
            this._pcmBuffer[this._pcmBufferPos] = this._current;
            this._pcmCyclesBuffer[this._pcmBufferPos] = this._apu._bus._cpu.cycles;
            this._pcmBufferPos = ++this._pcmBufferPos % this._pcmBuffer.length;
            this._isBufferFill = true;
            return;
        }
    }

    _pushDPCM() {
        let base = this.address;
        let cycles = this._apu.bus.cpu.cycles;
        for (let i = 0; i < this.length; i++) {
            let byte = this._apu.bus._read(base++);
            for (let j = 0; j < 8; j++) {
                if (byte & 0x1) {
                    if (this._current <= 125) this._current += 2;
                } else {
                    if (this._current >= 2) this._current -= 2;
                }
                this._pcmBuffer[this._pcmBufferPos] = this._current;
                this._pcmCyclesBuffer[this._pcmBufferPos] = cycles;
                cycles += this.dmcRate;
                this._pcmBufferPos = ++this._pcmBufferPos % this._pcmBuffer.length;
                byte >>= 1;
            }
        }
        this._isBufferFill = true;
    }
}

class APUStatusRegister extends Register {
    /**
     * 4015 Status register
     * @param {APU} apu apu object
     */
    constructor(apu) {
        super();
        this._apu = apu;
    }
    get _stateExclude() {
        return ["_apu"];
    }

    /**Return register value and set 'Frame Counter' IRQ to low value */
    read() {
        this._val = 0;
        for (let i = 0; i < this._apu.aRegister.length; i++) {
            this._val |= ((this._apu.aRegister[i].length != 0) + 0) << i;
        }
        if (this._apu.bus.cpu.isUpIRQ(IRQLine.FrameCounter)) this._val |= 0x40;

        this._apu.bus.cpu.setDownIRQ(IRQLine.FrameCounter);
        return this._val;
    }

    write(data) {
        this._apu.bus.cpu.setDownIRQ(IRQLine.DMC);
        for (let i = 0; i < this._apu.aRegister.length; i++) {
            this._apu.aRegister[i].isEnable = !!(data & (0x1 << i));
        }
    }
}

class APUFrameCounterRegister extends Register {
    /** @param {APU} apu */
    constructor(apu) {
        super();
        this._apu = apu;
    }
    get _stateExclude() {
        return ["_apu"];
    }
    /**@type {Boolean} false - 4-step seq; true - 5-step seq*/
    get stepMode() { return !!(this._val & 0x80); }
    get isIRQInhibit() { return !!(this._val & 0x40); }

    write(data) {
        this.val = data;
        this._apu.resetStepCounter();
        if (this.isIRQInhibit) this._apu.bus.cpu.setDownIRQ(IRQLine.FrameCounter);

        if (this.stepMode) {
            this._apu.halfFrameClock();
        }
    }
}

class APU extends EObject {
    /** @param {BusMain} bus */
    constructor(bus) {
        super();
        this._bus = bus;
        this._aRegister = [
            new APUPulseRegisterGroup(this, true), new APUPulseRegisterGroup(this),
            new APUTriangleRegisterGroup(this),
            new APUNoiseRegisterGroup(this),
            new APUDMCRegisterGroup(this)
        ];

        this._status = new APUStatusRegister(this);
        this._frameCounter = new APUFrameCounterRegister(this);
        /**@type {Number} */
        this._stepCounter = 0;
    }
    get _stateExclude() {
        return ["_bus"];
    }
    get bus() { return this._bus; }
    get frameCounter() { return this._frameCounter; }
    get aRegister() { return this._aRegister; }
    get aPulse() { return [this._aRegister[0], this._aRegister[1]]; }
    get triangle() { return this._aRegister[2]; }
    get noise() { return this._aRegister[3]; }
    /**@type {APUDMCRegisterGroup} */
    get dmc() { return this._aRegister[4]; }
    get status() { return this._status; }

    reset() {
        this._status.write(0);
    }
    resetStepCounter() {
        this._stepCounter = 0;
    }

    resetState() {
        super.resetState();
        this.reset();
        this.resetStepCounter();
    }

    step() {
        if (this._stepCounter == 3) {
            this._stepCounter++;
            if (this._frameCounter.stepMode) {
                return;
            }
        }

        if (this._stepCounter == 4 && !this._frameCounter.isIRQInhibit && !this._frameCounter.stepMode) {
            this._bus.cpu.setUpIRQ(IRQLine.FrameCounter);
        }

        if (this._stepCounter == 1 || this._stepCounter == 4) {
            this.halfFrameClock();
        }
        this.quarterFrameClock();

        this._stepCounter = ++this._stepCounter % 5;
    }

    quarterFrameClock() {
        for (const reg of this._aRegister) {
            reg.quarterFrameClock();
        }
    }

    halfFrameClock() {
        for (const reg of this._aRegister) {
            reg.halfFrameClock();
        }
    }
}

export { APU };