import { StandardInputSource } from "./input.js"

class KeyboardInput extends StandardInputSource {
    constructor() {
        super();
        this._map = {
            "KeyS": 0, "KeyA": 1,
            "KeyQ": 2, "KeyW": 3,
            "ArrowUp": 4, "ArrowDown": 5, "ArrowLeft": 6, "ArrowRight": 7
        };
        
        window.addEventListener("keydown", (e) => {
            let i = this._map[e.code];
            if (i !== undefined) {
                this.btnVector[i] = true;
                e.preventDefault();
            }
        });

        window.addEventListener("keyup", (e) => {
            let i = this._map[e.code];
            if (i !== undefined) {
                this.btnVector[i] = false;
                e.preventDefault();
            }
        });
    }

    setMap(map) {
        this._map = map;
    }
}

export { KeyboardInput };