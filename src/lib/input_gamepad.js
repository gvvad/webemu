import { StandardInputSource } from "./input.js"
const defaultMap = {
    0: 0x01, 2: 0x02,
    8: 0x04, 9: 0x08,
    12: 0x10, 13: 0x20, 14: 0x40, 15: 0x80
};

class GamepadInput extends StandardInputSource {
    constructor() {
        super();
        this._aMap = [
            {
                id: "Xbox 360 Controller",
                map: defaultMap
            },
            {
                id: "Wireless Controller",
                map: defaultMap
            },
        ];
        /**@type {Array<Gamepad>} */
        this._gpMap = {};
        this._gpMapLen = 0;
        
        window.addEventListener("gamepadconnected", (e) => {
            let gp = e.gamepad;
            let map = undefined;
            for (const mapItem of this._aMap) {
                if (gp.id.indexOf(mapItem["id"]) == 0) {
                    map = mapItem["map"];
                    break;
                }
            }
            if (!map) {
                console.warn(`"${gp.id}" does not have key-map!`);
                map = defaultMap;
            }
            this._gpMap[gp.index] = map;
            this._gpMapLen = Object.keys(this._gpMap).length;
        });
        
        window.addEventListener("gamepaddisconnected", (e) => {
            delete this._gpMap[e.gamepad.index];
            this._gpMapLen = Object.keys(this._gpMap).length;
        });
    }

    get value() {
        if (this._gpMapLen) {
            this._value = 0;
            for (const gp of navigator.getGamepads()) {
                if (!gp) continue;
                let map = this._gpMap[gp.index];
                for (const btnIndx in map) {
                    if (gp.buttons[btnIndx].pressed) {
                        this._value |= map[btnIndx];
                    }
                }
            }
            return this._value;
        } else {
            return 0;
        }
    }
    
}

export { GamepadInput };