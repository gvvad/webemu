/** Ines file wrapper */
class Ines {
    /**@param {ArrayBuffer} arrayBuffer */
    constructor(arrayBuffer) {
        this._buffer = arrayBuffer;
        this._aHeader = new Uint8Array(this._buffer, 0, 0x10);

        if (!(this._aHeader[0] == 0x4e &&
            this._aHeader[1] == 0x45 &&
            this._aHeader[2] == 0x53 &&
            this._aHeader[3] == 0x1A)) {
            throw "Wrong file!";
        }
        this._prg16BankCount = this._aHeader[4];

        let offset = 0x10;

        /**@type {DataView} */
        this._vTrainer = undefined;
        if (this.getFlag(6, 2)) {
            this._vTrainer = new DataView(this._buffer, offset, 0x200);
            offset += 0x200;
        }

        this._prgOffset = offset;
        offset += 0x4000 * this._prg16BankCount;

        /**@type {DataView} tiles data */
        this._vTileBank = undefined;
        if (this.tileBankCounts) {
            this._vTileBank = new DataView(this._buffer, offset, this.tileBankCounts * 0x2000);
            this._u8TileBank = new Uint8Array(this._vTileBank.buffer, this._vTileBank.byteOffset, this._vTileBank.byteLength);
        }
    }

    getFlag(number, bit) {
        return !!(this._aHeader[number] & (0x1 << bit));
    }

    /**
     * Return array of prg banks
     * @param {Number} size window size in bytes
     * @returns {Array<DataView>} Array of banks
     */
    getPrgBanks(size) {
        if (0x8000 % size) return;
        let srcBuffer = this._buffer;
        let offset = this._prgOffset;
        let len = this._prg16BankCount * 0x4000 / size;
        if ((len % 1) != 0) {
            if (len > 1) throw "Unexpected size value"
            let buf = new Uint8Array(0x8000);
            let srcView = new Uint8Array(this._buffer, this._prgOffset);
            buf.set(srcView);
            buf.set(srcView, 0x4000);
            srcBuffer = buf.buffer;
            offset = 0;
            len = 1;
        }
        let res = new Array(len);
        for (let i = 0; i < len; i++) {
            res[i] = new DataView(srcBuffer, offset, size);
            offset += size;
        }
        return res;
    }

    /**Mapper number id */
    get iMapper() {
        switch (this.headerVersion) {
            case 1:
                return (this._aHeader[7] & 0xF0) | (this._aHeader[6] >> 4);
            case 2:
                return ((this._aHeader[8] & 0x0F) << 8) | (this._aHeader[7] & 0xF0) | (this._aHeader[6] >> 4);
            default:
                return this._aHeader[6] >> 4;
        }
    }
    /**@type {Array<DataView>} Trainer bank */
    get vTrainer() { return this._vTrainer; }

    get tileBankCounts() { return this._aHeader[5]; }

    /**@type {DataView} Tiles data view */
    get vTileBank() { return this._vTileBank; }
    get u8TileBank() { return this._u8TileBank; }

    /**@type {Boolean} Hard-wired nametable mirroring type (false: Horizontal or mapper-controlled; true: Vertical) */
    get mirroringMode() { return !!(this._aHeader[6] & 0x1); }

    /**@type {Boolean} Hard-wired four-screen mode */
    get fourScreenMode() { return !!(this._aHeader[6] & 0x8); }

    /**@type {Number} 0 - old, 1 - 1.0v, 2 - 2.0v */
    get headerVersion() {
        return (this._aHeader[7] & 0xC) >> 2;
    }

    /**@type {Number} TV system (-1: - unknown; 0: NTSC; 1: PAL; 2: Multiple-region; 3: UMC 6527P ("Dendy")) */
    get system() {
        switch (this.headerVersion) {
            case 1:
                return this._aHeader[9] & 0x1;
            case 2:
                return (this._aHeader[12] & 0x3);
            default:
                return -1;
        }
    }
}

export { Ines }