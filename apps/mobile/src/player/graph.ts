// Modular audio graph (PLAN.md D19):
//   source → [processing slots…] → analyser → master gain → destination
// A slot is any node pair (input, output). Adding, removing or bypassing a slot
// only rewires the chain; PlayerService never changes when a new stage (EQ,
// reverb, a custom native C++ node, …) is added.
import type { AnalyserNode, AudioContext, AudioNode, BiquadFilterNode, GainNode } from 'react-native-audio-api';
import { eventLog } from '../log/eventLog';

export interface ProcessingSlot {
  readonly id: string;
  readonly input: AudioNode;
  readonly output: AudioNode;
  bypassed: boolean;
  dispose(): void;
}

/** Same bands, filter type and Q as the desktop (src/renderer/audio.js), so presets match. */
export const EQ_BAND_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
const EQ_Q = 1.1;

export interface EqSlot extends ProcessingSlot {
  readonly bands: BiquadFilterNode[];
  setBandGain(index: number, db: number): void;
  setAll(gains: readonly number[]): void;
}

export function createEqSlot(ctx: AudioContext): EqSlot {
  const bands = EQ_BAND_FREQS.map((f) => {
    const b = ctx.createBiquadFilter();
    b.type = 'peaking';
    b.frequency.value = f;
    b.Q.value = EQ_Q;
    b.gain.value = 0;
    return b;
  });
  for (let i = 0; i < bands.length - 1; i++) bands[i]!.connect(bands[i + 1]!);
  const setBandGain = (i: number, db: number) => {
    const band = bands[i];
    if (!band) return;
    const v = Math.max(-12, Math.min(12, db));
    band.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
  };
  return {
    id: 'eq10',
    input: bands[0]!,
    output: bands[bands.length - 1]!,
    bypassed: false,
    bands,
    setBandGain,
    setAll: (gains) => gains.forEach((g, i) => setBandGain(i, g)),
    dispose: () => bands.forEach((b) => safeDisconnect(b)),
  };
}

function safeDisconnect(node: AudioNode | null | undefined) {
  if (!node) return;
  try {
    node.disconnect();
  } catch {
    // not connected: fine
  }
}

export class AudioGraph {
  readonly analyser: AnalyserNode;
  readonly master: GainNode;
  private readonly slots: ProcessingSlot[] = [];
  private source: AudioNode | null = null;
  private readonly timeData: Uint8Array;

  constructor(readonly ctx: AudioContext) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;
    this.master = ctx.createGain();
    this.analyser.connect(this.master);
    this.master.connect(ctx.destination);
    this.timeData = new Uint8Array(this.analyser.fftSize);
  }

  addSlot(slot: ProcessingSlot, index = this.slots.length) {
    this.slots.splice(index, 0, slot);
    this.rewire();
  }

  getSlot<T extends ProcessingSlot>(id: string): T | undefined {
    return this.slots.find((s) => s.id === id) as T | undefined;
  }

  removeSlot(id: string) {
    const i = this.slots.findIndex((s) => s.id === id);
    if (i < 0) return;
    const [slot] = this.slots.splice(i, 1);
    safeDisconnect(slot?.output);
    slot?.dispose();
    this.rewire();
  }

  setBypass(id: string, bypassed: boolean) {
    const s = this.slots.find((x) => x.id === id);
    if (!s || s.bypassed === bypassed) return;
    s.bypassed = bypassed;
    this.rewire();
  }

  /** Replaces the source node (a new one per loaded track). */
  setSource(node: AudioNode | null) {
    if (this.source && this.source !== node) safeDisconnect(this.source);
    this.source = node;
    this.rewire();
  }

  describe(): string {
    const active = this.slots.filter((s) => !s.bypassed).map((s) => s.id);
    return ['source', ...active, 'analyser', 'gain', 'out'].join(' → ');
  }

  /** RMS of the signal reaching the analyser, 0..1. Non-zero proves audio flows through the graph. */
  readLevel(): number {
    this.analyser.getByteTimeDomainData(this.timeData);
    let sum = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const v = (this.timeData[i]! - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this.timeData.length);
  }

  private rewire() {
    safeDisconnect(this.source);
    for (const s of this.slots) safeDisconnect(s.output);
    let prev: AudioNode | null = this.source;
    for (const s of this.slots) {
      if (s.bypassed) continue;
      if (prev) prev.connect(s.input);
      prev = s.output;
    }
    // With no source yet, the last slot still feeds the analyser so the chain is complete.
    if (prev) prev.connect(this.analyser);
    eventLog.debug('graph', this.describe());
  }
}
