import { Container, Graphics } from "pixi.js";

export interface AsteroidView {
  container: Container;
  /** Update the HP bar (only drawn when hp < max). Pass [0,1]. */
  setHp: (frac: number) => void;
}

const ROCK_FILL = 0x4a4034;
const ROCK_STROKE = 0x8a7656;
const ROCK_HIGHLIGHT = 0xb8a07a;

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

  rock
    .poly(points.flatMap((p) => [p.x, p.y]))
    .fill({ color: ROCK_FILL, alpha: 1 })
    .stroke({ color: ROCK_STROKE, width: 1.5, alpha: 0.9 });

  // A few inner specks for a hint of texture without a real fill pattern.
  const specks = new Graphics();
  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * radius * 0.55;
    specks.circle(Math.cos(a) * r, Math.sin(a) * r, 1.5).fill({
      color: ROCK_HIGHLIGHT,
      alpha: 0.55,
    });
  }
  container.addChild(specks);

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

/** Tiny seeded PRNG so each asteroid id gets a stable silhouette. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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
