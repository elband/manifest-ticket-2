import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { FULL, ScreenClip, type Focus, type Highlight } from "../components/ScreenClip";
import { alignClip, mark, MODAL_DELAY } from "../clipTiming";
import { at, FPS, sceneFrames } from "../timing";

const ID = "04-ktp" as const;
const shift = (hs: Highlight[], d: number) => hs.map((h) => ({ ...h, from: h.from - d, to: h.to - d }));
const shiftF = (fs: Focus[], d: number) => fs.map((f) => ({ ...f, at: f.at - d }));

/**
 * KTP-first — (A) OCR membaca nama di KTP, (B) jalur "Tanpa KTP" untuk anak/bayi.
 * Keduanya rekaman asli kiosk dengan webcam berisi e-KTP contoh (fiktif).
 */
export const S04Ktp: React.FC = () => {
  const len = sceneFrames(ID);
  const read = at(ID, "terbaca");
  // A: momen "nama terbaca" di klip jatuh pas kata "terbaca" (diperlambat bila OCR
  // di rekaman lebih cepat dari narasi).
  const rateA = Math.min(1, Math.max(0.5, mark("ktp", "ktpRead") / (read / FPS)));
  const fromA = alignClip(mark("ktp", "ktpRead"), read, rateA);
  // B: mulai sedikit sebelum kata "Tekan" supaya ketukan tombol tepat di kata itu.
  const startB = at(ID, "Tekan") - 20;
  const fromB = alignClip(mark("exempt", "tap"), at(ID, "Tekan") - startB);
  const modalB = startB + Math.round((mark("exempt", "scan") + MODAL_DELAY - fromB) * FPS);

  // Tampil penuh: kamera (kiri) dan panel "Identitas KTP" (kanan) sama-sama terlihat.
  const focusA: Focus[] = [{ at: 0, ...FULL }];
  const hlA: Highlight[] = [
    { from: read - 4, to: startB, x: 290, y: 98, w: 350, h: 28, label: "Nama KTP terbaca", color: "#34D399", radius: 999 },
    { from: read + 8, to: startB, x: 940, y: 100, w: 940, h: 270, color: "#34D399" },
  ];
  const focusB: Focus[] = [
    { at: startB, x: 420, y: 60, w: 1500 },
    { at: modalB - 4, x: 420, y: 60, w: 1500 },
    { at: modalB + 18, x: 320, y: 150, w: 1280 },
  ];
  const hlB: Highlight[] = [
    { from: at(ID, "Tekan") - 6, to: modalB - 6, x: 924, y: 408, w: 970, h: 42, label: "Tanpa KTP (anak/bayi)" },
    { from: modalB + 16, to: len, x: 533, y: 266, w: 854, h: 38, label: "Dikonfirmasi petugas — cek KK/Akte", color: "#FCD34D" },
  ];
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={startB} layout="none">
        <ScreenClip clip="ktp" clipFrom={fromA} playbackRate={rateA} focus={focusA} highlights={hlA} />
      </Sequence>
      <Sequence from={startB} layout="none">
        <ScreenClip clip="exempt" clipFrom={fromB} focus={shiftF(focusB, startB)} highlights={shift(hlB, startB)} />
      </Sequence>
      <Sequence from={read} durationInFrames={10} layout="none">
        <Audio src={staticFile("audio/sfx-pop.wav")} volume={0.5} />
      </Sequence>
      <Sequence from={at(ID, "Tekan")} durationInFrames={10} layout="none">
        <Audio src={staticFile("audio/sfx-tap.wav")} volume={0.6} />
      </Sequence>
      <Sequence from={modalB} durationInFrames={40} layout="none">
        <Audio src={staticFile("audio/sfx-ding.wav")} volume={0.3} />
      </Sequence>
    </AbsoluteFill>
  );
};
