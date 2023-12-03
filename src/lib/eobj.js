/** Extended Object to make possible recursively save/load state */
class EObject extends Object {
    constructor() {
        super();
    }

    /**
     * Attribute names, that not be state stored
     * @returns {Array<String>}
     */
    get _stateExclude() {
        return [];
    }

    _getStateItem(el) {
        if (el instanceof Object) {
            if (el instanceof EObject) {
                return el.getState();

            } else if (el instanceof ArrayBuffer) {
                return Array.from(new Uint8Array(el));

            } else if (el instanceof Array) {
                let res = new Array(el.length);
                let isDefine = false;
                for (let i = 0; i < res.length; i++) {
                    res[i] = this._getStateItem(el[i]);
                    if (res[i] != undefined) isDefine = true;
                }
                if (isDefine) return res;
            }
        } else {
            return el;
        }
    }

    getState() {
        let res = {};
        let ex = this._stateExclude;

        for (const key in this) {
            if (ex.includes(key)) continue;
            let b = this._getStateItem(this[key]);
            if (b) res[key] = b;
        }

        return res;
    }

    _setStateItem(obj, key, stateItem) {
        if (obj[key] instanceof Object) {
            if (obj[key] instanceof EObject) {
                obj[key].setState(stateItem);

            } else if (obj[key] instanceof ArrayBuffer) {
                let arr_view = new Uint8Array(obj[key]);
                arr_view.set(stateItem);

            } else if (obj[key] instanceof Array) {
                for (let i = 0; i < obj[key].length; i++) {
                    this._setStateItem(obj[key], i, stateItem[i]);
                }
            }
        } else {
            obj[key] = stateItem;
        }
    }

    setState(state) {
        for (const key in state) {
            if (!(key in this)) continue;
            this._setStateItem(this, key, state[key]);
        }
    }

    _resetStateItem(obj, key) {
        if (obj[key] instanceof Object) {
            if (obj[key] instanceof EObject) {
                obj[key].resetState();
            } else if (obj[key] instanceof Array) {
                for (let i = 0; i < obj[key].length; i++) {
                    this._resetStateItem(obj[key], i);
                }
            }
        }
    }

    resetState() {
        let ex = this._stateExclude;
        for (const key in this) {
            if (ex.includes(key)) continue;
            this._resetStateItem(this, key);
        }
    }
}

export { EObject };