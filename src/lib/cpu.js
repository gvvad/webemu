import { BusBase } from "./bus_base.js"
import { Register } from "./register.js"
import { EObject } from "./eobj.js";

class Scheduler {
    /**
     * @param {CPU} cpu 
     */
    constructor(cpu) {
        this._cpu = cpu;
        this._aJobList = new Array();
    }

    reset() {
        this._aJobList.length = 0;
    }

    putJob(cycle, callback) {
        this._aJobList.push([this._cpu.cycles + cycle, callback]);
        this._aJobList = this._aJobList.sort((a, b) => a[0] - b[0]);
    }

    doJob() {
        while (this._aJobList.length) {
            if (this._aJobList[0][0] <= this._cpu.cycles) {
                let job = this._aJobList.shift();
                job[1]();
                continue;
            }
            break;
        }
    }
}

class StatusRegister extends Register {
    constructor() {
        super();
        this.val = 0;
    }
    get val() {
        this._val = 0;
        if (this._c) this._val |= 0x01;
        if (this._z) this._val |= 0x02;
        if (this._i) this._val |= 0x04;
        if (this._d) this._val |= 0x08;
        if (this._b) this._val |= 0x10;
        if (this._v) this._val |= 0x40;
        if (this._n) this._val |= 0x80;
        return this._val;
    }
    set val(v) {
        this._c = !!(v & 0x01);
        this._z = !!(v & 0x02);
        this._i = !!(v & 0x04);
        this._d = !!(v & 0x08);
        this._b = !!(v & 0x10);
        this._v = !!(v & 0x40);
        this._n = !!(v & 0x80);
    }
    /**Negative */
    get n() { return this._n; }
    set n(v) { this._n = !!v; }
    /**Overflow */
    get v() { return this._v; }
    set v(v) { this._v = !!v; }
    /**Break */
    get b() { return this._b; }
    set b(v) { this._b = !!v; }
    /**Decimal */
    get d() { return this._d; }
    set d(v) { this._d = !!v; }
    /**Interrupt (IRQ disable) */
    get i() { return this._i; }
    set i(v) { this._i = !!v; }
    /**Zero */
    get z() { return this._z; }
    set z(v) { this._z = !!v; }
    /**Carry */
    get c() { return this._c; }
    set c(v) { this._c = !!v; }

    toString() {
        return `${this.n ? "N" : "-"} ${this.v ? "V" : "-"} ${this.b ? "B" : "-"} ${this.d ? "D" : "-"} ${this.i ? "I" : "-"} ${this.z ? "Z" : "-"} ${this.c ? "C" : "-"}`;
    }
    /**Set zero and negative flags based on value */
    setNZ(v) {
        this.z = !v;
        this.n = v & 0x80;
    }
}

/**Opcodes that not produce addition cycle in cross-page mem access */
const CRSPG_EXCLUDE = [
    0x1E, 0x3E, 0x5E, 0x7E, 0x91, 0x99, 0x9D, 0xDE, 0xFE,
    0x13, 0x1B, 0x1F, 0x33, 0x3B, 0x3F, 0x53, 0x5B, 0x5F, 0x73, 0x7B, 0x7F, 0x93, 0x9B, 0x9C, 0x9E, 0x9F, 0xD3, 0xDB, 0xDF, 0xF3, 0xFB, 0xFF
];

class CPU extends EObject {
    /** @param {BusBase} bus */
    constructor(bus) {
        super();
        /**@type {BusBase} */
        this._bus = bus;
        /**@type {Scheduler} */
        this._scheduler = new Scheduler(this);

        /**@type {Number} OpCode address pointer */
        this._pc = undefined;
        /**@type {Number} Accumulator register */
        this._ac = undefined;
        /**@type {Number} X register */
        this._x = undefined;
        /**@type {Number} Y register */
        this._y = undefined;
        /**@type {StatusRegister} Status register object*/
        this._sr = new StatusRegister();
        /**@type {Number} Stack pointer */
        this._sp = undefined;
        /**@type {Number} Count of cpu cycles */
        this.cycles = 0;

        /**@type {Boolean} Is interrupt reset */
        this._intReset = undefined;
        /**@type {Boolean} Is interrupt NMI */
        this._intNmi = undefined;
        /**@type {Number} Bitmap of external IRQ lines value */
        this._irqLines = 0;
        /**@type {Boolean} One step skip external IRQ & NMI */
        this._skipIrq = false;
        //this._irqDelay = 0;

        this._aSheduleList = new Array();
        this.resetState();
        /**Every instruction will: 1 - log; 2 - break */
        this.debugLevel = 0;
        /**Array addresses where will debug */
        this._breakOn = new Array();

        /**Instructions fuctions table:
         * opcode: [ function, addressing, length, cycles ]
         * */
        this._inst_table = {
            // addressing:
            // 0x0 - accumulator            operand is AC (implied single byte instruction)
            // 0x1 - absolute               operand is address $HHLL
            // 0x2 - absolute, X-indexed    operand is address; effective address is address incremented by X with carry
            // 0x3 - absolute, Y-indexed    operand is address; effective address is address incremented by Y with carry
            // 0x4 - immediate              operand is byte BB
            // 0x5 - implied                operand implied
            // 0x6 - indirect               operand is address; effective address is contents of word at address: C.w($HHLL)
            // 0x7 - X-indexed, indirect    operand is zeropage address; effective address is word in (LL + X, LL + X + 1), inc. without carry: C.w($00LL + X)
            // 0x8 - indirect, Y-indexed    operand is zeropage address; effective address is word in (LL, LL + 1) incremented by Y with carry: C.w($00LL) + Y
            // 0x9 - relative               branch target is PC + signed offset BB
            // 0xA - zeropage               operand is zeropage address (hi-byte is zero, address = $00LL)
            // 0xB - zeropage, X-indexed    operand is zeropage address; effective address is address incremented by X without carry
            // 0xC - zeropage, Y-indexed    operand is zeropage address; effective address is address incremented by Y without carry
            0x69: [this._adc, 0x4, 2, 2],   //ADC
            0x65: [this._adc, 0xA, 2, 3],
            0x75: [this._adc, 0xB, 2, 4],
            0x6D: [this._adc, 0x1, 3, 4],
            0x7D: [this._adc, 0x2, 3, 4],
            0x79: [this._adc, 0x3, 3, 4],
            0x61: [this._adc, 0x7, 2, 6],
            0x71: [this._adc, 0x8, 2, 5],
            0x29: [this._and, 0x4, 2, 2],   //AND
            0x25: [this._and, 0xA, 2, 3],
            0x35: [this._and, 0xB, 2, 4],
            0x2D: [this._and, 0x1, 3, 4],
            0x3D: [this._and, 0x2, 3, 4],
            0x39: [this._and, 0x3, 3, 4],
            0x21: [this._and, 0x7, 2, 6],
            0x31: [this._and, 0x8, 2, 5],
            0x0A: [this._asl, 0x0, 1, 2],   //ASL
            0x06: [this._asl, 0xA, 2, 5],
            0x16: [this._asl, 0xB, 2, 6],
            0x0E: [this._asl, 0x1, 3, 6],
            0x1E: [this._asl, 0x2, 3, 7],
            0x90: [this._bcc, 0x9, 2, 2],   //BCC
            0xB0: [this._bcs, 0x9, 2, 2],   //BCS
            0xF0: [this._beq, 0x9, 2, 2],   //BEQ
            0x24: [this._bit, 0xA, 2, 3],   //BIT
            0x2C: [this._bit, 0x1, 3, 4],
            0x30: [this._bmi, 0x9, 2, 2],   //BMI
            0xD0: [this._bne, 0x9, 2, 2],   //BNE
            0x10: [this._bpl, 0x9, 2, 2],   //BPL
            0x00: [this._brk, 0x5, 1, 7],   //BRK
            0x50: [this._bvc, 0x9, 2, 2],   //BVC
            0x70: [this._bvs, 0x9, 2, 2],   //BVS
            0x18: [this._clc, 0x5, 1, 2],   //CLC
            0xD8: [this._cld, 0x5, 1, 2],   //CLD
            0x58: [this._cli, 0x5, 1, 2],   //CLI
            0xB8: [this._clv, 0x5, 1, 2],   //CLV
            0xC9: [this._cmp, 0x4, 2, 2],   //CMP
            0xC5: [this._cmp, 0xA, 2, 3],
            0xD5: [this._cmp, 0xB, 2, 4],
            0xCD: [this._cmp, 0x1, 3, 4],
            0xDD: [this._cmp, 0x2, 3, 4],
            0xD9: [this._cmp, 0x3, 3, 4],
            0xC1: [this._cmp, 0x7, 2, 6],
            0xD1: [this._cmp, 0x8, 2, 5],
            0xE0: [this._cpx, 0x4, 2, 2],   //CPX
            0xE4: [this._cpx, 0xA, 2, 3],
            0xEC: [this._cpx, 0x1, 3, 4],
            0xC0: [this._cpy, 0x4, 2, 2],   //CPY
            0xC4: [this._cpy, 0xA, 2, 3],
            0xCC: [this._cpy, 0x1, 3, 4],
            0xC6: [this._dec, 0xA, 2, 5],   //DEC
            0xD6: [this._dec, 0xB, 2, 6],
            0xCE: [this._dec, 0x1, 3, 6],
            0xDE: [this._dec, 0x2, 3, 7],
            0xCA: [this._dex, 0x5, 1, 2],   //DEX
            0x88: [this._dey, 0x5, 1, 2],   //DEY
            0x49: [this._eor, 0x4, 2, 2],   //EOR
            0x45: [this._eor, 0xA, 2, 3],
            0x55: [this._eor, 0xB, 2, 4],
            0x4D: [this._eor, 0x1, 3, 4],
            0x5D: [this._eor, 0x2, 3, 4],
            0x59: [this._eor, 0x3, 3, 4],
            0x41: [this._eor, 0x7, 2, 6],
            0x51: [this._eor, 0x8, 2, 5],
            0xE6: [this._inc, 0xA, 2, 5],   //INC
            0xF6: [this._inc, 0xB, 2, 6],
            0xEE: [this._inc, 0x1, 3, 6],
            0xFE: [this._inc, 0x2, 3, 7],
            0xE8: [this._inx, 0x5, 1, 2],   //INX
            0xC8: [this._iny, 0x5, 1, 2],   //INY
            0x4C: [this._jmp, 0x1, 3, 3],   //JMP
            0x6C: [this._jmp_ind, 0x6, 3, 5],
            0x20: [this._jsr, 0x1, 3, 6],   //JSR
            0xA9: [this._lda, 0x4, 2, 2],   //LDA
            0xA5: [this._lda, 0xA, 2, 3],
            0xB5: [this._lda, 0xB, 2, 4],
            0xAD: [this._lda, 0x1, 3, 4],
            0xBD: [this._lda, 0x2, 3, 4],
            0xB9: [this._lda, 0x3, 3, 4],
            0xA1: [this._lda, 0x7, 2, 6],
            0xB1: [this._lda, 0x8, 2, 5],
            0xA2: [this._ldx, 0x4, 2, 2],   //LDX
            0xA6: [this._ldx, 0xA, 2, 3],
            0xB6: [this._ldx, 0xC, 2, 4],
            0xAE: [this._ldx, 0x1, 3, 4],
            0xBE: [this._ldx, 0x3, 3, 4],
            0xA0: [this._ldy, 0x4, 2, 2],   //LDY
            0xA4: [this._ldy, 0xA, 2, 3],
            0xB4: [this._ldy, 0xB, 2, 4],
            0xAC: [this._ldy, 0x1, 3, 4],
            0xBC: [this._ldy, 0x2, 3, 4],
            0x4A: [this._lsr, 0x0, 1, 2],   //LDR
            0x46: [this._lsr, 0xA, 2, 5],
            0x56: [this._lsr, 0xB, 2, 6],
            0x4E: [this._lsr, 0x1, 3, 6],
            0x5E: [this._lsr, 0x2, 3, 7],
            0xEA: [this._nop, 0x5, 1, 2],   //NOP
            0x09: [this._ora, 0x4, 2, 2],   //ORA
            0x05: [this._ora, 0xA, 2, 3],
            0x15: [this._ora, 0xB, 2, 4],
            0x0D: [this._ora, 0x1, 3, 4],
            0x1D: [this._ora, 0x2, 3, 4],
            0x19: [this._ora, 0x3, 3, 4],
            0x01: [this._ora, 0x7, 2, 6],
            0x11: [this._ora, 0x8, 2, 5],
            0x48: [this._pha, 0x5, 1, 3],   //PHA
            0x08: [this._php, 0x5, 1, 3],   //PHP
            0x68: [this._pla, 0x5, 1, 4],   //PLA
            0x28: [this._plp, 0x5, 1, 4],   //PLP
            0x2A: [this._rol, 0x0, 1, 2],   //ROL
            0x26: [this._rol, 0xA, 2, 5],
            0x36: [this._rol, 0xB, 2, 6],
            0x2E: [this._rol, 0x1, 3, 6],
            0x3E: [this._rol, 0x2, 3, 7],
            0x6A: [this._ror, 0x0, 1, 2],   //ROR
            0x66: [this._ror, 0xA, 2, 5],
            0x76: [this._ror, 0xB, 2, 6],
            0x6E: [this._ror, 0x1, 3, 6],
            0x7E: [this._ror, 0x2, 3, 7],
            0x40: [this._rti, 0x5, 1, 6],   //RTI
            0x60: [this._rts, 0x5, 1, 6],   //RTS
            0xE9: [this._sbc, 0x4, 2, 2],   //SBC
            0xE5: [this._sbc, 0xA, 2, 3],
            0xF5: [this._sbc, 0xB, 2, 4],
            0xED: [this._sbc, 0x1, 3, 4],
            0xFD: [this._sbc, 0x2, 3, 4],
            0xF9: [this._sbc, 0x3, 3, 4],
            0xE1: [this._sbc, 0x7, 2, 6],
            0xF1: [this._sbc, 0x8, 2, 5],
            0x38: [this._sec, 0x5, 1, 2],   //SEC
            0xF8: [this._sed, 0x5, 1, 2],   //SED
            0x78: [this._sei, 0x5, 1, 2],   //SEI
            0x85: [this._sta, 0xA, 2, 3],   //STA
            0x95: [this._sta, 0xB, 2, 4],
            0x8D: [this._sta, 0x1, 3, 4],
            0x9D: [this._sta, 0x2, 3, 5],
            0x99: [this._sta, 0x3, 3, 5],
            0x81: [this._sta, 0x7, 2, 6],
            0x91: [this._sta, 0x8, 2, 6],
            0x86: [this._stx, 0xA, 2, 3],   //STX
            0x96: [this._stx, 0xC, 2, 4],
            0x8E: [this._stx, 0x1, 3, 4],
            0x84: [this._sty, 0xA, 2, 3],   //STY
            0x94: [this._sty, 0xB, 2, 4],
            0x8C: [this._sty, 0x1, 3, 4],
            0xAA: [this._tax, 0x5, 1, 2],   //TAX
            0xA8: [this._tay, 0x5, 1, 2],   //TAY
            0xBA: [this._tsx, 0x5, 1, 2],   //TSX
            0x8A: [this._txa, 0x5, 1, 2],   //TXA
            0x9A: [this._txs, 0x5, 1, 2],   //TXS
            0x98: [this._tya, 0x5, 1, 2],   //TYA
            //Illegal
            0x4B: [this._asr, 0x4, 2, 2],
            0x0B: [this._anc, 0x4, 2, 2],
            0x2B: [this._anc, 0x4, 2, 2],
            0x8B: [this._illegal, 0x4, 2, 2],
            0x6B: [this._arr, 0x4, 2, 2],
            0xC7: [this._dcp, 0xA, 2, 5],   //DCP (DCM)
            0xD7: [this._dcp, 0xB, 2, 6],
            0xCF: [this._dcp, 0x1, 3, 6],
            0xDF: [this._dcp, 0x2, 3, 7],
            0xDB: [this._dcp, 0x3, 3, 7],
            0xC3: [this._dcp, 0x7, 2, 8],
            0xD3: [this._dcp, 0x8, 2, 8],
            0xE7: [this._isc, 0xA, 2, 5],   //ISC (ISB, INS)
            0xF7: [this._isc, 0xB, 2, 6],
            0xEF: [this._isc, 0x1, 3, 6],
            0xFF: [this._isc, 0x2, 3, 7],
            0xFB: [this._isc, 0x3, 3, 7],
            0xE3: [this._isc, 0x7, 2, 8],
            0xF3: [this._isc, 0x8, 2, 8],
            0xBB: [this._illegal, 0x3, 3, 4],
            0xA7: [this._lax, 0xA, 2, 3],   //LAX
            0xB7: [this._lax, 0xC, 2, 4],
            0xAF: [this._lax, 0x1, 3, 4],
            0xBF: [this._lax, 0x3, 3, 4],
            0xA3: [this._lax, 0x7, 2, 6],
            0xB3: [this._lax, 0x8, 2, 5],
            0xAB: [this._lxa, 0x4, 2, 2],   //LXA(ATX)
            0x27: [this._rla, 0xA, 2, 5],   //RLA
            0x37: [this._rla, 0xB, 2, 6],
            0x2F: [this._rla, 0x1, 3, 6],
            0x3F: [this._rla, 0x2, 3, 7],
            0x3B: [this._rla, 0x3, 3, 7],
            0x23: [this._rla, 0x7, 2, 8],
            0x33: [this._rla, 0x8, 2, 8],
            0x67: [this._rra, 0xA, 2, 5],   //RRA
            0x77: [this._rra, 0xB, 2, 6],
            0x6F: [this._rra, 0x1, 3, 6],
            0x7F: [this._rra, 0x2, 3, 7],
            0x7B: [this._rra, 0x3, 3, 7],
            0x63: [this._rra, 0x7, 2, 8],
            0x73: [this._rra, 0x8, 2, 8],
            0x87: [this._sax, 0xA, 2, 3],   //SAX (AXS, AAX)
            0x97: [this._sax, 0xC, 2, 4],
            0x8F: [this._sax, 0x1, 3, 4],
            0x83: [this._sax, 0x7, 2, 6],
            0xCB: [this._axs, 0x4, 2, 2],   //SBX (AXS, SAX)
            0x9F: [this._illegal, 0x3, 3, 5],
            0x93: [this._illegal, 0x8, 2, 6],
            0x9E: [this._sxa, 0x3, 3, 5],
            0x9C: [this._sya, 0x2, 3, 5],
            0x07: [this._slo, 0xA, 2, 5],   //SLO (ASO)
            0x17: [this._slo, 0xB, 2, 6],
            0x0F: [this._slo, 0x1, 3, 6],
            0x1F: [this._slo, 0x2, 3, 7],
            0x1B: [this._slo, 0x3, 3, 7],
            0x03: [this._slo, 0x7, 2, 8],
            0x13: [this._slo, 0x8, 2, 8],
            0x47: [this._sre, 0xA, 2, 5],   //SRE (LSE)
            0x57: [this._sre, 0xB, 2, 6],
            0x4F: [this._sre, 0x1, 3, 6],
            0x5F: [this._sre, 0x2, 3, 7],
            0x5B: [this._sre, 0x3, 3, 7],
            0x43: [this._sre, 0x7, 2, 8],
            0x53: [this._sre, 0x8, 2, 8],
            0x9B: [this._illegal, 0x3, 3, 5],
            0xEB: [this._sbc, 0x4, 2, 2],   //SBC
            0x1A: [this._nop, 0x5, 1, 2],   //NOP
            0x3A: [this._nop, 0x5, 1, 2],
            0x5A: [this._nop, 0x5, 1, 2],
            0x7A: [this._nop, 0x5, 1, 2],
            0xDA: [this._nop, 0x5, 1, 2],
            0xFA: [this._nop, 0x5, 1, 2],
            0x80: [this._nop, 0x4, 2, 2],
            0x82: [this._nop, 0x4, 2, 2],
            0x89: [this._nop, 0x4, 2, 2],
            0xC2: [this._nop, 0x4, 2, 2],
            0xE2: [this._nop, 0x4, 2, 2],
            0x04: [this._nop, 0xA, 2, 3],
            0x44: [this._nop, 0xA, 2, 3],
            0x64: [this._nop, 0xA, 2, 3],
            0x14: [this._nop, 0xB, 2, 4],
            0x34: [this._nop, 0xB, 2, 4],
            0x54: [this._nop, 0xB, 2, 4],
            0x74: [this._nop, 0xB, 2, 4],
            0xD4: [this._nop, 0xB, 2, 4],
            0xF4: [this._nop, 0xB, 2, 4],
            0x0C: [this._nop, 0x1, 3, 4],
            0x1C: [this._nop, 0x2, 3, 4],
            0x3C: [this._nop, 0x2, 3, 4],
            0x5C: [this._nop, 0x2, 3, 4],
            0x7C: [this._nop, 0x2, 3, 4],
            0xDC: [this._nop, 0x2, 3, 4],
            0xFC: [this._nop, 0x2, 3, 4],
            0x02: [this._jam, 0x0, 0, 0],   //JAM
            0x12: [this._jam, 0x0, 0, 0],
            0x22: [this._jam, 0x0, 0, 0],
            0x32: [this._jam, 0x0, 0, 0],
            0x42: [this._jam, 0x0, 0, 0],
            0x52: [this._jam, 0x0, 0, 0],
            0x62: [this._jam, 0x0, 0, 0],
            0x72: [this._jam, 0x0, 0, 0],
            0x92: [this._jam, 0x0, 0, 0],
            0xB2: [this._jam, 0x0, 0, 0],
            0xD2: [this._jam, 0x0, 0, 0],
            0xF2: [this._jam, 0x0, 0, 0]
        };
    }

    get _stateExclude() {
        return ["_bus", "_inst_table", "_break_on", "debugLevel"];
    }
    get scheduler() { return this._scheduler; }
    get breakOn() { return this._breakOn; }
    set breakOn(v) {
        if (Array.isArray(v)) {
            this._breakOn = v;
        } else {
            this._breakOn.push(v);
        }
    }
    resetState() {
        super.resetState();
        this._pc = 0x8000;
        this._ac = 0;
        this._x = 0;
        this._y = 0;
        this._sr.val = 0x34;
        this._sp = 0x0;
        this.cycles = 0;

        this._scheduler.reset();
        this._intReset = true;
        this._intNmi = false;
        this._irqLines = 0;
    }

    intReset() {
        this._intReset = true;
    }

    /**Set NMI pin high/low value */
    setNMI(val) {
        //NMI triggered when value change from high to low
        if (this._nmi && !val) this._intNmi = true;
        this._nmi = val;
    }

    isUpIRQ(line) {
        return !!(this._irqLines & (0x1 << line));
    }

    /**Set logic hi-value on irq line */
    setUpIRQ(line) {
        this._irqLines |= 0x1 << line;
        //this._irqDelay = this.cycles + 0;
    }
    /**Set logic low-value on irq line */
    setDownIRQ(line) {
        this._irqLines &= ~(0x1 << line);
    }

    get pc() { return this._pc; }
    get ac() { return this._ac; }
    get x() { return this._x; }
    get y() { return this._y; }
    get sr() { return this._sr; }
    get sp() { return this._sp; }

    /**Operation code */
    get opc() { return this._bus.read(this._pc); }
    // Instruction operand
    get instOperUint8() { return this._bus.read(this._pc + 1); }
    get instOperInt8() { return this._bus.readInt(this._pc + 1); }
    get instOperUint16() { return this._bus.read16(this._pc + 1); }
    get instOperInt16() { return this._bus.readInt16(this._pc + 1); }

    _pageCrossBehaviour(addr, term) {
        if (((addr & 0xFF) + term) & 0xFF00) {
            if (!CRSPG_EXCLUDE.includes(this.opc)) this.cycles++;
            this._bus.read((addr & 0xFF00) | ((addr + term) & 0x00FF), true);   //Dummy read
        }
    }
    getOperandAddress(mode) {
        let res = null;

        switch (mode) {
            case 0x0: // Accumulator
                res = this._ac;
                break;
            case 0x1: // Absolute
                res = this.instOperUint16;
                break;
            case 0x2: // Absolute X
                res = this.instOperUint16;
                this._pageCrossBehaviour(res, this._x);
                res += this._x;
                break;
            case 0x3: // Absolute Y
                res = this.instOperUint16;
                this._pageCrossBehaviour(res, this._y);
                res += this._y;
                break;
            case 0x4: // Immediate
                res = this._pc + 1;
                break;
            case 0x5: // Implied
                break;
            case 0x6: // Indirect
                res = this._bus.read16(this.instOperUint16);
                break;
            case 0x7: // Indirect X
                res = this._bus.read((this.instOperUint8 + this._x) & 0xFF) | (this._bus.read((this.instOperUint8 + this._x + 1) & 0xFF) << 8);
                break;
            case 0x8: // Indirect Y
                res = this._bus.read(this.instOperUint8) | (this._bus.read((this.instOperUint8 + 1) & 0xFF) << 8);
                this._pageCrossBehaviour(res, this._y);
                res += this._y;
                break;
            case 0x9: // Relative
                res = this._pc + this.instOperInt8 + 2;
                break;
            case 0xA: // Zeropage
                res = this.instOperUint8;
                break;
            case 0xB: // Zeropage X
                res = (this.instOperUint8 + this._x) & 0xFF;
                break;
            case 0xC: // Zeropage Y
                res = (this.instOperUint8 + this._y) & 0xFF;
                break;
            default:
                break;
        }
        return res & 0xFFFF;
    }
    _isDebug(inst, addr) {
        let res = this.debugLevel >= 2;
        let isLog = this.debugLevel >= 1;
        if (this._breakOn.includes(this._pc)) {
            isLog = true;
            res = true;
        }
        if (isLog) {
            console.log(`0x${this._pc.toString(16)}:${inst[0].name}(0x${(addr | 'implied').toString(16)})\tac:0x${this._ac.toString(16)};x:0x${this._x.toString(16)};y:0x${this._y.toString(16)};sp:0x${this._sp.toString(16)};sr:${this._sr.toString()};clc:${this.cycles}`);
        }
        return res;
    }

    step() {
        if (this._intReset) {
            this._intReset = false;
            this._scheduler.reset();
            this._pc = this._bus.read16(0xFFFC);
            this._sr.i = true;
            this._sp = (this._sp - 3) & 0xFF;
            this.cycles += 8;
        } else {
            if (!this._skipIrq) {
                if (this._intNmi) {
                    this._intNmi = false;
                    this._pushUint8(this._pc >> 8);
                    this._pushUint8(this._pc & 0xFF);
                    this._pushUint8(this._sr);
                    this._pc = this._bus.read16(0xFFFA);

                    this.cycles += 7;
                } else {
                    //if (this._irqLines && !this._sr.i && this._irqDelay <= this.cycles) {
                    if (this._irqLines && !this._sr.i) {
                        this._pushUint8(this._pc >> 8);
                        this._pushUint8(this._pc & 0xFF);
                        this._pushUint8(this._sr);
                        this._sr.i = true;
                        this._pc = this._bus.read16(0xFFFE);

                        this.cycles += 7;
                    }
                }
            }
        }
        this._skipIrq = false;

        let inst = this._inst_table[this.opc];
        let addr = this.getOperandAddress(inst[1]);

        if (this._isDebug(inst, addr)) { debugger; }

        //If instruction function return true, PC register already updated
        if (!inst[0].call(this, addr, inst[1])) {
            this._pc += inst[2];
        }

        this.cycles += inst[3];
        this._scheduler.doJob();
    }

    /**Push byte to stack */
    _pushUint8(val) {
        this._bus.write(0x0100 | this._sp, val);
        this._sp--;
        this._sp &= 0xFF;
    }

    /**Pull byte from stack */
    _pullUint8() {
        this._sp++;
        this._sp &= 0xFF;
        return this._bus.read(0x0100 | this._sp);
    }

    _adc_helper(operand) {
        let res = this._ac + operand + this._sr.c;
        this._sr.c = res & 0xFF00;
        this._sr.v = (this._ac ^ res) & (operand ^ res) & 0x80;
        this._ac = res & 0xFF;
        this._sr.setNZ(this._ac);
    }
    _adc(addr) {
        let operand = this._bus.read(addr);
        this._adc_helper(operand);
    }
    _and(addr) {
        this._ac &= this._bus.read(addr);
        this._sr.setNZ(this._ac);
    }
    _asl(addr, mode) {
        let operand = this._ac;
        if (mode) {
            operand = this._bus.read(addr);
            this._bus.write(addr, operand, true); //Double-write
        }
        operand <<= 1;
        this._sr.c = operand & 0x0100;
        operand &= 0xFF;
        this._sr.setNZ(operand);

        if (mode == 0x0) {
            this._ac = operand
        } else {
            this._bus.write(addr, operand);
        }
    }

    _branch_helper(addr) {
        this._pc += this._inst_table[this.opc][2];
        if ((this._pc & 0xFF00) == (addr & 0xFF00)) {
            this._skipIrq = true;
            this.cycles++;
        } else {
            this.cycles += 2;
        }
        this._pc = addr;
    }
    _bcc(addr) {
        if (!this._sr.c) {
            this._branch_helper(addr);
            return true;
        }
    }
    _bcs(addr) {
        if (this._sr.c) {
            this._branch_helper(addr);
            return true;
        }
    }
    _beq(addr) {
        if (this._sr.z) {
            this._branch_helper(addr);
            return true;
        }
    }
    _bit(addr) {
        let operand = this._bus.read(addr);
        this._sr.v = operand & 0x40;
        this._sr.n = operand & 0x80;
        this._sr.z = !(this._ac & operand);
    }
    _bmi(addr) {
        if (this._sr.n) {
            this._branch_helper(addr);
            return true;
        }
    }
    _bne(addr) {
        if (!this._sr.z) {
            this._branch_helper(addr);
            return true;
        }
    }
    _bpl(addr) {
        if (!this._sr.n) {
            this._branch_helper(addr);
            return true;
        }
    }
    _brk() {
        // TODO push 16 bit
        this._pc += 2;
        this._pushUint8(this._pc >> 8);
        this._pushUint8(this._pc & 0xFF);
        this._pushUint8(this._sr | 0x30);

        this._sr.i = true;
        this._pc = this._bus.read16(0xFFFE);
        return true;
    }
    _bvc(addr) {
        if (!this._sr.v) {
            this._branch_helper(addr);
            return true;
        }
    }
    _bvs(addr) {
        if (this._sr.v) {
            this._branch_helper(addr);
            return true;
        }
    }
    _clc() {
        this._sr.c = false;
    }
    _cld() {
        this._sr.d = false;
    }
    _cli() {
        this._sr.i = false;
    }
    _clv() {
        this._sr.v = false;
    }
    _cmp(addr) {
        let buf = this._ac - this._bus.read(addr);
        this._sr.c = !(buf & 0x100);
        this._sr.setNZ(buf);
    }
    _cpx(addr) {
        let buf = this._x - this._bus.read(addr);
        this._sr.c = buf >= 0;
        this._sr.setNZ(buf);
    }
    _cpy(addr) {
        let buf = this._y - this._bus.read(addr);
        this._sr.c = buf >= 0;
        this._sr.setNZ(buf);
    }
    _dec(addr) {
        let buf = this._bus.read(addr);
        this._bus.write(addr, buf, true); //Double-write
        buf = (buf - 1) & 0xFF;
        this._sr.setNZ(buf);
        this._bus.write(addr, buf);
    }
    _dex() {
        this._x = (this._x - 1) & 0xFF;
        this._sr.setNZ(this._x);
    }
    _dey() {
        this._y = (this._y - 1) & 0xFF;
        this._sr.setNZ(this._y);
    }
    _eor(addr) {
        this._ac ^= this._bus.read(addr);
        this._sr.setNZ(this._ac);
    }
    _inc(addr) {
        let buf = this._bus.read(addr);
        this._bus.write(addr, buf, true); //Double-write
        buf = (buf + 1) & 0xFF;
        this._sr.setNZ(buf);
        this._bus.write(addr, buf);
    }
    _inx() {
        this._x = (this._x + 1) & 0xFF;
        this._sr.setNZ(this._x);
    }
    _iny() {
        this._y = (this._y + 1) & 0xFF;
        this._sr.setNZ(this._y);
    }
    _jmp(addr) {
        this._pc = addr;
        return true;
    }
    _jmp_ind(addr) {    // Special behaviour on JMP ($xxFF) address access
        if (!((this.instOperUint16 & 0xFF) ^ 0xFF)) {
            this._pc = (this._bus.read(this.instOperUint16 & 0xFF00) << 8) | this._bus.read(this.instOperUint16);
        } else {
            this._pc = addr;
        }
        return true;
    }
    _jsr(addr) {
        this._pc += 2;
        this._pushUint8(this._pc >> 8);
        this._pushUint8(this._pc & 0xFF);
        this._pc = addr;
        return true;
    }
    _lda(addr) {
        this._ac = this._bus.read(addr);
        this._sr.setNZ(this._ac);
    }
    _ldx(addr) {
        this._x = this._bus.read(addr);
        this._sr.setNZ(this._x);
    }
    _ldy(addr) {
        this._y = this._bus.read(addr);
        this._sr.setNZ(this._y);
    }
    _lsr(addr, mode) {
        let operand = this._ac;
        if (mode) {
            operand = this._bus.read(addr);
            this._bus.write(addr, operand, true); //Double-write
        }
        this._sr.c = operand & 0x1;
        operand >>= 1;
        this._sr.setNZ(operand);

        if (mode == 0x0) {
            this._ac = operand
        } else {
            this._bus.write(addr, operand);
        }
    }
    _nop() { }
    _ora(addr) {
        this._ac |= this._bus.read(addr);
        this._sr.setNZ(this._ac);
    }
    _pha() {
        this._pushUint8(this._ac);
    }
    _php() {
        this._pushUint8(this._sr | 0x30);
    }
    _pla() {
        this._ac = this._pullUint8();
        this._sr.setNZ(this._ac);
    }
    _plp() {
        this._sr.val = this._pullUint8();
    }
    _rol(addr, mode) {
        let operand = this._ac;
        if (mode) {
            operand = this._bus.read(addr);
            this._bus.write(addr, operand, true); //Double-write
        }
        operand <<= 1;
        operand |= this._sr.c;
        this._sr.c = operand & 0x0100;
        operand &= 0xFF;
        this._sr.setNZ(operand);

        if (mode == 0x0) {
            this._ac = operand
        } else {
            this._bus.write(addr, operand);
        }
    }
    _ror(addr, mode) {
        let operand = this._ac;
        if (mode) {
            operand = this._bus.read(addr);
            this._bus.write(addr, operand, true); //Double-write
        }

        operand |= this._sr.c << 8;
        this._sr.c = operand & 0x1;
        operand >>= 1;
        this._sr.setNZ(operand);

        if (mode == 0x0) {
            this._ac = operand
        } else {
            this._bus.write(addr, operand);
        }
    }

    /**Return from Interrupt */
    _rti() {
        this._sr.val = this._pullUint8();
        // TODO: pull 16 bit
        this._pc = 0x0;
        this._pc |= this._pullUint8();
        this._pc |= this._pullUint8() << 8;

        return true;
    }

    /**Return from Subroutine */
    _rts() {
        // TODO: pull 16 bit
        this._pc = 0x0;
        this._pc |= this._pullUint8();
        this._pc |= this._pullUint8() << 8;
        this._pc++;
        return true;
    }
    _sbc(addr) {
        let operand = this._bus.read(addr);

        let res = this._ac - operand - !this._sr.c;
        this._sr.c = !(res & 0xFF00);
        this._sr.v = (this._ac ^ res) & ((255 - operand) ^ res) & 0x80;
        this._ac = res & 0xFF;

        this._sr.setNZ(this._ac);
    }
    _sec() {
        this._sr.c = true;
    }
    _sed() {
        this._sr.d = true;
    }
    _sei() {
        this._sr.i = true;
    }
    _sta(addr) {
        this._bus.write(addr, this._ac);
    }
    _stx(addr) {
        this._bus.write(addr, this._x);
    }
    _sty(addr) {
        this._bus.write(addr, this._y);
    }
    _tax() {
        this._x = this._ac;
        this._sr.setNZ(this._x);
    }
    _tay() {
        this._y = this._ac;
        this._sr.setNZ(this._y);
    }
    _tsx() {
        this._x = this._sp;
        this._sr.setNZ(this._x);
    }
    _txa() {
        this._ac = this._x;
        this._sr.setNZ(this._ac);
    }
    _txs() {
        this._sp = this._x;
    }
    _tya() {
        this._ac = this._y;
        this._sr.setNZ(this.ac);
    }

    // Illegal instructions
    _anc(addr) {
        this._and(addr);
        this._sr.c = this._ac & 0x80;
    }

    _asr(addr) {
        this._and(addr);
        this._lsr(addr, 0x0);
    }

    _arr(addr) {
        this._ac = (this._ac & this._bus.read(addr)) >> 1;
        if (this._sr.c) this._ac |= 0x80;
        this._sr.setNZ(this._ac);

        this._sr.c = this._ac & 0x40;
        this._sr.v = ((this._sr.c ? 1 : 0) ^ ((this._ac >> 5) & 0x1));
    }

    _lxa(addr) {
        this._ac = this._bus.read(addr);
        this._x = this._ac;
        this._sr.setNZ(this._ac);
    }

    _axs(addr) {
        let operand = this._bus.read(addr);
        this._sr.c = (this._ac & this._x) >= operand;
        this._x = (this._ac & this._x) - operand;
        this._sr.setNZ(this._x);
    }
    /**ASL & ORA */
    _slo(addr) {
        let operand = this._bus.read(addr);
        this._bus.write(addr, operand, true); //Double-write
        operand <<= 1;
        this._sr.c = operand & 0x0100;
        operand &= 0xFF;
        this._ac |= operand
        this._sr.setNZ(this._ac);
        this._bus.write(addr, operand);
    }
    /**LSR & EOR */
    _rla(addr) {
        let operand = this._bus.read(addr);
        this._bus.write(addr, operand, true); //Double-write
        operand <<= 1;
        operand |= this._sr.c;
        this._sr.c = operand & 0x0100;
        operand &= 0xFF;
        this._ac &= operand
        this._sr.setNZ(this._ac);
        this._bus.write(addr, operand);
    }
    /**ROL & AND */
    _sre(addr) {
        let operand = this._bus.read(addr);
        this._bus.write(addr, operand, true); //Double-write
        this._sr.c = operand & 0x1;
        operand >>= 1;
        this._ac ^= operand;
        this._sr.setNZ(this._ac);
        this._bus.write(addr, operand);
    }
    /**ROR & ADC */
    _rra(addr) {
        let operand = this._bus.read(addr);
        this._bus.write(addr, operand, true); //Double-write
        operand |= this._sr.c << 8;
        this._sr.c = operand & 0x1;
        operand >>= 1;
        this._adc_helper(operand);
        this._bus.write(addr, operand);
    }
    /**STA & STX */
    _sax(addr) {
        this._bus.write(addr, this._ac & this._x);
    }
    /**LDA & LDX */
    _lax(addr) {
        let operand = this._bus.read(addr);
        this._ac = operand;
        this._x = operand;
        this._sr.setNZ(operand);
    }
    /**DEC & CMP */
    _dcp(addr) {
        let operand = this._bus.read(addr);
        this._bus.write(addr, operand, true); //Double-write
        operand = (operand - 1) & 0xFF;
        let buf = this._ac - operand;
        this._sr.c = !(buf & 0x100);
        this._sr.setNZ(buf);
        this._bus.write(addr, operand);
    }
    /**INC & SBC */
    _isc(addr) {
        let operand = this._bus.read(addr);
        this._bus.write(addr, operand, true); //Double-write
        operand = (operand + 1) & 0xFF;
        this._adc_helper(operand ^ 0xFF);
        this._bus.write(addr, operand);
    }
    //Illegal absolute
    _sya(addr) {
        let hi = addr >> 8;
        let lo = addr & 0xFF;
        let val = this._y & (hi + 1);
        this._bus.write((val << 8) | lo, val);
    }
    _sxa(addr) {
        let hi = addr >> 8;
        let lo = addr & 0xFF;
        let val = this._x & (hi + 1);
        this._bus.write((val << 8) | lo, val);
    }

    _illegal() {
        console.debug(`Illegal instruction: 0x${this.opc.toString(16)}`);
    }

    _jam() {
        throw `Jam instruction: 0x${this.opc.toString(16)}`;
    }
}

export { CPU };