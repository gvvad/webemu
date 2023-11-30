import { BusMain, IRQLine } from "./bus_main.js";
import { Ines } from "./ines.js"
import { EObject } from "./eobj.js";

class EUint8Array extends Uint8Array {
    constructor(...args) {
        super(...args);
        this._max = 0;
    }
    setMax(max) {
        this._max = max;
    }
    setSafety(index, val) {
        this[index] = (val >= this._max) ? val & this._max : val;
    }
}

class MapperBase extends EObject {
    /**
     * @param {BusMain} bus
     * @param {Ines} rom */
    constructor(bus, rom) {
        super();
        this._bus = bus;
        this._rom = rom;
        this.onTileBankChange = Function.prototype;

        this._sramBuffer = new ArrayBuffer(0x2000);
        this._vSram = new DataView(this._sramBuffer);

        /**Array item, it`s table id (0 - 3)
         * [0, 0, 1, 1] - Horizontal
         * [0, 1, 0, 1] - Vertical
         * [0, 0, 0, 0] - Single Screen
         * [0, 1, 2, 3] - 4 Screen
         * @type {Array<Number>} */
        this.mirroringMap = undefined;
        if (this._rom.fourScreenMode) {
            this.mirroringMap = [0, 1, 2, 3];
        } else {
            this.mirroringMap = (this._rom.mirroringMode) ? [0, 1, 0, 1] : [0, 0, 1, 1];
        }

        //this._setPrgBankSize(0x4000);

        /**@type {Array<Uint8Array>} Tile banks [8 KiB] */
        this._aTileBank = undefined;

        /**@type {DataView} */
        this._vTileBank = undefined;
        if (this._rom.tileBankCounts) {
            this._aTileLocalCopy = new Uint8Array(this._rom.vTileBank.byteLength);
            this._aTileLocalCopy.set(this._rom.u8TileBank);
            this._vTileBank = new DataView(this._aTileLocalCopy.buffer);
        } else {    //rom has no tile bank, empty buffer created
            this._tileBankBuffer = new ArrayBuffer(0x2000);
            this._vTileBank = new DataView(this._tileBankBuffer);
        }
    }
    get _stateExclude() {
        return ["_bus", "_rom", "onTileBankChange"];
    }
    setState(state) {
        super.setState(state);
        this.onTileBankChange();
    }

    doVramAddressChange() { }

    get rom() { return this._rom; }
    get aTileBank() { return this._aTileBank; }

    /**
     * Set prg window size. Use '_aPrgBankIdFor' to swap banks.
     * @param {Number} size window size in bytes (must be power of 2)
     */
    _setPrgBankSize(size) {
        /**@type {Array<DataView>} Prg banks. */
        this._aPrgBank = this._rom.getPrgBanks(size);
        this._prgBankIdBuffer = new ArrayBuffer(0x8000 / size);
        /**Bank access vector. */
        this._aPrgBankId = new EUint8Array(this._prgBankIdBuffer);
        this._aPrgBankId.setMax(this._aPrgBank.length - 1);
        this._aPrgBankId.fill(0);
        this._aPrgBankId[this._aPrgBankId.length - 1] = this._aPrgBank.length - 1;

        /**Bit position num (14...1), that divide address in hi/lo space (bank/offset). */
        this._prgWindowMaskBit = 1;
        /**Bit mask, that cover lo address space (offset). */
        this._prgWindowMask = 0x1;
        let buf = size;
        for (; this._prgWindowMaskBit < 16; this._prgWindowMaskBit++) {
            this._prgWindowMask |= 0x1 << (this._prgWindowMaskBit - 1);
            buf >>= 1;
            if (buf & 0x1) break;
        }
    }

    _setTileBankSize(size) {
        this._aTileBank = new Array(this._vTileBank.byteLength / size);
        for (let i = 0; i < this._aTileBank.length; i++) {
            this._aTileBank[i] = new Uint8Array(this._vTileBank.buffer, this._vTileBank.byteOffset + (i * size), size);
        }

        this._tileBankIdBuffer = new ArrayBuffer(0x2000 / size);
        this._aTileBankId = new EUint8Array(this._tileBankIdBuffer);
        this._aTileBankId.setMax(this._aTileBank.length - 1);
        for (let i = 0; i < this._aTileBankId.length; i++) this._aTileBankId[i] = i;

        this._tileWindowMaskBit = 1;
        this._tileWindowMask = 0x1;
        let buf = size;
        for (; this._tileWindowMaskBit < 13; this._tileWindowMaskBit++) {
            this._tileWindowMask |= 0x1 << (this._tileWindowMaskBit - 1);
            buf >>= 1;
            if (buf & 0x1) break;
        }
    }

    getTile(table, offset) {
        let addr = (table) ? 0x1000 : 0x0;
        addr |= offset;
        return this.readTile(addr);
    }

    getTileOffset(addr) {
        let id = this._aTileBankId[addr >> this._tileWindowMaskBit];
        if (id >= this._aTileBank.length) id &= this._aTileBank.length - 1;

        return [id, addr & this._tileWindowMask];
    }

    /**Mem space 0x4020 - 0x5FFF */
    readExpansion(addr) {
        if (!this.__isReadExpansionWarning) {
            console.warn(`${this.constructor.name}::Expansion read not implemented! [0x${addr.toString(16)}]`);
            this.__isReadExpansionWarning = true;
        }
    }
    /**Mem space 0x4020 - 0x5FFF */
    writeExpansion(addr, data) {
        if (!this.__isWriteExpansionWarning) {
            console.warn(`${this.constructor.name}::Expansion write not implemented! [0x${addr.toString(16)}] := 0x${data.toString(16)}`);
            this.__isWriteExpansionWarning = true;
        }
    }

    readSram(addr) {
        return this._vSram.getUint8(addr);
    }
    writeSram(addr, data) {
        this._vSram.setUint8(addr, data);
    }

    /**Read program ROM */
    readPrg(addr) {
        let _addr = addr & this._prgWindowMask;
        let bank = addr >> this._prgWindowMaskBit;
        return this._aPrgBank[this._aPrgBankId[bank]].getUint8(_addr);
    }
    /**Write program space or mapper registers */
    writePrg(addr, data) {
        if (!this.__isWritePrgWarning) {
            console.warn(`${this.constructor.name}::Prg write not implemented! [0x${addr.toString(16)}]`);
            this.__isWritePrgWarning = true;
        }
    }

    /**Read tile table rom */
    readTile(addr) {
        let res = this.getTileOffset(addr);
        return this._aTileBank[res[0]][res[1]];
    }
    /**Write tile table rom */
    writeTile(addr, data) {
        let res = this.getTileOffset(addr);
        this._aTileBank[res[0]][res[1]] = data;
        this.onTileBankChange(res[0]);
    }
}
/** @param {Ines} rom */
MapperBase.getConstructor = function (rom) {
    let res = MapperList[rom.iMapper];
    if (!res) {
        res = Mapper000;
        console.warn(`Mapper:#${rom.iMapper} not implemented`);
    }
    return res;
}

class Mapper000 extends MapperBase {
    constructor(...args) {
        super(...args);
        this._setPrgBankSize(0x4000);
        this._setTileBankSize(0x1000);
    }
}

class Mapper001 extends MapperBase {
    constructor(...args) {
        super(...args);
        this._buffer = 0;
        this._bufCounter = 0;

        this._rControl = 0xC;
        this._rChrBank0 = 0;
        this._rChrBank1 = 0;
        this._rPrgBank = 0;

        this._MIRRORING_MAPS = [
            [0, 0, 0, 0],//one-screen A
            [1, 1, 1, 1],//one-screen B
            [0, 1, 0, 1],//vertical
            [0, 0, 1, 1]//horizontal
        ];
        this._setPrgBankSize(0x4000);
        this._setTileBankSize(0x1000);
        this._update();
    }

    /**0: one-screen, lower bank; 1: one-screen, upper bank;2: vertical; 3: horizontal */
    get _mirroringMode() { return this._rControl & 0x3; }

    /**PRG ROM bank mode
     * (0, 1: switch 32 KB at $8000, ignoring low bit of bank number;
     * 2: fix first bank at $8000 and switch 16 KiB bank at $C000;
     * 3: fix last bank at $C000 and switch 16 KiB bank at $8000) */
    get _prgBankMode() { return (this._rControl & 0xC) >> 2; }
    /**CHR ROM bank mode (0: switch 8 KiB at a time; 1: switch two separate 4 KiB banks) */
    get _tileBankMode() { return (this._rControl & 0x10) >> 4; }

    _update() {
        this.mirroringMap = this._MIRRORING_MAPS[this._mirroringMode];

        switch (this._prgBankMode) {
            case 0:
            case 1:
                this._aPrgBankId.setSafety(0, this._rPrgBank & 0xFE);
                this._aPrgBankId.setSafety(1, (this._rPrgBank & 0xFE) | 0x1);
                break;
            case 2:
                this._aPrgBankId.setSafety(0, 0);
                this._aPrgBankId.setSafety(1, this._rPrgBank & 0xF);
                break;
            case 3:
                this._aPrgBankId.setSafety(0, this._rPrgBank & 0xF);
                this._aPrgBankId.setSafety(1, this._aPrgBank.length - 1);
                break;
            default:
                break;
        }

        if (this._tileBankMode == 0) {  //8 KiB
            this._aTileBankId.setSafety(0, this._rChrBank0 & 0x1E);
            this._aTileBankId.setSafety(1, this._aTileBankId[0] | 1);
        } else {    //4 KiB
            this._aTileBankId.setSafety(0, this._rChrBank0 & 0x1F);
            this._aTileBankId.setSafety(1, this._rChrBank1 & 0x1F);
        }
    }

    _resetBuffer() {
        this._buffer = 0;
        this._bufCounter = 0;
    }

    writePrg(addr, data) {
        // if (!((this._bus.cpu.cycles - this._cycleStamp) >= 2)) {
        //     console.log("cyc");
        // }
        if (this._bus.isDummy) {
            console.log("mmc1 write dummy!");
        }

        dispatch: {
            if (data & 0x80) {
                this._resetBuffer();
                this._rControl |= 0xC;
                this._update();
                break dispatch;
            } else {
                this._buffer >>= 1;
                this._buffer |= (data & 0x1) << 4;
                this._bufCounter++;
            }

            if (this._bufCounter >= 5) {
                switch (addr & 0x6000) {
                    case 0x0000:
                        this._rControl = this._buffer;
                        break;
                    case 0x2000:
                        this._rChrBank0 = this._buffer;
                        break;
                    case 0x4000:
                        this._rChrBank1 = this._buffer;
                        break;
                    case 0x6000:
                        this._rPrgBank = this._buffer;
                        break;
                    default:
                        break;
                }
                this._update();
                this._resetBuffer();
            }
        }
        //this._cycleStamp = this._bus.cpu.cycles;
    }
}

class Mapper002 extends MapperBase {
    constructor(...args) {
        super(...args);
        this._setPrgBankSize(0x4000);
        this._setTileBankSize(0x1000);
        this._aPrgBankId.setSafety(1, this._aPrgBank.length - 1);
    }

    writePrg(addr, data) {
        this._aPrgBankId.setSafety(0, data & 0xF);
    }
}

class Mapper003 extends MapperBase {
    constructor(...args) {
        super(...args);
        this._setPrgBankSize(0x4000);
        this._setTileBankSize(0x1000);
    }

    writePrg(addr, data) {
        this._aTileBankId.setSafety(0, (data & 0x3) << 1);
        this._aTileBankId.setSafety(1, this._aTileBankId[0] | 1);
    }
}

class Mapper004 extends MapperBase {
    constructor(...args) {
        super(...args);
        this._irqEnable = false;
        this._irqLatch = 0;
        this._irqCounter = 0;
        this._irqReload = false;
        this._rId = 0;
        this._r = new Array(8);
        this._r.fill(0);
        this._prgMode = false;
        this._chrInversion = false;

        this._setPrgBankSize(0x2000);
        this._aPrgBankId.setSafety(0, 0);
        this._aPrgBankId.setSafety(1, 1);
        this._aPrgBankId.setSafety(2, this._aPrgBank.length - 2);
        this._aPrgBankId.setSafety(3, this._aPrgBank.length - 1);

        this._setTileBankSize(0x400);
    }

    doVramAddressChange(changeMask, newAddr) {
        if (changeMask & 0x1000 && (newAddr & 0x1000)) {   //bit 12 toggle to 1
            //let count = this._irqCounter;
            if (this._irqCounter == 0 || this._irqReload) {
                this._irqCounter = this._irqLatch;
            } else {
                this._irqCounter--;
            }

            //if (((count && this._irqLatch > 0) || this._irqReload) && this._irqCounter == 0 && this._irqEnable) {
            if (this._irqCounter == 0 && this._irqEnable) {
                this._bus.cpu.setUpIRQ(IRQLine.Mapper);
            }

            this._irqReload = false;
        }
    }

    writePrg(addr, data) {
        let regNum = (addr & 0x6000) >> 13;
        let regPair = addr & 0x1;
        switch (regNum) {
            case 0:
                if (regPair == 0) { //Bank select
                    this._rId = data & 0x7;
                    this._prgMode = !!(data & 0x40);
                    this._chrInversion = !!(data & 0x80);
                } else {    //Bank data
                    this._r[this._rId] = data;
                }

                if (this._prgMode) {
                    this._aPrgBankId.setSafety(0, this._aPrgBank.length - 2);
                    this._aPrgBankId.setSafety(1, this._r[7]);
                    this._aPrgBankId.setSafety(2, this._r[6]);
                    this._aPrgBankId.setSafety(3, this._aPrgBank.length - 1);
                } else {
                    this._aPrgBankId.setSafety(0, this._r[6]);
                    this._aPrgBankId.setSafety(1, this._r[7]);
                    this._aPrgBankId.setSafety(2, this._aPrgBank.length - 2);
                    this._aPrgBankId.setSafety(3, this._aPrgBank.length - 1);
                }

                if (this._chrInversion) {
                    this._aTileBankId.setSafety(0, this._r[2]);
                    this._aTileBankId.setSafety(1, this._r[3]);
                    this._aTileBankId.setSafety(2, this._r[4]);
                    this._aTileBankId.setSafety(3, this._r[5]);
                    this._aTileBankId.setSafety(4, this._r[0]);
                    this._aTileBankId.setSafety(5, this._r[0] + 1);
                    this._aTileBankId.setSafety(6, this._r[1]);
                    this._aTileBankId.setSafety(7, this._r[1] + 1);
                } else {
                    this._aTileBankId.setSafety(0, this._r[0]);
                    this._aTileBankId.setSafety(1, this._r[0] + 1);
                    this._aTileBankId.setSafety(2, this._r[1]);
                    this._aTileBankId.setSafety(3, this._r[1] + 1);
                    this._aTileBankId.setSafety(4, this._r[2]);
                    this._aTileBankId.setSafety(5, this._r[3]);
                    this._aTileBankId.setSafety(6, this._r[4]);
                    this._aTileBankId.setSafety(7, this._r[5]);
                }
                break;
            case 1:
                if (regPair == 0) { //Mirroring (0, 1 : H, V)
                    this.mirroringMap = (data & 0x1) ? [0, 0, 1, 1] : [0, 1, 0, 1];
                } else {    //PRG Ram Protect

                }
                break;
            case 2:
                if (regPair == 0) { //IRQ Latch
                    this._irqLatch = data;
                } else {    //IRQ reload
                    this._irqReload = true;
                    this._irqCounter = 0;
                }
                break;
            case 3: //even - disable, odd - enable
                if (regPair) {
                    this._irqEnable = true;
                } else {
                    this._irqEnable = false;
                    this._bus.cpu.setDownIRQ(IRQLine.Mapper);
                }
                break;
            default:
                break;
        }
    }
}

class Mapper007 extends MapperBase {
    constructor(...args) {
        super(...args);
        this._setPrgBankSize(0x8000);
        this._setTileBankSize(0x1000);
        this._aPrgBankId.setSafety(0, this._aPrgBank.length - 1);
    }

    writePrg(addr, data) {
        this._aPrgBankId.setSafety(0, data & 0xF);
        this.mirroringMap = (data & 0x10) ? [0, 0, 0, 0] : [1, 1, 1, 1];
    }
}

/**@type {Array<MapperBase>} */
const MapperList = {
    0: Mapper000,
    1: Mapper001,
    155: Mapper001,
    2: Mapper002,
    3: Mapper003,
    4: Mapper004,
    7: Mapper007
}

export { MapperBase, MapperList };