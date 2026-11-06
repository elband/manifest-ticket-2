"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Camera,
  X,
  AlertCircle,
  Loader2,
  Zap,
  ZapOff,
  ScanLine,
  SwitchCamera,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getSettings, saveSettings } from "@/lib/settings";

const PREFERRED_FORMATS = [
  "pdf417",
  "aztec",
  "qr_code",
  "code_128",
  "code_39",
  "data_matrix",
];

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<{
    rawValue: string;
    format: string;
  }[]>;
}

interface BarcodeDetectorCtor {
  new (init?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

interface MediaTrackCapabilitiesWithTorch extends MediaTrackCapabilities {
  torch?: boolean;
}

interface MediaTrackConstraintSetWithTorch extends MediaTrackConstraintSet {
  torch?: boolean;
}

interface ZxingControls {
  stop: () => void;
}

let invertCanvas: HTMLCanvasElement | null = null;

/**
 * Salinan negatif (warna dibalik) dari frame video. Detektor barcode hanya
 * mengenali modul gelap di atas latar terang; QR kartu PAS justru putih di
 * atas merah, jadi perlu dibalik dulu.
 */
function invertFrame(video: HTMLVideoElement): HTMLCanvasElement | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  invertCanvas ??= document.createElement("canvas");
  const canvas = invertCanvas;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  // Safari lama belum punya ctx.filter → balik piksel manual.
  const hasFilter = typeof (ctx as { filter?: unknown }).filter === "string";
  if (hasFilter) {
    ctx.filter = "invert(1)";
    ctx.drawImage(video, 0, 0, w, h);
    ctx.filter = "none";
    return canvas;
  }
  ctx.drawImage(video, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onDecode: (raw: string, format: string) => void;
  /** Teks arahan awal di bawah video. */
  initialHint?: string;
  /**
   * "dialog" (default): kartu di tengah layar. "fullscreen": memenuhi layar —
   * untuk kiosk di HP, video sebesar mungkin supaya mudah membidik.
   */
  variant?: "dialog" | "fullscreen";
}

export function CameraScanner({
  open,
  onClose,
  onDecode,
  initialHint = "Arahkan kamera ke barcode boarding pass…",
  variant = "dialog",
}: Props) {
  const fullscreen = variant === "fullscreen";
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [starting, setStarting] = useState(true);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [engine, setEngine] = useState<"native" | "zxing" | null>(null);
  // Kamera terpilih (tersimpan di settings). null = kamera belakang default.
  const [deviceId, setDeviceId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getSettings().scannerCameraDeviceId,
  );
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [hint, setHint] = useState(initialHint);
  const lastDecodedRef = useRef<{ value: string; at: number }>({
    value: "",
    at: 0,
  });
  const rafRef = useRef<number | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const zxingControlsRef = useRef<ZxingControls | null>(null);
  const onDecodeRef = useRef(onDecode);

  useEffect(() => {
    onDecodeRef.current = onDecode;
  }, [onDecode]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const emitDecoded = (raw: string, format: string) => {
      const cleaned = (raw ?? "").trim();
      if (!cleaned) return;
      const now = Date.now();
      const last = lastDecodedRef.current;
      if (cleaned === last.value && now - last.at <= 2000) return;
      lastDecodedRef.current = { value: cleaned, at: now };
      setHint(`Terbaca · ${format.toUpperCase()} · ${cleaned.length} char`);
      onDecodeRef.current(cleaned, format);
    };

    const stop = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (zxingControlsRef.current) {
        try {
          zxingControlsRef.current.stop();
        } catch {
          /* ignore */
        }
        zxingControlsRef.current = null;
      }
      const s = streamRef.current;
      if (s) {
        s.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      const v = videoRef.current;
      if (v) {
        v.srcObject = null;
      }
    };

    const videoConstraints: MediaTrackConstraints = {
      ...(deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: { ideal: "environment" } }),
      width: { ideal: 1280 },
      height: { ideal: 720 },
    };

    // Label kamera baru tersedia setelah izin diberikan → enumerasi setelah
    // stream jalan, dan catat kamera yang benar-benar aktif.
    const refreshDevices = async (track: MediaStreamTrack | undefined) => {
      setActiveDeviceId(track?.getSettings?.().deviceId ?? null);
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) {
          setDevices(list.filter((d) => d.kind === "videoinput"));
        }
      } catch {
        /* ignore */
      }
    };

    const startNative = async (BD: BarcodeDetectorCtor) => {
      let formats = PREFERRED_FORMATS;
      if (BD.getSupportedFormats) {
        const sup = await BD.getSupportedFormats();
        const filtered = PREFERRED_FORMATS.filter((f) => sup.includes(f));
        if (filtered.length > 0) formats = filtered;
      }
      detectorRef.current = new BD({ formats });

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      const track = stream.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ??
        {}) as MediaTrackCapabilitiesWithTorch;
      setTorchAvailable(Boolean(caps.torch));
      void refreshDevices(track);

      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => {});
      }
      setSupported(true);
      setEngine("native");
      setStarting(false);
      loopNative();
    };

    const loopNative = () => {
      // Frame genap dideteksi apa adanya, frame ganjil versi negatifnya —
      // supaya QR putih di atas latar gelap (kartu PAS) juga terbaca.
      let inverted = false;
      const detect = async () => {
        const v = videoRef.current;
        const det = detectorRef.current;
        if (!v || !det || v.readyState < 2) {
          rafRef.current = requestAnimationFrame(detect);
          return;
        }
        inverted = !inverted;
        try {
          const source = inverted ? invertFrame(v) : v;
          const codes = source ? await det.detect(source) : [];
          if (codes && codes.length > 0) {
            const code = codes[0];
            emitDecoded(code.rawValue ?? "", code.format);
          }
        } catch {
          /* ignore frame error */
        }
        rafRef.current = requestAnimationFrame(detect);
      };
      rafRef.current = requestAnimationFrame(detect);
    };

    const startZxing = async () => {
      const [
        { BrowserMultiFormatReader, HTMLCanvasElementLuminanceSource },
        { DecodeHintType, BarcodeFormat, BinaryBitmap, HybridBinarizer },
      ] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);

      if (cancelled) return;

      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.PDF_417,
        BarcodeFormat.AZTEC,
        BarcodeFormat.QR_CODE,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.DATA_MATRIX,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 120,
      });
      // Sama seperti jalur native: selang-seling frame normal & negatif agar
      // QR putih di atas latar gelap juga terbaca.
      let invertNext = false;
      const decodeNormal = reader.decodeFromCanvas.bind(reader);
      reader.decodeFromCanvas = (canvas: HTMLCanvasElement) => {
        invertNext = !invertNext;
        if (!invertNext) return decodeNormal(canvas);
        const source = new HTMLCanvasElementLuminanceSource(canvas).invert();
        return reader.decodeBitmap(
          new BinaryBitmap(new HybridBinarizer(source)),
        );
      };

      const v = videoRef.current;
      if (!v) return;

      const constraints: MediaStreamConstraints = {
        video: videoConstraints,
        audio: false,
      };

      const controls = await reader.decodeFromConstraints(
        constraints,
        v,
        (result) => {
          if (!result) return;
          const fmt = result.getBarcodeFormat?.();
          const format =
            typeof fmt === "number" ? BarcodeFormat[fmt] ?? "barcode" : "barcode";
          emitDecoded(result.getText(), String(format).toLowerCase());
        },
      );
      if (cancelled) {
        try {
          controls.stop();
        } catch {
          /* ignore */
        }
        return;
      }
      zxingControlsRef.current = { stop: () => controls.stop() };

      // ZXing manages the stream internally — capture it for torch support.
      const stream = (v.srcObject as MediaStream | null) ?? null;
      if (stream) {
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        const caps = (track?.getCapabilities?.() ??
          {}) as MediaTrackCapabilitiesWithTorch;
        setTorchAvailable(Boolean(caps.torch));
        void refreshDevices(track);
      }

      setSupported(true);
      setEngine("zxing");
      setStarting(false);
    };

    const start = async () => {
      setStarting(true);
      setError(null);

      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        setSupported(false);
        setStarting(false);
        const isInsecure =
          typeof window !== "undefined" &&
          window.location.protocol !== "https:" &&
          window.location.hostname !== "localhost" &&
          window.location.hostname !== "127.0.0.1";
        setError(
          isInsecure
            ? `Akses kamera diblokir karena halaman dibuka via HTTP (${window.location.host}). iPhone Safari WAJIB HTTPS. Jalankan "npm run dev:https" lalu buka URL https://… yang muncul di terminal.`
            : "Browser tidak mendukung akses kamera (navigator.mediaDevices tidak tersedia).",
        );
        return;
      }

      const BD = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
        .BarcodeDetector;

      try {
        if (BD) {
          await startNative(BD);
        } else {
          await startZxing();
        }
      } catch (e) {
        // Kamera tersimpan sudah tidak ada (dicabut / device lain) → kembali
        // ke kamera default; efek jalan ulang karena deviceId berubah.
        const name = e instanceof Error ? e.name : "";
        if (
          deviceId &&
          (name === "OverconstrainedError" || name === "NotFoundError")
        ) {
          if (!cancelled) setDeviceId(null);
          return;
        }
        const msg =
          name === "NotAllowedError" || name === "SecurityError"
            ? "Izin kamera ditolak. Izinkan akses kamera untuk situs ini di pengaturan browser, lalu buka kamera lagi."
            : name === "NotFoundError"
              ? "Kamera tidak ditemukan di perangkat ini."
              : name === "NotReadableError"
                ? "Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi."
                : e instanceof Error
                  ? e.message
                  : "Tidak dapat mengakses kamera.";
        setError(msg);
        setStarting(false);
      }
    };

    start();
    return () => {
      cancelled = true;
      stop();
      setTorchOn(false);
      setEngine(null);
    };
  }, [open, deviceId]);

  const selectCamera = (id: string) => {
    const next = id || null;
    setDeviceId(next);
    saveSettings({ scannerCameraDeviceId: next });
  };

  // Tombol cepat: ganti ke kamera berikutnya (berguna di HP: depan ↔ belakang).
  const nextCamera = () => {
    if (devices.length < 2) return;
    const idx = devices.findIndex((d) => d.deviceId === activeDeviceId);
    selectCamera(devices[(idx + 1) % devices.length].deviceId);
  };

  const toggleTorch = async () => {
    const s = streamRef.current;
    if (!s) return;
    const track = s.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [
          { torch: next } as MediaTrackConstraintSetWithTorch,
        ],
      });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  };

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[90] flex items-center justify-center print:hidden",
        fullscreen ? "bg-black" : "bg-slate-950/85 px-4 backdrop-blur-sm",
      )}
    >
      <div
        className={cn(
          "relative w-full overflow-hidden bg-slate-950",
          fullscreen
            ? "flex h-[100dvh] flex-col"
            : "max-w-md rounded-2xl shadow-lift ring-1 ring-slate-800 animate-fade-up",
        )}
      >
        {/* Header */}
        <div
          className={cn(
            "flex items-center justify-between border-b border-slate-800 px-4 py-3",
            fullscreen && "shrink-0 pt-[max(0.75rem,env(safe-area-inset-top))]",
          )}
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30">
              <Camera className="h-3.5 w-3.5" />
            </span>
            Kamera Scanner
            {engine && (
              <span
                className={cn(
                  "ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1",
                  engine === "native"
                    ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                    : "bg-sky-500/15 text-sky-300 ring-sky-500/30",
                )}
                title={
                  engine === "native"
                    ? "BarcodeDetector native (cepat)"
                    : "ZXing fallback (untuk iOS Safari)"
                }
              >
                {engine === "native" ? "native" : "zxing"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {devices.length > 1 && (
              <button
                type="button"
                onClick={nextCamera}
                title="Ganti kamera"
                aria-label="Ganti kamera"
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
              >
                <SwitchCamera className="h-4 w-4" />
              </button>
            )}
            {torchAvailable && (
              <button
                type="button"
                onClick={toggleTorch}
                title={torchOn ? "Matikan senter" : "Nyalakan senter"}
                className={cn(
                  "rounded-lg p-1.5 transition",
                  torchOn
                    ? "bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/40"
                    : "text-slate-400 hover:bg-slate-800 hover:text-white",
                )}
              >
                {torchOn ? (
                  <Zap className="h-4 w-4" />
                ) : (
                  <ZapOff className="h-4 w-4" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup"
              className={cn(
                "rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-white",
                fullscreen ? "p-2" : "p-1.5",
              )}
            >
              <X className={fullscreen ? "h-5 w-5" : "h-4 w-4"} />
            </button>
          </div>
        </div>

        {/* Pilih kamera */}
        {devices.length > 0 && (
          <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-2">
            <Camera className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            <select
              value={activeDeviceId ?? deviceId ?? ""}
              onChange={(e) => selectCamera(e.target.value)}
              disabled={devices.length < 2}
              aria-label="Pilih kamera"
              className="min-w-0 flex-1 truncate rounded-lg bg-slate-900 px-2 py-1.5 text-xs text-slate-200 ring-1 ring-slate-700 outline-none focus:ring-emerald-500/60 disabled:opacity-70"
            >
              {devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Kamera ${i + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Video / Reticle */}
        <div
          className={cn(
            "relative bg-black",
            fullscreen ? "min-h-0 flex-1" : "aspect-[4/3]",
          )}
        >
          <video
            ref={videoRef}
            className={cn(
              "w-full object-cover",
              fullscreen ? "absolute inset-0 h-full" : "h-full",
            )}
            muted
            playsInline
          />
          {/* Reticle overlay */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className={cn(
                "relative rounded-2xl ring-2 ring-emerald-400/60",
                // Layar penuh: bidang bidik lebih tinggi supaya QR (persegi)
                // dan PDF417 (melebar) sama-sama muat.
                fullscreen
                  ? "aspect-square w-[72vw] max-w-[22rem] shadow-[0_0_0_100vmax_rgba(2,6,23,0.45)]"
                  : "h-44 w-72",
              )}
            >
              <span className="absolute -left-0.5 -top-0.5 h-6 w-6 rounded-tl-xl border-l-2 border-t-2 border-emerald-400" />
              <span className="absolute -right-0.5 -top-0.5 h-6 w-6 rounded-tr-xl border-r-2 border-t-2 border-emerald-400" />
              <span className="absolute -bottom-0.5 -left-0.5 h-6 w-6 rounded-bl-xl border-b-2 border-l-2 border-emerald-400" />
              <span className="absolute -bottom-0.5 -right-0.5 h-6 w-6 rounded-br-xl border-b-2 border-r-2 border-emerald-400" />
              <span className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-emerald-400/70 shadow-[0_0_8px_rgba(52,211,153,0.7)] animate-pulse" />
            </div>
          </div>

          {/* Starting / error overlays */}
          {(starting || error || supported === false) && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
              {error || supported === false ? (
                <div className="mx-4 flex max-w-xs items-start gap-2 rounded-xl bg-rose-950/70 px-3 py-2 text-xs text-rose-200 ring-1 ring-rose-800">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-full bg-slate-900/80 px-4 py-2 text-xs text-slate-300 ring-1 ring-slate-700">
                  <Loader2 className="h-4 w-4 animate-spin text-emerald-300" />
                  Menyalakan kamera…
                </div>
              )}
            </div>
          )}
        </div>

        {/* Status */}
        <div
          className={cn(
            "space-y-1 px-4 py-3",
            fullscreen && "shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
          )}
        >
          <p
            className={cn(
              "flex items-center justify-center gap-1.5 text-center font-medium text-slate-300",
              fullscreen ? "text-[13px]" : "text-[11px]",
            )}
          >
            <ScanLine className="h-3 w-3 text-emerald-400" />
            {hint}
          </p>
          <p className="text-center text-[10px] text-slate-500">
            Format: PDF417 (BCBP) · Aztec · QR · Code 128/39
            {engine === "zxing" && (
              <span className="ml-1 text-sky-400">· iOS fallback aktif</span>
            )}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
