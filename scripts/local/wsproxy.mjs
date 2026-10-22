// Local dev only: the app talks to Postgres through Neon's serverless driver,
// which speaks the Postgres wire protocol over a WebSocket. This relays those
// WebSocket frames to the plain TCP Postgres started by start.sh.
import net from "node:net";
import { WebSocketServer } from "ws";

const WS_PORT = Number(process.env.WS_PROXY_PORT ?? 5488);
const PG_PORT = Number(process.env.PG_PORT ?? 5433);

const wss = new WebSocketServer({ host: "127.0.0.1", port: WS_PORT });
wss.on("connection", (ws) => {
  const sock = net.connect(PG_PORT, "127.0.0.1");
  ws.on("message", (data) => sock.write(data));
  sock.on("data", (data) => ws.readyState === ws.OPEN && ws.send(data));
  ws.on("close", () => sock.end());
  sock.on("close", () => ws.close());
  sock.on("error", () => ws.close());
});
console.log(`wsproxy: ws://127.0.0.1:${WS_PORT} -> postgres 127.0.0.1:${PG_PORT}`);
