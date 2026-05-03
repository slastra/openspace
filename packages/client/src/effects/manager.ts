import type { Container } from "pixi.js";
import { Container as PixiContainer } from "pixi.js";

/**
 * One transient visual effect (death burst, spawn pulse, hit spark, ...).
 * Implementations create their own Pixi children inside `container` and
 * mutate them per frame in `update`. Returning false signals the manager
 * to remove and destroy the effect.
 */
export interface Effect {
  container: Container;
  update(dt: number): boolean;
}

/**
 * Owns a Pixi container that holds active effects. Game code calls `add` to
 * spawn an effect and `update(dt)` once per frame; dead effects are pulled
 * out and destroyed automatically.
 */
export class EffectManager {
  readonly layer: Container;
  private active: Effect[] = [];

  constructor(parent: Container) {
    this.layer = new PixiContainer({ label: "effects" });
    parent.addChild(this.layer);
  }

  add(effect: Effect) {
    this.active.push(effect);
    this.layer.addChild(effect.container);
  }

  update(dt: number) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const effect = this.active[i]!;
      const alive = effect.update(dt);
      if (!alive) {
        this.layer.removeChild(effect.container);
        effect.container.destroy({ children: true });
        this.active.splice(i, 1);
      }
    }
  }
}
