// Sintesis musik latar + SFX (bebas royalti, dibuat dari nol) ke public/audio/*.wav.
// Musik: 112 BPM, progresi C – G – Am – F, pad + arpeggio pluck + kick/hat ringan.
import { mkdirSync, writeFileSync } from "node:fs";

const SR = 44100;
const OUT = "public/audio";
mkdirSync(OUT, { recursive: true });

const writeWav = (file, left, right = left) => {
  const n = left.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    buf.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
  }
  writeFileSync(`${OUT}/${file}`, buf);
  console.log(file, (n / SR).toFixed(2) + "s");
};

const midi = (m) => 440 * 2 ** ((m - 69) / 12);
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

// ---------- Musik ----------
const BPM = 112;
const beat = 60 / BPM;
const DURATION = 100; // detik; dipotong & di-fade di Remotion sesuai panjang video
const N = Math.floor(DURATION * SR);
const L = new Float32Array(N);
const R = new Float32Array(N);
const add = (i, v, pan = 0) => {
  if (i < 0 || i >= N) return;
  L[i] += v * (1 - pan) * 0.5 * 2 ** 0.5;
  R[i] += v * (1 + pan) * 0.5 * 2 ** 0.5;
};

// Akord per bar (4 ketuk): C, G/B, Am, F  (MIDI)
const chords = [
  [48, 60, 64, 67, 72],
  [47, 59, 62, 67, 71],
  [45, 57, 60, 64, 69],
  [41, 57, 60, 65, 69],
];
const bar = beat * 4;
const bars = Math.ceil(DURATION / bar);
// Intensitas: intro tipis (bar 0-3), penuh setelahnya, outro mengecil.
const energy = (b) => (b < 2 ? 0.35 : b < 4 ? 0.7 : b > bars - 4 ? 0.6 : 1);

for (let b = 0; b < bars; b++) {
  const ch = chords[b % 4];
  const t0 = b * bar;
  const e = energy(b);

  // Pad: beberapa sinus sedikit detune dengan attack/release lembut.
  const padLen = bar;
  for (let k = 1; k < ch.length; k++) {
    const f = midi(ch[k]);
    for (let s = 0; s < padLen * SR; s++) {
      const t = s / SR;
      const env = Math.min(1, t / 0.6) * Math.min(1, (padLen - t) / 0.5 + 0.2);
      const v =
        (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 1.004 * t) + 0.18 * Math.sin(2 * Math.PI * f * 2 * t)) *
        0.022 * env;
      add(Math.floor((t0 + t) * SR), v, k % 2 ? -0.35 : 0.35);
    }
  }
  // Bass: root, ketukan 1 & 3 (+ sinkop "and" ketuk 2).
  for (const [off, len] of [[0, 1.4], [1.5, 0.45], [2, 1.4], [3.5, 0.45]]) {
    const f = midi(ch[0] - 12 + 12);
    for (let s = 0; s < len * beat * SR; s++) {
      const t = s / SR;
      const env = Math.exp(-t * 3.2) * Math.min(1, t / 0.01);
      const v = (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t)) * 0.16 * env * Math.max(e, 0.5);
      add(Math.floor((t0 + off * beat + t) * SR), v);
    }
  }
  if (b < 1) continue;
  // Arpeggio pluck (1/8) — pola naik turun.
  const pattern = [1, 2, 3, 4, 3, 2, 3, 4];
  for (let i = 0; i < 8; i++) {
    const note = ch[pattern[i]] + 12;
    const f = midi(note);
    const st = t0 + i * (beat / 2);
    for (let s = 0; s < 0.45 * SR; s++) {
      const t = s / SR;
      const env = Math.exp(-t * 9) * Math.min(1, t / 0.004);
      const v = (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * 2 * f * t) * Math.exp(-t * 20)) * 0.05 * env * e;
      add(Math.floor((st + t) * SR), v, i % 2 ? 0.45 : -0.45);
      // echo 3/8
      add(Math.floor((st + beat * 0.75 + t) * SR), v * 0.35, i % 2 ? -0.5 : 0.5);
    }
  }
  if (b < 2) continue;
  // Drum: kick tiap ketuk, hat off-beat, clap ketuk 2 & 4.
  for (let k = 0; k < 4; k++) {
    const st = t0 + k * beat;
    for (let s = 0; s < 0.3 * SR; s++) {
      const t = s / SR;
      const f = 50 + 90 * Math.exp(-t * 30);
      add(Math.floor((st + t) * SR), Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 11) * 0.3 * e);
    }
    for (let s = 0; s < 0.05 * SR; s++) {
      const t = s / SR;
      add(Math.floor((st + beat / 2 + t) * SR), rnd() * Math.exp(-t * 90) * 0.045 * e, 0.3);
    }
    if (k % 2 === 1 && e === 1) {
      for (let s = 0; s < 0.18 * SR; s++) {
        const t = s / SR;
        add(Math.floor((st + t) * SR), rnd() * Math.exp(-t * 28) * 0.06, -0.15);
      }
    }
  }
}
// Normalisasi lembut
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh((L[i] / peak) * 1.1) * 0.8;
  R[i] = Math.tanh((R[i] / peak) * 1.1) * 0.8;
}
writeWav("music.wav", L, R);

// ---------- SFX ----------
const sfx = (len, fn) => {
  const a = new Float32Array(Math.floor(len * SR));
  for (let i = 0; i < a.length; i++) a[i] = fn(i / SR);
  return a;
};
// Beep scanner: dua nada pendek.
writeWav(
  "sfx-beep.wav",
  sfx(0.22, (t) => (t < 0.09 ? Math.sin(2 * Math.PI * 2200 * t) : t > 0.12 ? Math.sin(2 * Math.PI * 2900 * t) : 0) * 0.35 * Math.min(1, (0.22 - t) / 0.02)),
);
// Ding valid: dua nada bel (E6 → A6).
writeWav(
  "sfx-ding.wav",
  sfx(1.2, (t) => {
    const n1 = Math.sin(2 * Math.PI * midi(88) * t) * Math.exp(-t * 4);
    const t2 = t - 0.13;
    const n2 = t2 > 0 ? (Math.sin(2 * Math.PI * midi(93) * t2) + 0.3 * Math.sin(2 * Math.PI * midi(105) * t2)) * Math.exp(-t2 * 3.5) : 0;
    return (n1 * 0.3 + n2 * 0.35) * Math.min(1, t / 0.003);
  }),
);
// Buzz ditolak: square rendah, dua kali.
writeWav(
  "sfx-buzz.wav",
  sfx(0.5, (t) => {
    const on = t < 0.18 || (t > 0.25 && t < 0.45);
    return on ? Math.sign(Math.sin(2 * Math.PI * 160 * t)) * 0.12 * (1 - 0.3 * Math.sin(2 * Math.PI * 30 * t)) : 0;
  }),
);
// Whoosh transisi: noise dengan sapuan "filter" sederhana.
{
  let lp = 0;
  writeWav(
    "sfx-whoosh.wav",
    sfx(0.9, (t) => {
      const cutoff = 0.02 + 0.25 * Math.sin((Math.PI * t) / 0.9);
      lp += cutoff * (rnd() - lp);
      return lp * 0.9 * Math.sin((Math.PI * t) / 0.9);
    }),
  );
}
// Klik keypad.
writeWav("sfx-tap.wav", sfx(0.06, (t) => (Math.sin(2 * Math.PI * 1500 * t) * 0.25 + rnd() * 0.1) * Math.exp(-t * 80)));
// Shutter kamera.
writeWav("sfx-shutter.wav", sfx(0.25, (t) => rnd() * (Math.exp(-t * 60) + (t > 0.08 ? Math.exp(-(t - 0.08) * 70) : 0)) * 0.35));
// Pop (kartu muncul).
writeWav("sfx-pop.wav", sfx(0.15, (t) => Math.sin(2 * Math.PI * (500 + 900 * t * 6) * t) * Math.exp(-t * 30) * 0.25));
