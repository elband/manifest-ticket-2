import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { FULL, ScreenClip } from "../components/ScreenClip";
import { alignClip, mark } from "../clipTiming";
import { at } from "../timing";

const ID = "08-tips" as const;

/**
 * Tips shift — (A) panel "Flight aktif" dengan jumlah pax, (B) Riwayat Scan di akun
 * supervisor, (C) tombol Demo scan untuk latihan. Semua rekaman UI asli.
 */
export const S08Tips: React.FC = () => {
  const startB = at(ID, "Supervisor") - 8;
  const startC = at(ID, "tombol") - 8;
  const clickC = at(ID, "Demo");
  const fromC = alignClip(mark("demo", "click"), clickC - startC);
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={startB} layout="none">
        <ScreenClip
          clip="board"
          clipFrom={0.5}
          focus={[{ at: 0, ...FULL }, { at: at(ID, "penerbangan") + 14, x: 900, y: 440, w: 1020 }]}
          highlights={[{ from: at(ID, "penerbangan") + 10, to: startB, x: 936, y: 500, w: 474, h: 54, label: "Jumlah penumpang tervalidasi", color: "#67E8F9" }]}
        />
      </Sequence>
      <Sequence from={startB} durationInFrames={startC - startB} layout="none">
        <ScreenClip
          clip="supervisor"
          clipFrom={0.3}
          focus={[{ at: 0, ...FULL }, { at: 30, x: 290, y: 60, w: 1630 }]}
          highlights={[{ from: 18, to: startC - startB, x: 305, y: 285, w: 1595, h: 130, label: "Riwayat Scan — dipantau supervisor", color: "#34D399" }]}
        />
      </Sequence>
      <Sequence from={startC} layout="none">
        <ScreenClip
          clip="demo"
          clipFrom={fromC}
          focus={[{ at: 0, x: 900, y: 240, w: 1020 }, { at: clickC - startC + 30, x: 900, y: 240, w: 1020 }, { at: clickC - startC + 54, ...FULL }]}
          highlights={[{ from: 0, to: clickC - startC + 20, x: 936, y: 400, w: 862, h: 36, label: "Demo scan — latihan tanpa scanner", color: "#FCD34D" }]}
        />
      </Sequence>
      <Sequence from={clickC} durationInFrames={10} layout="none">
        <Audio src={staticFile("audio/sfx-tap.wav")} volume={0.6} />
      </Sequence>
    </AbsoluteFill>
  );
};
