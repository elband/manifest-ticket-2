import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      screens: {
        // Layar kiosk yang cukup tinggi (mis. 1080p) → panel scanner diperbesar.
        tall: { raw: "(min-height: 960px)" },
      },
      fontFamily: {
        sans: ["Poppins", "ui-sans-serif", "system-ui", "sans-serif"],
        // Kiosk: keluarga Barlow (terinspirasi rambu jalan) — bahasa rambu bandara.
        sign: ["Barlow", "Poppins", "ui-sans-serif", "system-ui", "sans-serif"],
        board: ['"Barlow Condensed"', "Barlow", "ui-sans-serif", "sans-serif"],
      },
      colors: {
        // Kiosk: biru brand (bidang rambu, teks putih) + biru muda untuk aksen
        // di atas papan arang, dengan aula beton sebagai latar.
        kiosk: {
          sign: "#2563EB",
          "sign-glow": "#38BDF8",
          asphalt: "#1E2228",
          cell: "#2B3038",
          line: "#3A404A",
          concrete: "#D6DAE0",
          "concrete-dark": "#2A2F37",
          paper: "#FFFFFF",
          go: "#1F9D55",
          hold: "#F08C00",
          stop: "#D93F3F",
        },
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
        },
        // Semantic theme tokens (driven by CSS variables in globals.css)
        surface: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          2: "rgb(var(--surface-2) / <alpha-value>)",
          elev: "rgb(var(--surface-elev) / <alpha-value>)",
        },
        hairline: {
          DEFAULT: "rgb(var(--hairline) / <alpha-value>)",
          soft: "rgb(var(--hairline-soft) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--text) / <alpha-value>)",
          muted: "rgb(var(--text-muted) / <alpha-value>)",
          subtle: "rgb(var(--text-subtle) / <alpha-value>)",
        },
        brandvar: {
          DEFAULT: "rgb(var(--brand) / <alpha-value>)",
          2: "rgb(var(--brand-2) / <alpha-value>)",
          3: "rgb(var(--brand-3) / <alpha-value>)",
          fg: "rgb(var(--brand-fg) / <alpha-value>)",
        },
      },
      boxShadow: {
        soft: "0 8px 24px -12px rgba(15, 23, 42, 0.12)",
        card: "0 6px 18px -8px rgba(37, 99, 235, 0.18), 0 2px 6px rgba(37, 99, 235, 0.06)",
        lift: "0 16px 40px rgba(37, 99, 235, 0.14)",
        glow: "0 0 0 6px rgba(37, 99, 235, 0.12)",
      },
      backgroundImage: {
        "app-gradient":
          "radial-gradient(circle at top left, rgba(37,99,235,0.10), transparent 30%), radial-gradient(circle at top right, rgba(6,182,212,0.08), transparent 28%), linear-gradient(135deg,#F8FAFC 0%,#EEF6FF 45%,#F0FDFF 100%)",
        "shine":
          "linear-gradient(120deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.6) 50%, rgba(255,255,255,0) 100%)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "badge-pop": {
          "0%": { transform: "scale(0.9)", opacity: "0" },
          "60%": { transform: "scale(1.04)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        "pulse-glow": {
          "0%, 100%": {
            boxShadow: "0 0 0 0 rgba(37,99,235,0.35)",
          },
          "50%": {
            boxShadow: "0 0 0 10px rgba(37,99,235,0)",
          },
        },
        "pulse-glow-emerald": {
          "0%, 100%": {
            boxShadow: "0 0 0 0 rgba(16,185,129,0.45)",
          },
          "50%": {
            boxShadow: "0 0 0 12px rgba(16,185,129,0)",
          },
        },
        "pulse-glow-rose": {
          "0%, 100%": {
            boxShadow: "0 0 0 0 rgba(244,63,94,0.40)",
          },
          "50%": {
            boxShadow: "0 0 0 12px rgba(244,63,94,0)",
          },
        },
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-4px)" },
        },
        drift: {
          "0%": { transform: "translate(0, 0)" },
          "33%": { transform: "translate(8px, -6px)" },
          "66%": { transform: "translate(-6px, 4px)" },
          "100%": { transform: "translate(0, 0)" },
        },
        "spin-slow": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        "fly-by": {
          "0%": { transform: "translate(-120%, 30%) rotate(-12deg)", opacity: "0" },
          "10%": { opacity: "0.6" },
          "90%": { opacity: "0.6" },
          "100%": { transform: "translate(120%, -30%) rotate(-12deg)", opacity: "0" },
        },
        "route-fly": {
          "0%": { left: "0%", opacity: "0" },
          "12%": { opacity: "1" },
          "88%": { opacity: "1" },
          "100%": { left: "100%", opacity: "0" },
        },
        "gradient-shift": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        "tilt-soft": {
          "0%, 100%": { transform: "rotate(-1deg)" },
          "50%": { transform: "rotate(1deg)" },
        },
        "bp-rise": {
          "0%": { transform: "translateY(40px) rotate(-6deg)", opacity: "0" },
          "100%": { transform: "translateY(0) rotate(-6deg)", opacity: "1" },
        },
        "sheet-up": {
          "0%": { transform: "translateY(100%)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        ripple: {
          "0%": { transform: "scale(0.6)", opacity: "0.7" },
          "100%": { transform: "scale(2.2)", opacity: "0" },
        },
        "orbit-dot": {
          "0%": { transform: "rotate(0deg) translateX(var(--orbit-r,60px)) rotate(0deg)" },
          "100%": { transform: "rotate(360deg) translateX(var(--orbit-r,60px)) rotate(-360deg)" },
        },
        "check-pop": {
          "0%": { transform: "scale(0.4) rotate(-12deg)", opacity: "0" },
          "55%": { transform: "scale(1.15) rotate(2deg)", opacity: "1" },
          "100%": { transform: "scale(1) rotate(0deg)", opacity: "1" },
        },
        "flash-once": {
          "0%": { opacity: "0.6" },
          "100%": { opacity: "0" },
        },
        "scan-line": {
          "0%": { transform: "translateY(0)", opacity: "0" },
          "10%": { opacity: "0.9" },
          "90%": { opacity: "0.9" },
          "100%": { transform: "translateY(280px)", opacity: "0" },
        },
        wave: {
          "0%, 100%": { transform: "scaleY(0.35)" },
          "50%": { transform: "scaleY(1)" },
        },
        // Lineup masuk: SEMUA card animate bersamaan (tanpa stagger/delay-index).
        // fade-in + slide-up + scale 0.9→1. fill `backwards` (bukan forwards) agar
        // setelah selesai transform balik ke default → hover:-translate-y tetap jalan.
        "lineup-in": {
          "0%": { opacity: "0", transform: "translateY(18px) scale(0.9)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        // Idle floating halus untuk avatar setelah lineup selesai.
        "avatar-float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-5px)" },
        },
        // Idle glow "breathing" di belakang avatar.
        "glow-breath": {
          "0%, 100%": { opacity: "0.45", transform: "scale(1)" },
          "50%": { opacity: "0.85", transform: "scale(1.08)" },
        },
        // Pulse halus dot status hijau (aktif).
        "dot-pulse": {
          "0%, 100%": { transform: "scale(1)", boxShadow: "0 0 0 0 rgba(16,185,129,0.5)" },
          "50%": { transform: "scale(1.12)", boxShadow: "0 0 0 6px rgba(16,185,129,0)" },
        },
        // Ticker info kiosk: track digandakan 2x, geser -50% → loop mulus.
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        // Laci riwayat scan kiosk masuk dari kanan.
        "drawer-in": {
          "0%": { transform: "translateX(100%)" },
          "100%": { transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s ease-out both",
        "fade-in": "fade-in 0.4s ease-out both",
        "badge-pop": "badge-pop 0.35s ease-out both",
        "pulse-glow": "pulse-glow 2.2s ease-in-out infinite",
        "pulse-glow-emerald": "pulse-glow-emerald 2s ease-in-out infinite",
        "pulse-glow-rose": "pulse-glow-rose 1.8s ease-in-out infinite",
        shimmer: "shimmer 2.4s ease-in-out infinite",
        float: "float 3.5s ease-in-out infinite",
        drift: "drift 9s ease-in-out infinite",
        "spin-slow": "spin-slow 22s linear infinite",
        "spin-ring": "spin-slow 5s linear infinite",
        "fly-by": "fly-by 14s ease-in-out infinite",
        "route-fly": "route-fly 3.2s ease-in-out infinite",
        "gradient-shift": "gradient-shift 8s ease-in-out infinite",
        "tilt-soft": "tilt-soft 6s ease-in-out infinite",
        "bp-rise": "bp-rise 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "sheet-up": "sheet-up 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) both",
        ripple: "ripple 2.4s ease-out infinite",
        "orbit-dot": "orbit-dot 8s linear infinite",
        "check-pop": "check-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both",
        "flash-once": "flash-once 0.35s ease-out forwards",
        "scan-line": "scan-line 2.4s ease-in-out infinite",
        wave: "wave 1.1s ease-in-out infinite",
        "lineup-in": "lineup-in 1.2s cubic-bezier(0.2, 0.8, 0.2, 1) backwards",
        "avatar-float": "avatar-float 4s ease-in-out infinite",
        "glow-breath": "glow-breath 3.2s ease-in-out infinite",
        "dot-pulse": "dot-pulse 2.2s ease-in-out infinite",
        marquee: "marquee 38s linear infinite",
        "drawer-in": "drawer-in 0.32s cubic-bezier(0.2, 0.8, 0.2, 1) both",
      },
    },
  },
  plugins: [],
};
export default config;
