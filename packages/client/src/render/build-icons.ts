import { Application, Container, Rectangle } from "pixi.js";
import { STRUCTURE_KIND_META, UNIT_KIND_META } from "@openspace/shared";
import { createStructureView } from "./structures.js";
import { createUnitView } from "./units.js";

const ICON_PX = 48;
const ICON_PADDING = 0.85;
const ICON_TINT = "#cbd5e1";

/**
 * Snapshot every buildable kind into a static HTML canvas using the same
 * Pixi view builders as the in-game render — so the HUD icons match the
 * actual unit/structure art exactly. Generated once at startup; the cards
 * just replace their placeholder SVG with the returned canvas.
 *
 * Each view is created with `bars: false` so empty HP/shield bars don't
 * bleed into the icon, scaled to fit `ICON_PX * ICON_PADDING`, then
 * extracted via `app.renderer.extract.canvas` (resolution 2 for crisp
 * rendering on high-DPR displays). Color is a neutral light-slate so
 * cards read as kind-identifiers, not team-specific.
 */
export function generateBuildIcons(app: Application): Map<string, HTMLCanvasElement> {
  const icons = new Map<string, HTMLCanvasElement>();
  for (const kind of Object.keys(UNIT_KIND_META)) {
    const view = createUnitView(kind, ICON_TINT, { bars: false });
    icons.set(kind, snapshot(app, view.container));
  }
  for (const kind of Object.keys(STRUCTURE_KIND_META)) {
    const view = createStructureView(kind, ICON_TINT, { bars: false });
    icons.set(kind, snapshot(app, view.container));
  }
  return icons;
}

function snapshot(app: Application, body: Container): HTMLCanvasElement {
  // Auto-fit: scale so the larger bound dimension sits within the padded
  // icon area. Big shapes (structures ~70px) and small shapes (units ~18px)
  // both end up filling the icon nicely.
  const bounds = body.getLocalBounds();
  const max = Math.max(bounds.width, bounds.height);
  if (max > 0) body.scale.set((ICON_PX * ICON_PADDING) / max);

  const wrap = new Container();
  body.x = ICON_PX / 2;
  body.y = ICON_PX / 2;
  wrap.addChild(body);

  const canvas = app.renderer.extract.canvas({
    target: wrap,
    frame: new Rectangle(0, 0, ICON_PX, ICON_PX),
    resolution: 2,
    clearColor: "rgba(0,0,0,0)",
  });

  wrap.destroy({ children: true });
  return canvas as HTMLCanvasElement;
}
