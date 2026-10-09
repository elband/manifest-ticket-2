import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";

/**
 * Frame "webcam palsu" untuk Chrome (--use-file-for-fake-video-capture) saat merekam
 * UI asli SIPANDAI. Dirender jadi Y4M oleh scripts/fake-cams.mjs (15 fps, loop).
 * Data KTP fiktif; wajah memakai foto petugas yang sudah ada di aplikasi.
 */
export const FACE_PHOTO = "brand/petugas4.png";
export const CAM_FPS = 15;
export const CAM_FRAMES = 90;

/** Wajah di tengah frame — supaya heuristik warna kulit aplikasi menyatakan "Siap scan". */
export const CamFace: React.FC = () => {
  const f = useCurrentFrame();
  const t = (f / CAM_FRAMES) * Math.PI * 2; // satu siklus penuh → loop mulus
  return (
    <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 35%, #F4F1EC, #CFC8BD)" }}>
      <Img
        src={staticFile(FACE_PHOTO)}
        style={{
          position: "absolute",
          height: 1680,
          left: "50%",
          top: -125,
          mixBlendMode: "multiply",
          transform: `translateX(calc(-50% + 40px)) translate(${Math.sin(t) * 4}px, ${Math.sin(t * 2) * 4}px) scale(${1 + 0.012 * Math.sin(t)})`,
        }}
      />
    </AbsoluteFill>
  );
};

const KTP_FONT = "Arial, Helvetica, sans-serif";

const Row: React.FC<{ label: string; value: string; big?: boolean }> = ({ label, value, big }) => (
  <div style={{ display: "flex", fontSize: big ? 30 : 24, fontWeight: big ? 700 : 600, lineHeight: 1.5 }}>
    <div style={{ width: big ? 90 : 230 }}>{label}</div>
    <div style={{ width: 22 }}>:</div>
    <div>{value}</div>
  </div>
);

/** e-KTP contoh (data fiktif), dipegang di depan kamera dengan sedikit goyang. */
export const CamKtp: React.FC = () => {
  const f = useCurrentFrame();
  const t = (f / CAM_FRAMES) * Math.PI * 2;
  return (
    <AbsoluteFill style={{ background: "linear-gradient(160deg, #4A4F57, #2A2E34)", alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          width: 860,
          height: 540,
          borderRadius: 26,
          position: "relative",
          overflow: "hidden",
          fontFamily: KTP_FONT,
          color: "#0A0A0A",
          background: "linear-gradient(135deg, #BFE3F7 0%, #DDF1FB 45%, #B4DCF3 100%)",
          boxShadow: "0 30px 70px rgba(0,0,0,0.55)",
          transform: `translate(${Math.sin(t) * 3}px, ${Math.cos(t) * 2}px)`,
        }}
      >
        <div style={{ textAlign: "center", fontWeight: 700, fontSize: 28, paddingTop: 22 }}>PROVINSI KALIMANTAN TIMUR</div>
        <div style={{ textAlign: "center", fontWeight: 700, fontSize: 26 }}>KOTA SAMARINDA</div>
        <div style={{ position: "absolute", left: 34, top: 108 }}>
          <Row label="NIK" value="6472015205940003" big />
          <div style={{ height: 8 }} />
          <Row label="Nama" value="RINA LESTARI" />
          <Row label="Tempat/Tgl Lahir" value="SAMARINDA, 12-05-1994" />
          <Row label="Jenis Kelamin" value="PEREMPUAN" />
          <Row label="Alamat" value="JL. PAHLAWAN NO. 12" />
          <Row label="Agama" value="ISLAM" />
          <Row label="Kewarganegaraan" value="WNI" />
        </div>
        <div style={{ position: "absolute", right: 34, top: 120, width: 170, height: 220, borderRadius: 6, overflow: "hidden", background: "#C62828" }}>
          <Img src={staticFile(FACE_PHOTO)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
        <div style={{ position: "absolute", right: 34, top: 356, width: 170, textAlign: "center", fontSize: 18, fontWeight: 600 }}>
          SAMARINDA
          <br />
          12-05-2022
        </div>
      </div>
    </AbsoluteFill>
  );
};
