import { NES } from "./lib/nes.js"
import { StandardInputSource } from "./lib/input.js";

class DBMan {
    open(dbName, storeInit) {
        return new Promise((resolveFunc, rejectFunc) => {
            this._openReq = indexedDB.open(dbName);
            this._storeInit = storeInit;
            this._openReq.onupgradeneeded = (event) => {
                for (const store in this._storeInit) {
                    event.target.result.createObjectStore(store, { keyPath: this._storeInit[store] });
                }
            };
            this._openReq.onsuccess = resolveFunc;
            this._openReq.onerror = rejectFunc;
        });
    }

    getKeys(store) {
        return new Promise((resolveFunc, rejectFunc) => {
            let tr = this._openReq.result.transaction(store, "readonly");
            let objStore = tr.objectStore(store);
            let req = objStore.getAllKeys();
            req.onsuccess = function (event) {
                this(event.target.result);
            }.bind(resolveFunc);
            req.onerror = rejectFunc;
        });
    }

    get(store, key) {
        return new Promise((resolveFunc, rejectFunc) => {
            let tr = this._openReq.result.transaction(store, "readonly");
            let objStore = tr.objectStore(store);
            let req = objStore.get(key);
            req.onsuccess = function (event) {
                this(event.target.result);
            }.bind(resolveFunc);
            req.onerror = rejectFunc;
        });
    }

    add(store, item) {
        return new Promise((resolveFunc, rejectFunc) => {
            let tr = this._openReq.result.transaction(store, "readwrite");
            let objStore = tr.objectStore(store);
            let req = objStore.add(item);
            req.onsuccess = function (event) {
                this(event.target.result);
            }.bind(resolveFunc);
            req.onerror = rejectFunc;
        });
    }

    put(store, item) {
        return new Promise((resolveFunc, rejectFunc) => {
            let tr = this._openReq.result.transaction(store, "readwrite");
            let objStore = tr.objectStore(store);
            let req = objStore.put(item);
            req.onsuccess = function (event) {
                this(event.target.result);
            }.bind(resolveFunc);
            req.onerror = rejectFunc;
        });
    }

    delete(store, key) {
        return new Promise((resolveFunc, rejectFunc) => {
            let tr = this._openReq.result.transaction(store, "readwrite");
            let objStore = tr.objectStore(store);
            let req = objStore.delete(key);
            req.onsuccess = function (event) {
                this(event.target.result);
            }.bind(resolveFunc);
            req.onerror = rejectFunc;
        });
    }
}

class App extends EventTarget {
    /**
     * @param {Element} canvas 
     */
    constructor(canvas) {
        super();
        this._nes = new NES();
        this._nes.setCanvas(canvas);
        this._isSetAudioCtx = false;
        this._currentRomItem = {};
        this.onRomRefreshEvent = new Event("onRomRefresh");

        this._db = new DBMan();
    }
    get nes() { return this._nes; }

    init() {
        return this._db.open("webemu", { "rom": "name" });
    }

    async refreshRomList() {
        let res = await this._db.getKeys("rom");
        this.onRomRefreshEvent.result = res;
        this.dispatchEvent(this.onRomRefreshEvent);
    }

    async addRom(name, data) {
        let rom = {
            "name": name,
            "state": {},
            "data": data
        };
        await this._db.add("rom", rom);
    }

    async deleteRom(name) {
        await this._db.delete("rom", name);
    }

    async loadRom(name) {
        let res = await this._db.get("rom", name);
        this._currentRomItem = res;
        await this._nes.loadFile(res.data);
        await this.powerOn();
    }

    async powerOn() {
        if (!this._isSetAudioCtx) {
            try {
                let ctx = new AudioContext();
                await ctx.audioWorklet.addModule('src/lib/pcm_processor.js');
                await ctx.audioWorklet.addModule('src/lib/noise_processor.js');
                this._nes.setAudioContext(ctx);
                this._isSetAudioCtx = true;
            } catch (e) {
                console.warn(e);
            }
        }
        this._nes.powerOn();
    }

    powerOff() {
        return this._nes.powerOff();
    }

    async hardReset() {
        await this._nes.powerOff();
        this._nes.powerOn();
    }

    reset() {
        return this._nes.reset();
    }

    async saveState() {
        let res = await this._nes.saveState();
        this._currentRomItem.state = res;
        this._db.put("rom", this._currentRomItem);
    }

    loadState() {
        return this._nes.loadState(this._currentRomItem.state);
    }
}

window.app = new App(document.querySelector("#canvas-0"));

document.querySelector("#i-local-file").addEventListener("change", function (event) {
    if (event.target.files.length > 0) {
        let reader = new FileReader();
        reader.addEventListener("load", async function (event) {
            await this.addRom(event.target.fName, event.target.result);
            this.refreshRomList();
        }.bind(this));

        let file = event.target.files[0]
        reader.fName = file.name;
        reader.readAsArrayBuffer(file);
    }
}.bind(window.app));

window.openRomFile = function () {
    document.querySelector("#i-local-file").click();
};

window.fullScreen = function () {
    document.querySelector(".screen-wrapper").requestFullscreen();
};

await window.app.init();
window.app.addEventListener("onRomRefresh", function (event) {
    document.querySelector("#rom-list").setData(event.result);
});
window.app.refreshRomList();

document.querySelector("#rom-list").addEventListener("onItemAction", async function (event) {
    switch (event.actionId) {
        case 0:
            window.app.loadRom(event.result);
            let a = bootstrap.Offcanvas.getInstance(document.querySelector("#optionsSidebar"));
            if (a) a.hide();
            break;
        case 1:
            await window.app.deleteRom(event.result);
            window.app.refreshRomList();
            break;
        default:
            console.log(event);
            break;
    }
});

window.screen?.orientation?.addEventListener("change", (e) => {
    let scrOrientation = e.target;
    if (scrOrientation.type.indexOf("portrait") != -1) {
        try {
            document.exitFullscreen();
        } catch (e) { }
    } else {
        window.fullScreen();
    }
});

class TouchPad extends StandardInputSource {
    constructor(elem, buttons, dpad) {
        super();
        this._padElem = elem;
        this._buttons = buttons;
        this._dpad = dpad;
        this._padElem.addEventListener("touchstart", this._tStart.bind(this));
        this._padElem.addEventListener("touchmove", this._tStart.bind(this));
        this._padElem.addEventListener("touchend", this._tEnd.bind(this));
        this._padElem.addEventListener("touchcancel", this._tEnd.bind(this));

        this._map = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80];
        this._touches = {};
        this._isDpadTouch = false;
        this._dpadSector = 0;
        this._dpadTouchId = 0;
    }

    _isHit(rect, x, y) {
        return (
            x >= rect.left &&
            x <= rect.right &&
            y >= rect.top &&
            y <= rect.bottom
        );
    }

    _tStart(evt) {
        for (const touch of evt.changedTouches) {
            const dpadRect = this._dpad.getBoundingClientRect();
            if (this._isHit(dpadRect, touch.clientX, touch.clientY)) {
                const x = dpadRect.x + (dpadRect.width / 2);
                const y = dpadRect.y + (dpadRect.height / 2);
                let angle = (Math.atan2(y - touch.clientY, x - touch.clientX) * 180) / Math.PI;
                angle = (angle + 360 + 7) % 360;
                
                this._dpadSector = Math.floor(angle / 45);
                this._dpadTouchId = touch.identifier;
                this._isDpadTouch = true;
            }

            for (let i = 0; i < this._buttons.length; i++) {
                const rect = this._buttons[i].getBoundingClientRect();

                if (this._isHit(rect, touch.clientX, touch.clientY)) {
                    this._touches[touch.identifier] = i;
                    break;
                }
            }
        }
        evt.preventDefault();
    }

    _tEnd(evt) {
        for (const touch of evt.changedTouches) {
            if (this._isDpadTouch && (this._dpadTouchId == touch.identifier)) {
                this._isDpadTouch = false;
                continue;
            }
            delete this._touches[touch.identifier];
        }
        evt.preventDefault();
    }

    get value() {
        let res = 0;
        if (this._isDpadTouch) {
            switch(this._dpadSector) {
                case 0:
                    res |= 0x40;
                    break;
                case 1:
                    res |= 0x40 | 0x10;
                    break;
                case 2:
                    res |= 0x10;
                    break;
                case 3:
                    res |= 0x10 | 0x80;
                    break;
                case 4:
                    res |= 0x80;
                    break;
                case 5:
                    res |= 0x80 | 0x20;
                    break;
                case 6:
                    res |= 0x20;
                    break;
                case 7:
                    res |= 0x20 | 0x40;
                    break;
            }
        }

        for (const key in this._touches) {
            res |= this._map[this._touches[key]];
        }
        return res;
    }
}

if ('ontouchstart' in window || navigator.maxTouchPoints) {
    // Touch is supported
    let tPadElem = document.querySelector(".touch-pad");
    let dpad = tPadElem.querySelector("#d-pad");
    let buttons = new Array();
    buttons.push(tPadElem.querySelector("#a-but"));
    buttons.push(tPadElem.querySelector("#b-but"));
    buttons.push(tPadElem.querySelector("#sl-but"));
    buttons.push(tPadElem.querySelector("#st-but"));

    // buttons.push(tPadElem.querySelector("#u-dpad"));
    // buttons.push(tPadElem.querySelector("#d-dpad"));
    // buttons.push(tPadElem.querySelector("#l-dpad"));
    // buttons.push(tPadElem.querySelector("#r-dpad"));
    window.app.nes.bus.inputController.setStandardInput(new TouchPad(tPadElem, buttons, dpad));
    tPadElem.style.display = "";
}