import { linearTiming, TransitionSeries, type TransitionPresentation } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import type { ComponentType } from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Background } from "./components/common";
import { Captions, ChapterStub, JourneyBar, PlaneSwoosh } from "./components/overlays";
import { S01Intro } from "./scenes/S01Intro";
import { S02Login } from "./scenes/S02Login";
import { S03Wajah } from "./scenes/S03Wajah";
import { S04Ktp } from "./scenes/S04Ktp";
import { S05Scan } from "./scenes/S05Scan";
import { S06Valid } from "./scenes/S06Valid";
import { S07Ditolak } from "./scenes/S07Ditolak";
import { S08Tips } from "./scenes/S08Tips";
import { S09Penutup } from "./scenes/S09Penutup";
import { SCENES, sceneFrames, sceneStarts, TOTAL_FRAMES, TRANSITION, voDelay, voRanges, type SceneId } from "./timing";

const COMPONENTS: Record<SceneId, ComponentType> = {
  "01-intro": S01Intro,
  "02-login": S02Login,
  "03-wajah": S03Wajah,
  "04-ktp": S04Ktp,
  "05-scan": S05Scan,
  "06-valid": S06Valid,
  "07-ditolak": S07Ditolak,
  "08-tips": S08Tips,
  "09-penutup": S09Penutup,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const presentationFor = (i: number): TransitionPresentation<any> => {
  switch (i % 4) {
    case 0:
      return slide({ direction: "from-right" });
    case 1:
      return wipe({ direction: "from-left" });
    case 2:
      return slide({ direction: "from-bottom" });
    default:
      return fade();
  }
};

/** Musik turun saat narasi (ducking), fade in di awal & fade out di akhir. */
const musicVolume = (f: number) => {
  const RAMP = 10;
  let duck = 0;
  for (const [s, e] of voRanges) {
    duck = Math.max(duck, interpolate(f, [s - RAMP, s, e, e + RAMP], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  }
  const edges = interpolate(f, [0, 20, TOTAL_FRAMES - 60, TOTAL_FRAMES - 5], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (0.34 - 0.22 * duck) * edges;
};

const STEP_SCENES = SCENES.slice(1, -1);

export const Main: React.FC = () => {
  const frame = useCurrentFrame();

  // Posisi pesawat di bar perjalanan: maju mulus saat pergantian langkah.
  const progress = STEP_SCENES.slice(1).reduce((sum, id) => {
    const s = sceneStarts[id];
    return sum + interpolate(frame, [s - TRANSITION, s + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  }, 0);
  const firstStep = sceneStarts[STEP_SCENES[0]];
  const outro = sceneStarts["09-penutup"];
  const barOpacity = interpolate(frame, [firstStep - TRANSITION, firstStep + 10, outro - TRANSITION, outro + 5], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#071222" }}>
      <Background />
      <TransitionSeries>
        {SCENES.flatMap((id, i) => {
          const Scene = COMPONENTS[id];
          const seq = (
            <TransitionSeries.Sequence key={id} durationInFrames={sceneFrames(id)}>
              <Scene />
            </TransitionSeries.Sequence>
          );
          return i === SCENES.length - 1
            ? [seq]
            : [seq, <TransitionSeries.Transition key={`${id}-t`} presentation={presentationFor(i)} timing={linearTiming({ durationInFrames: TRANSITION })} />];
        })}
      </TransitionSeries>

      {/* Overlay global */}
      {STEP_SCENES.map((id) => (
        <Sequence key={`stub-${id}`} from={sceneStarts[id]} durationInFrames={sceneFrames(id) - TRANSITION}>
          <ChapterStub id={id} />
        </Sequence>
      ))}
      <JourneyBar progress={progress} opacity={barOpacity} />
      {SCENES.map((id) => (
        <Sequence key={`cap-${id}`} from={sceneStarts[id]} durationInFrames={sceneFrames(id)}>
          <Captions id={id} />
        </Sequence>
      ))}
      {SCENES.slice(1).map((id, i) => (
        <Sequence key={`sw-${id}`} from={sceneStarts[id] - 4} durationInFrames={30}>
          <PlaneSwoosh variant={i} />
          <Audio src={staticFile("audio/sfx-whoosh.wav")} volume={0.3} />
        </Sequence>
      ))}

      {/* Audio */}
      {SCENES.map((id) => (
        <Sequence key={`vo-${id}`} from={sceneStarts[id] + voDelay(id)} durationInFrames={sceneFrames(id)} layout="none">
          <Audio src={staticFile(`audio/vo-${id}.mp3`)} volume={1} />
        </Sequence>
      ))}
      <Audio src={staticFile("audio/music.mp3")} volume={musicVolume} />
    </AbsoluteFill>
  );
};
