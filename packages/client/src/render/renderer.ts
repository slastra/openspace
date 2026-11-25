import { Application, Container } from "pixi.js";
import { BACKGROUND_COLOR } from "@openspace/shared";
import { Camera, createCamera } from "./camera.js";
import { buildStarfield, buildVignette, type Vignette } from "./background.js";

export interface Renderer {
  app: Application;
  /** Container that holds everything rendered in world coordinates. */
  world: Container;
  /** Screen-space container behind the world for parallax backdrop layers. */
  background: Container;
  /** Container for player ships and other entities. */
  entities: Container;
  /** Screen-space damage flash above the world, below the minimap. */
  vignette: Vignette;
  /** Camera owns position + screen↔world transforms. */
  camera: Camera;
}

export async function createRenderer(host: HTMLElement): Promise<Renderer> {
  const app = new Application();
  await app.init({
    background: BACKGROUND_COLOR,
    resizeTo: window,
    antialias: true,
    autoDensity: true,
    // Phones report DPR 3; rendering at 2 is visually identical at arm's
    // length and saves over half the fill work.
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  host.appendChild(app.canvas);

  const background = new Container({ label: "background" });
  const world = new Container({ label: "world" });
  // Sorted by zIndex so ships draw over structures and units regardless of
  // spawn order, with engine trails underneath everything.
  const entities = new Container({ label: "entities", sortableChildren: true });
  world.addChild(entities);

  app.stage.addChild(background);
  app.stage.addChild(world);
  const starfield = buildStarfield(background);
  const vignette = buildVignette(app.stage);

  const camera = createCamera(app, world, (x, y, w, h) => {
    starfield.update(x, y, w, h);
    vignette.resize(w, h);
  });
  camera.apply();

  return { app, world, background, entities, vignette, camera };
}
