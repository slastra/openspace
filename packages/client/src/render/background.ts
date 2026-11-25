import { Container, Graphics, Sprite, Texture } from "pixi.js";
import {
  GRID_SPACING,
  SPAWN_BUBBLE_RADIUS_U,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "@openspace/shared";
import { mulberry32 } from "./random.js";

/** Screen-space parallax layer: told where the camera is each frame. */
export interface ParallaxLayer {
  update(camX: number, camY: number, screenW: number, screenH: number): void;
}

interface StarLayerSpec {
  parallax: number;
  /** Stars per screen megapixel, so density is resolution-independent. */
  perMegapixel: number;
  minSize: number;
  maxSize: number;
  minA: number;
  maxA: number;
  seed: number;
}

// Far → near. Stars are small sprites that wrap around the screen, so the
// field is endless and costs a few hundred quads in one batch, with no
// full-screen fill passes (which hurt on weak GPUs).
const STAR_LAYERS: StarLayerSpec[] = [
  { parallax: 0.04, perMegapixel: 230, minSize: 2, maxSize: 3.5, minA: 0.25, maxA: 0.6, seed: 11 },
  { parallax: 0.1, perMegapixel: 70, minSize: 3, maxSize: 5, minA: 0.4, maxA: 0.85, seed: 23 },
  { parallax: 0.22, perMegapixel: 14, minSize: 5, maxSize: 9, minA: 0.6, maxA: 1, seed: 37 },
];

// Mostly white with a few blue and amber stars.
const STAR_TINTS = [0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xcfe0ff, 0xa8c8ff, 0xffe2b0];

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D) => void): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext("2d")!);
  return Texture.from(canvas);
}

/** A star: hard bright core with a soft halo. */
function starTexture(): Texture {
  return canvasTexture(16, (ctx) => {
    const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,0.9)");
    g.addColorStop(0.45, "rgba(255,255,255,0.2)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 16);
  });
}

// Nebula clouds in "parallax space" (camera world position × NEBULA_PARALLAX,
// so 0..360 across a 12k world), baked into one low-res texture. The
// gradients are smooth, so upscaling ~7× is invisible and the whole nebula
// is a single sprite.
const NEBULA_PARALLAX = 0.03;
const NEBULA_MIN = -1600;
const NEBULA_SPAN = 3600;
const NEBULA_TEX = 512;
const NEBULA_CLOUDS = [
  { x: 120, y: 140, r: 750, rgb: "29, 78, 216", a: 0.16 },
  { x: 260, y: 90, r: 600, rgb: "15, 118, 110", a: 0.14 },
  { x: 200, y: 260, r: 850, rgb: "109, 40, 217", a: 0.11 },
  { x: 40, y: 300, r: 550, rgb: "14, 116, 144", a: 0.12 },
  { x: 330, y: 330, r: 650, rgb: "190, 24, 93", a: 0.08 },
];

function nebulaTexture(): Texture {
  return canvasTexture(NEBULA_TEX, (ctx) => {
    const k = NEBULA_TEX / NEBULA_SPAN;
    ctx.globalCompositeOperation = "lighter";
    for (const c of NEBULA_CLOUDS) {
      const x = (c.x - NEBULA_MIN) * k;
      const y = (c.y - NEBULA_MIN) * k;
      const r = c.r * k;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${c.rgb}, ${c.a})`);
      g.addColorStop(0.4, `rgba(${c.rgb}, ${c.a * 0.5})`);
      g.addColorStop(1, `rgba(${c.rgb}, 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
}

interface Star {
  sprite: Sprite;
  /** Position in [0,1) of the wrap box. */
  u: number;
  v: number;
}

/**
 * Deep-space backdrop: one nebula sprite plus three wrapping star layers at
 * increasing parallax. Lives in screen space (the `background` container is
 * never moved by the camera); `update` pans it.
 */
export function buildStarfield(parent: Container): ParallaxLayer {
  const nebula = new Sprite(nebulaTexture());
  nebula.width = nebula.height = NEBULA_SPAN;
  parent.addChild(nebula);

  const tex = starTexture();
  const layers = STAR_LAYERS.map((spec) => {
    const container = new Container();
    parent.addChild(container);
    return { spec, container, stars: [] as Star[] };
  });
  let lastW = 0;
  let lastH = 0;

  // (Re)seed each layer for the screen size. Same seed → same sky.
  const populate = (w: number, h: number) => {
    for (const layer of layers) {
      const { spec } = layer;
      layer.container.removeChildren().forEach((c) => c.destroy());
      layer.stars = [];
      const rng = mulberry32(spec.seed);
      const count = Math.round(((w * h) / 1e6) * spec.perMegapixel);
      for (let i = 0; i < count; i++) {
        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5);
        const size = spec.minSize + rng() * (spec.maxSize - spec.minSize);
        sprite.width = sprite.height = size;
        sprite.alpha = spec.minA + rng() * (spec.maxA - spec.minA);
        sprite.tint = STAR_TINTS[Math.floor(rng() * STAR_TINTS.length)]!;
        layer.container.addChild(sprite);
        layer.stars.push({ sprite, u: rng(), v: rng() });
      }
    }
  };

  const wrap = (v: number, m: number) => ((v % m) + m) % m;

  return {
    update(camX, camY, w, h) {
      if (w !== lastW || h !== lastH) {
        populate(w, h);
        lastW = w;
        lastH = h;
      }
      nebula.position.set(
        w / 2 - camX * NEBULA_PARALLAX + NEBULA_MIN,
        h / 2 - camY * NEBULA_PARALLAX + NEBULA_MIN,
      );
      for (const { spec, stars } of layers) {
        const ox = -camX * spec.parallax;
        const oy = -camY * spec.parallax;
        for (const s of stars) {
          s.sprite.x = wrap(s.u * w + ox, w);
          s.sprite.y = wrap(s.v * h + oy, h);
        }
      }
    },
  };
}

/**
 * Screen-space red edge flash above the world for when the local ship
 * takes damage. Hidden (no fill cost) except while a pulse is fading.
 */
export interface Vignette {
  container: Container;
  resize(w: number, h: number): void;
  /** Kick a red damage pulse (0..1 strength). */
  hit(strength: number): void;
  tick(dtSeconds: number): void;
}

export function buildVignette(parent: Container): Vignette {
  const container = new Container({ label: "damage-vignette" });
  container.eventMode = "none";
  const red = new Sprite(
    canvasTexture(256, (ctx) => {
      const g = ctx.createRadialGradient(128, 128, 256 * 0.3, 128, 128, 256 * 0.72);
      g.addColorStop(0, "rgba(255,40,40,0)");
      g.addColorStop(1, "rgba(255,40,40,0.55)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
    }),
  );
  red.alpha = 0;
  red.visible = false;
  container.addChild(red);
  parent.addChild(container);
  let pulse = 0;
  return {
    container,
    resize(w, h) {
      red.width = w;
      red.height = h;
    },
    hit(strength) {
      pulse = Math.min(1, Math.max(pulse, strength));
      red.visible = true;
    },
    tick(dt) {
      if (pulse <= 0) return;
      pulse = Math.max(0, pulse - dt * 2.5);
      red.alpha = pulse;
      red.visible = pulse > 0;
    },
  };
}

const MAJOR_EVERY = 5;

export function buildGrid(parent: Container) {
  // Grid lives in world space so it aligns with player movement and gives a
  // strong sense of motion as you fly across it. Minor lines every cell,
  // brighter major lines every MAJOR_EVERY cells.
  const grid = new Graphics();
  for (let x = 0, i = 0; x <= WORLD_WIDTH; x += GRID_SPACING, i++) {
    if (i % MAJOR_EVERY !== 0) grid.moveTo(x, 0).lineTo(x, WORLD_HEIGHT);
  }
  for (let y = 0, i = 0; y <= WORLD_HEIGHT; y += GRID_SPACING, i++) {
    if (i % MAJOR_EVERY !== 0) grid.moveTo(0, y).lineTo(WORLD_WIDTH, y);
  }
  grid.stroke({ color: 0x1f4560, width: 1, alpha: 0.38 });
  for (let x = 0; x <= WORLD_WIDTH; x += GRID_SPACING * MAJOR_EVERY) {
    grid.moveTo(x, 0).lineTo(x, WORLD_HEIGHT);
  }
  for (let y = 0; y <= WORLD_HEIGHT; y += GRID_SPACING * MAJOR_EVERY) {
    grid.moveTo(0, y).lineTo(WORLD_WIDTH, y);
  }
  grid.stroke({ color: 0x24506b, width: 1.25, alpha: 0.45 });

  // Outside the arena: a dark wash so the playable area reads as lit.
  const PAD = 6000;
  grid
    .rect(-PAD, -PAD, WORLD_WIDTH + PAD * 2, PAD)
    .rect(-PAD, WORLD_HEIGHT, WORLD_WIDTH + PAD * 2, PAD)
    .rect(-PAD, 0, PAD, WORLD_HEIGHT)
    .rect(WORLD_WIDTH, 0, PAD, WORLD_HEIGHT)
    .fill({ color: 0x020409, alpha: 0.6 });

  // World boundary: a soft glow under a crisp line.
  grid.rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).stroke({ color: 0x38bdf8, width: 10, alpha: 0.08 });
  grid.rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).stroke({ color: 0x38bdf8, width: 2, alpha: 0.55 });

  parent.addChild(grid);
  return grid;
}

/**
 * Circular marker for the no-build spawn bubble at world center: a dim
 * filled disc, a soft glow ring and a crisp dashed-looking outline, so a
 * player flying past can tell they're inside the no-build zone.
 */
export function buildSpawnBubble(parent: Container) {
  const bubble = new Graphics();
  const cx = WORLD_WIDTH / 2;
  const cy = WORLD_HEIGHT / 2;
  bubble.circle(cx, cy, SPAWN_BUBBLE_RADIUS_U).fill({ color: 0x4ade80, alpha: 0.025 });
  bubble.circle(cx, cy, SPAWN_BUBBLE_RADIUS_U).stroke({ color: 0x4ade80, width: 8, alpha: 0.06 });
  const SEGMENTS = 96;
  for (let i = 0; i < SEGMENTS; i++) {
    const a0 = (i / SEGMENTS) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / SEGMENTS * 0.6;
    bubble
      .moveTo(cx + Math.cos(a0) * SPAWN_BUBBLE_RADIUS_U, cy + Math.sin(a0) * SPAWN_BUBBLE_RADIUS_U)
      .arc(cx, cy, SPAWN_BUBBLE_RADIUS_U, a0, a1);
  }
  bubble.stroke({ color: 0x4ade80, width: 2, alpha: 0.4 });
  parent.addChild(bubble);
  return bubble;
}
