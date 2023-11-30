class PcmProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        /**PCM values array */
        this._aDirectBuffer = new Float32Array(512);
        /**Sample rates for every sample */
        this._aDirectRate = new Float32Array(512);
        this._directPos = 0;
        this._directDst = 0;
        this._directRest = 0;

        /**@type {Float32Array} */
        this._aDmcBuffer = undefined;
        this._dmcRate = 1000;
        this._dmcPos = 0;
        this._dmcDst = 0;
        this._dmcRest = 0;

        this.port.onmessage = (e) => {
            /**@type {Float32Array} */
            if (e.data.direct) {
                const srcVal = e.data.direct.buffer;
                const srcRate = e.data.direct.rate;
                for (let i = 0; i < srcVal.length; i++) {
                    this._aDirectBuffer[this._directDst] = srcVal[i];
                    this._aDirectRate[this._directDst] = srcRate[i];
                    this._directDst = ++this._directDst % this._aDirectBuffer.length;
                }
            }

            if (e.data.sample) {
                this._dmcRate = e.data.sample.rate;
                this._aDmcBuffer = e.data.sample.buffer;
                this._dmcPos = 0;
                this._dmcDst = this._aDmcBuffer.length - 1;
                this._dmcRest = 0;
            }
        }
    }

    process(inputs, outputs, parameters) {
        /**@type {Float32Array} */
        const channel = outputs[0][0];

        if (this._dmcPos != this._dmcDst) {
            for (let i = 0; i < channel.length; i++) {
                channel[i] = this._aDmcBuffer[this._dmcPos];
                this._dmcRest += this._dmcRate;
                if (this._dmcRest > sampleRate) {
                    this._dmcRest %= sampleRate;
                    this._dmcPos++;
                    if (this._dmcPos == this._dmcDst) break;
                }
            }
            return true;
        }

        if (this._directDst != this._directPos) {
            for (let i = 0; i < channel.length; i++) {
                channel[i] = this._aDirectBuffer[this._directPos];
                this._directRest += this._aDirectRate[this._directPos];
                if (this._directRest > sampleRate) {
                    this._directRest %= sampleRate;
                    this._directPos = ++this._directPos % this._aDirectBuffer.length;
                    if (this._directPos == this._directDst) break;
                }
            }
        }

        return true;
    }
}

registerProcessor('pcm-processor', PcmProcessor);