import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Stamp the service worker with a per-build version derived from the
  // hashed asset filenames so the browser sees a byte-different sw.js
  // after every deploy. That is what triggers the standard waiting-SW
  // update flow that surfaces our "new version available" toast.
  const swPath = path.join(distPath, "sw.js");
  let stampedSw: string | null = null;
  if (fs.existsSync(swPath)) {
    try {
      const assetsDir = path.join(distPath, "assets");
      const fingerprint = fs.existsSync(assetsDir)
        ? fs
            .readdirSync(assetsDir)
            .sort()
            .join(",")
        : String(Date.now());
      const hash = crypto
        .createHash("sha1")
        .update(fingerprint)
        .digest("hex")
        .slice(0, 12);
      const raw = fs.readFileSync(swPath, "utf8");
      stampedSw = `// build:${hash}\nself.__BUILD_VERSION__ = ${JSON.stringify(hash)};\n${raw}`;
    } catch {
      stampedSw = null;
    }
  }

  app.get("/sw.js", (_req, res) => {
    if (stampedSw) {
      res.setHeader("Content-Type", "application/javascript; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Service-Worker-Allowed", "/");
      res.send(stampedSw);
      return;
    }
    res.sendFile(swPath);
  });

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
