import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { fadeUp, popIn, tween, useEnter } from "../components/anim";
import { Plane, SplitFlap } from "../components/common";
import { C, fontFamily, gradText } from "../theme";
import { at, sceneFrames } from "../timing";

const ID = "09-penutup" as const;

export const S09Penutup: React.FC = () => {
  const frame = useCurrentFrame();
  const durationInFrames = sceneFrames(ID);
  const logo = useEnter(2, { damping: 11 });
  const title = useEnter(8);
  const thanks = useEnter(at(ID, "Selamat") - 4, { damping: 12 });
  const takeoff = tween(frame, [at(ID, "bertugas"), at(ID, "bertugas") + 60], [0, 1]);
  const fadeOut = tween(frame, [durationInFrames - 30, durationInFrames], [0, 1]);

  return (
    <AbsoluteFill style={{ fontFamily }}>
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 150 }}>
        <div style={{ ...popIn(logo), filter: "drop-shadow(0 0 40px rgba(56,189,248,0.6))" }}>
          <Img src={staticFile("brand/icon.svg")} style={{ width: 130, height: 130 }} />
        </div>
        <div style={{ ...fadeUp(title, 50), fontSize: 120, fontWeight: 800, letterSpacing: 8, ...gradText, lineHeight: 1.1, marginTop: 10 }}>SIPANDAI</div>
        <div style={{ display: "flex", alignItems: "center", gap: 26, marginTop: 30 }}>
          <SplitFlap text="AMAN" start={at(ID, "Aman") - 8} size={70} />
          <Dot />
          <SplitFlap text="CEPAT" start={at(ID, "cepat") - 8} size={70} />
          <Dot />
          <SplitFlap text="TERTIB" start={at(ID, "tertib") - 8} size={70} />
        </div>
        <div style={{ ...fadeUp(thanks, 40), marginTop: 46, color: C.text, fontSize: 64, fontWeight: 800 }}>
          Selamat bertugas!
        </div>
        <div style={{ ...fadeUp(thanks, 20), marginTop: 10, color: C.muted, fontSize: 28 }}>Avsec · Bandar Udara Aji Pangeran Tumenggung Pranoto · Samarinda</div>
      </AbsoluteFill>
      {takeoff > 0 && takeoff < 1 ? (
        <div style={{ position: "absolute", left: 200 + takeoff * 1900, top: 880 - takeoff * 900, transform: "rotate(-25deg)" }}>
          <div style={{ position: "absolute", right: 70, top: 44, width: 900, height: 6, borderRadius: 4, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.75))" }} />
          <Plane size={130} color="#F8FAFC" style={{ filter: "drop-shadow(0 0 24px rgba(56,189,248,0.95))" }} />
        </div>
      ) : null}
      <AbsoluteFill style={{ background: "#02060C", opacity: fadeOut }} />
    </AbsoluteFill>
  );
};

const Dot = () => <div style={{ width: 14, height: 14, borderRadius: 14, background: C.brand2, boxShadow: `0 0 14px ${C.brand2}` }} />;
