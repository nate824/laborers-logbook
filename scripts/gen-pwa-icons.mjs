import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "client/public/icon.svg");
const outDir = path.join(root, "client/public");
await mkdir(outDir, { recursive: true });
const svg = await readFile(src);

const targets = [
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  { name: "icon-512-maskable.png", size: 512, padding: 0.1 },
  { name: "apple-touch-icon.png", size: 180 },
];

for (const t of targets) {
  const buf = await sharp(svg, { density: 384 })
    .resize(t.size, t.size)
    .png()
    .toBuffer();
  await writeFile(path.join(outDir, t.name), buf);
  console.log("wrote", t.name);
}
