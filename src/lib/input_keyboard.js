import { StandardInputSource } from "./input.js"

class KeyboardInput extends StandardInputSource {
    constructor() {
        super();
        this._map = {
            "KeyS": 0x01, "KeyA": 0x02,
            "KeyQ": 0x04, "KeyW": 0x08,
            "ArrowUp": 0x10, "ArrowDown": 0x20, "ArrowLeft": 0x40, "ArrowRight": 0x80
        };
        
        window.addEventListener("keydown", (e) => {
            let bit = this._map[e.code];
            if (bit !== undefined) {
                this._value |= bit;
                e.preventDefault();
            }
        });

        window.addEventListener("keyup", (e) => {
            let bit = this._map[e.code];
            if (bit !== undefined) {
                this._value &= ~bit;
                e.preventDefault();
            }
        });
    }

    setMap(map) {
        this._map = map;
    }
}

export { KeyboardInput };