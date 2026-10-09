import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { ScreenClip } from "../components/ScreenClip";
import { clipDuration, mark } from "../clipTiming";
import { at, FPS, sceneFrames } from "../timing";

const ID = "03-wajah" as const;
const CAM_FOCUS = { x: 0, y: 70, w: 1320 };

/**
 * Kiosk & wajah — bagian akhir klip login (kamera menyala, deteksi wajah)
 * disambung klip "face" (status "Siap scan" stabil).
 */
export const S03Wajah: React.FC = () => {
  const len = sceneFrames(ID);
  const loginFrom = mark("login", "kiosk");
  const partA = Math.round((clipDuration("login") - loginFrom) * FPS) - 2;
  const siap = at(ID, "Siap");
  const foto = at(ID, "fotonya");
  const highlights = [
    { from: siap - 4, to: foto - 6, x: 405, y: 96, w: 122, h: 32, label: "Siap scan", color: "#34D399", radius: 999 },
    { from: foto - 4, to: len, x: 24, y: 762, w: 884, h: 60, label: "Foto wajah tersimpan otomatis", color: "#67E8F9" },
  ];
  const focus = [
    { at: 0, ...CAM_FOCUS },
    { at: len, ...CAM_FOCUS },
  ];
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={partA} layout="none">
        <ScreenClip clip="login" clipFrom={loginFrom} focus={focus} highlights={highlights} />
      </Sequence>
      <Sequence from={partA} layout="none">
        <ScreenClip
          clip="face"
          clipFrom={0}
          focus={focus.map((f) => ({ ...f, at: f.at - partA }))}
          highlights={highlights.map((h) => ({ ...h, from: h.from - partA, to: h.to - partA }))}
        />
      </Sequence>
      <Sequence from={siap} durationInFrames={10} layout="none">
        <Audio src={staticFile("audio/sfx-pop.wav")} volume={0.5} />
      </Sequence>
    </AbsoluteFill>
  );
};
