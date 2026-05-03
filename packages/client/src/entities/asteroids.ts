import { Renderer } from "../render/renderer.js";
import { AsteroidView, asteroidSeed, createAsteroidView } from "../render/asteroids.js";
import { AsteroidSnapshot } from "../net/client.js";

/**
 * Client-side mirror of a server Asteroid. Static — no interpolation
 * needed; position is set once on add and never changes server-side.
 * Visible state is just hp (drives the damage bar).
 */
export class Asteroid {
  readonly id: string;
  readonly view: AsteroidView;
  readonly radius: number;
  hp: number;
  maxHp: number;
  /** Seconds since spawn; drives the fade-in. */
  private age = 0;

  constructor(snap: AsteroidSnapshot, renderer: Renderer) {
    this.id = snap.id;
    this.radius = snap.radius;
    this.view = createAsteroidView(snap.radius, asteroidSeed(snap.id));
    this.view.container.x = snap.x;
    this.view.container.y = snap.y;
    // Start invisible and small; tick() ramps both up over FADE_IN.
    this.view.container.alpha = 0;
    this.view.container.scale.set(0.7);
    this.view.setHp(snap.maxHp > 0 ? snap.hp / snap.maxHp : 1);
    // Asteroids sit at the very back of the entity layer so ships and units
    // visibly read on top of them.
    renderer.entities.addChildAt(this.view.container, 0);

    this.hp = snap.hp;
    this.maxHp = snap.maxHp;
  }

  applyServerUpdate(snap: AsteroidSnapshot) {
    this.hp = snap.hp;
    this.maxHp = snap.maxHp;
    this.view.setHp(this.maxHp > 0 ? this.hp / this.maxHp : 0);
  }

  /** Per-frame: advance the spawn-in fade. No-op once at full opacity. */
  tick(dt: number) {
    if (this.age >= FADE_IN_SECONDS) return;
    this.age = Math.min(FADE_IN_SECONDS, this.age + dt);
    const t = this.age / FADE_IN_SECONDS;
    // Ease-out so the asteroid arrives gently rather than snapping in.
    const eased = 1 - Math.pow(1 - t, 2);
    this.view.container.alpha = eased;
    this.view.container.scale.set(0.7 + 0.3 * eased);
  }

  destroy(renderer: Renderer) {
    renderer.entities.removeChild(this.view.container);
    this.view.container.destroy({ children: true });
  }
}

const FADE_IN_SECONDS = 0.6;

export function tickAsteroids(asteroids: Map<string, Asteroid>, dt: number) {
  for (const a of asteroids.values()) a.tick(dt);
}
