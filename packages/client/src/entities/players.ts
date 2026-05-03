import { PlayerInput } from "@openspace/shared";
import { Renderer } from "../render/renderer.js";
import { ShipView, createShipView } from "../render/units.js";
import { LocalPrediction, ObstacleProvider } from "../prediction.js";
import { RemoteInterpolator } from "../interpolation.js";
import { PlayerSnapshot } from "../net/client.js";

/**
 * The local player. Drives prediction + reconciliation, owns the ship view,
 * and tracks current HP/shield for HUD readouts. The game loop calls `step`
 * each frame to integrate input, send messages, and update the rendered pose.
 */
export class LocalPlayer {
  readonly ship: ShipView;
  readonly prediction: LocalPrediction;
  color: string;
  name: string;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  deathCount: number;
  credits: number;
  supplyCap: number;
  supplyUsed: number;
  dashing: boolean;

  constructor(snap: PlayerSnapshot, renderer: Renderer, getObstacles?: ObstacleProvider) {
    this.ship = createShipView();
    this.ship.setColor(snap.color);
    this.ship.setLocal(true);
    this.ship.container.x = snap.x;
    this.ship.container.y = snap.y;
    this.ship.setRotation(snap.rotation);
    this.ship.setHp(snap.maxHp > 0 ? snap.hp / snap.maxHp : 1);
    this.ship.setShield(snap.maxShield > 0 ? snap.shield / snap.maxShield : 0);
    renderer.entities.addChild(this.ship.container);

    this.prediction = new LocalPrediction(snap.x, snap.y, getObstacles);
    this.color = snap.color;
    this.name = snap.name;
    this.hp = snap.hp;
    this.maxHp = snap.maxHp;
    this.shield = snap.shield;
    this.maxShield = snap.maxShield;
    this.deathCount = snap.deathCount;
    this.credits = snap.credits;
    this.supplyCap = snap.supplyCap;
    this.supplyUsed = snap.supplyUsed;
    this.dashing = snap.dashing;
  }

  applyServerUpdate(snap: PlayerSnapshot) {
    this.color = snap.color;
    this.name = snap.name;
    this.hp = snap.hp;
    this.maxHp = snap.maxHp;
    this.shield = snap.shield;
    this.maxShield = snap.maxShield;
    this.deathCount = snap.deathCount;
    this.credits = snap.credits;
    this.supplyCap = snap.supplyCap;
    this.supplyUsed = snap.supplyUsed;
    this.dashing = snap.dashing;
    this.prediction.onServerUpdate(
      snap.x,
      snap.y,
      snap.rotation,
      snap.lastProcessedInputSeq,
    );
  }

  /** Predict, write into ship view. Returns inputs to send + current pose.
   *  `speedMultiplier` is the dash boost (1 normally) — caller derives it
   *  from `dashUntil` so prediction matches server velocity. */
  step(
    dt: number,
    target: { x: number; y: number },
    speedMultiplier: number = 1,
  ): { inputs: PlayerInput[]; x: number; y: number; rotation: number } {
    const inputs = this.prediction.step(dt, target, speedMultiplier);
    this.prediction.advanceDisplay(dt);
    const pos = this.prediction.position;
    const rotation = this.prediction.rotation;
    this.ship.container.x = pos.x;
    this.ship.container.y = pos.y;
    this.ship.setRotation(rotation);
    this.ship.setHp(this.maxHp > 0 ? this.hp / this.maxHp : 0);
    this.ship.setShield(this.maxShield > 0 ? this.shield / this.maxShield : 0);
    return { inputs, x: pos.x, y: pos.y, rotation };
  }
}

/**
 * A remote player ship. State is server-authoritative; we render via
 * snapshot interpolation. `applyServerUpdate` pushes new samples; `render`
 * samples the interpolator at the current server-time.
 */
export class RemotePlayer {
  readonly id: string;
  readonly ship: ShipView;
  readonly interp: RemoteInterpolator;
  color: string;
  name: string;
  hp: number;
  maxHp: number;
  deathCount: number;
  /** Last position written to the view (used as the death-effect anchor). */
  renderedX: number;
  renderedY: number;
  private hpFraction = 1;
  private shieldFraction = 0;

  constructor(snap: PlayerSnapshot, renderer: Renderer) {
    this.id = snap.id;
    this.ship = createShipView();
    this.ship.setColor(snap.color);
    this.ship.setLocal(false);
    this.ship.container.x = snap.x;
    this.ship.container.y = snap.y;
    this.ship.setRotation(snap.rotation);
    renderer.entities.addChild(this.ship.container);

    this.interp = new RemoteInterpolator();
    this.interp.setColor(snap.color);
    this.interp.push({
      t: snap.serverTime,
      x: snap.x,
      y: snap.y,
      rotation: snap.rotation,
    });
    this.color = snap.color;
    this.name = snap.name;
    this.hp = snap.hp;
    this.maxHp = snap.maxHp;
    this.deathCount = snap.deathCount;
    this.renderedX = snap.x;
    this.renderedY = snap.y;
    this.hpFraction = snap.maxHp > 0 ? snap.hp / snap.maxHp : 1;
    this.shieldFraction = snap.maxShield > 0 ? snap.shield / snap.maxShield : 0;
    this.ship.setHp(this.hpFraction);
    this.ship.setShield(this.shieldFraction);
  }

  applyServerUpdate(snap: PlayerSnapshot) {
    this.interp.push({
      t: snap.serverTime,
      x: snap.x,
      y: snap.y,
      rotation: snap.rotation,
    });
    this.color = snap.color;
    this.name = snap.name;
    this.hp = snap.hp;
    this.maxHp = snap.maxHp;
    this.deathCount = snap.deathCount;
    this.hpFraction = snap.maxHp > 0 ? snap.hp / snap.maxHp : 1;
    this.shieldFraction = snap.maxShield > 0 ? snap.shield / snap.maxShield : 0;
  }

  render(serverNow: number) {
    const s = this.interp.sample(serverNow);
    if (!s) return;
    this.ship.container.x = s.x;
    this.ship.container.y = s.y;
    this.ship.setRotation(s.rotation);
    this.ship.setHp(this.hpFraction);
    this.ship.setShield(this.shieldFraction);
    this.renderedX = s.x;
    this.renderedY = s.y;
  }

  destroy(renderer: Renderer) {
    renderer.entities.removeChild(this.ship.container);
    this.ship.container.destroy({ children: true });
  }
}
