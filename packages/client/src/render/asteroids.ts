import { Container, Graphics } from "pixi.js";
import { mulberry32 } from "./random.js";

export interface AsteroidView {
  container: Container;
  /** Update the HP bar (only drawn when hp < max). Pass [0,1]. */
  setHp: (frac: number) => void;
}

const ROCK_SHADOW = 0x241f1a;
const ROCK_FILL = 0x51463a;
const ROCK_STROKE = 0x8a7656;
const ROCK_HIGHLIGHT = 0xd8c3a0;

/**
 * Build an asteroid view: a jagged closed polygon that visually breaks
 * up the perfectly-circular collider, plus a thin damage bar that fades
 * in only once the rock has been chipped. Geometry is generated once at
 * construction (a deterministic hash of `seed` keeps the silhouette stable
 * across re-creations of the same asteroid id).
 */
export function createAsteroidView(radius: number, seed: number): AsteroidView {
  const container = new Container();

  const rock = new Graphics();
  container.addChild(rock);

  const rng = mulberry32(seed);
  const points: { x: number; y: number }[] = [];
  const sides = 9 + Math.floor(rng() * 4); // 9–12 vertices
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2;
    // 0.78 – 1.05 of the radius, jittered per-vertex for a rough silhouette.
    const r = radius * (0.78 + rng() * 0.27);
    points.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  }

  // Light from the top-left: a dark base silhouette, a lit body offset
  // toward the light, and a faint highlight cap. Each inner layer is the
  // same polygon scaled down, so it stays inside the silhouette.
  const layer = (scale: number, ox: number, oy: number) =>
    points.flatMap((p) => [p.x * scale + ox * radius, p.y * scale + oy * radius]);
  rock
    .poly(layer(1, 0, 0))
    .fill({ color: ROCK_SHADOW, alpha: 1 })
    .poly(layer(0.84, -0.07, -0.08))
    .fill({ color: ROCK_FILL, alpha: 1 })
    .poly(layer(0.5, -0.2, -0.22))
    .fill({ color: ROCK_HIGHLIGHT, alpha: 0.14 })
    .poly(layer(1, 0, 0))
    .stroke({ color: ROCK_STROKE, width: Math.max(1.25, radius * 0.02), alpha: 0.5 });

  // Craters: a dark pit with a lit lower-right lip.
  const craters = new Graphics();
  const craterCount = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < craterCount; i++) {
    const a = rng() * Math.PI * 2;
    const d = rng() * radius * 0.5;
    const cx = Math.cos(a) * d;
    const cy = Math.sin(a) * d;
    const cr = radius * (0.1 + rng() * 0.1);
    const a0 = Math.PI * -0.05;
    const a1 = Math.PI * 0.55;
    craters
      .circle(cx, cy, cr)
      .fill({ color: ROCK_SHADOW, alpha: 0.65 })
      .moveTo(cx + Math.cos(a0) * cr, cy + Math.sin(a0) * cr)
      .arc(cx, cy, cr, a0, a1)
      .stroke({ color: ROCK_HIGHLIGHT, width: Math.max(1, cr * 0.2), alpha: 0.3 });
  }
  container.addChild(craters);

  const hpBar = createHealthBar(radius * 1.5);
  hpBar.container.position.set(0, -radius - 8);
  container.addChild(hpBar.container);

  return {
    container,
    setHp(frac) {
      hpBar.set(frac);
    },
  };
}

interface MeterBar {
  container: Container;
  set: (frac: number) => void;
}

function createHealthBar(width: number): MeterBar {
  const container = new Container();
  const bg = new Graphics();
  const fg = new Graphics();
  container.addChild(bg);
  container.addChild(fg);
  let lastFrac = -1;
  return {
    container,
    set(frac) {
      const clamped = frac < 0 ? 0 : frac > 1 ? 1 : frac;
      if (clamped === lastFrac) return;
      lastFrac = clamped;
      bg.clear();
      fg.clear();
      // Hide the bar entirely on a pristine asteroid — keeps the field clean.
      if (clamped >= 1) return;
      bg.rect(-width / 2, 0, width, 3).fill({ color: 0x10141c, alpha: 0.7 });
      bg.stroke({ color: 0x2a3346, width: 0.75, alpha: 0.8 });
      if (clamped <= 0) return;
      const color = clamped > 0.5 ? 0xb8a07a : clamped > 0.25 ? 0xfacc15 : 0xf87171;
      fg.rect(-width / 2, 0, width * clamped, 3).fill({ color, alpha: 0.95 });
    },
  };
}

/** Hash a string id into a 32-bit seed for the silhouette PRNG. */
export function asteroidSeed(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
