// Generate voice-over per scene (Bahasa Indonesia) via Microsoft Edge TTS.
// Output:
//   public/audio/vo-<id>.mp3      — klip narasi per scene
//   src/vo-durations.json         — durasi (detik) per klip, dipakai Root.tsx
//   src/vo-words.json             — timing per kata, untuk caption & sinkron animasi
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VOICE = process.env.VOICE ?? "id-ID-GadisNeural";
const RATE = process.env.RATE ?? "+20%";
const narration = JSON.parse(readFileSync("src/narration.json", "utf8"));
const outDir = "public/audio";
mkdirSync(outDir, { recursive: true });

const probeSeconds = (file) => {
  const probe = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["remotion", "ffprobe", file], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(`${probe.stdout}${probe.stderr}`);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
};

// Metadata Edge TTS: satu atau lebih objek JSON { Metadata: [{ Type, Data: { Offset, Duration, text: { Text } } }] }.
// Offset/Duration dalam satuan 100 ns.
const parseWords = (raw) => {
  const words = [];
  for (const chunk of raw.split(/\n(?=\{)/)) {
    if (!chunk.trim()) continue;
    for (const md of JSON.parse(chunk).Metadata ?? []) {
      if (md.Type !== "WordBoundary") continue;
      words.push({
        text: md.Data.text.Text,
        start: +(md.Data.Offset / 1e7).toFixed(3),
        end: +((md.Data.Offset + md.Data.Duration) / 1e7).toFixed(3),
      });
    }
  }
  return words;
};

const durations = {};
const words = {};
for (const item of narration) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, { wordBoundaryEnabled: true });
  const tmp = join(outDir, `tmp-${item.id}`);
  mkdirSync(tmp, { recursive: true });
  const { audioFilePath, metadataFilePath } = await tts.toFile(tmp, item.text, { rate: RATE });
  const target = join(outDir, `vo-${item.id}.mp3`);
  renameSync(audioFilePath, target);
  words[item.id] = metadataFilePath ? parseWords(readFileSync(metadataFilePath, "utf8")) : [];
  rmSync(tmp, { recursive: true, force: true });
  tts.close();

  durations[item.id] = probeSeconds(target);
  console.log(item.id, durations[item.id], `${words[item.id].length} kata`);
}
writeFileSync("src/vo-durations.json", JSON.stringify(durations, null, 2) + "\n");
writeFileSync("src/vo-words.json", JSON.stringify(words, null, 1) + "\n");
