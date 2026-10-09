// Buat file webcam palsu (Y4M) untuk Chrome dari komposisi CamFace & CamKtp.
// Output: out/cams/face.y4m, out/cams/ktp.y4m  (dipakai scripts/capture.mjs)
import { bundle } from "@remotion/bundler";
import { renderFrames, selectComposition } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const ffmpeg = path.resolve("node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe");
const W = 1280;
const H = 960;
const browserExecutable = process.env.REMOTION_BROWSER ?? null;
const chromeMode = browserExecutable ? "chrome-for-testing" : "headless-shell";
mkdirSync("out/cams", { recursive: true });
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });

for (const [id, name] of [
  ["CamFace", "face"],
  ["CamKtp", "ktp"],
]) {
  const composition = await selectComposition({ serveUrl, id, browserExecutable, chromeMode });
  const dir = `out/cams/${name}-frames`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await renderFrames({
    serveUrl,
    composition,
    outputDir: dir,
    imageFormat: "jpeg",
    jpegQuality: 95,
    inputProps: {},
    onStart: () => {},
    onFrameUpdate: () => {},
    browserExecutable,
    chromeMode,
  });
  // JPEG → YUV420 mentah (image2pipe + rawvideo), lalu bungkus jadi Y4M.
  const raw = execFileSync(
    ffmpeg,
    ["-v", "error", "-i", `${dir}/element-%02d.jpeg`, "-pix_fmt", "yuv420p", "-c:v", "rawvideo", "-f", "image2pipe", "-"],
    { maxBuffer: 1 << 30 },
  );
  const frameSize = (W * H * 3) / 2;
  const n = raw.length / frameSize;
  const parts = [Buffer.from(`YUV4MPEG2 W${W} H${H} F15:1 Ip A1:1 C420jpeg\n`)];
  for (let i = 0; i < n; i++) parts.push(Buffer.from("FRAME\n"), raw.subarray(i * frameSize, (i + 1) * frameSize));
  writeFileSync(`out/cams/${name}.y4m`, Buffer.concat(parts));
  rmSync(dir, { recursive: true, force: true });
  console.log(name, n, "frame");
}
