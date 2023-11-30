import { StandardInputSource } from "./input.js"
const defaultMap = {
    0: 0, 2: 1,
    8: 2, 9: 3,
    12: 4, 13: 5, 14: 6, 15: 7
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

    pool() {
        if (this._gpMapLen) {
            this.btnVector.fill(false);
            for (const gp of navigator.getGamepads()) {
                if (!gp) continue;
                let map = this._gpMap[gp.index];
                for (const btnIndx in map) {
                    this.btnVector[map[btnIndx]] = gp.buttons[btnIndx].pressed
                }
            }
            return super.pool();
        } else {
            return 0;
        }
    }
    
}

export { GamepadInput };