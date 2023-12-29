const BUFFER_LENGTH = 1024 * 32;
class PcmProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        /**PCM values array */
        this._aBuffer = new Float32Array(BUFFER_LENGTH);
        this._aCycles = new Uint32Array(BUFFER_LENGTH);

        this._pos = 0;
        this._dst = 0;
        this._current = 0.0;

        this._syncCycles = 0;
        this._lastCycles = 0;

        this._cycles = 0;
        this._cpuRate = 37.2;

        this.port.onmessage = (e) => {
            /**@type {Float32Array} */
            if (e.data.direct) {
                const srcVal = e.data.direct.buffer;
                const srcCycles = e.data.direct.cycles;
                
                if (srcCycles[0] < this._lastCycles) {
                    this._pos = 0;
                    this._dst = 0;
                }
                this._lastCycles = srcCycles[srcVal.length - 1];

                for (let i = 0; i < srcVal.length; i++) {
                    this._aBuffer[this._dst] = srcVal[i];
                    this._aCycles[this._dst] = srcCycles[i];
                    this._dst = ++this._dst % this._aBuffer.length;
                }
            } else {
                this._cpuRate = (e.data.cpuFreq / sampleRate);
                let td = currentTime - e.data.syncTime;
                let cd = td * e.data.cpuFreq;
                let fixC = e.data.syncCycles + cd;
                // console.log(this._cycles - fixC);
                if ((this._cycles > fixC) || (this._cycles < (fixC - 3000))) {
                    this._cycles = fixC;
                }
            }
        }
    }

    process(inputs, outputs, parameters) {
        /**@type {Float32Array} */
        const channel = outputs[0][0];

        for (let i = 0; i < channel.length; i++) {
            this._cycles += this._cpuRate;
            if (this._pos != this._dst) {
                if (this._aCycles[this._pos] <= this._cycles) {
                    this._current = this._aBuffer[this._pos];
                    this._pos = ++this._pos % this._aBuffer.length;
                }
            }
            channel[i] = this._current;
        }
        // console.log(`cyc:${this._cycles} posCyc:${this._aCycles[this._pos]} pos:${this._pos} dst:${this._dst}`);
        return true;
    }
}

registerProcessor('pcm-processor', PcmProcessor);