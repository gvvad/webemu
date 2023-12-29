import { BusBase } from "./bus_base.js"
import { Register } from "./register.js"
import { BusMain } from "./bus_main.js"
import { EObject } from "./eobj.js";

class PPUControl extends Register {
    constructor() {
        super();
    }
    /**Base nametable address (0 = $2000; 1 = $2400; 2 = $2800; 3 = $2C00) */
    get n() { return this._val & 0x03; }
    /**VRAM address increment per CPU read/write of PPUDATA (0: add 1, going across; 1: add 32, going down) */
    get i() { return !!(this._val & 0x04); }
    /**Sprite tile table address for 8x8 sprites (0: $0000; 1: $1000; ignored in 8x16 mode) */
    get spriteTable() { return (this._val & 0x08) ? 1 : 0; }
    /**Background tile table address (0: $0000; 1: $1000) */
    get backgroundTable() { return (this._val & 0x10) ? 1 : 0; }
    /**Sprite size (false: 8x8 pixels; true: 8x16 pixels) */
    get h() { return !!(this._val & 0x20); }
    /**PPU master/slave select (0: read backdrop from EXT pins; 1: output color on EXT pins) */
    get p() { return !!(this._val & 0x40); }
    /**Generate an NMI at the start of the vertical blanking interval (0: off; 1: on) */
    get isNMI() { return !!(this._val & 0x80); }
}

class PPUMask extends Register {
    constructor() {
        super();
    }
    /**Greyscale (0: normal color, 1: produce a greyscale display) */
    get isGreyscale() { return !!(this._val & 0x01); }
    /**Show background in leftmost 8 pixels of screen, 0: Hide */
    get isBackgroundFromLeft() { return !!(this._val & 0x02); }
    /**Show sprites in leftmost 8 pixels of screen, 0: Hide */
    get isSpritesFromLeft() { return !!(this._val & 0x04); }
    /**Show background */
    get isShowBackground() { return !!(this._val & 0x08); }
    /**Show sprites */
    get isShowSprites() { return !!(this._val & 0x10); }
    /**Emphasize red (green on PAL/Dendy) */
    get isEmphasisRed() { return !!(this._val & 0x20); }
    /**Emphasize green (red on PAL/Dendy) */
    get isEmphasisGreen() { return !!(this._val & 0x40); }
    /**Emphasize blue */
    get isEmphasisBlue() { return !!(this._val & 0x80); }

    /**Is enable rendering */
    get isRendering() { return !!(this._val & 0x18); }
    get isAllRendering() { return (this._val & 0x18) == 0x18; }
}

class PPUStatus extends Register {
    /**@param {BusPPU} ppuBus */
    constructor(ppuBus) {
        super();
        this._ppuBus = ppuBus;
    }
    get _stateExclude() {
        return ["_ppuBus"];
    }
    get val() { return (this._val & 0x60) | this._ppuBus.nmiOccured << 7; }
    set val(v) { this._val = v; }

    /**Sprite overflow (more than eight sprites appear on a scanline).*/
    get overflow() { return !!(this._val & 0x20); }
    set overflow(v) {
        if (v) {
            this._val |= 0x20;
        } else {
            this._val &= ~0x20;
        }
    }
    /**Sprite 0 Hit. */
    get isSpriteHit() { return !!(this._val & 0x40); }
    set isSpriteHit(v) {
        if (v) {
            this._val |= 0x40;
        } else {
            this._val &= ~0x40;
        }
    }
}

class PPUAddressScroll extends EObject {
    /**@param {BusPPU} ppuBus */
    constructor(ppuBus) {
        super();
        this._ppuBus = ppuBus;
        this._w = false;
        this._t = 0;
        this._v = 0;
        this._x = 0;
        this._cycleStamp = 0;
    }
    get _stateExclude() {
        return ["_ppuBus"];
    }
    resetState() {
        this._w = false;
        this._t = 0;
        this._v = 0;
        this._x = 0;
    }
    get w() { return this._w; }
    set w(val) { this._w = !!val; }
    get t() { return this._t; }
    /**Total X position(coarse & fine) */
    get xPos() { return ((this.v & 0x1F) << 3) | this._x; }
    /**Total Y position(coarse & fine) */
    get yPos() { return ((this.v & 0x3E0) >> 2) | (this.v & 0x7000) >> 12; }

    get baseTable() { return (this.v & 0xC00) >> 10; }
    /**Set 10-11 bits of internal t register */
    set baseTable(val) {
        this._t = (this._t & 0x73FF) | ((val & 0x3) << 10);
    }

    /**Address register value*/
    get v() {
        return this._v;
    }

    set v(val) {
        let fixVal = val & 0x7FFF;
        let changeMask = this._v ^ fixVal;
        this._v = fixVal;
        if (changeMask) this._ppuBus.mainBus.mapper.doVramAddressChange(changeMask, fixVal);
    }

    writeScroll(val) {
        if (!this._w) {
            this._x = val & 0x7;
            this._t &= 0x7FE0;
            this._t |= (val & 0xF8) >> 3;
        } else {
            this._t &= 0x0C1F //-000 1100  0001 1111
            this._t |= (val & 0x7) << 12;
            this._t |= (val & 0xF8) << 2;
        }
        this._w = !this._w;
    }

    writeAddress(val) {
        if (!this._w) {
            this._t &= 0xFF;
            this._t |= (val & 0x3F) << 8;
        } else {
            this._t &= 0x7F00;
            this._t |= val & 0xFF;
            this.v = this._t;

            //CRUTCH: to prevent 'race condition'
            //When program writes address at 'increment Y position' moment (255 ppu cycle)
            // this._cycleStamp = this._ppuBus.mainBus.cpu.cycles + 15;
        }
        this._w = !this._w;
    }

    incYPos() {
        // if (this._cycleStamp > this._ppuBus.mainBus.cpu.cycles) {
        //     console.log("inc Y too late");
        //     return;
        // }
        let bufV = this.v;
        bufV += 0x1000;
        if (bufV & 0x8000) {
            let yCoarse = (bufV & 0x3E0);
            if (yCoarse == 0x3A0) { //29
                bufV &= 0x7C1F; //coarse Y = 0
                bufV ^= 0x800;  //switch vertical nametable
            } else if (yCoarse == 0x3E0) {  //31
                bufV &= 0x7C1F; //coarse Y = 0
            } else {
                bufV += 0x20;   //inc coarse Y
            }
        }
        this.v = bufV;
        this.v |= 0x1000;   //Emulate sprite fetch (a12 toggle)
        this.v = bufV;
    }
}

class BusPPU extends BusBase {
    /** @param {BusMain} mainBus */
    constructor(mainBus) {
        super();
        this._mainBus = mainBus;
        /** @type {ArrayBuffer} (Name tables + attrib) x 4 + palette*/
        this._vramBuffer = new ArrayBuffer(0x1000 + 0x20);
        this._aVram = new Uint8Array(this._vramBuffer);

        this._vNameTables = new DataView(this._vramBuffer, 0, 0x1000);
        this._aNameTable = [
            new Uint8Array(this._vramBuffer, this._vNameTables.byteOffset + 0x000, 0x3C0),
            new Uint8Array(this._vramBuffer, this._vNameTables.byteOffset + 0x400, 0x3C0),
            new Uint8Array(this._vramBuffer, this._vNameTables.byteOffset + 0x800, 0x3C0),
            new Uint8Array(this._vramBuffer, this._vNameTables.byteOffset + 0xC00, 0x3C0)
        ];
        this._aAttribTable = [
            new Uint8Array(this._vramBuffer, this._vNameTables.byteOffset + 0x3C0, 0x40),
            new Uint8Array(this._vramBuffer, this._vNameTables.byteOffset + 0x7C0, 0x40),
            new Uint8Array(this._vramBuffer, this._vNameTables.byteOffset + 0xBC0, 0x40),
            new Uint8Array(this._vramBuffer, this._vNameTables.byteOffset + 0xFC0, 0x40)
        ];

        this._vPalettes = new DataView(this._vramBuffer, 0x1000, 0x20);
        this._aPalettes = [
            [
                new Uint8Array(this._vramBuffer, this._vPalettes.byteOffset + 0x0, 0x4),
                new Uint8Array(this._vramBuffer, this._vPalettes.byteOffset + 0x4, 0x4),
                new Uint8Array(this._vramBuffer, this._vPalettes.byteOffset + 0x8, 0x4),
                new Uint8Array(this._vramBuffer, this._vPalettes.byteOffset + 0xC, 0x4)
            ], [
                new Uint8Array(this._vramBuffer, this._vPalettes.byteOffset + 0x10, 0x4),
                new Uint8Array(this._vramBuffer, this._vPalettes.byteOffset + 0x14, 0x4),
                new Uint8Array(this._vramBuffer, this._vPalettes.byteOffset + 0x18, 0x4),
                new Uint8Array(this._vramBuffer, this._vPalettes.byteOffset + 0x1C, 0x4)
            ]
        ];

        this._isPalettesUpdates = true;

        this._oamBuffer = new ArrayBuffer(0x100);
        /**Object mem [yPos, tileId, attrib, xPos] */
        this._u8Oam = new Uint8Array(this._oamBuffer);

        this._overflowVectorBuffer = new ArrayBuffer(240);
        this._overflowVector = new Uint8Array(this._overflowVectorBuffer);

        this.rCtrl = new PPUControl();
        this.rMask = new PPUMask();
        this.rStatus = new PPUStatus(this);
        this._nmiOccured = false;
        this._rOamAddr = 0;
        this.rAddrScroll = new PPUAddressScroll(this);
        this._vramDataBuffer = 0;
        //this._busCyclesStamp = 0;
    }
    get _stateExclude() {
        return ["_mainBus", "_isPalettesUpdates"];
    }
    
    setState(state) {
        super.setState(state);
        this._isPalettesUpdates = true;
    }
    
    resetState() {
        super.resetState();
        this._u8Oam.fill(0);
        this._aVram.fill(0);
        this._isPalettesUpdates = true;
        this._nmiOccured = false;
        this._rOamAddr = 0;
        this._vramDataBuffer = 0;
    }
    get mainBus() { return this._mainBus; }

    /**V-Blank flag */
    get nmiOccured() { return this._nmiOccured; }
    set nmiOccured(v) {
        this._nmiOccured = !!v;
        this._mainBus.cpu.setNMI(!(this._nmiOccured && this.rCtrl.isNMI));
    }

    get rOamAddr() { return this._rOamAddr; }
    set rOamAddr(v) { this._rOamAddr = v & 0xFF; }

    getNameTable(num) {
        return this._aNameTable[this._mainBus.mapper.mirroringMap[num]];
    }
    getAttribTable(num) {
        return this._aAttribTable[this._mainBus.mapper.mirroringMap[num]];
    }

    /** 2 items array [aBg_u8Palette, aSpr_u8Palette]  */
    get aPalettes() { return this._aPalettes; }

    get isPalettesUpdated() {
        let res = this._isPalettesUpdates;
        this._isPalettesUpdates = false;
        return res;
    }

    /**
     * 0: Y pos; 1: Tile index; 2: Attrib [7: flipV, 6: flipH, 5: prior(0: in front of bg; 1: behind bg), -,-,-, 1 0: palette]; 3: X pos
     */
    get u8Oam() { return this._u8Oam; }

    doFrameBegin() {
        this._overflowVector.fill(0);
        for (let i = 0; i < 64; i++) {
            let y = this._u8Oam[i * 4];
            if (y < 0xEF) {
                this._overflowVector[y]++;
            }
        }
    }

    doScanLineHSync() {
        if (this._overflowVector[this._mainBus.nes.scanLine] > 7) {
            this.rStatus.overflow = true;
        }
        if (this.rMask.isRendering) {
            this.rAddrScroll.incYPos();
            this.rAddrScroll.v = (this.rAddrScroll.v & ~0x41F) | (this.rAddrScroll.t & 0x41F);
        }
    }

    doVBlankBegin() {
        this.nmiOccured = true;
    }
    doVBlankEnd() {
        this.nmiOccured = false;
        //Sprite-hit flag is cleared after vblank
        this.rStatus.isSpriteHit = false
        this.rStatus.overflow = false;
    }
    doFrameEnd() {
        if (this.rMask.isRendering) {
            this.rAddrScroll.incYPos();
            this.rAddrScroll.v = (this.rAddrScroll.v & ~0x41F) | (this.rAddrScroll.t & 0x41F);
            this.rAddrScroll.v = (this.rAddrScroll.v & ~0x7BE0) | (this.rAddrScroll.t & 0x7BE0);
        }
    }

    writeOAMDMA(addrByteHi) {
        let wHiByte = (addrByteHi & 0xFF) << 8;
        for (let i = 0; i < 0x100; i++) {
            let buf = this._mainBus.read(wHiByte | i);
            if ((this._rOamAddr % 4) == 2) buf &= 0xE3;
            this._u8Oam[this._rOamAddr] = buf;
            this._rOamAddr = ++this._rOamAddr & 0xFF;
        }
        this._mainBus.cpu.cycles += 513;
    }

    // /**Bus decay emulation */
    // _updateBus(isRefreshDecay = true, mask = 0xFF) {
    //     // 900000 cycles - ~500ms
    //     if (this._busCyclesStamp + 900000 <= this._mainBus.cpu.cycles) {
    //         this.data &= ~mask;
    //     }
    //     if (isRefreshDecay) this._busCyclesStamp = this._mainBus.cpu.cycles;
    // }

    _updateVRamAddr() {
        if (this._mainBus.nes.scanLine >= 240 || !this.rMask.isRendering) {
            this.rAddrScroll.v += this.rCtrl.i ? 32 : 1;
        }
    }

    _read(regNum) {
        switch (regNum) {
            // case 0:     // Control
            //     this.data = this.rCtrl.val;
            //     break;
            // case 1:     // Mask
            //     this.data = this.rMask.val;
            //     break;
            case 2:     // Status
                // this._updateBus(true, 0x1F);
                this.data &= 0x1F;    //5 lower bits on IObus has left unchanged
                this.data |= this.rStatus.val;
                this.rAddrScroll.w = false;
                this.nmiOccured = false;
                break;
            // case 3:     // OAM Address
            //     this.data = this.rOamAddr;
            //     break;
            case 4:     // OAM Data
                // this._updateBus();
                this.data = this._u8Oam[this.rOamAddr];
                if ((this.rOamAddr % 4) == 2) this.data &= 0xE3;    //Every $02 (3th) byte 
                break;
            // case 5:
            //     this.data;
            //     break;
            case 7:     // PPU Data
                // this._updateBus();
                this.data = this._readPPURam(this.rAddrScroll.v);
                this._updateVRamAddr();
                break;
            default:
                // this._updateBus(false);
                break;
        }
    }

    _write(regNum) {
        // this._updateBus(true, 0x0);
        switch (regNum) {
            case 0:     // $2000 - Control
                this.rCtrl.val = this.data;
                this.rAddrScroll.baseTable = this.data;
                break;
            case 1:     // $2001 - Mask
                this.rMask.val = this.data;
                this._isPalettesUpdates = true;
                break;
            case 3:     // $2003 - OAM Addr
                this.rOamAddr = this.data;
                break;
            case 4:     // $2004 - OAM Data
                if (this._mainBus.nes.scanLine >= 240 || !this.rMask.isRendering) {
                    // FIXME: $02 byte map non sence (for debug only)
                    this._u8Oam[this.rOamAddr] = (this.rOamAddr % 4) == 2 ? this.data & 0xE3 : this.data;
                    this.rOamAddr++;
                } else {
                    this.rOamAddr += 4;
                }
                break;
            case 5:     // $2005 - Scroll
                this.rAddrScroll.writeScroll(this.data);
                break;
            case 6:     // $2006 - PPU Address
                this.rAddrScroll.writeAddress(this.data);
                break;
            case 7:     // $2007 - PPU Data
                this._writePPURam(this.rAddrScroll.v, this.data);
                this._updateVRamAddr();
            default:
                break;
        }
    }

    _readPPURam(addr) {
        if (addr < 0x2000) {
            let prev = this._vramDataBuffer;
            this._vramDataBuffer = this._mainBus.mapper.readTile(addr);
            return prev;
        }

        if (addr < 0x3F00) {
            let prev = this._vramDataBuffer;

            let _addr = (addr - 0x2000) % 0x1000;
            let num = (_addr & 0x0C00) >> 10;   //Calculate address based on mirroring mode
            _addr = (this._mainBus.mapper.mirroringMap[num] * 0x400) + (_addr % 0x400);
            this._vramDataBuffer = this._vNameTables.getUint8(_addr);

            return prev;
        }

        if (addr < 0x4000) {
            return this._vPalettes.getUint8((addr - 0x3F00) % 0x20);
        }

        return this._readPPURam((addr - 0x4000) % 0x4000);
    }

    _writePPURam(addr, data) {
        if (addr < 0x3F00) {
            //While rendering, address low byte instead data value
            let _data = (this._mainBus.nes.scanLine >= 240 || !this.rMask.isRendering) ? data : addr & 0xFF;
            if (addr < 0x2000) {
                this._mainBus.mapper.writeTile(addr, _data);
            } else {
                let _addr = (addr - 0x2000) % 0x1000;
                let num = (_addr & 0x0C00) >> 10;   //Calculate address based on mirroring mode
                _addr = (this._mainBus.mapper.mirroringMap[num] * 0x400) + (_addr % 0x400);
                this._vNameTables.setUint8(_addr, _data);
            }
            return;
        }

        if (addr < 0x4000) {    //palette table
            let palAddr = (addr - 0x3F00) % 0x20;
            let _data = 0x3F & data;    //ignoring 2 hi bits
            this._vPalettes.setUint8(palAddr, _data);
            if (palAddr % 4 == 0) { //Every 4 byte mirror to another table
                this._vPalettes.setUint8((palAddr + 0x10) % 0x20, _data);
            }
            this._isPalettesUpdates = true;
            return;
        }

        return this._writePPURam((addr - 0x4000) % 0x4000, data);
    };
}

export { BusPPU };