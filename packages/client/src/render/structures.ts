import { Container, Graphics } from "pixi.js";
import { STRUCTURE_GRID_SNAP } from "@openspace/shared";
import { lighten, parseHexColor } from "./colors.js";

export interface StructureView {
  container: Container;
  /** Update the HP bar (hidden at full HP for clean visual). */
  setHp: (frac: number) => void;
  /** Rotate the dynamic part (turret barrel). No-op for static structures. */
  setRotation: (radians: number) => void;
}

const SIZE = STRUCTURE_GRID_SNAP * 0.7;

/**
 * Build the visual for a player-placed structure. Currently only "supply"
 * exists — a stout boxy depot with a stacked-crates motif and a player-tinted
 * frame so allegiance reads at a glance. Visuals sit below the unit layer
 * (set by game.ts on add) so ships and drones draw on top.
 */
export interface CreateStructureViewOptions {
  /** Include the HP bar above the structure. Defaults to true; pass false
   *  for icon snapshots so an empty bar doesn't show. */
  bars?: boolean;
}

export function createStructureView(
  kind: string,
  color: string,
  opts: CreateStructureViewOptions = {},
): StructureView {
  const bars = opts.bars !== false;
  const container = new Container();
  let setRotation: (r: number) => void = () => {};
  switch (kind) {
    case "turret": {
      setRotation = buildTurret(container, color);
      break;
    }
    case "supply":
    default:
      buildSupply(container, color);
      break;
  }
  let hpBar: BarHandle | null = null;
  if (bars) {
    hpBar = createStructureHpBar(SIZE * 0.85);
    hpBar.container.position.set(0, -SIZE / 2 - 8);
    container.addChild(hpBar.container);
  }
  return {
    container,
    setHp(frac) {
      hpBar?.set(frac);
    },
    setRotation(r) {
      setRotation(r);
    },
  };
}

interface BarHandle {
  container: Container;
  set: (frac: number) => void;
}

/** Slim HP bar that hides at full health, mirrors the asteroid bar style. */
function createStructureHpBar(width: number): BarHandle {
  const container = new Container();
  const bg = new Graphics();
  const fg = new Graphics();
  container.addChild(bg);
  container.addChild(fg);
  let last = -1;
  return {
    container,
    set(frac) {
      const f = frac < 0 ? 0 : frac > 1 ? 1 : frac;
      if (f === last) return;
      last = f;
      bg.clear();
      fg.clear();
      if (f >= 1) return;
      bg.rect(-width / 2, 0, width, 3).fill({ color: 0x10141c, alpha: 0.7 });
      bg.stroke({ color: 0x2a3346, width: 0.75, alpha: 0.8 });
      if (f <= 0) return;
      const color = f > 0.5 ? 0x4ade80 : f > 0.25 ? 0xfacc15 : 0xf87171;
      fg.rect(-width / 2, 0, width * f, 3).fill({ color, alpha: 0.95 });
    },
  };
}

/**
 * Octagonal armored base with a rotating barrel + emitter dot. The barrel
 * sits in its own sub-container so we can spin it to face the current
 * target without rotating the base or the HP bar.
 *
 * Returns a setter the caller wires to the schema's rotation field.
 */
function buildTurret(container: Container, color: string): (r: number) => void {
  const tint = parseHexColor(color);
  const half = SIZE / 2;
  const inset = half * 0.85;

  // Octagonal base — chamfered square reads as "armored fortification".
  const base = new Graphics();
  const cut = SIZE * 0.18;
  base
    .poly([
      -inset + cut, -inset,
      inset - cut, -inset,
      inset, -inset + cut,
      inset, inset - cut,
      inset - cut, inset,
      -inset + cut, inset,
      -inset, inset - cut,
      -inset, -inset + cut,
    ])
    .fill({ color: 0x1a1f2e, alpha: 0.9 })
    .stroke({ color: lighten(tint, 0.35), width: 1.5, alpha: 0.95 });
  container.addChild(base);

  const ring = new Graphics();
  ring
    .circle(0, 0, SIZE * 0.32)
    .fill({ color: tint, alpha: 0.18 })
    .stroke({ color: lighten(tint, 0.45), width: 1, alpha: 0.85 });
  container.addChild(ring);

  // Barrel + emitter live in their own container so we can rotate them.
  const barrelMount = new Container();
  container.addChild(barrelMount);

  const barrel = new Graphics();
  barrel
    .rect(-SIZE * 0.08, -SIZE * 0.45, SIZE * 0.16, SIZE * 0.32)
    .fill({ color: lighten(tint, 0.5), alpha: 0.95 })
    .stroke({ color: lighten(tint, 0.7), width: 0.75, alpha: 0.9 });
  barrelMount.addChild(barrel);

  const emitter = new Graphics();
  emitter.circle(0, -SIZE * 0.46, SIZE * 0.07).fill({ color: 0xff5545, alpha: 0.95 });
  barrelMount.addChild(emitter);

  // Server gives rotation as 0 = facing +x. Add π/2 so the barrel (drawn
  // pointing up at -y) ends up aligned with the target direction.
  return (r: number) => {
    barrelMount.rotation = r + Math.PI / 2;
  };
}

function buildSupply(container: Container, color: string) {
  const tint = parseHexColor(color);
  const frame = new Graphics();
  const half = SIZE / 2;
  frame
    .roundRect(-half, -half, SIZE, SIZE, 6)
    .fill({ color: 0x1a1f2e, alpha: 0.85 })
    .stroke({ color: lighten(tint, 0.35), width: 1.5, alpha: 0.95 });
  container.addChild(frame);

  // Stacked-crate motif — three rows of two cells, tinted in the owner's color.
  const crates = new Graphics();
  const cellW = SIZE * 0.32;
  const cellH = SIZE * 0.22;
  const gapX = SIZE * 0.06;
  const gapY = SIZE * 0.06;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) {
      const x = (col - 0.5) * (cellW + gapX) - cellW / 2;
      const y = (row - 1) * (cellH + gapY) - cellH / 2;
      crates
        .rect(x, y, cellW, cellH)
        .fill({ color: tint, alpha: 0.55 })
        .stroke({ color: lighten(tint, 0.5), width: 0.75, alpha: 0.85 });
    }
  }
  container.addChild(crates);
}

/**
 * Translucent ghost rendered at the snapped grid cell while the player is
 * in placement mode. `valid` toggles between affordable+legal (green-ish)
 * and rejected (red-ish) tints so the player gets immediate feedback.
 */
export function createPlacementGhost(): {
  container: Container;
  setPos: (x: number, y: number) => void;
  setValid: (valid: boolean) => void;
} {
  const container = new Container();
  const g = new Graphics();
  container.addChild(g);
  let lastValid: boolean | null = null;

  const draw = (valid: boolean) => {
    g.clear();
    const half = SIZE / 2;
    const color = valid ? 0x4ade80 : 0xf87171;
    g
      .roundRect(-half, -half, SIZE, SIZE, 6)
      .fill({ color, alpha: 0.15 })
      .stroke({ color, width: 1.5, alpha: 0.85 });
    // Crosshair marker for the snap center.
    g.moveTo(-6, 0).lineTo(6, 0).stroke({ color, width: 1, alpha: 0.7 });
    g.moveTo(0, -6).lineTo(0, 6).stroke({ color, width: 1, alpha: 0.7 });
  };
  draw(true);

  return {
    container,
    setPos(x, y) {
      container.x = x;
      container.y = y;
    },
    setValid(valid) {
      if (valid === lastValid) return;
      lastValid = valid;
      draw(valid);
    },
  };
}

