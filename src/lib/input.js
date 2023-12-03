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
            this._controllerBuf |= controller.value;
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
        this._value = 0;
    }

    /**Buttons 8 bit mask [A, B, Select, Start, Up, Down, Left, Right]  */
    get value() {
        return this._value;
    }
}

export { InputController, StandardInputSource };