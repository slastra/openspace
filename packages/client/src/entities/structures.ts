import { Renderer } from "../render/renderer.js";
import { StructureView, createStructureView } from "../render/structures.js";
import { StructureSnapshot } from "../net/client.js";

/**
 * Client-side mirror of a server Structure. Static, no interpolation —
 * structures don't move once placed. Slotted into the entity layer beneath
 * units so ships/drones draw on top.
 */
export class Structure {
  readonly id: string;
  readonly ownerId: string;
  readonly view: StructureView;
  readonly kind: string;
  readonly color: string;
  hp: number;
  maxHp: number;
  targetId: string;
  /** Last cooldown value seen from server. A jump upward is a fire event. */
  lastCooldown: number;

  constructor(snap: StructureSnapshot, renderer: Renderer) {
    this.id = snap.id;
    this.ownerId = snap.ownerId;
    this.kind = snap.kind;
    this.color = snap.color;
    this.hp = snap.hp;
    this.maxHp = snap.maxHp;
    this.targetId = snap.targetId;
    this.lastCooldown = snap.cooldown;
    this.view = createStructureView(snap.kind, snap.color);
    this.view.container.x = snap.x;
    this.view.container.y = snap.y;
    this.view.setHp(snap.maxHp > 0 ? snap.hp / snap.maxHp : 1);
    this.view.setRotation(snap.rotation);
    // addChildAt 0 puts structures at the back of the entities layer so
    // units and ships render on top.
    renderer.entities.addChildAt(this.view.container, 0);
  }

  applyServerUpdate(snap: StructureSnapshot) {
    this.hp = snap.hp;
    this.maxHp = snap.maxHp;
    this.targetId = snap.targetId;
    this.view.setHp(snap.maxHp > 0 ? snap.hp / snap.maxHp : 0);
    this.view.setRotation(snap.rotation);
  }

  destroy(renderer: Renderer) {
    renderer.entities.removeChild(this.view.container);
    this.view.container.destroy({ children: true });
  }
}
