/**
 * Synthesized sound effects (Web Audio, no asset files). Every sound is a
 * short recipe of oscillators and filtered noise. World sounds are
 * attenuated and panned relative to the camera, and each name is
 * rate-limited so a 200-drone fight doesn't turn into white noise.
 *
 * The AudioContext can only start after a user gesture, so `unlock()` is
 * called from the join button; before that every `play` is a no-op.
 */

export type SfxName =
  | "laser"
  | "gun"
  | "hit"
  | "explode"
  | "bigExplode"
  | "mineral"
  | "spawn"
  | "build"
  | "deny"
  | "hurt"
  | "alarm"
  | "emote"
  | "respawn"
  | "click";

interface PlayOpts {
  /** World position; omit for UI sounds (centered, no falloff). */
  x?: number;
  y?: number;
  /** Extra gain multiplier (0..1+). */
  volume?: number;
}

/** Beyond this distance from the camera, world sounds are silent. */
const HEARING_RANGE = 1300;
const MUTE_KEY = "openspace.muted";

// Per-sound throttle (min ms between plays) and base gain.
const RULES: Record<SfxName, { gap: number; gain: number }> = {
  laser: { gap: 45, gain: 0.16 },
  gun: { gap: 40, gain: 0.12 },
  hit: { gap: 35, gain: 0.12 },
  explode: { gap: 60, gain: 0.35 },
  bigExplode: { gap: 200, gain: 0.7 },
  mineral: { gap: 110, gain: 0.12 },
  spawn: { gap: 70, gain: 0.12 },
  build: { gap: 100, gain: 0.35 },
  deny: { gap: 150, gain: 0.22 },
  hurt: { gap: 120, gain: 0.4 },
  alarm: { gap: 1500, gain: 0.25 },
  emote: { gap: 100, gain: 0.2 },
  respawn: { gap: 500, gain: 0.25 },
  click: { gap: 40, gain: 0.12 },
};

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastAt = new Map<SfxName, number>();
  private listenerX = 0;
  private listenerY = 0;
  private halfWidth = 800;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      // Storage blocked: default to sound on.
    }
  }

  /** Create/resume the context. Must run inside a user gesture. */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      // Gentle limiter so a pile-up of explosions can't clip.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.02);
    }
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0");
    } catch {
      // Ignore: mute just won't persist.
    }
    return this.muted;
  }

  /** Camera position + screen half-width, for falloff and stereo pan. */
  setListener(x: number, y: number, screenWidth: number) {
    this.listenerX = x;
    this.listenerY = y;
    this.halfWidth = Math.max(200, screenWidth / 2);
  }

  play(name: SfxName, opts: PlayOpts = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted || ctx.state !== "running") return;
    const rule = RULES[name];
    const nowMs = performance.now();
    if (nowMs - (this.lastAt.get(name) ?? -1e9) < rule.gap) return;

    let gain = rule.gain * (opts.volume ?? 1);
    let pan = 0;
    if (opts.x !== undefined && opts.y !== undefined) {
      const dx = opts.x - this.listenerX;
      const dy = opts.y - this.listenerY;
      const d = Math.hypot(dx, dy);
      if (d >= HEARING_RANGE) return;
      gain *= (1 - d / HEARING_RANGE) ** 1.6;
      pan = Math.max(-0.8, Math.min(0.8, dx / this.halfWidth));
    }
    if (gain < 0.004) return;
    this.lastAt.set(name, nowMs);

    const out = ctx.createGain();
    out.gain.value = gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    out.connect(panner).connect(this.master);
    RECIPES[name](ctx, out, this.noise!, ctx.currentTime);
    // Disconnect after the longest recipe has finished.
    window.setTimeout(() => panner.disconnect(), 1600);
  }
}

type Recipe = (ctx: AudioContext, out: AudioNode, noise: AudioBuffer, t: number) => void;

/** Oscillator with an exponential pitch sweep and a fast-attack decay. */
function tone(
  ctx: AudioContext,
  out: AudioNode,
  t: number,
  type: OscillatorType,
  from: number,
  to: number,
  dur: number,
  level = 1,
) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(level, t + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(env).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Filtered noise burst with a sweeping cutoff. */
function burst(
  ctx: AudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  t: number,
  type: BiquadFilterType,
  fromHz: number,
  toHz: number,
  dur: number,
  level = 1,
) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(fromHz, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(20, toHz), t + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(level, t + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(env).connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

const RECIPES: Record<SfxName, Recipe> = {
  laser: (c, o, _n, t) => tone(c, o, t, "sawtooth", 1500, 260, 0.09, 0.6),
  gun: (c, o, n, t) => {
    tone(c, o, t, "square", 520, 160, 0.05, 0.5);
    burst(c, o, n, t, "highpass", 3000, 1500, 0.03, 0.4);
  },
  hit: (c, o, n, t) => burst(c, o, n, t, "bandpass", 2400, 900, 0.05),
  explode: (c, o, n, t) => {
    burst(c, o, n, t, "lowpass", 2200, 180, 0.35);
    tone(c, o, t, "sine", 140, 40, 0.3, 0.8);
  },
  bigExplode: (c, o, n, t) => {
    burst(c, o, n, t, "lowpass", 3000, 90, 1.1);
    tone(c, o, t, "sine", 110, 28, 0.9, 1);
    burst(c, o, n, t + 0.08, "bandpass", 900, 200, 0.6, 0.5);
  },
  mineral: (c, o, _n, t) => {
    tone(c, o, t, "sine", 1320, 1320, 0.1, 0.6);
    tone(c, o, t + 0.05, "sine", 1980, 1980, 0.14, 0.45);
  },
  spawn: (c, o, _n, t) => tone(c, o, t, "triangle", 330, 760, 0.08, 0.7),
  build: (c, o, n, t) => {
    tone(c, o, t, "sine", 200, 55, 0.22, 1);
    burst(c, o, n, t, "lowpass", 1400, 300, 0.08, 0.6);
    tone(c, o, t + 0.06, "triangle", 660, 660, 0.12, 0.25);
  },
  deny: (c, o, _n, t) => {
    tone(c, o, t, "square", 150, 140, 0.07, 0.6);
    tone(c, o, t + 0.09, "square", 120, 110, 0.09, 0.6);
  },
  hurt: (c, o, n, t) => {
    burst(c, o, n, t, "lowpass", 900, 120, 0.22);
    tone(c, o, t, "sine", 90, 45, 0.2, 0.9);
  },
  alarm: (c, o, _n, t) => {
    for (let i = 0; i < 2; i++) {
      tone(c, o, t + i * 0.3, "square", 880, 880, 0.13, 0.5);
      tone(c, o, t + i * 0.3 + 0.15, "square", 587, 587, 0.13, 0.5);
    }
  },
  emote: (c, o, _n, t) => tone(c, o, t, "sine", 600, 1100, 0.09, 0.7),
  respawn: (c, o, _n, t) => {
    [523, 659, 784, 1047].forEach((f, i) => tone(c, o, t + i * 0.06, "triangle", f, f, 0.16, 0.6));
  },
  click: (c, o, _n, t) => tone(c, o, t, "square", 1800, 1200, 0.025, 0.4),
};

export const sfx = new Sfx();
