import { EObject } from "./eobj.js";

class RegisterGroup extends EObject {
    constructor(size) {
        super();
        this._reg_buffer = new ArrayBuffer(size);
        this._reg = new Uint8Array(this._reg_buffer);
    }
    write(num, data) {
        this._reg[num] = data;
    };
    read(num) {
        return this._reg[num];
    };

    get u8Registers() { return this._reg; }
    resetState() { this._reg.fill(0); }
}

class Register extends EObject {
    constructor() {
        super();
        this._val = 0;
    }

    get val() { return this._val; }
    set val(v) { this._val = v & 0xFF; }
    read() { return this.val; }
    write(v) { this.val = v; }
    valueOf() { return this.val; }
    resetState() { this._val = 0; }
}

export { Register, RegisterGroup };