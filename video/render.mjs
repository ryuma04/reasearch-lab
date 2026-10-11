#!/usr/bin/env node
/**
 * Renders one explainer video. Called by the agent worker (agents/lab/explainer/render.py):
 *
 *   node render.mjs --job <dir>
 *
 * <dir>/props.json   the composition props (see src/types.ts)
 * <dir>/public/      audio clips, figure and equation images (served through staticFile())
 * <dir>/video.mp4    output (H.264 + AAC)
 *
 * Progress is printed as one JSON object per line ({"event":"progress","progress":0.42}) so the worker can report it.
 */
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const say = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

const jobDir = arg("job");
if (!jobDir) {
  console.error("usage: node render.mjs --job <dir>");
  process.exit(2);
}
const props = JSON.parse(fs.readFileSync(path.join(jobDir, "props.json"), "utf-8"));
const out = path.join(jobDir, "video.mp4");
const tmp = path.join(jobDir, "video.partial.mp4");

try {
  say({ event: "stage", stage: "browser" });
  await ensureBrowser();
  say({ event: "stage", stage: "bundle" });
  const serveUrl = await bundle({
    entryPoint: path.join(here, "src", "index.ts"),
    publicDir: path.join(jobDir, "public"),
    outDir: path.join(jobDir, ".bundle"),
  });
  const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps: props });
  say({ event: "stage", stage: "render", frames: composition.durationInFrames });
  let last = -1;
  await renderMedia({
    serveUrl,
    composition,
    inputProps: props,
    codec: "h264",
    audioCodec: "aac",
    crf: 20,
    outputLocation: tmp,
    concurrency: Math.max(1, Math.min(6, Math.floor(os.cpus().length / 2))),
    chromiumOptions: { gl: "angle" },
    onProgress: ({ progress }) => {
      const p = Math.round(progress * 100);
      if (p !== last) {
        last = p;
        say({ event: "progress", progress });
      }
    },
  });
  fs.renameSync(tmp, out);
  fs.rmSync(path.join(jobDir, ".bundle"), { recursive: true, force: true });
  say({ event: "done", output: out, frames: composition.durationInFrames, fps: composition.fps });
} catch (e) {
  say({ event: "error", message: String(e?.stack || e).slice(0, 4000) });
  process.exit(1);
}
