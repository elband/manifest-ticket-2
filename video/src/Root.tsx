import { Composition } from "remotion";
import { CAM_FPS, CAM_FRAMES, CamFace, CamKtp } from "./FakeCams";
import { Main } from "./Main";
import { FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from "./timing";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="PanduanAvsec" component={Main} durationInFrames={TOTAL_FRAMES} fps={FPS} width={WIDTH} height={HEIGHT} />
    <Composition id="CamFace" component={CamFace} durationInFrames={CAM_FRAMES} fps={CAM_FPS} width={1280} height={960} />
    <Composition id="CamKtp" component={CamKtp} durationInFrames={CAM_FRAMES} fps={CAM_FPS} width={1280} height={960} />
  </>
);
