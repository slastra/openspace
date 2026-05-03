import { Renderer } from "../render/renderer.js";
import { WreckageView, createWreckageView } from "../render/wreckages.js";
import { WreckageSnapshot } from "../net/client.js";

/**
 * Client-side mirror of a server Wreckage. Static (server doesn't move
 * them); just position once on add and update credits / pulse on tick.
 */
export class Wreckage {
  readonly id: string;
  readonly view: WreckageView;
  credits: number;

  constructor(snap: WreckageSnapshot, renderer: Renderer) {
    this.id = snap.id;
    this.credits = snap.credits;
    this.view = createWreckageView(snap.color, snap.ownerName, snap.halfSize);
    this.view.container.x = snap.x;
    this.view.container.y = snap.y;
    this.view.setCredits(snap.credits);
    renderer.entities.addChildAt(this.view.container, 0);
  }

  applyServerUpdate(snap: WreckageSnapshot) {
    if (this.credits !== snap.credits) {
      this.credits = snap.credits;
      this.view.setCredits(snap.credits);
    }
  }

  tick(dt: number) {
    this.view.tick(dt);
  }

  destroy(renderer: Renderer) {
    renderer.entities.removeChild(this.view.container);
    this.view.container.destroy({ children: true });
  }
}

export function tickWreckages(wreckages: Map<string, Wreckage>, dt: number) {
  for (const w of wreckages.values()) w.tick(dt);
}
