import { Renderer } from "../render/renderer.js";
import { UnitView, createUnitView } from "../render/units.js";
import { RemoteInterpolator } from "../interpolation.js";
import { UnitSnapshot } from "../net/client.js";

/**
 * Client-side mirror of a server Unit. Server-authoritative position lives
 * on the schema and is rendered via snapshot interpolation. No client-side
 * prediction or compensation — units behave purely as physics-driven entities
 * owned by the server, with the standard ~150ms interpolation delay applied
 * uniformly to local-owned and remote-owned units alike.
 */
export class Unit {
  readonly id: string;
  readonly ownerId: string;
  readonly view: UnitView;
  readonly interp: RemoteInterpolator;
  kind: string;
  color: string;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  targetId: string;
  deactivated: boolean;
  /** Last cooldown value seen from server. A jump upward is a fire event. */
  lastCooldown: number;

  constructor(snap: UnitSnapshot, renderer: Renderer) {
    this.id = snap.id;
    this.ownerId = snap.ownerId;
    this.kind = snap.kind;
    this.color = snap.color;
    this.view = createUnitView(snap.kind, snap.color);
    this.view.container.x = snap.x;
    this.view.container.y = snap.y;
    this.view.setHp(snap.maxHp > 0 ? snap.hp / snap.maxHp : 1);
    this.view.setShield(snap.maxShield > 0 ? snap.shield / snap.maxShield : 0);
    // Units sit behind ships in draw order so the friendly ship reads on top.
    renderer.entities.addChildAt(this.view.container, 0);

    this.interp = new RemoteInterpolator();
    this.interp.push({
      t: snap.serverTime,
      x: snap.x,
      y: snap.y,
      vx: snap.vx,
      vy: snap.vy,
      rotation: snap.rotation,
    });

    this.hp = snap.hp;
    this.maxHp = snap.maxHp;
    this.shield = snap.shield;
    this.maxShield = snap.maxShield;
    this.targetId = snap.targetId;
    this.deactivated = snap.deactivated;
    this.lastCooldown = snap.cooldown;
    this.view.container.alpha = snap.deactivated ? 0.45 : 1;
  }

  applyServerUpdate(snap: UnitSnapshot) {
    this.interp.push({
      t: snap.serverTime,
      x: snap.x,
      y: snap.y,
      vx: snap.vx,
      vy: snap.vy,
      rotation: snap.rotation,
    });
    this.kind = snap.kind;
    this.color = snap.color;
    this.hp = snap.hp;
    this.maxHp = snap.maxHp;
    this.shield = snap.shield;
    this.maxShield = snap.maxShield;
    this.targetId = snap.targetId;
    if (this.deactivated !== snap.deactivated) {
      this.deactivated = snap.deactivated;
      this.view.container.alpha = snap.deactivated ? 0.45 : 1;
    }
  }

  destroy(renderer: Renderer) {
    renderer.entities.removeChild(this.view.container);
    this.view.container.destroy({ children: true });
  }
}

export function renderUnits(units: Map<string, Unit>, serverNow: number) {
  for (const unit of units.values()) {
    const sample = unit.interp.sample(serverNow);
    if (!sample) continue;
    unit.view.container.x = sample.x;
    unit.view.container.y = sample.y;
    unit.view.setRotation(sample.rotation);
    unit.view.setHp(unit.maxHp > 0 ? unit.hp / unit.maxHp : 0);
    unit.view.setShield(unit.maxShield > 0 ? unit.shield / unit.maxShield : 0);
  }
}
