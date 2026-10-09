import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { FULL, ScreenClip } from "../components/ScreenClip";
import { mark } from "../clipTiming";
import { at, FPS } from "../timing";

const ID = "02-login" as const;
// Klip diperlambat sedikit agar ketukan PIN terbaca jelas.
const RATE = 0.75;
const clipFrame = (t: number) => Math.round((t / RATE) * FPS);

const LOGIN_FOCUS = { x: 940, y: 280, w: 1000 };

/** Login PIN — rekaman asli halaman /login lalu otomatis masuk ke /scan/kiosk. */
export const S02Login: React.FC = () => {
  const keys = ["key1", "key2", "key3", "key4"].map((k) => clipFrame(mark("login", k)));
  const submit = clipFrame(mark("login", "submit"));
  return (
    <AbsoluteFill>
      <ScreenClip
        clip="login"
        clipFrom={0}
        playbackRate={RATE}
        focus={[
          { at: 0, ...FULL },
          { at: at(ID, "PIN") + 18, ...LOGIN_FOCUS },
          { at: submit + 2, ...LOGIN_FOCUS },
          { at: submit + 26, ...FULL },
        ]}
        highlights={[
          { from: keys[0] - 6, to: keys[3] + 14, x: 1356, y: 352, w: 168, h: 38, label: "PIN 4–6 digit", color: "#67E8F9", radius: 22 },
          { from: at(ID, "tekan") - 4, to: submit + 4, x: 1245, y: 708, w: 390, h: 48, label: "Masuk Petugas" },
          { from: submit + 30, to: at(ID, "kiosk") + 30, x: 24, y: 14, w: 330, h: 50, label: "Mode Kiosk", color: "#67E8F9" },
        ]}
      />
      {keys.map((f, i) => (
        <Sequence key={i} from={f} durationInFrames={10} layout="none">
          <Audio src={staticFile("audio/sfx-tap.wav")} volume={0.5} />
        </Sequence>
      ))}
      <Sequence from={submit} durationInFrames={36} layout="none">
        <Audio src={staticFile("audio/sfx-ding.wav")} volume={0.22} />
      </Sequence>
    </AbsoluteFill>
  );
};
