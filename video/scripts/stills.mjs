// Render satu still per scene (atau frame tertentu: node scripts/stills.mjs 120 900) ke out/stills/.
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const durations = JSON.parse(readFileSync("src/vo-durations.json", "utf8"));
const ids = Object.keys(durations);
const voDelay = (id) => (id === "01-intro" ? 36 : 8);
const tail = (id) => (id === "09-penutup" ? 45 : 6);
let at = 0;
const frames = [];
for (const id of ids) {
  const len = voDelay(id) + Math.ceil(durations[id] * 30) + tail(id);
  for (const p of [0.35, 0.8]) frames.push({ name: `${id}-${Math.round(p * 100)}`, frame: at + Math.round(len * p) });
  at += len - 15;
}
const custom = process.argv.slice(2).map(Number);
const targets = custom.length ? custom.map((f) => ({ name: `f${f}`, frame: f })) : frames;

const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
// Pakai Chrome terpasang bila headless-shell bawaan Remotion diblokir Windows (spawn UNKNOWN).
const browserExecutable = process.env.REMOTION_BROWSER ?? null;
const chromeMode = browserExecutable ? "chrome-for-testing" : "headless-shell";
const composition = await selectComposition({ serveUrl, id: "PanduanAvsec", browserExecutable, chromeMode });
mkdirSync("out/stills", { recursive: true });
for (const t of targets) {
  await renderStill({ serveUrl, composition, frame: t.frame, output: `out/stills/${t.name}.png`, scale: 0.5, browserExecutable, chromeMode });
  console.log(t.name, t.frame);
}
