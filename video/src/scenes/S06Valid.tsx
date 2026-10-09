import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { FULL, ScreenClip } from "../components/ScreenClip";
import { alignClip, mark, MODAL_DELAY } from "../clipTiming";
import { at, FPS } from "../timing";

const ID = "06-valid" as const;
const MODAL_FOCUS = { x: 310, y: 160, w: 1300 };

/** Hasil VALID — modal boarding pass asli (warna maskapai, foto wajah, tutup otomatis 6 dtk). */
export const S06Valid: React.FC = () => {
  const open = at(ID, "VALID") - 4;
  const clipFrom = alignClip(mark("valid", "scan") + MODAL_DELAY, open);
  const close = open + 6 * FPS;
  return (
    <AbsoluteFill>
      <ScreenClip
        clip="valid"
        clipFrom={clipFrom}
        focus={[
          { at: 0, ...MODAL_FOCUS },
          { at: close, ...MODAL_FOCUS },
          { at: close + 22, ...FULL },
        ]}
        highlights={[
          { from: open + 2, to: at(ID, "Persilakan") - 4, x: 528, y: 180, w: 330, h: 60, label: "VALID", color: "#34D399" },
          { from: at(ID, "Persilakan") - 2, to: at(ID, "Layar") - 4, x: 1212, y: 394, w: 130, h: 160, label: "Foto penumpang", color: "#67E8F9" },
          { from: at(ID, "Layar") - 2, to: close - 2, x: 530, y: 850, w: 770, h: 48, label: "Tutup otomatis 6 detik", color: "#FCD34D" },
        ]}
      />
      <Sequence from={open} durationInFrames={40} layout="none">
        <Audio src={staticFile("audio/sfx-ding.wav")} volume={0.5} />
      </Sequence>
    </AbsoluteFill>
  );
};
