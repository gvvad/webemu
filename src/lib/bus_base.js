import { EObject } from "./eobj.js";

class BusBase extends EObject {
    constructor() {
        super();
        /**Current bus data*/
        this.data = 0;
        this._isDummy = false;
    }

    get isDummy() { return this._isDummy; }

    /** @param {Number} addr */
    _read(addr) { throw "Undefined" };
    /** @param {Number} addr */
    _write(addr) { throw "Undefined" };
    
    /** @param {Number} addr */
    read(addr, isDummy = false) {
        this._isDummy = isDummy;
        let res = this._read(addr);
        if (!isNaN(res)) {
            this.data = res;
        }
        this._isDummy = false;
        return this.data;
    }

    /** 
     * @param {Number} addr 
     * @param {Number} data
     */
    write(addr, data, isDummy = false) {
        this._isDummy = isDummy;
        this.data = data & 0xFF;
        this._write(addr);
        this._isDummy = false;
    }

    /** @param {Number} addr */
    read16(addr) {
        let res = this.read(addr + 1) << 8;
        res |= this.read(addr);
        return res;
    }

    /** @param {Number} addr */
    readInt(addr) {
        return this.read(addr) << 24 >> 24;
    }

    /** @param {Number} addr */
    readInt16(addr) {
        return this.read16(addr) << 16 >> 16;
    }

    // write16(addr, data) {
    //     this.write(addr + 1, (data & 0xFF00) >> 8);
    //     this.write(addr, data & 0xFF);
    // }
}

export { BusBase };