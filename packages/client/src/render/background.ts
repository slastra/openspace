import { Container, Graphics } from "pixi.js";
import {
  GRID_COLOR,
  GRID_SPACING,
  SPAWN_BUBBLE_RADIUS_U,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "@openspace/shared";

export function buildStarfield(parent: Container) {
  // Stars are drawn once into a single Graphics in screen-ish space and panned
  // gently with the camera (parallax handled by the renderer).
  const stars = new Graphics();
  const count = 220;
  const spread = Math.max(WORLD_WIDTH, WORLD_HEIGHT) * 0.6;
  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * spread * 2;
    const y = (Math.random() - 0.5) * spread * 2;
    const r = Math.random() * 1.2 + 0.3;
    const a = 0.3 + Math.random() * 0.6;
    stars.circle(x, y, r).fill({ color: 0xffffff, alpha: a });
  }
  parent.addChild(stars);
  return stars;
}

export function buildGrid(parent: Container) {
  // Grid lives in world space so it aligns with player movement and gives a
  // strong sense of motion as you fly across it.
  const grid = new Graphics();
  for (let x = 0; x <= WORLD_WIDTH; x += GRID_SPACING) {
    grid.moveTo(x, 0).lineTo(x, WORLD_HEIGHT);
  }
  for (let y = 0; y <= WORLD_HEIGHT; y += GRID_SPACING) {
    grid.moveTo(0, y).lineTo(WORLD_WIDTH, y);
  }
  grid.stroke({ color: GRID_COLOR, width: 1, alpha: 0.55 });

  // World boundary — slightly brighter so you can see where the arena ends.
  grid
    .rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
    .stroke({ color: 0x1e6072, width: 2, alpha: 0.8 });

  parent.addChild(grid);
  return grid;
}

/**
 * Faint circular outline marking the no-build spawn bubble at world
 * center. Lives in world space so it pans with the camera. Draws a
 * dim filled disc + a brighter outline so a player flying past can
 * tell they're inside the bubble (no-build zone) at a glance.
 */
export function buildSpawnBubble(parent: Container) {
  const bubble = new Graphics();
  const cx = WORLD_WIDTH / 2;
  const cy = WORLD_HEIGHT / 2;
  bubble
    .circle(cx, cy, SPAWN_BUBBLE_RADIUS_U)
    .fill({ color: 0x4ade80, alpha: 0.04 })
    .stroke({ color: 0x4ade80, width: 2, alpha: 0.45 });
  parent.addChild(bubble);
  return bubble;
}
