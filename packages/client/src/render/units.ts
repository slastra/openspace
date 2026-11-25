import { Container, Graphics } from "pixi.js";
import { PLAYER_SIZE, PLAYER_SPEED, UNIT_KIND_META, UNIT_SIZE } from "@openspace/shared";
import { lighten, parseHexColor } from "./colors.js";

const SHIELD_AURA_COLOR = 0x60d4ff;

export interface ShipView {
  /** Outer container — game loop sets x/y; rotation is intentionally NOT set
   * here so the HP/shield bars stay world-aligned. */
  container: Container;
  setColor: (hex: string) => void;
  setLocal: (isLocal: boolean) => void;
  setRotation: (radians: number) => void;
  setHp: (frac: number) => void;
  setShield: (frac: number) => void;
  /** World-space engine trail. Add to the entity layer under `container`. */
  trail: Graphics;
  /** Per frame, after positioning `container`: feeds the engine flame and
   *  trail from how far the ship moved. */
  updateMotion: (dtSeconds: number) => void;
}

export interface UnitView {
  /** Outer container — game loop sets x/y; never rotated so HP bars stay world-aligned. */
  container: Container;
  /** Rotates the inner hull only. Pass radians (0 = facing +x). */
  setRotation: (radians: number) => void;
  setHp: (frac: number) => void;
  setShield: (frac: number) => void;
}

/**
 * Build a triangle ship. The hull rotates with the ship's heading; the
 * HP/shield bars stay axis-aligned above it via a non-rotated outer container.
 */
export function createShipView(): ShipView {
  const container = new Container();
  const body = new Container();
  container.addChild(body);

  const glow = new Graphics();
  const flame = new Graphics();
  const hull = new Graphics();
  flame.blendMode = "add";
  body.addChild(glow);
  body.addChild(flame);
  body.addChild(hull);
  const trail = new Graphics();
  trail.blendMode = "add";
  trail.zIndex = -10;
  container.zIndex = 10;

  const hpBar = createHealthBar(PLAYER_SIZE - 4);
  hpBar.container.position.set(0, -PLAYER_SIZE * 0.85);
  container.addChild(hpBar.container);

  const shieldBar = createShieldBar(PLAYER_SIZE - 4);
  shieldBar.container.position.set(0, -PLAYER_SIZE * 0.85 - 4);
  container.addChild(shieldBar.container);

  let currentColor = "#ffffff";
  let isLocal = false;

  const redraw = () => {
    const tint = parseHexColor(currentColor);
    const half = PLAYER_SIZE / 2;
    const tail = -PLAYER_SIZE * 0.45;
    const wing = PLAYER_SIZE * 0.55;

    const hullShape = [
      { x: half, y: 0 },
      { x: tail, y: -wing },
      { x: tail * 0.5, y: 0 },
      { x: tail, y: wing },
    ];

    hull
      .clear()
      .roundShape(hullShape, 2)
      .fill({ color: tint, alpha: 1 })
      .stroke({ color: lighten(tint, 0.5), width: 1.25, alpha: 0.9 });

    glow.clear();
    if (isLocal) {
      // Soft ground glow so your own ship stands out inside its swarm.
      for (const [r, a] of [
        [PLAYER_SIZE * 1.6, 0.05],
        [PLAYER_SIZE * 1.15, 0.07],
        [PLAYER_SIZE * 0.8, 0.09],
      ] as const) {
        glow.circle(0, 0, r).fill({ color: tint, alpha: a });
      }
    }

    // Unit-length flame pointing backward from the tail notch; scaled per
    // frame by speed. Additive, so it reads as light over anything.
    flame
      .clear()
      .poly([0, -wing * 0.42, -1, 0, 0, wing * 0.42])
      .fill({ color: lighten(tint, 0.35), alpha: 0.55 })
      .poly([0, -wing * 0.2, -0.75, 0, 0, wing * 0.2])
      .fill({ color: 0xffffff, alpha: 0.6 });
    flame.x = tail * 0.5 + 1;
    trailColor = tint;
  };

  // Engine trail: recent positions, sampled by distance, aged out so the
  // trail shrinks when the ship stops.
  const TRAIL_MAX = 18;
  const TRAIL_SPACING = 7;
  const TRAIL_LIFE_S = 0.45;
  const pts: { x: number; y: number; age: number }[] = [];
  let trailColor = 0xffffff;
  let speedSmoothed = 0;
  let lastX = Number.NaN;
  let lastY = Number.NaN;
  let flicker = 0;

  const updateMotion = (dt: number) => {
    const x = container.x;
    const y = container.y;
    if (Number.isNaN(lastX) || !container.visible) {
      lastX = x;
      lastY = y;
      pts.length = 0;
      trail.clear();
      return;
    }
    const moved = Math.hypot(x - lastX, y - lastY);
    lastX = x;
    lastY = y;
    // A respawn or reconcile snap is a teleport, not motion.
    if (moved > 120) {
      pts.length = 0;
    }
    const speed = dt > 0 ? Math.min(moved / dt, PLAYER_SPEED * 2.5) : 0;
    speedSmoothed += (speed - speedSmoothed) * Math.min(1, dt * 10);

    flicker += dt * 40;
    const k = Math.min(1, speedSmoothed / PLAYER_SPEED);
    const len = k < 0.05 ? 0 : 5 + k * 13 * (1 + 0.12 * Math.sin(flicker));
    flame.visible = len > 0;
    flame.scale.set(len, 0.8 + 0.2 * k);
    flame.alpha = container.alpha;

    for (const p of pts) p.age += dt;
    while (pts.length > 0 && pts[0]!.age > TRAIL_LIFE_S) pts.shift();
    const head = pts[pts.length - 1];
    if (!head || Math.hypot(head.x - x, head.y - y) >= TRAIL_SPACING) {
      pts.push({ x, y, age: 0 });
      if (pts.length > TRAIL_MAX) pts.shift();
    }

    trail.clear();
    if (pts.length < 2) return;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const life = 1 - b.age / TRAIL_LIFE_S;
      const along = i / pts.length;
      trail
        .moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .stroke({ color: trailColor, width: 1 + along * 4, alpha: 0.28 * life * along, cap: "round" });
    }
  };

  return {
    container,
    setColor(hex) {
      currentColor = hex;
      redraw();
    },
    setLocal(value) {
      isLocal = value;
      container.zIndex = value ? 11 : 10;
      redraw();
    },
    setRotation(r) {
      body.rotation = r;
    },
    setHp(frac) {
      hpBar.set(frac);
    },
    setShield(frac) {
      shieldBar.set(frac);
    },
    trail,
    updateMotion,
  };
}

const warnedUnknownKinds = new Set<string>();

/**
 * Build the visual for an AI unit, dispatched on `kind`. Each kind plugs in
 * its own builder function below; unknown kinds fall back to the rammer
 * silhouette so a new server kind doesn't crash old clients. We warn once
 * per unknown kind so missing-render-fn bugs surface in the console during
 * development instead of looking like "the laser drone renders as a diamond."
 */
export interface CreateUnitViewOptions {
  /** Include the HP/shield bars above the body. Defaults to true; pass false
   *  for icon snapshots so empty bars don't bleed into the visual. */
  bars?: boolean;
}

export function createUnitView(
  kind: string,
  color: string,
  opts: CreateUnitViewOptions = {},
): UnitView {
  const bars = opts.bars !== false;
  switch (kind) {
    case "rammer":
      return buildRammerView(color, bars);
    case "miner":
      return buildMinerView(color, bars);
    case "laser":
      return buildLaserView(color, bars);
    case "repair":
      return buildRepairView(color, bars);
    case "gunner":
      return buildGunnerView(color, bars);
    case "shielder":
      return buildShielderView(color, bars);
    default:
      if (!warnedUnknownKinds.has(kind)) {
        warnedUnknownKinds.add(kind);
        console.warn(`[units] no render fn for kind "${kind}", falling back to rammer`);
      }
      return buildRammerView(color, bars);
  }
}

/**
 * Rammer — diamond outer ring with a bright inner dot. Static (rotation-
 * symmetric so we don't need a rotated sub-container). HP/shield bars sit
 * axis-aligned above the body.
 */
function buildRammerView(color: string, bars: boolean): UnitView {
  const container = new Container();
  const body = new Container();
  container.addChild(body);
  const tint = parseHexColor(color);
  const r = UNIT_SIZE / 2;
  const ring = new Graphics();
  const core = new Graphics();

  // Diamond stretched along +x so the "front" is visually identifiable
  // once we rotate the body to the unit's facing direction.
  ring
    .roundShape(
      [
        { x: r * 1.15, y: 0 },
        { x: 0, y: r * 0.75 },
        { x: -r * 0.85, y: 0 },
        { x: 0, y: -r * 0.75 },
      ],
      1.5,
    )
    .stroke({ color: lighten(tint, 0.4), width: 1.5, alpha: 0.85 })
    .fill({ color: tint, alpha: 0.15 });

  core.circle(r * 0.25, 0, r * 0.28).fill({ color: lighten(tint, 0.6), alpha: 0.95 });

  body.addChild(ring);
  body.addChild(core);

  const meters = bars ? attachMeters(container, UNIT_SIZE * 0.75) : null;

  return {
    container,
    setRotation(r) {
      body.rotation = r;
    },
    setHp(frac) {
      meters?.hp(frac);
    },
    setShield(frac) {
      meters?.shield(frac);
    },
  };
}

/**
 * Miner — hexagonal hull with a bright drill core and three tool-arm spurs,
 * so it visually reads differently from the rammer's diamond at a glance.
 * Same HP/shield bar conventions as other unit views.
 */
/**
 * Attach the standard HP + shield bar pair to a unit view container.
 * Returned setters are no-ops when the bars aren't attached (caller decides
 * via the kind builder's `bars` flag — false for icon snapshots).
 */
function attachMeters(
  container: Container,
  baseY: number,
): { hp: (f: number) => void; shield: (f: number) => void } {
  const hpBar = createHealthBar(UNIT_SIZE - 2, 2);
  hpBar.container.position.set(0, -baseY);
  container.addChild(hpBar.container);
  const shieldBar = createShieldBar(UNIT_SIZE - 2, 1.5);
  shieldBar.container.position.set(0, -baseY - 3);
  container.addChild(shieldBar.container);
  return { hp: hpBar.set, shield: shieldBar.set };
}

function buildMinerView(color: string, bars: boolean): UnitView {
  const container = new Container();
  const body = new Container();
  container.addChild(body);
  const tint = parseHexColor(color);
  const r = UNIT_SIZE / 2;

  const hex = new Graphics();
  const verts: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    verts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  hex
    .roundShape(verts, 1.25)
    .fill({ color: tint, alpha: 0.25 })
    .stroke({ color: lighten(tint, 0.35), width: 1.5, alpha: 0.9 });
  body.addChild(hex);

  // Three short spurs on alternating hex faces — looks like mining arms.
  const spurs = new Graphics();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const x1 = Math.cos(a) * r * 0.9;
    const y1 = Math.sin(a) * r * 0.9;
    const x2 = Math.cos(a) * r * 1.5;
    const y2 = Math.sin(a) * r * 1.5;
    spurs
      .moveTo(x1, y1)
      .lineTo(x2, y2)
      .stroke({ color: lighten(tint, 0.5), width: 1.5, alpha: 0.85 });
  }
  body.addChild(spurs);

  // Forward drill — short triangle at +x so the front is unambiguous when rotated.
  const drill = new Graphics();
  drill
    .poly([r * 1.0, 0, r * 0.55, -r * 0.32, r * 0.55, r * 0.32])
    .fill({ color: lighten(tint, 0.55), alpha: 0.95 })
    .stroke({ color: lighten(tint, 0.7), width: 0.75, alpha: 0.9 });
  body.addChild(drill);

  const core = new Graphics();
  core.circle(0, 0, r * 0.32).fill({ color: 0xfacc15, alpha: 0.95 });
  body.addChild(core);

  const meters = bars ? attachMeters(container, UNIT_SIZE * 0.85) : null;

  return {
    container,
    setRotation(r) {
      body.rotation = r;
    },
    setHp(frac) {
      meters?.hp(frac);
    },
    setShield(frac) {
      meters?.shield(frac);
    },
  };
}

/**
 * Laser — narrow elongated hull with a glowing red emitter at the front and
 * twin barrel slits, signalling "ranged attacker" at a glance. Static
 * orientation (no rotation): the beam effect itself communicates aim.
 */
function buildLaserView(color: string, bars: boolean): UnitView {
  const container = new Container();
  const body = new Container();
  container.addChild(body);
  const tint = parseHexColor(color);
  const r = UNIT_SIZE / 2;

  const hull = new Graphics();
  hull
    .roundShape(
      [
        { x: r * 1.05, y: 0 },
        { x: -r * 0.7, y: -r * 0.55 },
        { x: -r * 0.9, y: 0 },
        { x: -r * 0.7, y: r * 0.55 },
      ],
      1.5,
    )
    .fill({ color: tint, alpha: 0.3 })
    .stroke({ color: lighten(tint, 0.45), width: 1.25, alpha: 0.95 });
  body.addChild(hull);

  // Twin barrel slits radiating from the emitter.
  const barrels = new Graphics();
  barrels
    .moveTo(0, -r * 0.18)
    .lineTo(r * 0.95, -r * 0.18)
    .stroke({ color: lighten(tint, 0.6), width: 0.75, alpha: 0.9 });
  barrels
    .moveTo(0, r * 0.18)
    .lineTo(r * 0.95, r * 0.18)
    .stroke({ color: lighten(tint, 0.6), width: 0.75, alpha: 0.9 });
  body.addChild(barrels);

  const emitter = new Graphics();
  emitter.circle(r * 0.85, 0, r * 0.22).fill({ color: 0xff5545, alpha: 0.95 });
  body.addChild(emitter);

  const meters = bars ? attachMeters(container, UNIT_SIZE * 0.85) : null;

  return {
    container,
    setRotation(r) {
      body.rotation = r;
    },
    setHp(frac) {
      meters?.hp(frac);
    },
    setShield(frac) {
      meters?.shield(frac);
    },
  };
}

/**
 * Repair drone — pill-shaped hull with a green caduceus-style cross core
 * so it reads as "medic" at any zoom. The cross sits inside the rotating
 * body; HP/shield bars stay axis-aligned outside.
 */
function buildRepairView(color: string, bars: boolean): UnitView {
  const container = new Container();
  const body = new Container();
  container.addChild(body);
  const tint = parseHexColor(color);
  const r = UNIT_SIZE / 2;
  const HEAL_GREEN = 0x4ade80;

  const hull = new Graphics();
  hull
    .roundShape(
      [
        { x: r * 0.95, y: -r * 0.55 },
        { x: r * 0.95, y: r * 0.55 },
        { x: -r * 0.95, y: r * 0.55 },
        { x: -r * 0.95, y: -r * 0.55 },
      ],
      r * 0.55,
    )
    .fill({ color: tint, alpha: 0.28 })
    .stroke({ color: lighten(tint, 0.4), width: 1.25, alpha: 0.95 });
  body.addChild(hull);

  // Green cross — universal heal/medic shorthand.
  const cross = new Graphics();
  const armW = r * 0.22;
  const armL = r * 0.55;
  cross
    .rect(-armW, -armL, armW * 2, armL * 2)
    .fill({ color: HEAL_GREEN, alpha: 0.95 });
  cross
    .rect(-armL, -armW, armL * 2, armW * 2)
    .fill({ color: HEAL_GREEN, alpha: 0.95 });
  body.addChild(cross);

  const meters = bars ? attachMeters(container, UNIT_SIZE * 0.85) : null;

  return {
    container,
    setRotation(r) {
      body.rotation = r;
    },
    setHp(frac) {
      meters?.hp(frac);
    },
    setShield(frac) {
      meters?.shield(frac);
    },
  };
}

/**
 * Gunner — chunky front-loaded hull with a single thick barrel. Visually
 * distinct from the laser (which has twin slits + emitter glow) so you can
 * tell at a glance which ranged unit is firing.
 */
function buildGunnerView(color: string, bars: boolean): UnitView {
  const container = new Container();
  const body = new Container();
  container.addChild(body);
  const tint = parseHexColor(color);
  const r = UNIT_SIZE / 2;

  const hull = new Graphics();
  hull
    .roundShape(
      [
        { x: r * 0.55, y: -r * 0.7 },
        { x: r * 0.55, y: r * 0.7 },
        { x: -r * 0.85, y: r * 0.55 },
        { x: -r * 0.85, y: -r * 0.55 },
      ],
      2,
    )
    .fill({ color: tint, alpha: 0.35 })
    .stroke({ color: lighten(tint, 0.4), width: 1.25, alpha: 0.95 });
  body.addChild(hull);

  const barrel = new Graphics();
  barrel
    .rect(r * 0.45, -r * 0.22, r * 0.7, r * 0.44)
    .fill({ color: lighten(tint, 0.55), alpha: 0.95 })
    .stroke({ color: lighten(tint, 0.7), width: 0.75, alpha: 0.9 });
  body.addChild(barrel);

  const muzzle = new Graphics();
  muzzle.circle(r * 1.15, 0, r * 0.18).fill({ color: 0xffd166, alpha: 0.95 });
  body.addChild(muzzle);

  const meters = bars ? attachMeters(container, UNIT_SIZE * 0.85) : null;

  return {
    container,
    setRotation(r) {
      body.rotation = r;
    },
    setHp(frac) {
      meters?.hp(frac);
    },
    setShield(frac) {
      meters?.shield(frac);
    },
  };
}

/**
 * Shielder — round dome hull with a cyan shield emblem and a faint aura
 * ring at the kind's actual `shieldRange`, so players can see exactly how
 * far the protection reaches. The aura sits on the outer (non-rotating)
 * container so it stays world-aligned while the dome rotates with facing.
 */
function buildShielderView(color: string, bars: boolean): UnitView {
  const container = new Container();
  const tint = parseHexColor(color);
  const r = UNIT_SIZE / 2;

  // Aura ring under everything else. Pulled from kind meta so changing
  // SHIELDER.shieldRange auto-updates the visual. Skipped in icon mode
  // (`bars: false`) — the 220-unit ring would dominate the auto-fit and
  // shrink the dome to a speck.
  const auraRadius = UNIT_KIND_META.shielder?.shieldRange ?? 0;
  if (bars && auraRadius > 0) {
    const aura = new Graphics();
    aura
      .circle(0, 0, auraRadius)
      .stroke({ color: SHIELD_AURA_COLOR, width: 1, alpha: 0.18 });
    aura.circle(0, 0, auraRadius).fill({ color: SHIELD_AURA_COLOR, alpha: 0.04 });
    container.addChild(aura);
  }

  const body = new Container();
  container.addChild(body);

  const dome = new Graphics();
  dome
    .circle(0, 0, r * 1.05)
    .fill({ color: tint, alpha: 0.3 })
    .stroke({ color: lighten(tint, 0.4), width: 1.25, alpha: 0.95 });
  body.addChild(dome);

  // Cyan shield emblem (curved arc + downward V).
  const emblem = new Graphics();
  emblem
    .moveTo(-r * 0.45, -r * 0.2)
    .arc(0, -r * 0.2, r * 0.45, Math.PI, 0)
    .lineTo(0, r * 0.45)
    .closePath()
    .fill({ color: SHIELD_AURA_COLOR, alpha: 0.95 });
  body.addChild(emblem);

  const meters = bars ? attachMeters(container, UNIT_SIZE * 0.85) : null;

  return {
    container,
    setRotation(r) {
      body.rotation = r;
    },
    setHp(frac) {
      meters?.hp(frac);
    },
    setShield(frac) {
      meters?.shield(frac);
    },
  };
}

interface MeterBar {
  container: Container;
  set: (frac: number) => void;
}

/**
 * HP bar that only shows while the owner is hurt. A full-health swarm
 * otherwise reads as a field of green dashes. The fill is drawn once and
 * scaled/tinted, so a change never rebuilds geometry.
 */
function createHealthBar(width: number, height: number = 3): MeterBar {
  const container = new Container();
  const bg = new Graphics();
  const fg = new Graphics();
  bg.rect(-width / 2 - 0.5, -0.5, width + 1, height + 1).fill({ color: 0x05080f, alpha: 0.75 });
  fg.rect(0, 0, width, height).fill({ color: 0xffffff, alpha: 0.95 });
  fg.position.set(-width / 2, 0);
  container.addChild(bg);
  container.addChild(fg);
  container.visible = false;
  let lastFrac = -1;
  return {
    container,
    set(frac) {
      const clamped = frac < 0 ? 0 : frac > 1 ? 1 : frac;
      if (clamped === lastFrac) return;
      lastFrac = clamped;
      container.visible = clamped < 1;
      fg.scale.x = clamped;
      fg.tint = clamped > 0.5 ? 0x4ade80 : clamped > 0.25 ? 0xfacc15 : 0xf87171;
    },
  };
}

/**
 * Shield bar — same width as the HP bar, rendered in cyan. Stays invisible
 * until the unit actually has shield (so unshielded kinds show no clutter).
 */
function createShieldBar(width: number, height: number = 2): MeterBar {
  const container = new Container();
  const fg = new Graphics();
  container.addChild(fg);
  let lastFrac = -1;
  return {
    container,
    set(frac) {
      const clamped = frac < 0 ? 0 : frac > 1 ? 1 : frac;
      if (clamped === lastFrac) return;
      lastFrac = clamped;
      fg.clear();
      if (clamped <= 0) return;
      fg
        .rect(-width / 2, 0, width * clamped, height)
        .fill({ color: 0x60d4ff, alpha: 0.85 });
    },
  };
}

