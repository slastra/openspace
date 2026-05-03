import { Application, Container } from "pixi.js";
import { BACKGROUND_COLOR } from "@openspace/shared";
import { Camera, createCamera } from "./camera.js";

export interface Renderer {
  app: Application;
  /** Container that holds everything rendered in world coordinates. */
  world: Container;
  /** Container behind the world for parallax background layers. */
  background: Container;
  /** Container for player ships and other entities. */
  entities: Container;
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
    resolution: window.devicePixelRatio || 1,
  });
  host.appendChild(app.canvas);

  const background = new Container({ label: "background" });
  const world = new Container({ label: "world" });
  const entities = new Container({ label: "entities" });
  world.addChild(entities);

  app.stage.addChild(background);
  app.stage.addChild(world);

  const camera = createCamera(app, world, background);
  camera.apply();

  return { app, world, background, entities, camera };
}
