class InputController {
    constructor() {
        this._aController = new Array();
        this._controllerBuf = 0;
    }
    get buffer() { return this._controllerBuf; }

    /** @param {StandardInputSource} obj */
    setStandardInput(obj) {
        this._aController.push(obj);
    }

    pool() {
        for (const controller of this._aController) {
            this._controllerBuf |= controller.pool();
        }
        return this._controllerBuf;
    }

    readBit() {
        let res = 0;

        res |= this._controllerBuf & 0x1;
        this._controllerBuf >>= 1;

        return res;
    }
}

class StandardInputSource {
    constructor() {
        /**[A, B, Select, Start, Up, Down, Left, Right] */
        this.btnVector = new Array(8);
        this.btnVector.fill(false);
    }

    pool() {
        let res = 0;
        if (this.btnVector[0]) res |= 0x01;
        if (this.btnVector[1]) res |= 0x02;
        if (this.btnVector[2]) res |= 0x04;
        if (this.btnVector[3]) res |= 0x08;
        if (this.btnVector[4]) res |= 0x10;
        if (this.btnVector[5]) res |= 0x20;
        if (this.btnVector[6]) res |= 0x40;
        if (this.btnVector[7]) res |= 0x80;
        return res;
    }
}

export { InputController, StandardInputSource };