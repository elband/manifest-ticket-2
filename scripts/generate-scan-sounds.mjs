#!/usr/bin/env node
/**
 * Buat ulang rekaman suara hasil scan (public/sounds/scan-*.mp3) dengan suara
 * AI bahasa Indonesia — ElevenLabs atau Google Cloud Text-to-Speech.
 *
 * API key TIDAK disimpan di repo — hanya dibaca dari environment.
 *
 * ElevenLabs:
 *   ELEVENLABS_API_KEY=xxxx node scripts/generate-scan-sounds.mjs --list
 *   ELEVENLABS_API_KEY=xxxx node scripts/generate-scan-sounds.mjs --voice <voice_id>
 *
 * Google Cloud TTS:
 *   GOOGLE_TTS_API_KEY=xxxx node scripts/generate-scan-sounds.mjs --list
 *   GOOGLE_TTS_API_KEY=xxxx node scripts/generate-scan-sounds.mjs --voice id-ID-Wavenet-D
 *   (tanpa API key: GOOGLE_TTS_TOKEN=$(gcloud auth print-access-token))
 *
 * Opsi:
 *   --provider <elevenlabs|google>  default: yang key-nya diisi (ElevenLabs bila keduanya)
 *   --list            tampilkan pilihan suara, lalu keluar
 *   --voice <id>      ElevenLabs: voice_id (wajib, lihat --list)
 *                     Google: nama suara (default id-ID-Wavenet-A, perempuan)
 *   --model <id>      ElevenLabs saja (default eleven_multilingual_v2)
 *   --rate <angka>    kecepatan bicara (Google 0.25–4, ElevenLabs 0.7–1.2; default 1.0)
 *   --out <folder>    folder tujuan (default public/sounds)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Tampilkan pesan error saja, tanpa stack trace.
process.on("uncaughtException", (e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

const CLIPS = [
  { file: "scan-berhasil.mp3", text: "Berhasil." },
  { file: "scan-duplikat.mp3", text: "Tiket sudah dipakai." },
  { file: "scan-gagal.mp3", text: "Gagal." },
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const listOnly = process.argv.includes("--list");
const rate = Number(arg("rate", "1.0"));
const outDir = resolve(arg("out", "public/sounds"));

const env = {
  eleven: process.env.ELEVENLABS_API_KEY?.trim(),
  googleKey: process.env.GOOGLE_TTS_API_KEY?.trim(),
  googleToken: process.env.GOOGLE_TTS_TOKEN?.trim(),
};
const provider =
  arg("provider", null) ?? (env.eleven ? "elevenlabs" : env.googleKey || env.googleToken ? "google" : null);

if (!provider) {
  console.error(
    "Isi salah satu, lalu jalankan ulang:\n" +
      "  ELEVENLABS_API_KEY  (ElevenLabs → Profile → API keys)\n" +
      "  GOOGLE_TTS_API_KEY  (Google Cloud, Text-to-Speech API aktif)",
  );
  process.exit(1);
}

async function readError(res) {
  const json = await res.json().catch(() => ({}));
  const d = json?.detail;
  return (
    json?.error?.message ??
    (typeof d === "string" ? d : d?.message) ??
    `HTTP ${res.status}`
  );
}

// ───────────────────────────── ElevenLabs ─────────────────────────────

const ELEVEN_API = "https://api.elevenlabs.io/v1";

async function elevenLabs() {
  if (!env.eleven) throw new Error("ELEVENLABS_API_KEY belum diisi.");
  const headers = { "xi-api-key": env.eleven };

  if (listOnly) {
    const res = await fetch(`${ELEVEN_API}/voices`, { headers });
    if (!res.ok) throw new Error(`ElevenLabs menolak permintaan: ${await readError(res)}`);
    const { voices = [] } = await res.json();
    console.log("voice_id                  nama");
    for (const v of voices) {
      const l = v.labels ?? {};
      const info = [l.gender, l.accent, l.language, l.age].filter(Boolean).join(", ");
      console.log(`${v.voice_id.padEnd(26)}${v.name}${info ? `  (${info})` : ""}`);
    }
    console.log(
      "\nSuara berlogat Indonesia dari Voice Library harus ditambahkan dulu ke\n" +
        '"My Voices" di situs ElevenLabs agar muncul di daftar ini.',
    );
    return;
  }

  const voice = arg("voice", null);
  if (!voice) throw new Error("Pilih suara: --voice <voice_id> (lihat daftar dengan --list).");
  const model = arg("model", "eleven_multilingual_v2");
  await mkdir(outDir, { recursive: true });

  for (const c of CLIPS) {
    const res = await fetch(
      `${ELEVEN_API}/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({
          text: c.text,
          model_id: model,
          voice_settings: {
            stability: 0.6, // stabil: tiga klip terdengar seperti satu orang
            similarity_boost: 0.8,
            style: 0,
            use_speaker_boost: true,
            speed: rate,
          },
        }),
      },
    );
    if (!res.ok) throw new Error(`ElevenLabs menolak permintaan: ${await readError(res)}`);
    await writeFile(join(outDir, c.file), Buffer.from(await res.arrayBuffer()));
    console.log(`✓ ${c.file}  ← "${c.text}" (ElevenLabs ${voice}, ${model})`);
  }
}

// ───────────────────────────── Google Cloud TTS ─────────────────────────────

const GOOGLE_API = "https://texttospeech.googleapis.com/v1";

async function google() {
  const { googleKey: key, googleToken: token } = env;
  if (!key && !token) throw new Error("GOOGLE_TTS_API_KEY / GOOGLE_TTS_TOKEN belum diisi.");
  const url = (path) =>
    key ? `${GOOGLE_API}${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}` : `${GOOGLE_API}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...(token && !key ? { Authorization: `Bearer ${token}` } : {}),
  };
  const call = async (path, body) => {
    const res = await fetch(url(path), {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Google TTS menolak permintaan: ${await readError(res)}`);
    return res.json();
  };

  if (listOnly) {
    const { voices = [] } = await call("/voices?languageCode=id-ID");
    for (const v of voices.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`${v.name.padEnd(32)} ${v.ssmlGender}`);
    }
    return;
  }

  const voice = arg("voice", "id-ID-Wavenet-A");
  await mkdir(outDir, { recursive: true });
  for (const c of CLIPS) {
    const { audioContent } = await call("/text:synthesize", {
      input: { text: c.text },
      voice: { languageCode: "id-ID", name: voice },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: rate,
        sampleRateHertz: 24000,
        effectsProfileId: ["small-bluetooth-speaker-class-device"],
      },
    });
    await writeFile(join(outDir, c.file), Buffer.from(audioContent, "base64"));
    console.log(`✓ ${c.file}  ← "${c.text}" (Google ${voice})`);
  }
}

if (provider === "elevenlabs") await elevenLabs();
else if (provider === "google") await google();
else throw new Error(`--provider tidak dikenal: ${provider} (pakai elevenlabs atau google).`);

if (!listOnly) console.log("\nSelesai. Uji di Pengaturan → Suara dan getar → Uji suara.");
