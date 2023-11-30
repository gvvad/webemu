import { NES } from "./lib/nes.js"

class DBMan {
    constructor() {

    }

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

    delete (store, key) {
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
            let ctx = new AudioContext();
            await ctx.audioWorklet.addModule('src/lib/pcm_processor.js');
            await ctx.audioWorklet.addModule('src/lib/noise_processor.js');
            this._nes.setAudioContext(ctx);
            this._isSetAudioCtx = true;
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
    document.querySelector("#canvas-0").requestFullscreen();
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