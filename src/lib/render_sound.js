import { APU } from "./apu.js"

class BaseOsc {
    /**
     * @param {AudioContext} ctx 
     * @param {AudioNode} dstNode 
     */
    constructor(ctx, dstNode) {
        this._ctx = ctx;
        this._gainOut = new GainNode(ctx, { gain: 0 });
        this._gainOut.connect(dstNode);
    }

    set volume(val) {
        this._gainOut.gain.setValueAtTime(val, this._ctx.currentTime);
    }
    get volume() {
        return this._gainOut.gain.value;
    }

    start() { }
}

class PulseOsc extends BaseOsc {
    constructor(ctx, dstNode) {
        super(ctx, dstNode);

        this._oscNode = new OscillatorNode(ctx, { type: "sawtooth" });
        this._gain = Array(4);
        this._shaper = Array(4);

        let duties = [32, 64, 128, 192];
        for (let i = 0; i < 4; i++) {
            this._gain[i] = new GainNode(ctx, { gain: 0 });
            this._gain[i].connect(this._gainOut);

            let squareCurve = new Float32Array(256);
            squareCurve.fill(-1.0, 0, duties[i]);
            squareCurve.fill(1.0, duties[i], 256);
            this._shaper[i] = new WaveShaperNode(ctx, { curve: squareCurve });
            this._shaper[i].connect(this._gain[i]);

            this._oscNode.connect(this._shaper[i]);
        }
    }

    start() { this._oscNode.start(); }

    set frequency(v) {
        this._oscNode.frequency.setValueAtTime(v > this._oscNode.frequency.maxValue ? this._oscNode.frequency.maxValue : v, this._ctx.currentTime);
    }
    set duty(v) {
        for (let i = 0; i < 4; i++) {
            this._gain[i].gain.setValueAtTime((v == i) ? 1.0 : 0.0, this._ctx.currentTime);
        }
    }
}

class TriangleOsc extends BaseOsc {
    constructor(ctx, dstNode) {
        super(ctx, dstNode);

        let stepDistort = new Float32Array(256);
        let i = 0;
        for (; i < stepDistort.length - 16; i += 16) { stepDistort.fill(((i / 256) * 2) - 1, i, i + 16); }
        stepDistort.fill(1, i, 256);
        this._shaper = new WaveShaperNode(ctx, { curve: stepDistort });

        this._oscNode = new OscillatorNode(ctx, { type: "triangle" });
        this._oscNode.connect(this._shaper);
        this._shaper.connect(this._gainOut);
    }

    start() { this._oscNode.start(); }

    set frequency(v) {
        this._oscNode.frequency.setValueAtTime(v > this._oscNode.frequency.maxValue ? this._oscNode.frequency.maxValue : v, this._ctx.currentTime);
    }
}

class NoiseOsc extends BaseOsc {
    constructor(ctx, dstNode) {
        super(ctx, dstNode);
        this._noiseNode = new AudioWorkletNode(this._ctx, 'noise-processor', {
            processorOptions: {}
        });
        this._noiseNode.connect(this._gainOut);
        this._freqParam = this._noiseNode.parameters.get("frequency");
        this._modeParam = this._noiseNode.parameters.get("mode");
        this._buzzParam = this._noiseNode.parameters.get("buzz");
    }

    set volume(val) {
        this._gainOut.gain.setValueAtTime(val, this._ctx.currentTime);
    }

    /**Noise mode (true: buzzer, false: white) */
    set mode(v) {
        this._modeParam.value = !!(v) + 0;
    }

    set frequency(v) {
        this._freqParam.value = v;
        this._buzzParam.value = v / 93;
    }
}

class DMCOsc extends BaseOsc {
    /**
     * @param {AudioContext} ctx 
     * @param {AudioNode} dstNode 
     * @param {APU} apu 
     */
    constructor(ctx, dstNode, apu) {
        super(ctx, dstNode);
        this._apu = apu;
        this._pcmBufferPos = 0;
        this._pcmBuffer = new Float32Array(128);
        this._c = 0;
        this.pcmNode = new AudioWorkletNode(this._ctx, 'pcm-processor', {
            processorOptions: {}
        });
        this.pcmNode.connect(this._gainOut);
        this._apu.dmc.setCallback(this._callback.bind(this));
        this.volume = 1;
    }

    _callback(num, data) {
        switch (num) {
            case 0:
                let len = undefined;
                if (this._apu.dmc.pcmBufferPos < this._pcmBufferPos) {
                    len = this._apu.dmc.pcmBuffer.length - this._pcmBufferPos;
                    len += this._apu.dmc.pcmBufferPos;
                } else {
                    len = this._apu.dmc.pcmBufferPos - this._pcmBufferPos;
                }
                let values = new Float32Array(len);
                let rates = new Float32Array(len);
                let i = 0;
                for (const index of this._apu.dmc.pcmBufferIndexRange(this._pcmBufferPos)) {
                    values[i] = this._apu.dmc.pcmBuffer[index] / 127.0 * 2.0 - 1.0;
                    rates[i] = this._apu.dmc.pcmRateBuffer[index];
                    i++;
                }
                this._pcmBufferPos = this._apu.dmc.pcmBufferPos;
                this.pcmNode.port.postMessage({
                    direct: {
                        buffer: values,
                        rate: rates
                    }
                });
                break;
            case 1:
                let rawData = this._apu.dmc.getDPCMData();
                let fData = new Float32Array(rawData.length);
                for (let i = 0; i < rawData.length; i++) {
                    fData[i] = rawData[i] / 255.0 * 2 - 1;
                    fData[i] *= 5
                }
                this.pcmNode.port.postMessage({ sample: { buffer: fData, rate: this._apu.dmc.dmcRateFrequency } });
                break;
            default:
                break;
        }
    }
}

class RenderSound {
    /** @param {APU} apu */
    constructor(apu) {
        this._apu = apu;
        this._ctx = undefined;
    }

    /**@param {AudioContext} context */
    setContext(context) {
        this._ctx = context;
        this._masterGain = new GainNode(this._ctx, { gain: 0.1 });
        this._masterGain.connect(this._ctx.destination);

        this._aSqOsc = [new PulseOsc(this._ctx, this._masterGain), new PulseOsc(this._ctx, this._masterGain)];

        this._triangleOsc = new TriangleOsc(this._ctx, this._masterGain);

        this._noiseOsc = new NoiseOsc(this._ctx, this._masterGain);
        this._dmc = new DMCOsc(this._ctx, this._masterGain, this._apu);
    }

    start() {
        if (!this._ctx) return;
        try {
            for (const sqOsc of this._aSqOsc) {
                sqOsc.start();
            }
            this._triangleOsc.start();
            this._noiseOsc.start();
        } catch (e) { }
    }

    shut() {
        if (!this._ctx) return;
        for (const sqOsc of this._aSqOsc) {
            sqOsc.volume = 0;
        }
        this._triangleOsc.volume = 0;
        this._noiseOsc.volume = 0;
    }

    refresh() {
        if (!this._ctx) return;
        for (let i = 0; i < this._aSqOsc.length; i++) {
            this._aSqOsc[i].frequency = this._apu.aPulse[i].frequency;
            this._aSqOsc[i].duty = this._apu.aPulse[i].duty;
            if (this._apu.aPulse[i].isEnable) {
                this._aSqOsc[i].volume = this._apu.aPulse[i].amplitude / 15 * 0.3;
            } else {
                this._aSqOsc[i].volume = 0;
            }
        }

        this._triangleOsc.frequency = this._apu.triangle.frequency;
        if (this._apu.triangle.isEnable) {
            this._triangleOsc.volume = this._apu.triangle.amplitude / 15 * 0.3;
        } else {
            this._triangleOsc.volume = 0.0;
        }

        this._noiseOsc.volume = this._apu.noise.amplitude / 15 * 0.3;
        this._noiseOsc.mode = this._apu.noise.mode;
        this._noiseOsc.frequency = (this._apu.noise.sampleRate / 2);
    }
}

export { RenderSound };