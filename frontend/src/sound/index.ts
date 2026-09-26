// Synthesized WebAudio only: plain http is not a secure context, so no AudioWorklet and no files.
export type SoundName = 'open' | 'close' | 'static' | 'paired';

interface ToneSpec {
  type: OscillatorType;
  from: number;
  to?: number;
  dur: number;
  peak: number;
  lowpass?: number;
  delay?: number;
}

type Voice = (ctx: AudioContext, out: AudioNode, at: number) => void;

let ctx: AudioContext | undefined;
let master: GainNode | undefined;
let noise: AudioBuffer | undefined;
let volume = 70;

/** Squared curve: the middle of the volume slider sounds roughly half as loud. */
const gainFor = (v: number): number => (v / 100) ** 2;

/** Fast attack, exponential decay; exponential ramps must never touch zero. */
function envelope(gain: AudioParam, start: number, dur: number, peak: number): void {
  gain.setValueAtTime(0.0001, start);
  gain.exponentialRampToValueAtTime(peak, start + 0.006);
  gain.exponentialRampToValueAtTime(0.0001, start + dur);
}

function tone(ctx: AudioContext, out: AudioNode, at: number, spec: ToneSpec): void {
  const start = at + (spec.delay ?? 0);
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = spec.type;
  osc.frequency.setValueAtTime(spec.from, start);
  if (spec.to !== undefined) osc.frequency.exponentialRampToValueAtTime(spec.to, start + spec.dur * 0.7);
  envelope(amp.gain, start, spec.dur, spec.peak);
  if (spec.lowpass) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = spec.lowpass;
    osc.connect(filter).connect(amp);
  } else {
    osc.connect(amp);
  }
  amp.connect(out);
  osc.onended = () => amp.disconnect();
  osc.start(start);
  osc.stop(start + spec.dur + 0.02);
}

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (!noise) {
    noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.6), ctx.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }
  return noise;
}

const voices: Record<SoundName, Voice> = {
  // Chunky panel blips: a filtered square chirp over a short low thump, rising to open, falling to close.
  open: (ctx, out, at) => {
    tone(ctx, out, at, { type: 'square', from: 240, to: 620, dur: 0.12, peak: 0.16, lowpass: 2400 });
    tone(ctx, out, at, { type: 'sine', from: 150, to: 90, dur: 0.1, peak: 0.35 });
  },
  close: (ctx, out, at) => {
    tone(ctx, out, at, { type: 'square', from: 560, to: 210, dur: 0.11, peak: 0.16, lowpass: 2000 });
    tone(ctx, out, at, { type: 'sine', from: 120, to: 70, dur: 0.09, peak: 0.3 });
  },
  static: (ctx, out, at) => {
    const src = ctx.createBufferSource();
    const highpass = ctx.createBiquadFilter();
    const lowpass = ctx.createBiquadFilter();
    const amp = ctx.createGain();
    src.buffer = noiseBuffer(ctx);
    highpass.type = 'highpass';
    highpass.frequency.value = 700;
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 6500;
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
    amp.gain.setValueAtTime(0.22, at + 0.4);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
    src.connect(highpass).connect(lowpass).connect(amp).connect(out);
    src.onended = () => amp.disconnect();
    src.start(at);
  },
  // A friendly rising fourth (G5, then C6), each note with a faint octave for a bell-like shine.
  paired: (ctx, out, at) => {
    for (const [delay, hz, dur] of [[0, 783.99, 0.5], [0.14, 1046.5, 0.8]] as const) {
      tone(ctx, out, at, { type: 'sine', from: hz, dur, peak: 0.22, delay });
      tone(ctx, out, at, { type: 'sine', from: hz * 2, dur: dur * 0.6, peak: 0.05, delay });
    }
  },
};

/** Call from the TAP TO START gesture: creates or resumes the audio context. Never rejects. */
export async function unlockAudio(): Promise<void> {
  try {
    if (!ctx) {
      if (typeof AudioContext === 'undefined') return;
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = gainFor(volume);
      master.connect(ctx.destination);
    }
    if (ctx.state !== 'running') await ctx.resume();
  } catch {
    // No usable audio here: every sound stays a silent no-op.
  }
}

/** Plays a sound; silently does nothing before unlockAudio() or when audio is unavailable. */
export function play(name: SoundName): void {
  if (!ctx || !master) return;
  if (ctx.state !== 'running') {
    ctx.resume().catch(() => undefined);
    return;
  }
  try {
    voices[name](ctx, master, ctx.currentTime + 0.01);
  } catch {
    // Sounds are decoration: a failure must never break the page.
  }
}

/** Master volume, 0–100 (the server's `volume`). Kept until the context exists. */
export function setVolume(v: number): void {
  if (!Number.isFinite(v)) return;
  volume = Math.min(100, Math.max(0, v));
  if (ctx && master) master.gain.setTargetAtTime(gainFor(volume), ctx.currentTime, 0.03);
}
