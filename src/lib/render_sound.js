import { APU } from "./apu.js"

class BaseOsc {
    /**
     * @param {AudioContext} ctx 
     * @param {AudioNode} dstNode 
     */
    constructor(ctx, dstNode) {
        this._ctx = ctx;
        /**@type {OscillatorNode} */
        this._oscNode = undefined;
        this._gainOut = new GainNode(ctx, { gain: 0 });
        this._gainOut.connect(dstNode);
    }

    setFrequency(v, time) {
        this._oscNode.frequency.setValueAtTime(v > this._oscNode.frequency.maxValue ? this._oscNode.frequency.maxValue : v, time);
    }

    set frequency(v) {
        this.setFrequency(v, this._ctx.currentTime);
    }

    get frequency() {
        return this._oscNode.frequency.value;
    }

    setVolume(v, time) {
        this._gainOut.gain.setValueAtTime(v, time);
    }

    set volume(v) {
        this.setVolume(v, this._ctx.currentTime);
    }

    get volume() {
        return this._gainOut.gain.value;
    }

    start() { this._oscNode.start(); }
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

    setDuty(v, time) {
        for (let i = 0; i < 4; i++) {
            this._gain[i].gain.setValueAtTime((v == i) ? 1.0 : 0.0, time);
        }
    }

    set duty(v) {
        this.setDuty(v, this._ctx.currentTime);
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

    setMode(v, time) {
        this._modeParam.setValueAtTime(v, time);
    }

    /**Noise mode (true: buzzer, false: white) */
    set mode(v) {
        this.setMode(v, this._ctx.currentTime);
    }

    setFrequency(v, time) {
        this._freqParam.setValueAtTime(v, time);
        this._buzzParam.setValueAtTime(v / 93, time);
    }
}

class DMCOsc extends BaseOsc {
    /**
     * @param {AudioContext} ctx 
     * @param {AudioNode} dstNode 
     * @param {APU} apu 
     * @param {RenderSound} render
     */
    constructor(ctx, dstNode, apu, render) {
        super(ctx, dstNode);
        this._apu = apu;
        this._render = render;
        this._pcmBufferPos = 0;
        this._pcmBuffer = new Float32Array(128);
        this._c = 0;
        this.pcmNode = new AudioWorkletNode(this._ctx, 'pcm-processor', {
            processorOptions: {}
        });
        this.pcmNode.connect(this._gainOut);
        this.volume = 1;
    }

    dispatch() {
        if (this._apu.dmc.isBufferFill) {
            let len = this._apu.dmc.pcmBufferLength(this._pcmBufferPos);

            if (len) {
                let values = new Float32Array(len);
                let cycles = new Uint32Array(len);
                let syncTime = 0.0;
                let syncCycles = 0;
                let i = 0;
                for (const index of this._apu.dmc.pcmBufferIndexRange(this._pcmBufferPos)) {
                    values[i] = this._apu.dmc.pcmBuffer[index] / 127.0 * 2.0 - 1.0;
                    cycles[i] = this._apu.dmc.pcmCyclesBuffer[index];
                    if (i == 0) {
                        syncCycles = this._apu.dmc.pcmCyclesBuffer[index];
                        let timeDelta = (syncCycles - this._render.cycStamp) / this._apu.bus.cpuFrequency;
                        syncTime = this._render.timeStamp + timeDelta;
                    }
                    i++;
                }
                this._pcmBufferPos = this._apu.dmc.pcmBufferPos;
                
                this.pcmNode.port.postMessage({
                    direct: {
                        buffer: values,
                        cycles: cycles,
                        syncTime: syncTime,
                        syncCycles: syncCycles
                    }
                });
            }
        }
    }
}

class RenderSound {
    /** @param {APU} apu */
    constructor(apu) {
        this._apu = apu;
        this._ctx = undefined;
        this._timeStamp = 0;
        this._cycStamp = 0;
    }

    /**@param {AudioContext} context */
    setContext(context) {
        this._ctx = context;
        this._masterGain = new GainNode(this._ctx, { gain: 0.3 });
        this._masterGain.connect(this._ctx.destination);

        this._aSqOsc = [new PulseOsc(this._ctx, this._masterGain), new PulseOsc(this._ctx, this._masterGain)];

        this._triangleOsc = new TriangleOsc(this._ctx, this._masterGain);

        this._noiseOsc = new NoiseOsc(this._ctx, this._masterGain);
        this._dmc = new DMCOsc(this._ctx, this._masterGain, this._apu, this);
    }

    get ctx() { return this._ctx; }
    get apu() { return this._apu; }
    get masterGain() { return this._masterGain; }
    get cycStamp() { return this._cycStamp; }
    get timeStamp() { return this._timeStamp; }

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

    syncTime() {
        if (!this._ctx) return;
        this._cycStamp = this._apu.bus.cpu.cycles;
        let curTime = this._ctx.currentTime;
        let delta = curTime - this._timeStamp;  //reduce timer jitter
        this._timeStamp = curTime + (this._apu.bus.nes.frameTimeS - (delta * 0.98));
        
        this._dmc.pcmNode.port.postMessage({
            syncCycles: this._cycStamp,
            syncTime: this._timeStamp,
            cpuFreq: this._apu.bus.cpuFrequency
        });
    }

    refresh() {
        if (!this._ctx) return;
        let timeDelta = (this._apu.bus.cpu.cycles - this._cycStamp) / this._apu.bus.cpuFrequency;
        let timeOffset = this._timeStamp + timeDelta;

        for (let i = 0; i < this._aSqOsc.length; i++) {
            this._aSqOsc[i].setFrequency(this._apu.aPulse[i].frequency, timeOffset);
            this._aSqOsc[i].setDuty(this._apu.aPulse[i].duty, timeOffset);
            if (this._apu.aPulse[i].isEnable) {
                this._aSqOsc[i].setVolume(this._apu.aPulse[i].amplitude / 15 * 0.3, timeOffset);
            } else {
                this._aSqOsc[i].setVolume(0.0, timeOffset);
            }
        }

        this._triangleOsc.setFrequency(this._apu.triangle.frequency, timeOffset);
        if (this._apu.triangle.isEnable) {
            this._triangleOsc.setVolume(this._apu.triangle.amplitude / 15 * 0.3, timeOffset);
        } else {
            this._triangleOsc.setVolume(0.0, timeOffset);
        }

        this._noiseOsc.setVolume(this._apu.noise.amplitude / 15 * 0.3, timeOffset);
        this._noiseOsc.setMode(this._apu.noise.mode, timeOffset);
        this._noiseOsc.setFrequency(this._apu.noise.sampleRate / 2, timeOffset);

        this._dmc.dispatch();
    }
}

export { RenderSound };