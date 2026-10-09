import { loadFont } from "@remotion/google-fonts/Poppins";
import type { CSSProperties } from "react";

export const { fontFamily } = loadFont("normal", {
  weights: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
});

/** Palet brand SIPANDAI (lihat src/app/globals.css & tailwind.config.ts di aplikasi). */
export const C = {
  brand: "#2563EB",
  brand2: "#38BDF8",
  brand3: "#06B6D4",
  navy: "#071222",
  navy2: "#0B1A30",
  panel: "#112035",
  panel2: "#16294A",
  line: "rgba(125, 211, 252, 0.22)",
  lineStrong: "rgba(56, 189, 248, 0.55)",
  text: "#E8F1FF",
  muted: "#8FA6C7",
  success: "#10B981",
  successLite: "#34D399",
  warning: "#F59E0B",
  warningLite: "#FCD34D",
  danger: "#F43F5E",
  dangerLite: "#FDA4AF",
  white: "#FFFFFF",
} as const;

export const gradText: CSSProperties = {
  backgroundImage: "linear-gradient(90deg, #7DD3FC 0%, #A5F3FC 45%, #93C5FD 100%)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
};

/** Panel kaca bergaya HUD seperti mode kiosk aplikasi. */
export const hudPanel: CSSProperties = {
  background: "linear-gradient(160deg, rgba(22, 41, 74, 0.92), rgba(10, 22, 40, 0.92))",
  border: `1.5px solid ${C.line}`,
  borderRadius: 28,
  boxShadow: "0 0 0 1px rgba(56,189,248,0.06) inset, 0 30px 80px -30px rgba(0,0,0,0.8), 0 0 60px -20px rgba(56,189,248,0.35)",
};
