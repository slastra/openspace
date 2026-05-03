import { Container, Graphics, Text } from "pixi.js";

export interface WreckageView {
  container: Container;
  setCredits: (n: number) => void;
  /** Drives the breathing-glow animation (pass elapsed seconds). */
  tick: (dt: number) => void;
}

const MINERAL_GOLD = 0xfacc15;
const MINERAL_BRIGHT = 0xfde68a;

/**
 * Wreckage square — dead pilot's loot drop. Always rendered in mineral
 * gold (matches the credits palette) regardless of the dead player's color
 * so it visually screams "minerals here". The pilot's name above identifies
 * whose wreck it is; the orphan units orbiting carry their original color.
 */
export function createWreckageView(
  _color: string,
  ownerName: string,
  halfSize: number,
): WreckageView {
  const container = new Container();

  const aura = new Graphics();
  container.addChild(aura);
  const square = new Graphics();
  container.addChild(square);

  const half = halfSize;
  square
    .roundRect(-half, -half, half * 2, half * 2, 4)
    .fill({ color: MINERAL_GOLD, alpha: 0.85 })
    .stroke({ color: MINERAL_BRIGHT, width: 1.5, alpha: 0.95 });
  // Inner highlight rectangle — gives the gold block some surface depth.
  square
    .roundRect(-half * 0.6, -half * 0.6, half * 1.2, half * 1.2, 2)
    .stroke({ color: MINERAL_BRIGHT, width: 0.75, alpha: 0.6 });

  const nameLabel = new Text({
    text: ownerName,
    style: {
      fontFamily: "ui-monospace, Menlo, monospace",
      fontSize: 10,
      fill: 0xcbd5e1,
      letterSpacing: 1,
    },
  });
  nameLabel.anchor.set(0.5, 1);
  nameLabel.position.set(0, -half - 4);
  container.addChild(nameLabel);

  const creditsLabel = new Text({
    text: "0",
    style: {
      fontFamily: "ui-monospace, Menlo, monospace",
      fontSize: 12,
      fontWeight: "700",
      fill: 0xfacc15,
    },
  });
  creditsLabel.anchor.set(0.5, 0);
  creditsLabel.position.set(0, half + 4);
  container.addChild(creditsLabel);

  let elapsed = 0;
  const drawAura = () => {
    aura.clear();
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * 3);
    const r = halfSize * 1.6;
    aura
      .circle(0, 0, r)
      .fill({ color: MINERAL_GOLD, alpha: 0.05 + 0.08 * pulse });
    aura
      .circle(0, 0, r * 0.7)
      .stroke({ color: MINERAL_BRIGHT, width: 1, alpha: 0.25 + 0.25 * pulse });
  };
  drawAura();

  return {
    container,
    setCredits(n) {
      const str = String(n);
      if (creditsLabel.text !== str) creditsLabel.text = str;
    },
    tick(dt) {
      elapsed += dt;
      drawAura();
    },
  };
}
