import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME, SERVER_PORT } from "@openspace/shared";
import { ArenaRoom } from "./rooms/ArenaRoom.js";

const gameServer = new Server({
  transport: new WebSocketTransport(),
});

gameServer.define(ROOM_NAME, ArenaRoom);

gameServer
  .listen(SERVER_PORT)
  .then(() => {
    console.log(`[server] listening on ws://localhost:${SERVER_PORT}`);
  })
  .catch((err) => {
    console.error("[server] failed to start", err);
    process.exit(1);
  });
