// Local dev only: point the Neon driver at scripts/local/wsproxy.mjs (plain
// ws://, no TLS) before the server creates its pool, then boot as usual.
import { neonConfig } from "@neondatabase/serverless";

neonConfig.wsProxy = () => `127.0.0.1:${process.env.WS_PROXY_PORT ?? 5488}/`;
neonConfig.useSecureWebSocket = false;
neonConfig.pipelineTLS = false;
neonConfig.pipelineConnect = false;

await import("../../server/index.ts");
