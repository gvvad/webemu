class RandomNoiseProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._halfSRate = sampleRate / 2;
        this._noiseBuffer = new Float32Array(sampleRate);
        for (let i = 0; i < this._noiseBuffer.length; i++) {
            this._noiseBuffer[i] = Math.random() * 2 - 1.0;
            // this._noiseBuffer[i] = (Math.random() > 0.5)? 1 : -1;
        }
        this._pos = 0;
        this._rate = 0;
        this._buzzRate = 0;
    }

    static get parameterDescriptors() {
        return [{
            name: "mode",
            defaultValue: 0.0,
            minValue: 0.0,
            maxValue: 1.0
        }, {
            name: "frequency",
            defaultValue: 100.0
        }, {
            name: "buzz",
            defaultValue: 100.0
        }];
    }

    process(inputs, outputs, parameters) {
        const channel = outputs[0][0];
        const freq = parameters.frequency[0];
        const mode = parameters.mode[0] > 0.5;

        for (let i = 0; i < channel.length; i++) {
            channel[i] = this._noiseBuffer[this._pos];

            this._rate += freq;
            if (this._rate >= this._halfSRate) {
                this._rate %= this._halfSRate;
                this._pos = ++this._pos % this._noiseBuffer.length;
            }

            if (mode) {
                this._buzzRate += parameters.buzz[0];
                if (this._buzzRate > this._halfSRate) {
                    this._buzzRate %= this._halfSRate;
                    this._pos = 0;
                }
            }
        }

        return true;
    }
}

registerProcessor("noise-processor", RandomNoiseProcessor);