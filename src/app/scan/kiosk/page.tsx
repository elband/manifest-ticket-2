"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ScanLine,
  X,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Plane,
  User,
  Armchair,
  Clock,
  Usb,
  Keyboard,
  ShieldCheck,
  Sun,
  Moon,
  ArrowRight,
  Scan,
  Volume2,
  VolumeX,
  RotateCcw,
  Sparkles,
  Cloud,
  CloudOff,
  Loader2,
  Settings,
  Megaphone,
  IdCard,
  UserX,
  Power,
  Maximize,
  Minimize,
  Ticket,
  Scissors,
  Droplets,
  Flame,
  SprayCan,
  Hammer,
  ShieldAlert,
  BatteryCharging,
  Luggage,
  BarChart3,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCountUp } from "@/lib/useCountUp";
import Image from "next/image";
import { cn, todayDateString } from "@/lib/utils";
import { pullFidsKeberangkatan } from "@/lib/jadwal/flightSync";
import {
  type FaceCaptureHandle,
  type FaceState,
} from "@/components/scan/FaceCaptureCamera";
import { Modal } from "@/components/ui/Modal";
import { getAirlineMeta } from "@/lib/airlines";
import { AirlineLogo } from "@/components/ui/AirlineLogo";
import {
  SEED_BOARDING_PASSES,
  buildPayload,
  ensureDemoBoardingFlight,
} from "@/lib/seedBoardingPasses";
import { useToast } from "@/components/ui/Toast";
import {
  getSession,
  getScanEvents,
  getFlights,
  updateScanEvent,
} from "@/lib/storage";
import {
  playFeedbackHaptic,
  playFeedbackSound,
  processScan,
  processScanWithFace,
} from "@/lib/scanService";
import { facePhotoStore } from "@/lib/facePhotoStore";
import { KtpVerifyModal } from "@/components/scan/KtpVerifyModal";
import { getEffectiveFlightStatus } from "@/lib/flightStatus";
import {
  flushOutbox,
  getOutboxSummary,
  subscribeOutbox,
  type OutboxSummary,
} from "@/lib/sikerenOutbox";
import {
  getSettings,
  saveSettings,
  subscribeSettings,
  type AppSettings,
} from "@/lib/settings";
import { setTheme } from "@/lib/theme";
import { initKtpOcr } from "@/lib/ktpOcr";
import { getIdDoc, recognizeIdName } from "@/lib/idDocs";
import { matchKtpName } from "@/lib/nameMatch";
import type {
  Flight,
  KtpVerification,
  ParsedBarcode,
  ScanEvent,
  ScanResultStatus,
  SessionUser,
} from "@/lib/types";

// KTP-first: parameter pemindaian KTP di kamera utama. Kotak ini SEKALIGUS
// panduan visual & region yang di-OCR (WYSIWYG) — dibuat lebih ke tengah frame.
const KTP_NAME_CROP = { x: 0.16, y: 0.27, w: 0.68, h: 0.36 };
// WYSIWYG: samakan rasio capture dengan display kamera (aspect-[4/3]) supaya
// kotak panduan yang dilihat operator = persis area yang di-OCR. Kalau beda
// (mis. 16:10) nama bisa keluar dari region OCR (terutama ID card portrait).
const KTP_CAPTURE_ASPECT = 4 / 3;
const KTP_SHARP_THRESHOLD = 90; // > 90 = tajam
const KTP_PENDING_TTL_MS = 45_000; // identitas KTP kedaluwarsa bila tak ada scan

type PendingKtp = {
  name: string;
  rawText: string;
  photoUrl: string;
  capturedAt: number;
};

/** KTP-first: nama di zona "periksa manual" — menunggu keputusan petugas. */
type KtpDecision = {
  ocrName: string;
  expectedName: string;
  similarity: number;
  photoUrl: string;
  decide: (accepted: boolean) => void;
};

interface LastResult {
  event: ScanEvent;
  flight: Flight | null;
  parsed: ParsedBarcode | null;
  flightNumber: string | null;
  seat: string | null;
  passengerName: string | null;
  route: string | null;
  faceUrl: string | null;
}

const STATUS_META: Record<
  ScanResultStatus,
  {
    label: string;
    icon: React.ReactNode;
    modalTone: "success" | "warning" | "danger";
    bar: string;
    pill: string;
    glow: string;
  }
> = {
  VALID_FLIGHT: {
    label: "VALID",
    icon: <CheckCircle2 className="h-12 w-12" />,
    modalTone: "success",
    bar: "from-emerald-500 via-emerald-400 to-teal-400",
    pill: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40",
    glow: "shadow-[0_0_60px_-12px_rgba(16,185,129,0.55)]",
  },
  DUPLICATE_SCAN: {
    label: "DUPLICATE - VALID",
    icon: <AlertTriangle className="h-12 w-12" />,
    modalTone: "warning",
    bar: "from-amber-500 via-amber-400 to-yellow-400",
    pill: "bg-amber-500/15 text-amber-300 ring-amber-500/40",
    glow: "shadow-[0_0_60px_-12px_rgba(245,158,11,0.55)]",
  },
  FLIGHT_NOT_TODAY: {
    label: "BUKAN HARI INI",
    icon: <XCircle className="h-12 w-12" />,
    modalTone: "danger",
    bar: "from-rose-500 via-rose-400 to-pink-500",
    pill: "bg-rose-500/15 text-rose-300 ring-rose-500/40",
    glow: "shadow-[0_0_60px_-12px_rgba(244,63,94,0.55)]",
  },
  FLIGHT_NOT_ACTIVE: {
    label: "FLIGHT NOT ACTIVE",
    icon: <XCircle className="h-12 w-12" />,
    modalTone: "danger",
    bar: "from-rose-500 via-rose-400 to-pink-500",
    pill: "bg-rose-500/15 text-rose-300 ring-rose-500/40",
    glow: "shadow-[0_0_60px_-12px_rgba(244,63,94,0.55)]",
  },
  UNKNOWN_FLIGHT: {
    label: "UNKNOWN FLIGHT",
    icon: <XCircle className="h-12 w-12" />,
    modalTone: "danger",
    bar: "from-rose-500 via-rose-400 to-pink-500",
    pill: "bg-rose-500/15 text-rose-300 ring-rose-500/40",
    glow: "shadow-[0_0_60px_-12px_rgba(244,63,94,0.55)]",
  },
  INVALID_BARCODE: {
    label: "INVALID",
    icon: <XCircle className="h-12 w-12" />,
    modalTone: "danger",
    bar: "from-rose-500 via-rose-400 to-pink-500",
    pill: "bg-rose-500/15 text-rose-300 ring-rose-500/40",
    glow: "shadow-[0_0_60px_-12px_rgba(244,63,94,0.55)]",
  },
  KTP_MISMATCH: {
    label: "KTP TIDAK COCOK",
    icon: <XCircle className="h-12 w-12" />,
    modalTone: "danger",
    bar: "from-rose-500 via-rose-400 to-pink-500",
    pill: "bg-rose-500/15 text-rose-300 ring-rose-500/40",
    glow: "shadow-[0_0_60px_-12px_rgba(244,63,94,0.55)]",
  },
};

const MODAL_AUTO_CLOSE_MS = 6000;

type ModalToneName = "info" | "warning" | "danger" | "success" | "brand";

const AIRLINE_MODAL_TONE: Record<string, ModalToneName> = {
  GA: "info",
  ID: "info",
  SAA: "info",
  IP: "info",
  MH: "info",
  JT: "danger",
  QZ: "danger",
  SJ: "danger",
  XT: "danger",
  AK: "danger",
  IU: "brand",
  IW: "warning",
  SQ: "warning",
  QG: "success",
};

const AIRLINE_COUNTDOWN_BAR: Record<string, string> = {
  GA: "from-sky-600 via-blue-500 to-cyan-400",
  ID: "from-blue-700 via-blue-600 to-indigo-500",
  SAA: "from-sky-500 via-cyan-500 to-blue-500",
  IP: "from-blue-500 via-cyan-500 to-emerald-500",
  MH: "from-blue-600 via-blue-500 to-red-400",
  JT: "from-rose-600 via-red-500 to-orange-400",
  QZ: "from-rose-600 via-pink-500 to-red-400",
  SJ: "from-red-600 via-red-500 to-rose-400",
  XT: "from-rose-700 via-rose-500 to-red-500",
  AK: "from-red-600 via-rose-500 to-pink-400",
  IU: "from-fuchsia-600 via-pink-500 to-rose-400",
  IW: "from-amber-500 via-orange-500 to-red-400",
  SQ: "from-amber-500 via-yellow-500 to-orange-400",
  QG: "from-emerald-500 via-green-500 to-lime-400",
};

function airlineToneFor(code: string | null | undefined): ModalToneName {
  return AIRLINE_MODAL_TONE[(code ?? "").toUpperCase()] ?? "success";
}

function airlineBarFor(code: string | null | undefined): string {
  return (
    AIRLINE_COUNTDOWN_BAR[(code ?? "").toUpperCase()] ??
    "from-emerald-500 to-teal-400"
  );
}

function faceGateMessage(state: FaceState): { title: string; body: string } {
  switch (state) {
    case "no_face":
      return {
        title: "Wajah tidak terdeteksi",
        body: "Posisikan wajah penumpang di depan kamera sebelum scan.",
      };
    case "multiple":
      return {
        title: "Lebih dari 1 wajah",
        body: "Pastikan hanya 1 penumpang di depan kamera.",
      };
    case "too_far":
      return {
        title: "Wajah terlalu jauh",
        body: "Mendekat ke kamera supaya wajah terlihat jelas.",
      };
    case "off_center":
      return {
        title: "Wajah tidak menghadap kamera",
        body: "Hadapkan wajah lurus ke kamera dan ke tengah.",
      };
    default:
      return {
        title: "Validasi wajah belum siap",
        body: "Tunggu sebentar hingga kamera mendeteksi wajah.",
      };
  }
}

export default function KioskPage() {
  const router = useRouter();
  const toast = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const cameraRef = React.useRef<FaceCaptureHandle>(null);
  const lastFaceUrlRef = React.useRef<string | null>(null);

  // Gerbang hidrasi: halaman kiosk bergantung penuh ke localStorage (settings,
  // session, tema) → render server (default) bisa beda dgn client → mismatch.
  // Tunda render UI sampai mounted di client supaya server & client awal sama.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const [session, setSession] = React.useState<SessionUser | null>(null);
  const [rawSettings, setSettings] = React.useState<AppSettings>(getSettings());
  // Mode kiosk tanpa kamera: semua fitur yang butuh kamera (foto wajah, gerbang
  // wajah, KTP-first, verifikasi KTP) dipaksa mati di sini tanpa mengubah
  // pengaturan global halaman /scan.
  const settings = React.useMemo<AppSettings>(
    () => ({
      ...rawSettings,
      faceCaptureEnabled: false,
      requireFaceForScan: false,
      ktpScanFirst: false,
      ktpVerifyEnabled: false,
    }),
    [rawSettings],
  );
  const [value, setValue] = React.useState("");
  const [last, setLast] = React.useState<LastResult | null>(null);
  const [recent, setRecent] = React.useState<ScanEvent[]>([]);
  const [todayScans, setTodayScans] = React.useState<ScanEvent[]>([]);
  const [todayFlights, setTodayFlights] = React.useState<Flight[]>([]);
  const [flightsToday, setFlightsToday] = React.useState(0);
  const [inputMode, setInputMode] = React.useState<"idle" | "scanner" | "manual">(
    "idle",
  );
  const [now, setNow] = React.useState(new Date());
  const [modalOpen, setModalOpen] = React.useState(false);
  const [ktpFlow, setKtpFlow] = React.useState<{
    eventId: string;
    expectedName: string | null;
    expectedNameTruncated: boolean;
  } | null>(null);
  const [faceState, setFaceState] = React.useState<FaceState>("unknown");
  const [faceDetectorSupported, setFaceDetectorSupported] = React.useState(false);
  // KTP-first: identitas KTP yang sudah terbaca, menunggu boarding pass.
  const [pendingKtp, setPendingKtp] = React.useState<PendingKtp | null>(null);
  const pendingKtpRef = React.useRef<PendingKtp | null>(null);
  const [ktpDecision, setKtpDecision] = React.useState<KtpDecision | null>(null);
  const [closeConfirm, setCloseConfirm] = React.useState(false);
  React.useEffect(() => {
    pendingKtpRef.current = pendingKtp;
  }, [pendingKtp]);
  // Stats sesi tetap dihitung internal (untuk reset), tapi tidak ditampilkan lagi
  // di header — binding nilai sengaja di-skip agar tak jadi variabel menggantung.
  const [, setSessionStats] = React.useState<{
    valid: number;
    duplicate: number;
    rejected: number;
  }>({ valid: 0, duplicate: 0, rejected: 0 });
  const [demoLoading, setDemoLoading] = React.useState(false);
  const [outbox, setOutbox] = React.useState<OutboxSummary>(() =>
    typeof window === "undefined"
      ? {
          pending: 0,
          failed: 0,
          total: 0,
          lastSyncedAt: null,
          lastError: null,
          online: true,
        }
      : getOutboxSummary(),
  );
  const [syncing, setSyncing] = React.useState(false);

  const keyTimesRef = React.useRef<number[]>([]);
  const submittingRef = React.useRef(false);
  // Barcode demo terakhir — dipakai untuk mengulang pass yang sama (uji duplikat).
  const lastDemoRawRef = React.useRef<string | null>(null);

  // Jalur "Tanpa KTP": scan berikutnya dilewati pencocokan KTP-nya.
  // Ref dipakai di handler submit (hindari stale closure), state untuk highlight UI.
  const exemptNextRef = React.useRef(false);
  const [exemptNext, setExemptNextState] = React.useState(false);
  const setExemptNext = React.useCallback((v: boolean) => {
    exemptNextRef.current = v;
    setExemptNextState(v);
  }, []);

  const isDark = settings.theme === "dark";

  React.useEffect(() => {
    const s = getSession();
    setSession(s);
    if (!s) {
      router.replace("/login");
      return;
    }
    const all = getScanEvents();
    setRecent(all.slice(0, 6));
    const today = new Date().toISOString().slice(0, 10);
    setTodayScans(all.filter((e) => e.scannedAt.slice(0, 10) === today));
    const todays = getFlights().filter((f) => f.departureDate === today);
    setTodayFlights(todays);
    setFlightsToday(todays.length);
    const unsub = subscribeSettings((next) => setSettings(next));
    setTimeout(() => inputRef.current?.focus(), 50);
    return unsub;
  }, [router]);

  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Refresh todayFlights & todayScans secara berkala + saat storage berubah
  // (mis. user buat flight baru di tab lain) supaya list "FLIGHT AKTIF" selalu
  // up-to-date tanpa harus reload halaman.
  React.useEffect(() => {
    const refresh = () => {
      // P-02: skip kerja saat tab tidak terlihat (hemat parse + re-render).
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      // P-02: getFlights() dipanggil SEKALI (sebelumnya 2×) lalu hasilnya dipakai ulang.
      const todays = getFlights().filter((f) => f.departureDate === today);
      setTodayFlights(todays);
      setFlightsToday(todays.length);
      const all = getScanEvents();
      setTodayScans(all.filter((e) => e.scannedAt.slice(0, 10) === today));
    };
    const id = window.setInterval(refresh, 5000);
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key.startsWith("afvs.")) refresh();
    };
    const onFocus = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Auto-sync FIDS → jadwal flight tiap 3 menit (silent). Kiosk fullscreen tak
  // pakai AppShell (yang punya auto-sync), jadi effect ini menjaga jadwal kerja
  // tetap ikut FIDS tanpa operator harus menarik manual. Gate: setting
  // fidsAutoSync + online. Pull menulis ke localStorage → refresh 5s memungutnya.
  React.useEffect(() => {
    const run = () => {
      if (!getSettings().fidsAutoSync) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      pullFidsKeberangkatan(todayDateString()).catch(() => {});
    };
    const first = window.setTimeout(run, 5000); // jeda setelah first paint
    const id = window.setInterval(run, 180_000); // 3 menit
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);

  // KTP-first: warm-up OCR engine saat mode dinyalakan (hindari lag baca pertama).
  React.useEffect(() => {
    if (settings.ktpScanFirst) initKtpOcr().catch(() => {});
  }, [settings.ktpScanFirst]);

  // KTP-first: loop pindai KTP di kamera utama saat idle (belum ada identitas &
  // belum scan). Saat NAMA terbaca → kunci sebagai identitas pending lalu berhenti.
  React.useEffect(() => {
    if (!settings.ktpScanFirst) return;
    if (!settings.faceCaptureEnabled) return; // butuh kamera hidup
    if (pendingKtp) return; // sudah ada identitas → tunggu boarding pass
    if (modalOpen || ktpFlow || ktpDecision) return; // jangan ganggu saat modal hasil terbuka
    const doc = getIdDoc(settings.idDocType); // crop + parser sesuai jenis dokumen
    let cancelled = false;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const run = async () => {
      while (!cancelled) {
        if (submittingRef.current) {
          await sleep(250);
          continue;
        }
        const cam = cameraRef.current;
        if (!cam || !cam.isReady()) {
          await sleep(250);
          continue;
        }
        const sharp = () =>
          cam.measureSharpness?.({
            region: doc.crop,
            aspect: KTP_CAPTURE_ASPECT,
          }) ?? 0;
        if (sharp() < KTP_SHARP_THRESHOLD) {
          await sleep(160);
          continue;
        }
        await sleep(110); // konfirmasi steady (anti motion-blur)
        if (cancelled) return;
        if (sharp() < KTP_SHARP_THRESHOLD) continue;
        const blob = await cam.captureFrame({
          width: 1200,
          height: 900, // 4:3 — samakan dgn display (WYSIWYG dgn kotak panduan)
          quality: 0.95,
          burst: 1,
        });
        if (cancelled) return;
        if (!blob) {
          await sleep(180);
          continue;
        }
        let res: { rawText: string; name: string | null };
        try {
          res = await recognizeIdName(blob, doc);
        } catch {
          res = { rawText: "", name: null };
        }
        if (cancelled) return;
        if (res.name) {
          const url = URL.createObjectURL(blob);
          setPendingKtp({
            name: res.name,
            rawText: res.rawText,
            photoUrl: url,
            capturedAt: Date.now(),
          });
          return; // berhenti; lanjut menunggu scan boarding pass
        }
        await sleep(200);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [settings.ktpScanFirst, settings.faceCaptureEnabled, settings.idDocType, pendingKtp, modalOpen, ktpFlow, ktpDecision]);

  // KTP-first: identitas pending kedaluwarsa setelah TTL bila tak ada scan.
  React.useEffect(() => {
    if (!pendingKtp) return;
    const t = window.setTimeout(() => {
      URL.revokeObjectURL(pendingKtp.photoUrl);
      setPendingKtp(null);
    }, KTP_PENDING_TTL_MS);
    return () => window.clearTimeout(t);
  }, [pendingKtp]);

  React.useEffect(() => {
    const t = window.setInterval(() => {
      const el = inputRef.current;
      if (!el) return;
      const active = document.activeElement as HTMLElement | null;
      if (active === el) return;
      // jangan rebut focus saat user sedang berinteraksi dengan kontrol form
      // (mis. dropdown webcam, tombol modal, atau input lain)
      if (active) {
        const tag = active.tagName;
        if (
          tag === "SELECT" ||
          tag === "OPTION" ||
          tag === "BUTTON" ||
          tag === "TEXTAREA" ||
          (tag === "INPUT" && active !== el)
        ) {
          return;
        }
        if (active.isContentEditable) return;
      }
      el.focus();
    }, 500);
    return () => window.clearInterval(t);
  }, []);

  const ktpFlowOpen = ktpFlow !== null || ktpDecision !== null;
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (ktpFlowOpen) return;
        if (modalOpen) setModalOpen(false);
        else router.push("/scan");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, modalOpen, ktpFlowOpen]);

  React.useEffect(() => {
    return () => {
      if (lastFaceUrlRef.current) {
        URL.revokeObjectURL(lastFaceUrlRef.current);
        lastFaceUrlRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    if (!modalOpen) return;
    const t = setTimeout(() => setModalOpen(false), MODAL_AUTO_CLOSE_MS);
    return () => clearTimeout(t);
  }, [modalOpen]);

  React.useEffect(() => {
    setOutbox(getOutboxSummary());
    return subscribeOutbox(() => setOutbox(getOutboxSummary()));
  }, []);

  // Poll face detection state from camera for HUD feedback
  React.useEffect(() => {
    const id = window.setInterval(() => {
      const cam = cameraRef.current;
      if (!cam) return;
      setFaceState(cam.getFaceState());
      setFaceDetectorSupported(cam.isFaceDetectionSupported());
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key.length === 1) {
      const t = performance.now();
      const arr = keyTimesRef.current;
      arr.push(t);
      if (arr.length > 12) arr.shift();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const times = keyTimesRef.current;
      if (times.length >= 6) {
        const span = times[times.length - 1] - times[0];
        const avg = span / (times.length - 1);
        setInputMode(avg < 30 ? "scanner" : "manual");
      } else {
        setInputMode("manual");
      }
      keyTimesRef.current = [];
      submit();
    }
  };

  const submit = async (rawInput?: string) => {
    if (!session) return;
    if (submittingRef.current) return;
    // Petugas belum memutuskan KTP zona "periksa manual" — tahan scan berikutnya.
    if (ktpDecision) return;
    const raw = rawInput ?? value;
    if (!raw.trim()) {
      setValue("");
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    submittingRef.current = true;

    // === Mode KTP-first: nama boarding pass dicocokkan ke KTP yang sudah dipindai
    // di kamera utama. Tanpa capture wajah, tanpa modal KTP (inline). ===
    if (settings.ktpScanFirst) {
      try {
        const { outcome, event } = processScan(raw, session.email);
        const pending = pendingKtpRef.current;
        const expectedName = outcome.parsed?.passengerName ?? null;
        let finalStatus = outcome.status;
        let finalMessage = outcome.message;
        // Zona "periksa manual": nama mirip tapi di bawah ambang auto-cocok →
        // petugas yang memutuskan (lihat setKtpDecision di bawah).
        let review: { ktpRes: KtpVerification; ocrName: string; expectedName: string } | null =
          null;

        // Jalur "Tanpa KTP" — one-shot, dikonsumsi saat scan ini.
        const isExempt = exemptNextRef.current;
        if (isExempt) setExemptNext(false);
        if (outcome.status === "VALID_FLIGHT") {
          if (isExempt) {
            // Lewati pencocokan KTP — petugas (scannedBy) mengonfirmasi identitas
            // secara visual/dokumen pendukung. Tandai exempted (tercatat untuk audit).
            const ktpRes: KtpVerification = {
              status: "exempted",
              ocrName: null,
              capturedAt: new Date().toISOString(),
              exemptReason: "other",
            };
            updateScanEvent(event.id, { ktpVerification: ktpRes });
            event.ktpVerification = ktpRes;
            // finalStatus tetap VALID_FLIGHT.
          } else if (pending && expectedName) {
            const sim = matchKtpName(pending.name, expectedName, {
              expectedTruncated: outcome.parsed?.passengerNameTruncated,
            });
            const matched = sim >= settings.ktpAutoPassThreshold;
            const ktpRes: KtpVerification = {
              status: matched ? "matched" : "mismatch",
              ocrName: pending.name,
              rawText: pending.rawText,
              similarity: sim,
              capturedAt: new Date(pending.capturedAt).toISOString(),
            };
            updateScanEvent(event.id, { ktpVerification: ktpRes });
            event.ktpVerification = ktpRes;
            // Mode KTP-first: nama WAJIB cocok. Tidak cocok → tolak (apa pun
            // setting ktpRequireForValid, karena pencocokan ini inti mode-nya),
            // kecuali zona "periksa manual" → petugas memutuskan. Sambil
            // menunggu, scan tetap tercatat DITOLAK (fail-safe bila tab ditutup).
            if (!matched) {
              const reviewable = sim >= settings.ktpManualThreshold;
              if (reviewable) review = { ktpRes, ocrName: pending.name, expectedName };
              finalStatus = "KTP_MISMATCH";
              finalMessage = reviewable
                ? `Menunggu keputusan petugas: nama KTP (${pending.name}) mirip boarding pass (${expectedName}).`
                : `Ditolak: nama KTP (${pending.name}) tidak cocok dengan boarding pass (${expectedName}).`;
              updateScanEvent(event.id, {
                resultStatus: finalStatus,
                message: finalMessage,
              });
              event.resultStatus = finalStatus;
              event.message = finalMessage;
            }
          } else {
            // Boarding pass valid tapi KTP belum dipindai → wajib di mode ini.
            finalStatus = "KTP_MISMATCH";
            finalMessage =
              "Ditolak: KTP belum dipindai. Tunjukkan KTP ke kamera lebih dulu.";
            updateScanEvent(event.id, {
              resultStatus: finalStatus,
              message: finalMessage,
            });
            event.resultStatus = finalStatus;
            event.message = finalMessage;
          }
        }

        // Foto KTP dipakai sebagai gambar hasil — kepemilikan URL dialihkan ke
        // lastFaceUrlRef di finish() (jangan revoke saat clear pendingKtp).
        const ktpPhotoUrl = pending?.photoUrl ?? null;
        setPendingKtp(null);

        const finish = (
          status: ScanResultStatus,
          message: string,
          manualPass = false,
        ) => {
          // Audio hasil scan (berhasil/gagal) dimatikan — cukup getar + visual.
          playFeedbackHaptic(status);
          setSessionStats((prev) =>
            status === "VALID_FLIGHT"
              ? { ...prev, valid: prev.valid + 1 }
              : status === "DUPLICATE_SCAN"
                ? { ...prev, duplicate: prev.duplicate + 1 }
                : { ...prev, rejected: prev.rejected + 1 },
          );
          if (status === "VALID_FLIGHT") {
            toast.success(
              `${outcome.flight?.flightNumber ?? "Flight"} · ${
                isExempt
                  ? "tanpa KTP"
                  : manualPass
                    ? "KTP diverifikasi manual"
                    : pending
                      ? "identitas terverifikasi"
                      : "tanpa KTP"
              }`,
              "Valid",
            );
          } else if (status === "DUPLICATE_SCAN") {
            toast.warning(message, "Duplicate");
          } else {
            toast.error(message, "Ditolak");
          }

          if (lastFaceUrlRef.current) {
            URL.revokeObjectURL(lastFaceUrlRef.current);
            lastFaceUrlRef.current = null;
          }
          lastFaceUrlRef.current = ktpPhotoUrl;

          setLast({
            event,
            flight: outcome.flight,
            parsed: outcome.parsed,
            flightNumber:
              outcome.flight?.flightNumber ?? outcome.parsed?.flightNumber ?? null,
            seat: outcome.parsed?.seatNumber ?? null,
            passengerName: outcome.parsed?.passengerName ?? null,
            route: outcome.flight
              ? `${outcome.flight.originAirport} → ${outcome.flight.destinationAirport}`
              : null,
            faceUrl: ktpPhotoUrl,
          });
          const all = getScanEvents();
          setRecent(all.slice(0, 6));
          const today = new Date().toISOString().slice(0, 10);
          setTodayScans(all.filter((e) => e.scannedAt.slice(0, 10) === today));
          setTodayFlights(getFlights().filter((f) => f.departureDate === today));
          setModalOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        };

        setValue("");
        if (review && ktpPhotoUrl) {
          const r = review;
          let decided = false; // cegah klik ganda tercatat dua kali
          setKtpDecision({
            ocrName: r.ocrName,
            expectedName: r.expectedName,
            similarity: r.ktpRes.similarity ?? 0,
            photoUrl: ktpPhotoUrl,
            decide: (accepted) => {
              if (decided) return;
              decided = true;
              const v: KtpVerification = {
                ...r.ktpRes,
                status: accepted ? "manual_pass" : "manual_reject",
              };
              const status: ScanResultStatus = accepted ? outcome.status : "KTP_MISMATCH";
              const message = accepted
                ? outcome.message
                : `Ditolak petugas: nama KTP (${r.ocrName}) tidak cocok dengan boarding pass (${r.expectedName}).`;
              updateScanEvent(event.id, {
                ktpVerification: v,
                resultStatus: status,
                message,
              });
              event.ktpVerification = v;
              event.resultStatus = status;
              event.message = message;
              setKtpDecision(null);
              finish(status, message, accepted);
            },
          });
          return;
        }
        finish(finalStatus, finalMessage);
      } finally {
        submittingRef.current = false;
      }
      return;
    }

    const captureEnabled = Boolean(
      settings.faceCaptureEnabled && cameraRef.current?.isReady(),
    );

    // Face validation gate
    if (
      captureEnabled &&
      settings.requireFaceForScan &&
      cameraRef.current?.isFaceDetectionSupported()
    ) {
      const fs = cameraRef.current.getFaceState();
      if (fs !== "ok") {
        const { title, body } = faceGateMessage(fs);
        toast.warning(body, title);
        playFeedbackSound("INVALID_BARCODE");
        playFeedbackHaptic("INVALID_BARCODE");
        setValue("");
        setTimeout(() => inputRef.current?.focus(), 0);
        submittingRef.current = false;
        return;
      }
    }

    const getFaceBlob = async (): Promise<Blob | null> => {
      if (!captureEnabled) return null;
      return (await cameraRef.current?.captureFrame()) ?? null;
    };

    try {
      const { outcome, event } = captureEnabled
        ? await processScanWithFace(raw, session.email, getFaceBlob)
        : processScan(raw, session.email);

      // KTP hanya diverifikasi kalau boarding pass punya NAMA untuk dicocokkan.
      // Tanpa nama, tidak ada yang bisa dibandingkan → lewati (jangan paksa gagal).
      const expectedNameForKtp = outcome.parsed?.passengerName ?? null;
      const willOpenKtp =
        outcome.status === "VALID_FLIGHT" &&
        settings.ktpVerifyEnabled &&
        !!expectedNameForKtp;
      // Bila KTP wajib & akan dibuka, tunda feedback "sukses" (suara/stats/toast)
      // sampai hasil OCR KTP keluar — supaya tidak terlanjur menyatakan "Valid"
      // padahal masih harus lolos verifikasi KTP. Feedback dilakukan di onClose
      // KtpVerifyModal.
      const requireKtpGate = willOpenKtp && settings.ktpRequireForValid;

      if (!requireKtpGate) {
        // Audio hasil scan (berhasil/gagal) dimatikan — cukup getar + visual.
        playFeedbackHaptic(outcome.status);

        setSessionStats((prev) => {
          if (outcome.status === "VALID_FLIGHT") return { ...prev, valid: prev.valid + 1 };
          if (outcome.status === "DUPLICATE_SCAN") return { ...prev, duplicate: prev.duplicate + 1 };
          return { ...prev, rejected: prev.rejected + 1 };
        });

        if (outcome.status === "VALID_FLIGHT") {
          toast.success(
            `${outcome.flight?.flightNumber ?? "Flight"} · seat ${outcome.parsed?.seatNumber ?? "—"}`,
            "Valid",
          );
        } else if (outcome.status === "DUPLICATE_SCAN") {
          toast.warning(outcome.message, "Duplicate - valid hari ini");
        } else {
          toast.error(outcome.message, "Rejected");
        }
      }

      if (lastFaceUrlRef.current) {
        URL.revokeObjectURL(lastFaceUrlRef.current);
        lastFaceUrlRef.current = null;
      }
      let faceUrl: string | null = null;
      if (event.faceCaptureId) {
        faceUrl = await facePhotoStore.getObjectUrl(event.faceCaptureId);
        lastFaceUrlRef.current = faceUrl;
      }

      setLast({
        event,
        flight: outcome.flight,
        parsed: outcome.parsed,
        flightNumber:
          outcome.flight?.flightNumber ?? outcome.parsed?.flightNumber ?? null,
        seat: outcome.parsed?.seatNumber ?? null,
        passengerName: outcome.parsed?.passengerName ?? null,
        route: outcome.flight
          ? `${outcome.flight.originAirport} → ${outcome.flight.destinationAirport}`
          : null,
        faceUrl,
      });
      const all = getScanEvents();
      setRecent(all.slice(0, 6));
      const today = new Date().toISOString().slice(0, 10);
      setTodayScans(all.filter((e) => e.scannedAt.slice(0, 10) === today));
      setTodayFlights(getFlights().filter((f) => f.departureDate === today));
      if (willOpenKtp) {
        setKtpFlow({
          eventId: event.id,
          expectedName: expectedNameForKtp,
          expectedNameTruncated: !!outcome.parsed?.passengerNameTruncated,
        });
      } else {
        setModalOpen(true);
      }
      setValue("");
      setTimeout(() => inputRef.current?.focus(), 0);
    } finally {
      submittingRef.current = false;
    }
  };

  const exitKiosk = () => router.push("/scan");
  // Browser hanya mengizinkan window.close() bila jendela dibuka oleh skrip
  // atau riwayatnya cuma 1 halaman; selain itu ditolak diam-diam → cek lalu
  // beri petunjuk tutup manual.
  const closeBrowser = () => {
    setCloseConfirm(false);
    window.close();
    setTimeout(() => {
      if (!window.closed) {
        toast.warning(
          "Browser tidak mengizinkan halaman menutup dirinya sendiri. Tekan Alt+F4 (atau Ctrl+W) untuk menutup.",
          "Tutup manual",
        );
        inputRef.current?.focus();
      }
    }, 300);
  };
  const toggleTheme = () => setTheme(isDark ? "airport" : "dark");
  const toggleSound = () => saveSettings({ soundOn: !settings.soundOn });

  const onForceSync = async () => {
    if (syncing) return;
    if (!settings.sikerenEnabled) {
      toast.info("Integrasi Sikeren belum diaktifkan di Settings.", "Sikeren off");
      return;
    }
    setSyncing(true);
    try {
      const res = await flushOutbox();
      if (res.sent > 0) {
        toast.success(`${res.sent} item terkirim ke Sikeren.`, "Sync OK");
      } else if (res.failed > 0) {
        toast.error(`${res.failed} item gagal.`, "Sync gagal");
      } else {
        toast.info("Tidak ada item untuk dikirim.", "Sikeren");
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleReset = () => {
    setModalOpen(false);
    setLast(null);
    setSessionStats({ valid: 0, duplicate: 0, rejected: 0 });
    setRecent([]);
    setValue("");
    if (lastFaceUrlRef.current) {
      URL.revokeObjectURL(lastFaceUrlRef.current);
      lastFaceUrlRef.current = null;
    }
    if (pendingKtp) {
      URL.revokeObjectURL(pendingKtp.photoUrl);
      setPendingKtp(null);
    }
    toast.success("Stats & riwayat tampilan dikosongkan", "Reset");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleDemoScan = async () => {
    if (demoLoading || submittingRef.current) return;
    setDemoLoading(true);
    try {
      // Kalau scan demo barusan VALID → klik berikutnya MENGULANG pass yang sama
      // (barcode identik) supaya menghasilkan DUPLICATE. Klik setelahnya acak lagi.
      if (
        lastDemoRawRef.current &&
        last?.event.resultStatus === "VALID_FLIGHT"
      ) {
        await submit(lastDemoRawRef.current);
        return;
      }
      const pick =
        SEED_BOARDING_PASSES[Math.floor(Math.random() * SEED_BOARDING_PASSES.length)];
      // Pastikan flight-nya ada & sedang boarding hari ini → hasil demo VALID
      // (bukan UNKNOWN_FLIGHT saat belum ada jadwal di-seed).
      ensureDemoBoardingFlight(pick);
      // Segarkan panel "FLIGHT AKTIF · BOARDING" tanpa tunggu polling 5 dtk.
      const today = new Date().toISOString().slice(0, 10);
      const todays = getFlights().filter((f) => f.departureDate === today);
      setTodayFlights(todays);
      setFlightsToday(todays.length);
      const raw = buildPayload(pick);
      lastDemoRawRef.current = raw;
      await submit(raw);
    } finally {
      setDemoLoading(false);
    }
  };

  const lastMeta = last ? STATUS_META[last.event.resultStatus] : null;

  // Sebelum mounted: render shell kosong (sama di server & client) → no mismatch.
  if (!mounted) {
    return <div className="h-screen bg-[#eef3fb] dark:bg-[#0a1226]" />;
  }

  return (
    <div
      className={cn(
        "relative flex h-screen flex-col overflow-clip transition-colors",
        "bg-[#eef3fb] text-slate-800",
        "dark:bg-[#0a1226] dark:text-white",
      )}
    >
      {/* Background grid + glow (dark only) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden opacity-[0.18] dark:block"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(56,189,248,0.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(56,189,248,0.18) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse at center, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 80%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 top-1/4 h-[420px] w-[420px] rounded-full bg-cyan-400/20 blur-3xl dark:bg-cyan-500/15"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 top-1/2 h-[380px] w-[380px] rounded-full bg-blue-400/20 blur-3xl dark:bg-blue-600/15"
      />

      {/* Header */}
      <header className="relative z-30 flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 text-white shadow-lg shadow-cyan-500/40 ring-1 ring-white/40">
            <span className="pointer-events-none absolute -inset-1 rounded-2xl bg-cyan-400/30 blur-md" />
            <ShieldCheck className="relative h-5 w-5" />
            {/* dot online berkedip */}
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-[#eef3fb] dark:ring-[#0a1226]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            </span>
          </span>
          <div>
            <h1 className="text-[13px] font-black tracking-[0.18em]">
              KIOSK MODE
              <span className="mx-1.5 text-slate-400 dark:text-white/30">·</span>
              <span className="text-cyan-600 dark:text-cyan-300">POS VALIDASI</span>
            </h1>
            <p className="text-[10.5px] tracking-wider text-slate-500 dark:text-white/55">
              {session?.name ?? "—"} · {flightsToday} flight hari ini
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {settings.sikerenEnabled && (
            <SikerenSyncChip
              summary={outbox}
              syncing={syncing}
              onClick={onForceSync}
            />
          )}
          <ScannerStatusBadge mode={inputMode} />
          <ClockChip now={now} />
          <KioskMenu
            isDark={isDark}
            soundOn={settings.soundOn}
            onToggleSound={toggleSound}
            onToggleTheme={toggleTheme}
            onExit={exitKiosk}
            onCloseBrowser={() => setCloseConfirm(true)}
          />
        </div>
      </header>

      {/* Hidden input */}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
        aria-label="Scanner input"
        className="pointer-events-none fixed -left-[9999px] top-0 h-px w-px opacity-0"
      />

      {/* Main grid */}
      <main className="relative z-10 grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 pb-6 pt-2 lg:overflow-visible lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:[grid-template-rows:minmax(0,1fr)]">
        {/* Kiri (penumpang): status scan + panduan bergilir */}
        <section className="flex flex-col gap-4 lg:min-h-0">
          <ScanReadyCard
            ktpFirst={settings.ktpScanFirst}
            pendingName={pendingKtp?.name ?? null}
          />
          <ActionRow
            onReset={handleReset}
            onDemo={handleDemoScan}
            demoLoading={demoLoading}
            showExempt={settings.ktpScanFirst && settings.allowNoKtpExemption}
            exemptActive={exemptNext}
            onToggleExempt={() => setExemptNext(!exemptNextRef.current)}
          />
          <PassengerGuideCarousel paused={modalOpen} />
        </section>

        {/* Kanan (petugas AVSEC): statistik shift + flight aktif */}
        <section className="flex flex-col gap-4 lg:min-h-0">
          <ShiftStatsCard scans={todayScans} now={now} />
          <ActiveFlightCards
            flights={todayFlights}
            scans={todayScans}
            now={now}
            settings={settings}
            highlightFlightId={last?.event.flightId ?? null}
            onMore={() =>
              router.push(session?.role === "security" ? "/scan" : "/scan-events")
            }
          />
        </section>
      </main>

      {/* Ticker info berjalan (bawah) — pengingat keamanan/instruksi, gaya kalem. */}
      <KioskTicker />

      {/* Result Modal */}
      {last && lastMeta && (() => {
        const isValid =
          last.event.resultStatus === "VALID_FLIGHT" &&
          last.flight &&
          last.parsed;
        const airlineCode = last.flight?.airlineCode ?? null;
        const tone: ModalToneName = isValid
          ? airlineToneFor(airlineCode)
          : lastMeta.modalTone;
        const barGradient = isValid
          ? airlineBarFor(airlineCode)
          : ACCENT_BAR[lastMeta.modalTone];
        return (
          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            tone={tone}
            size={isValid ? "xl" : "lg"}
            icon={lastMeta.icon}
            title={
              <span className="text-xl font-black tracking-tight">
                {lastMeta.label}
              </span>
            }
            description={last.event.message}
            footer={
              <ModalCloseFooter
                onClose={() => setModalOpen(false)}
                barGradient={barGradient}
                durationMs={MODAL_AUTO_CLOSE_MS}
                resetKey={last.event.id}
              />
            }
          >
            {isValid ? (
              <BoardingPassModalBody last={last} />
            ) : (
              <ResultModalBody last={last} meta={lastMeta} />
            )}
          </Modal>
        );
      })()}

      {/* KTP-first: nama di zona "periksa manual" — petugas wajib memutuskan
          (tanpa tombol tutup / ESC, supaya tak terlewat tanpa keputusan). */}
      <Modal
        open={ktpDecision !== null}
        onClose={() => {}}
        closeOnBackdrop={false}
        hideClose
        tone="warning"
        size="lg"
        title="Periksa KTP manual"
        icon={<IdCard className="h-5 w-5" />}
      >
        {ktpDecision && (
          <div className="space-y-4 p-1">
            <p className="rounded-2xl bg-amber-50 px-4 py-3 text-[13px] leading-snug text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30">
              Nama mirip tapi tidak identik (
              <b className="tabular-nums">{Math.round(ktpDecision.similarity * 100)}%</b>{" "}
              kemiripan). Bandingkan KTP penumpang dengan boarding pass, lalu putuskan.
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={ktpDecision.photoUrl}
              alt="KTP yang dipindai"
              className="h-40 w-full rounded-xl bg-slate-50 object-contain dark:bg-surface-elev"
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-surface-elev">
                <div className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">
                  Boarding Pass
                </div>
                <div className="mt-0.5 text-[14px] font-bold text-ink">
                  {ktpDecision.expectedName.toUpperCase()}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-surface-elev">
                <div className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">
                  KTP (OCR)
                </div>
                <div className="mt-0.5 text-[14px] font-bold text-ink">
                  {ktpDecision.ocrName.toUpperCase()}
                </div>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => ktpDecision.decide(false)}
                className="rounded-2xl bg-rose-600 px-3 py-2.5 text-[13px] font-bold text-white hover:bg-rose-700"
              >
                Tolak
              </button>
              <button
                type="button"
                onClick={() => ktpDecision.decide(true)}
                className="rounded-2xl bg-blue-600 px-3 py-2.5 text-[13px] font-bold text-white hover:bg-blue-700"
              >
                Cocok (manual)
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={closeConfirm}
        onClose={() => {
          setCloseConfirm(false);
          inputRef.current?.focus();
        }}
        tone="danger"
        size="sm"
        title="Tutup browser?"
        icon={<Power className="h-5 w-5" />}
      >
        <div className="space-y-4 p-1">
          <p className="text-[13px] leading-snug text-slate-600 dark:text-ink-muted">
            Layar kiosk akan ditutup dan scanner tidak menerima boarding pass
            sampai browser dibuka kembali.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setCloseConfirm(false);
                inputRef.current?.focus();
              }}
              className="rounded-2xl bg-slate-100 px-3 py-2.5 text-[13px] font-bold text-slate-700 hover:bg-slate-200 dark:bg-white/10 dark:text-white/80 dark:hover:bg-white/15"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={closeBrowser}
              className="rounded-2xl bg-rose-600 px-3 py-2.5 text-[13px] font-bold text-white hover:bg-rose-700"
            >
              Tutup Browser
            </button>
          </div>
        </div>
      </Modal>

      <KtpVerifyModal
        open={ktpFlow !== null}
        expectedName={ktpFlow?.expectedName ?? null}
        expectedNameTruncated={ktpFlow?.expectedNameTruncated ?? false}
        cameraRef={cameraRef}
        autoPassThreshold={settings.ktpAutoPassThreshold}
        manualThreshold={settings.ktpManualThreshold}
        requireMatch={settings.ktpVerifyEnabled && settings.ktpRequireForValid}
        onClose={(result) => {
          if (ktpFlow && result) {
            updateScanEvent(ktpFlow.eventId, { ktpVerification: result });
            const requireKtp =
              settings.ktpVerifyEnabled && settings.ktpRequireForValid;
            const passed =
              result.status === "matched" || result.status === "manual_pass";

            if (requireKtp && !passed) {
              // BLOKIR: KTP wajib cocok tapi gagal → turunkan scan jadi tidak valid.
              // Pesan sesuai PENYEBAB — penting untuk audit: "dilewati" bukan
              // berarti nama tidak cocok.
              const [msg, title] =
                result.status === "ocr_failed"
                  ? ["Ditolak: KTP tidak terbaca, verifikasi nama gagal.", "KTP tidak terbaca"]
                  : result.status === "skipped"
                    ? [
                        "Ditolak: verifikasi KTP dilewati, padahal KTP wajib untuk validasi.",
                        "KTP dilewati",
                      ]
                    : result.status === "manual_reject"
                      ? ["Ditolak petugas: nama KTP tidak cocok dengan boarding pass.", "KTP ditolak"]
                      : ["Ditolak: nama KTP tidak cocok dengan boarding pass.", "KTP tidak cocok"];
              updateScanEvent(ktpFlow.eventId, {
                resultStatus: "KTP_MISMATCH",
                message: msg,
              });
              setLast((prev) =>
                prev && prev.event.id === ktpFlow.eventId
                  ? {
                      ...prev,
                      event: {
                        ...prev.event,
                        resultStatus: "KTP_MISMATCH",
                        message: msg,
                      },
                    }
                  : prev,
              );
              setSessionStats((prev) => ({ ...prev, rejected: prev.rejected + 1 }));
              playFeedbackHaptic("KTP_MISMATCH");
              toast.error(msg, title);
            } else if (requireKtp && passed) {
              // LOLOS: berikan feedback sukses yang tadi ditunda di submit().
              setSessionStats((prev) => ({ ...prev, valid: prev.valid + 1 }));
              playFeedbackHaptic("VALID_FLIGHT");
              if (result.status === "manual_pass") {
                toast.info("KTP diverifikasi manual oleh operator.", "KTP Manual");
              } else {
                toast.success("Nama KTP cocok.", "KTP OK");
              }
            } else {
              // KTP advisory (tidak wajib) — feedback sukses sudah jalan di submit().
              if (result.status === "manual_reject") {
                toast.error("Nama KTP tidak cocok dengan boarding pass.", "KTP Reject");
              } else if (result.status === "matched") {
                toast.success("Nama KTP cocok.", "KTP OK");
              } else if (result.status === "manual_pass") {
                toast.info("KTP diverifikasi manual oleh operator.", "KTP Manual");
              }
            }
          }
          setKtpFlow(null);
          setModalOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
      />
    </div>
  );
}

/* ─────────────── Ticker info berjalan (footer) ─────────────── */

const TICKER_ITEMS = [
  "Siapkan boarding pass & KTP/Paspor sebelum menuju pos pemeriksaan",
  "Dilarang membawa benda tajam, cairan >100 ml, dan barang berbahaya ke kabin",
  "Powerbank wajib dibawa di kabin, tidak boleh di bagasi",
  "Pastikan nama di boarding pass sesuai dengan identitas penumpang",
  "Ikuti arahan petugas AVSEC di setiap titik pemeriksaan keamanan",
];

/* ─────────────── Panduan penumpang (carousel) ─────────────── */

type GuideTone = "cyan" | "rose" | "amber";

interface GuideSlide {
  id: string;
  eyebrow: string;
  title: string;
  tone: GuideTone;
  /** steps = langkah bernomor; grid = ikon kecil 3 kolom; info = 2 kartu besar */
  kind: "steps" | "grid" | "info";
  items: { icon: React.ElementType; label: string; sub: string }[];
}

const GUIDE_SLIDES: GuideSlide[] = [
  {
    id: "cara-scan",
    eyebrow: "Cara Validasi",
    title: "3 langkah mudah di pos ini",
    tone: "cyan",
    kind: "steps",
    items: [
      { icon: Ticket, label: "Siapkan boarding pass", sub: "Cetak atau tampilkan di ponsel" },
      { icon: ScanLine, label: "Arahkan barcode ke scanner", sub: "Tahan tenang ±10 cm di depan scanner" },
      { icon: CheckCircle2, label: "Lihat hasil di layar", sub: "Hijau = silakan lanjut ke ruang tunggu" },
    ],
  },
  {
    id: "terlarang",
    eyebrow: "Barang Terlarang di Kabin",
    title: "Jangan dibawa ke kabin pesawat",
    tone: "rose",
    kind: "grid",
    items: [
      { icon: Scissors, label: "Benda tajam", sub: "Pisau, gunting, cutter" },
      { icon: Droplets, label: "Cairan > 100 ml", sub: "Per wadah" },
      { icon: Flame, label: "Mudah terbakar", sub: "Bensin, spiritus, kembang api" },
      { icon: SprayCan, label: "Aerosol", sub: "Semprotan bertekanan" },
      { icon: Hammer, label: "Perkakas", sub: "Palu, obeng, kunci" },
      { icon: ShieldAlert, label: "Senjata & replika", sub: "Termasuk mainan mirip senjata" },
    ],
  },
  {
    id: "powerbank",
    eyebrow: "Baterai & Powerbank",
    title: "Powerbank wajib dibawa di kabin",
    tone: "amber",
    kind: "info",
    items: [
      {
        icon: BatteryCharging,
        label: "Bawa di kabin",
        sub: "Powerbank & baterai lithium cadangan tidak boleh masuk bagasi.",
      },
      {
        icon: Luggage,
        label: "Batas kapasitas",
        sub: "Maks. 160 Wh. Di atas 100 Wh perlu persetujuan maskapai.",
      },
    ],
  },
  {
    id: "dokumen",
    eyebrow: "Dokumen Perjalanan",
    title: "Siapkan sebelum antre",
    tone: "cyan",
    kind: "info",
    items: [
      {
        icon: Ticket,
        label: "Boarding pass",
        sub: "Barcode, nama, dan nomor penerbangan harus terbaca jelas.",
      },
      {
        icon: IdCard,
        label: "Identitas asli",
        sub: "KTP / Paspor / SIM dengan nama sesuai boarding pass.",
      },
    ],
  },
];

const GUIDE_INTERVAL_MS = 8000;

const GUIDE_TONE: Record<GuideTone, { eyebrow: string; chip: string }> = {
  cyan: {
    eyebrow: "text-cyan-700 dark:text-cyan-300",
    chip: "bg-cyan-500/10 text-cyan-600 ring-cyan-500/25 dark:bg-cyan-400/15 dark:text-cyan-300 dark:ring-cyan-400/30",
  },
  rose: {
    eyebrow: "text-rose-600 dark:text-rose-300",
    chip: "bg-rose-500/10 text-rose-600 ring-rose-500/25 dark:bg-rose-400/15 dark:text-rose-300 dark:ring-rose-400/30",
  },
  amber: {
    eyebrow: "text-amber-700 dark:text-amber-300",
    chip: "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:bg-amber-400/15 dark:text-amber-300 dark:ring-amber-400/30",
  },
};

/**
 * Panduan untuk penumpang yang antre: cara scan, barang terlarang, powerbank,
 * dokumen. Bergilir otomatis; berhenti saat modal hasil scan terbuka supaya
 * tidak ada gerakan di belakang hasil. Reduced-motion → hanya fade.
 */
function PassengerGuideCarousel({ paused }: { paused: boolean }) {
  const [idx, setIdx] = React.useState(0);
  const reduce = useReducedMotion();

  React.useEffect(() => {
    if (paused) return;
    const t = setTimeout(
      () => setIdx((i) => (i + 1) % GUIDE_SLIDES.length),
      GUIDE_INTERVAL_MS,
    );
    return () => clearTimeout(t);
  }, [idx, paused]);

  const slide = GUIDE_SLIDES[idx];
  const tone = GUIDE_TONE[slide.tone];

  return (
    <div className="relative flex min-h-[260px] flex-1 flex-col overflow-hidden rounded-3xl bg-white/80 px-6 py-5 [@media(max-height:860px)]:py-4 ring-1 ring-slate-200 backdrop-blur-md dark:bg-[#0c1a36] dark:ring-cyan-400/15">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-white/50">
          Panduan Penumpang
        </span>
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Pilih panduan">
          {GUIDE_SLIDES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === idx}
              aria-label={s.eyebrow}
              onClick={() => setIdx(i)}
              className="flex h-6 items-center px-0.5"
            >
              <span
                className={cn(
                  "block h-1.5 rounded-full transition-all",
                  i === idx
                    ? "w-6 bg-cyan-500 dark:bg-cyan-400"
                    : "w-1.5 bg-slate-300 hover:bg-slate-400 dark:bg-white/20 dark:hover:bg-white/35",
                )}
              />
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={slide.id}
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: 28 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: -28 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="mt-3 flex min-h-0 flex-1 flex-col"
        >
          <p className={cn("text-[11px] font-black uppercase tracking-[0.16em]", tone.eyebrow)}>
            {slide.eyebrow}
          </p>
          <h2 className="mt-0.5 text-2xl font-black tracking-tight text-slate-800 [@media(max-height:860px)]:text-xl dark:text-white">
            {slide.title}
          </h2>

          {slide.kind === "steps" && (
            <ol className="mt-4 grid flex-1 gap-3 [@media(max-height:860px)]:mt-3 sm:grid-cols-3">
              {slide.items.map((it, i) => {
                const Icon = it.icon;
                return (
                  <li
                    key={it.label}
                    className="relative flex flex-col items-center justify-center gap-2 rounded-2xl bg-slate-50 px-3 py-4 [@media(max-height:860px)]:py-2.5 text-center ring-1 ring-slate-200/80 dark:bg-white/5 dark:ring-white/10"
                  >
                    <span className="absolute left-3 top-2.5 text-[11px] font-black text-slate-400 dark:text-white/35">
                      {i + 1}
                    </span>
                    <span className={cn("flex h-14 w-14 items-center justify-center rounded-2xl ring-1", tone.chip)}>
                      <Icon className="h-7 w-7" />
                    </span>
                    <span className="text-[15px] font-bold leading-tight text-slate-800 dark:text-white">
                      {it.label}
                    </span>
                    <span className="text-[12px] leading-snug text-slate-500 dark:text-white/55">
                      {it.sub}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          {slide.kind === "grid" && (
            <ul className="mt-4 grid flex-1 grid-cols-2 gap-3 [@media(max-height:860px)]:mt-3 [@media(max-height:860px)]:gap-2 sm:grid-cols-3">
              {slide.items.map((it) => {
                const Icon = it.icon;
                return (
                  <li
                    key={it.label}
                    className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-3 [@media(max-height:860px)]:py-2 ring-1 ring-slate-200/80 dark:bg-white/5 dark:ring-white/10"
                  >
                    <span className={cn("relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1", tone.chip)}>
                      <Icon className="h-5 w-5" />
                      {/* garis coret "dilarang" */}
                      <span aria-hidden className="absolute h-0.5 w-9 rotate-45 rounded-full bg-rose-500/80" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-bold leading-tight text-slate-800 dark:text-white">
                        {it.label}
                      </span>
                      <span className="block text-[11.5px] leading-snug text-slate-500 dark:text-white/55">
                        {it.sub}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {slide.kind === "info" && (
            <ul className="mt-4 grid flex-1 gap-3 [@media(max-height:860px)]:mt-3 sm:grid-cols-2">
              {slide.items.map((it) => {
                const Icon = it.icon;
                return (
                  <li
                    key={it.label}
                    className="flex flex-col justify-center gap-3 [@media(max-height:860px)]:gap-2 rounded-2xl bg-slate-50 px-5 py-4 [@media(max-height:860px)]:py-3 ring-1 ring-slate-200/80 dark:bg-white/5 dark:ring-white/10"
                  >
                    <span className={cn("flex h-12 w-12 items-center justify-center rounded-2xl ring-1", tone.chip)}>
                      <Icon className="h-6 w-6" />
                    </span>
                    <span className="text-[17px] font-black leading-tight text-slate-800 dark:text-white">
                      {it.label}
                    </span>
                    <span className="text-[13px] leading-snug text-slate-500 dark:text-white/60">
                      {it.sub}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ─────────────── Statistik shift (untuk petugas AVSEC) ─────────────── */

function ShiftStatsCard({ scans, now }: { scans: ScanEvent[]; now: Date }) {
  const stats = React.useMemo(() => {
    let valid = 0;
    let duplicate = 0;
    let rejected = 0;
    let lastHour = 0;
    const hourly = new Array<number>(24).fill(0);
    const nowMs = now.getTime();
    const localDay = now.toDateString();
    let firstHour = 24;
    for (const e of scans) {
      if (e.resultStatus === "VALID_FLIGHT") valid++;
      else if (e.resultStatus === "DUPLICATE_SCAN") duplicate++;
      else rejected++;
      const d = new Date(e.scannedAt);
      if (nowMs - d.getTime() <= 3_600_000) lastHour++;
      // Grafik per jam hanya untuk hari lokal yang sama (todayScans difilter
      // berdasarkan tanggal UTC).
      if (d.toDateString() === localDay) {
        const h = d.getHours();
        hourly[h]++;
        if (h < firstHour) firstHour = h;
      }
    }
    const curHour = now.getHours();
    const start = Math.max(0, Math.min(firstHour, curHour - 5));
    const bars: { hour: number; n: number }[] = [];
    for (let h = start; h <= curHour; h++) bars.push({ hour: h, n: hourly[h] });
    const max = Math.max(1, ...bars.map((b) => b.n));
    return { valid, duplicate, rejected, total: scans.length, lastHour, bars, max };
  }, [scans, now]);

  const hasData = stats.bars.some((b) => b.n > 0);
  const curHour = now.getHours();

  return (
    <div className="shrink-0 rounded-3xl bg-white/80 px-5 py-4 ring-1 ring-slate-200 backdrop-blur-md dark:bg-[#0c1a36] dark:ring-cyan-400/15">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-white/50">
          <BarChart3 className="h-3.5 w-3.5" />
          Statistik Shift Hari Ini
        </span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-slate-600 dark:bg-white/5 dark:text-white/65">
          <b className="font-black text-slate-800 dark:text-white">{stats.lastHour}</b> scan / jam terakhir
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          label="Valid"
          value={stats.valid}
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          dot="text-emerald-500"
        />
        <StatTile
          label="Duplikat"
          value={stats.duplicate}
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          dot="text-amber-500"
        />
        <StatTile
          label="Ditolak"
          value={stats.rejected}
          icon={<XCircle className="h-3.5 w-3.5" />}
          dot="text-rose-500"
        />
        <StatTile
          label="Total"
          value={stats.total}
          icon={<ScanLine className="h-3.5 w-3.5" />}
          dot="text-cyan-500"
        />
      </div>

      {/* Grafik batang: jumlah scan per jam (satu seri, satu hue) */}
      <div className="mt-4">
        <div className="relative flex h-20 items-end gap-1.5 border-b border-slate-200 dark:border-white/10">
          {!hasData && (
            <span className="absolute inset-0 flex items-center justify-center text-[11.5px] text-slate-400 dark:text-white/40">
              Belum ada scan hari ini
            </span>
          )}
          {stats.bars.map((b) => {
            const isNow = b.hour === curHour;
            const pct = (b.n / stats.max) * 100;
            const hh = String(b.hour).padStart(2, "0");
            return (
              <div
                key={b.hour}
                className="group relative flex h-full flex-1 items-end justify-center"
              >
                {/* label nilai hanya untuk jam berjalan (label selektif) */}
                {isNow && b.n > 0 && (
                  <span
                    className="absolute left-1/2 -translate-x-1/2 text-[10px] font-bold tabular-nums text-slate-600 dark:text-white/70"
                    style={{ bottom: `calc(${pct}% + 2px)` }}
                  >
                    {b.n}
                  </span>
                )}
                <div
                  className={cn(
                    "w-full max-w-[28px] rounded-t-[4px] transition-[height] duration-500",
                    isNow ? "bg-cyan-500 dark:bg-cyan-400" : "bg-cyan-500/45 dark:bg-cyan-400/40",
                    "group-hover:bg-cyan-600 dark:group-hover:bg-cyan-300",
                  )}
                  style={{ height: b.n > 0 ? `max(${pct}%, 4px)` : "0px" }}
                />
                {/* tooltip hover */}
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white shadow-lg group-hover:block dark:bg-white dark:text-slate-900">
                  {hh}:00–{hh}:59 · {b.n} scan
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex gap-1.5">
          {stats.bars.map((b, i) => (
            <span
              key={b.hour}
              className={cn(
                "flex-1 text-center text-[10px] tabular-nums",
                b.hour === curHour
                  ? "font-bold text-slate-700 dark:text-white/80"
                  : "text-slate-400 dark:text-white/40",
              )}
            >
              {stats.bars.length <= 12 || i % 2 === 0 || b.hour === curHour
                ? String(b.hour).padStart(2, "0")
                : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  icon,
  dot,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  dot: string;
}) {
  const shown = useCountUp(value);
  return (
    <div className="rounded-2xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200/80 dark:bg-white/5 dark:ring-white/10">
      <span className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-white/55">
        <span className={dot}>{icon}</span>
        {label}
      </span>
      <span className="mt-0.5 block text-2xl font-black tabular-nums text-slate-800 dark:text-white">
        {shown}
      </span>
    </div>
  );
}

/**
 * Running-text kalem untuk mengisi bawah layar kiosk: pengingat keamanan &
 * instruksi. Track digandakan 2x lalu digeser -50% (animate-marquee) supaya
 * loop mulus. Bukan "warning" merah berkedip — gaya brand yang tenang.
 * motion-reduce → diam (hormati prefers-reduced-motion).
 */
function KioskTicker() {
  const Row = () => (
    <div className="flex shrink-0 items-center pr-2" aria-hidden>
      {TICKER_ITEMS.map((t, i) => (
        <span key={i} className="flex items-center whitespace-nowrap">
          {/* pemisah diamond antar item */}
          <span className="mx-5 inline-block h-1.5 w-1.5 rotate-45 rounded-[2px] bg-cyan-400/70" />
          <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-600 dark:text-slate-200">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-cyan-500" />
            {t}
          </span>
        </span>
      ))}
    </div>
  );
  return (
    <footer className="relative z-20 shrink-0 overflow-hidden border-t border-slate-200/70 bg-gradient-to-r from-slate-50 via-white to-slate-50 dark:border-white/10 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/* garis aksen gradient beranimasi di atas */}
      <div className="h-0.5 w-full animate-gradient-shift bg-[length:200%_100%] bg-[linear-gradient(90deg,#06b6d4,#3b82f6,#22d3ee,#06b6d4)]" />
      <div className="flex items-stretch">
        {/* Label tetap di kiri — chip gradient + dot live + glow */}
        <div className="relative z-10 flex shrink-0 items-center gap-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 py-2.5 pl-4 pr-5 text-white shadow-[0_0_24px_rgba(6,182,212,0.35)]">
          <span className="relative flex h-2 w-2 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/80" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
          </span>
          <Megaphone className="h-4 w-4" />
          <span className="text-[11px] font-extrabold uppercase tracking-[0.15em]">
            Info Bandara
          </span>
          {/* ekor miring biar nyambung mulus ke track */}
          <span className="pointer-events-none absolute -right-3 top-0 h-full w-3 skew-x-[-12deg] bg-blue-600" />
        </div>
        {/* Marquee */}
        <div className="relative flex-1 overflow-hidden py-2.5">
          <div className="flex w-max animate-marquee motion-reduce:animate-none">
            <Row />
            <Row />
          </div>
          {/* fade tepi kiri/kanan biar teks muncul/hilang halus */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-white to-transparent dark:from-slate-900" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-slate-50 to-transparent dark:from-slate-950" />
        </div>
      </div>
    </footer>
  );
}

/* ─────────────── Scan ready card with audio waveform ─────────────── */

function ScanReadyCard({
  ktpFirst = false,
  pendingName = null,
}: {
  ktpFirst?: boolean;
  pendingName?: string | null;
}) {
  // 3 keadaan: (a) KTP-first menunggu KTP, (b) KTP terbaca menunggu boarding pass,
  // (c) normal menunggu boarding pass.
  const identityReady = ktpFirst && !!pendingName;
  const waitingKtp = ktpFirst && !pendingName;

  const icon = identityReady ? (
    <CheckCircle2 className="h-7 w-7" />
  ) : waitingKtp ? (
    <IdCard className="h-7 w-7" />
  ) : (
    <Scan className="h-7 w-7" />
  );
  const chip = identityReady
    ? "from-emerald-400 to-teal-600 shadow-emerald-500/40"
    : "from-cyan-400 to-blue-600 shadow-cyan-500/40";
  const title = identityReady
    ? pendingName
    : waitingKtp
      ? "ARAHKAN KTP"
      : "MENUNGGU SCAN…";
  const subtitle = identityReady
    ? "Identitas terbaca — sekarang scan boarding pass penumpang."
    : waitingKtp
      ? "Tunjukkan KTP ke kamera untuk membaca identitas penumpang."
      : "Arahkan scanner USB ke boarding pass untuk memulai validasi.";

  return (
    <div className="relative shrink-0 overflow-hidden rounded-3xl bg-white/80 px-6 py-5 [@media(max-height:860px)]:py-4 ring-1 ring-slate-200 backdrop-blur-md dark:bg-[#0c1a36] dark:ring-cyan-400/15">
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-cyan-50/40 via-transparent to-blue-50/40 dark:from-cyan-500/5 dark:to-blue-500/5"
      />
      <div className="relative flex flex-col items-center gap-4 [@media(max-height:860px)]:gap-3">
        {/* layar pendek: gelombang disembunyikan agar panduan kebagian ruang */}
        <div className="[@media(max-height:860px)]:hidden">
          <Waveform />
        </div>
        <span
          className={cn(
            "relative flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-xl",
            chip,
          )}
        >
          {icon}
          <span
            aria-hidden
            className={cn(
              "absolute inset-0 rounded-2xl animate-ping",
              identityReady ? "bg-emerald-300/40" : "bg-cyan-300/40",
            )}
          />
        </span>
        <div className="text-center">
          {identityReady && (
            <p className="mb-0.5 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-300">
              Identitas KTP
            </p>
          )}
          <p className="text-xl font-black tracking-tight">{title}</p>
          <p className="mt-1.5 max-w-sm text-[12px] leading-snug text-slate-500 dark:text-white/55">
            {subtitle}
          </p>
        </div>
      </div>
    </div>
  );
}

function Waveform() {
  // 32 batang vertikal, tinggi deterministik, animasi via delay CSS
  const bars = React.useMemo(
    () =>
      Array.from({ length: 32 }, (_, i) => {
        const seed = Math.sin(i * 1.7) * 0.5 + 0.5;
        const h = 30 + Math.round(seed * 70);
        const delay = (i % 10) * 80;
        return { h, delay };
      }),
    [],
  );
  return (
    <div className="flex h-16 items-center gap-1.5">
      {bars.map((b, i) => (
        <span
          key={i}
          className="block w-[3px] rounded-full bg-gradient-to-t from-cyan-500/70 to-cyan-300/90 animate-wave dark:from-cyan-500/70 dark:to-cyan-200"
          style={{
            height: `${b.h}%`,
            animationDelay: `${b.delay}ms`,
          }}
        />
      ))}
    </div>
  );
}

/* ─────────────── Active flight cards ─────────────── */

interface FlightCardData {
  flight: Flight;
  effectiveStatus: "OPEN" | "ACTIVE";
  boarded: number;
  lastScanAt: number;
}

function ActiveFlightCards({
  flights,
  scans,
  now,
  settings,
  highlightFlightId,
  onMore,
}: {
  flights: Flight[];
  scans: ScanEvent[];
  now: Date;
  settings: AppSettings;
  highlightFlightId: string | null;
  onMore: () => void;
}) {
  const cards: FlightCardData[] = React.useMemo(() => {
    const validScans = scans.filter(
      (e) => e.resultStatus === "VALID_FLIGHT" && e.flightId,
    );
    return flights
      .map((flight) => {
        // Pakai stored status sebagai dasar tampilan (kalau supervisor mark
        // OPEN/ACTIVE manual, harus tetap muncul di kiosk walaupun window
        // auto-close lewat). Effective hanya jadi badge tambahan.
        const eff = getEffectiveFlightStatus(flight, now, settings);
        const isBoardable =
          flight.status === "OPEN" ||
          flight.status === "ACTIVE" ||
          eff.status === "OPEN" ||
          eff.status === "ACTIVE";
        if (!isBoardable) return null;
        const fScans = validScans
          .filter((e) => e.flightId === flight.id)
          .sort(
            (a, b) =>
              new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime(),
          );
        const lastAt = fScans[0]
          ? new Date(fScans[0].scannedAt).getTime()
          : 0;
        // Tampilkan badge "OPEN" untuk semua yang lolos filter — kalau
        // stored OPEN/ACTIVE tapi effective lain (CLOSED), tetap OPEN biar
        // konsisten dengan list /flights.
        const displayStatus: "OPEN" | "ACTIVE" =
          flight.status === "ACTIVE" || eff.status === "ACTIVE"
            ? "ACTIVE"
            : "OPEN";
        return {
          flight,
          effectiveStatus: displayStatus,
          boarded: fScans.length,
          lastScanAt: lastAt,
        };
      })
      .filter((c): c is FlightCardData => c !== null)
      .sort((a, b) => {
        // ACTIVE first, then by most-recent scan, then by STD
        if (a.effectiveStatus !== b.effectiveStatus) {
          return a.effectiveStatus === "ACTIVE" ? -1 : 1;
        }
        if (a.lastScanAt !== b.lastScanAt) return b.lastScanAt - a.lastScanAt;
        return a.flight.departureTime.localeCompare(b.flight.departureTime);
      });
  }, [flights, scans, now, settings]);

  // Opsi A: tampilkan HANYA sebanyak baris yang muat rapi di ruang tersedia
  // (tanpa scroll berdempet). Sisanya via tombol "Lihat semua". Dihitung dari
  // tinggi kontainer & tinggi 1 baris (~54px) × jumlah kolom (2 di layar lebar).
  const gridRef = React.useRef<HTMLDivElement | null>(null);
  const [maxVisible, setMaxVisible] = React.useState(999);
  React.useEffect(() => {
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ROW_STRIDE = 54; // tinggi baris kompak + gap
    const recompute = () => {
      const cols = window.matchMedia("(min-width:1280px)").matches ? 2 : 1;
      const rows = Math.max(1, Math.floor(el.clientHeight / ROW_STRIDE));
      setMaxVisible(rows * cols);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    window.addEventListener("resize", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, []);

  const shown = cards.slice(0, maxVisible);
  const remaining = cards.length - shown.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-3xl bg-white/80 ring-1 ring-slate-200 backdrop-blur-md dark:bg-[#0c1a36] dark:ring-cyan-400/15">
      <div className="flex items-center justify-between px-5 py-3">
        <h3 className="text-[10.5px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-white/70">
          Flight Aktif · Boarding
        </h3>
        <span className="rounded-full bg-slate-900/5 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-white/10 dark:text-white/70">
          {cards.length}
        </span>
      </div>
      <div
        ref={gridRef}
        className="grid min-h-0 flex-1 grid-cols-1 content-start gap-1.5 overflow-hidden px-3 pb-3 xl:grid-cols-2"
      >
        {cards.length === 0 && (
          <div className="col-span-full px-3 py-8 text-center text-xs text-slate-400 dark:text-white/40">
            Belum ada flight yang sedang boarding.
          </div>
        )}
        {shown.map((c) => (
          <FlightBoardingCard
            key={c.flight.id}
            data={c}
            highlight={highlightFlightId === c.flight.id}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onMore}
        className="group flex w-full items-center justify-center gap-1.5 border-t border-slate-200/70 px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-cyan-700 transition hover:bg-cyan-50/50 dark:border-cyan-400/10 dark:text-cyan-300 dark:hover:bg-cyan-500/5"
      >
        {remaining > 0 ? (
          <>
            <span className="rounded-full bg-cyan-100 px-1.5 py-0.5 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-200">
              +{remaining}
            </span>
            flight lainnya · Lihat semua
          </>
        ) : (
          "Lihat semua scan hari ini"
        )}
        <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
      </button>
    </div>
  );
}

function FlightBoardingCard({
  data,
  highlight,
}: {
  data: FlightCardData;
  highlight: boolean;
}) {
  const { flight, effectiveStatus, boarded } = data;
  const expected = flight.expectedPax ?? null;
  const airlineName = getAirlineMeta(flight.airlineCode).name;

  // Aksen status pada garis kiri kartu (tanpa teks — biar tetap ringkas).
  const accent =
    effectiveStatus === "ACTIVE"
      ? "from-amber-400 to-orange-500"
      : "from-emerald-400 to-teal-500";

  return (
    <div
      title={`${flight.flightNumber} · ${airlineName} · ${flight.originAirport}→${flight.destinationAirport}`}
      className={cn(
        "relative flex items-center gap-2.5 overflow-hidden rounded-xl bg-white py-2 pl-3.5 pr-2.5 ring-1 ring-slate-200 transition dark:bg-[#0e1f44] dark:ring-cyan-400/15",
        highlight &&
          "ring-2 ring-cyan-400 shadow-[0_0_20px_-4px_rgba(34,211,238,0.45)] dark:ring-cyan-300",
      )}
    >
      {/* garis aksen status di kiri */}
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-1 bg-gradient-to-b",
          accent,
        )}
      />

      {/* Maskapai (logo) */}
      <AirlineLogo code={flight.airlineCode} size="sm" mode="rich" />

      {/* Info penerbangan */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-[13px] font-black leading-tight tracking-tight tabular-nums text-slate-800 dark:text-white">
            {flight.flightNumber}
          </p>
          <span className="flex shrink-0 items-center gap-0.5 text-[9.5px] font-bold tabular-nums text-slate-500 dark:text-white/60">
            {flight.originAirport}
            <ArrowRight className="h-2.5 w-2.5 text-cyan-500" />
            {flight.destinationAirport}
          </span>
        </div>
        <p className="truncate text-[9.5px] font-semibold text-slate-400 dark:text-white/45">
          {airlineName}
        </p>
      </div>

      {/* PAX */}
      <div className="shrink-0 rounded-lg bg-slate-900/5 px-2 py-1 text-right dark:bg-white/10">
        <span className="text-[13px] font-black leading-none tabular-nums text-slate-800 dark:text-white">
          {boarded}
          {expected !== null && (
            <span className="text-[10px] font-bold text-slate-400 dark:text-white/40">
              /{expected}
            </span>
          )}
        </span>
        <span className="ml-0.5 text-[8px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/40">
          pax
        </span>
      </div>
    </div>
  );
}

/* ─────────────── Header chips ─────────────── */

function ScannerStatusBadge({ mode }: { mode: "idle" | "scanner" | "manual" }) {
  const cfg = {
    scanner: {
      icon: Usb,
      label: "Scanner USB",
      chip: "from-emerald-400 to-emerald-600 shadow-emerald-500/30",
      dot: "bg-emerald-500",
      text: "text-emerald-600 dark:text-emerald-300",
    },
    manual: {
      icon: Keyboard,
      label: "Input Manual",
      chip: "from-amber-400 to-amber-500 shadow-amber-500/30",
      dot: "bg-amber-500",
      text: "text-amber-600 dark:text-amber-300",
    },
    idle: {
      icon: ScanLine,
      label: "Menunggu Input",
      chip: "from-slate-400 to-slate-500 shadow-slate-500/20",
      dot: "bg-slate-400",
      text: "text-slate-600 dark:text-white/70",
    },
  }[mode];
  const Icon = cfg.icon;
  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-slate-200/80 bg-white/80 px-3 py-1.5 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/10">
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md",
          cfg.chip,
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="leading-none">
        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/50">
          Mode Input
        </div>
        <div className={cn("mt-1 flex items-center gap-1.5 text-[13px] font-extrabold", cfg.text)}>
          <span className="relative flex h-1.5 w-1.5">
            <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-70", cfg.dot)} />
            <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", cfg.dot)} />
          </span>
          {cfg.label}
        </div>
      </div>
    </div>
  );
}

function ClockChip({ now }: { now: Date }) {
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const dateStr = now.toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-slate-200/80 bg-white/80 px-3 py-1.5 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/10">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 text-white shadow-md shadow-cyan-500/30">
        <Clock className="h-4 w-4" />
      </span>
      <div className="leading-none">
        <div className="flex items-baseline gap-1 font-mono tabular-nums">
          {/* suppressHydrationWarning: jam berbasis waktu → wajar beda server/client */}
          <span
            suppressHydrationWarning
            className="text-xl font-black tracking-tight text-slate-800 dark:text-white"
          >
            {hh}
            <span className="mx-px animate-pulse text-cyan-500 dark:text-cyan-300">:</span>
            {mm}
          </span>
          <span
            suppressHydrationWarning
            className="rounded-md bg-cyan-500/10 px-1 py-0.5 text-[11px] font-bold text-cyan-600 dark:bg-cyan-400/15 dark:text-cyan-300"
          >
            {ss}
          </span>
          <span className="ml-0.5 text-[9px] font-bold tracking-wide text-slate-400 dark:text-white/50">
            WIB
          </span>
        </div>
        <div
          suppressHydrationWarning
          className="mt-1 text-[9.5px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/50"
        >
          {dateStr}
        </div>
      </div>
    </div>
  );
}

function KioskMenu({
  isDark,
  soundOn,
  onToggleSound,
  onToggleTheme,
  onExit,
  onCloseBrowser,
}: {
  isDark: boolean;
  soundOn: boolean;
  onToggleSound: () => void;
  onToggleTheme: () => void;
  onExit: () => void;
  onCloseBrowser: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  // Ikuti status fullscreen dari browser (juga saat user keluar via Esc/F11).
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  React.useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Ditolak browser (mis. kebijakan/iframe) — biarkan; status tetap sinkron
      // lewat event fullscreenchange.
    }
  };

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Pengaturan kiosk"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "inline-flex h-11 w-11 items-center justify-center rounded-2xl border shadow-sm backdrop-blur transition",
          open
            ? "border-cyan-300 bg-cyan-500/10 text-cyan-600 dark:border-cyan-400/30 dark:bg-cyan-400/15 dark:text-cyan-300"
            : "border-slate-200/80 bg-white/80 text-slate-500 hover:bg-white hover:text-slate-700 dark:border-white/10 dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/15",
        )}
      >
        <Settings className={cn("h-5 w-5 transition-transform", open && "rotate-45")} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-2 w-52 overflow-hidden rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-slate-200 dark:bg-[#0c1a36] dark:ring-cyan-400/20"
        >
          <MenuItem
            icon={soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            label={soundOn ? "Suara feedback: Aktif" : "Suara feedback: Mati"}
            onClick={onToggleSound}
          />
          <MenuItem
            icon={isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            label={isDark ? "Mode terang" : "Mode gelap"}
            onClick={onToggleTheme}
          />
          <MenuItem
            icon={isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            label={isFullscreen ? "Keluar layar penuh" : "Layar penuh"}
            onClick={() => {
              setOpen(false);
              void toggleFullscreen();
            }}
          />
          <div className="my-1 h-px bg-slate-200/70 dark:bg-white/10" />
          <MenuItem
            icon={<X className="h-4 w-4" />}
            label="Keluar Kiosk"
            danger
            onClick={() => {
              setOpen(false);
              onExit();
            }}
          />
          <MenuItem
            icon={<Power className="h-4 w-4" />}
            label="Tutup Browser"
            danger
            onClick={() => {
              setOpen(false);
              onCloseBrowser();
            }}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[12px] font-bold transition",
        danger
          ? "text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10"
          : "text-slate-700 hover:bg-slate-100 dark:text-white/80 dark:hover:bg-white/10",
      )}
    >
      <span className="shrink-0">{icon}</span>
      {label}
    </button>
  );
}

function SikerenSyncChip({
  summary,
  syncing,
  onClick,
}: {
  summary: OutboxSummary;
  syncing: boolean;
  onClick: () => void;
}) {
  const offline = !summary.online;
  const hasFailed = summary.failed > 0;
  const hasPending = summary.pending > 0;

  let tone:
    | "ok"
    | "pending"
    | "failed"
    | "offline"
    | "syncing" = "ok";
  if (syncing) tone = "syncing";
  else if (offline) tone = "offline";
  else if (hasFailed) tone = "failed";
  else if (hasPending) tone = "pending";

  const toneClass: Record<typeof tone, string> = {
    ok: "bg-emerald-100 text-emerald-700 ring-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
    pending:
      "bg-sky-100 text-sky-700 ring-sky-300 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30",
    failed:
      "bg-rose-100 text-rose-700 ring-rose-300 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
    offline:
      "bg-slate-200 text-slate-700 ring-slate-300 dark:bg-white/10 dark:text-white/70 dark:ring-white/15",
    syncing:
      "bg-cyan-100 text-cyan-700 ring-cyan-300 dark:bg-cyan-500/15 dark:text-cyan-300 dark:ring-cyan-500/30",
  };

  const icon =
    tone === "syncing" ? (
      <Loader2 className="h-3 w-3 animate-spin" />
    ) : tone === "offline" ? (
      <CloudOff className="h-3 w-3" />
    ) : (
      <Cloud className="h-3 w-3" />
    );

  const label =
    tone === "syncing"
      ? "Sync…"
      : tone === "offline"
        ? "Offline"
        : tone === "failed"
          ? `Gagal ${summary.failed}`
          : tone === "pending"
            ? `Pending ${summary.pending}`
            : "Tersinkron";

  const lastSync = summary.lastSyncedAt
    ? new Date(summary.lastSyncedAt).toLocaleTimeString("id-ID")
    : "belum pernah";

  return (
    <button
      type="button"
      onClick={onClick}
      title={`Sikeren · ${label} · last sync: ${lastSync}${
        summary.lastError ? ` · ${summary.lastError}` : ""
      }`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60",
        toneClass[tone],
      )}
      disabled={syncing}
    >
      {icon}
      <span className="tabular-nums">{label}</span>
    </button>
  );
}


function ActionRow({
  onReset,
  onDemo,
  demoLoading,
  showExempt,
  exemptActive,
  onToggleExempt,
}: {
  onReset: () => void;
  onDemo: () => void;
  demoLoading: boolean;
  showExempt?: boolean;
  exemptActive?: boolean;
  onToggleExempt?: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {showExempt && (
        <button
          type="button"
          onClick={onToggleExempt}
          aria-pressed={exemptActive}
          title="Penumpang tanpa KTP — scan berikutnya dilewati pencocokan KTP & dicatat"
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-2xl px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider ring-1 transition",
            exemptActive
              ? "bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md shadow-amber-500/30 ring-amber-300 animate-pulse"
              : "bg-amber-500/10 text-amber-700 ring-amber-300/50 hover:bg-amber-500/20 dark:text-amber-300 dark:ring-amber-400/20",
          )}
        >
          <UserX className="h-4 w-4" />
          {exemptActive
            ? "Tanpa KTP AKTIF — scan boarding pass"
            : "Tanpa KTP"}
        </button>
      )}
      <div className="flex items-center gap-2 rounded-2xl bg-white/70 px-3 py-2 ring-1 ring-slate-200 backdrop-blur dark:bg-[#0c1a36] dark:ring-cyan-400/15">
        <button
          type="button"
          onClick={onDemo}
          disabled={demoLoading}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-white shadow-md shadow-cyan-500/20 transition hover:shadow-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {demoLoading ? "Memproses…" : "Demo Scan"}
        </button>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900/5 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-900/10 dark:bg-white/10 dark:text-white dark:ring-white/15 dark:hover:bg-white/15"
          title="Reset stats & tampilan"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </button>
      </div>
    </div>
  );
}

/* ─────────────── Modal close footer with countdown ─────────────── */

const ACCENT_BAR: Record<"success" | "warning" | "danger", string> = {
  success: "from-emerald-500 to-teal-400",
  warning: "from-amber-500 to-orange-400",
  danger: "from-rose-500 to-pink-400",
};

function ModalCloseFooter({
  onClose,
  barGradient,
  durationMs,
  resetKey,
}: {
  onClose: () => void;
  barGradient: string;
  durationMs: number;
  resetKey: string;
}) {
  const [remaining, setRemaining] = React.useState(Math.ceil(durationMs / 1000));
  React.useEffect(() => {
    setRemaining(Math.ceil(durationMs / 1000));
    const start = performance.now();
    const id = window.setInterval(() => {
      const elapsed = performance.now() - start;
      const left = Math.max(0, Math.ceil((durationMs - elapsed) / 1000));
      setRemaining(left);
      if (elapsed >= durationMs) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [durationMs, resetKey]);

  return (
    <div className="flex w-full items-center gap-3">
      <div className="flex-1">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
          <div
            key={resetKey}
            className={cn("h-full rounded-full bg-gradient-to-r", barGradient)}
            style={{
              width: "100%",
              animation: `kiosk-countdown ${durationMs}ms linear forwards`,
            }}
          />
        </div>
        <p className="mt-1 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500 dark:text-ink-subtle">
          Tutup otomatis dalam {remaining}s
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-slate-800 dark:bg-white/10 dark:hover:bg-white/20"
      >
        <X className="h-3.5 w-3.5" />
        Tutup
      </button>
      <style>{`
        @keyframes kiosk-countdown {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  );
}

/* ─────────────── Boarding pass modal body (VALID) ─────────────── */

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

/** Badge skor kecocokan nama KTP vs boarding pass (muncul di modal hasil scan). */
function KtpMatchBadge({ v }: { v: KtpVerification }) {
  // Penumpang tanpa KTP — tampilkan badge khusus, bukan match/mismatch.
  if (v.status === "exempted") {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30">
        <UserX className="h-4 w-4 shrink-0" />
        <span className="shrink-0 font-semibold">Tanpa KTP</span>
        <span className="ml-auto shrink-0 rounded-md bg-white/70 px-1.5 py-0.5 font-black uppercase tracking-wider dark:bg-white/10">
          dikonfirmasi petugas
        </span>
      </div>
    );
  }
  const pct = v.similarity != null ? Math.round(v.similarity * 100) : null;
  const ok = v.status === "matched" || v.status === "manual_pass";
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl px-3 py-2 text-xs ring-1",
        ok
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30"
          : "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
      )}
    >
      <IdCard className="h-4 w-4 shrink-0" />
      <span className="shrink-0 font-semibold">Identitas KTP:</span>
      <span className="truncate font-bold">{v.ocrName ?? "tidak terbaca"}</span>
      {pct != null && (
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="rounded-md bg-white/70 px-1.5 py-0.5 font-black tabular-nums dark:bg-white/10">
            {pct}%
          </span>
          {ok ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
        </span>
      )}
    </div>
  );
}

function BoardingPassModalBody({ last }: { last: LastResult }) {
  const { flight, parsed, passengerName } = last;
  if (!flight || !parsed) return null;
  const meta = getAirlineMeta(flight.airlineCode);
  const enrich = SEED_BOARDING_PASSES.find(
    (s) => s.pnr.toUpperCase() === parsed.pnr.toUpperCase(),
  );
  const cabinClass = enrich?.cabinClass ?? "Economy";
  const isBusiness = cabinClass === "Business";
  const originCity = enrich?.originCity ?? flight.originAirport;
  const destCity = enrich?.destinationCity ?? flight.destinationAirport;
  const name = (passengerName ?? parsed.passengerName ?? "(nama tidak ada di barcode)").toUpperCase();
  const seatRow = parseInt(parsed.seatNumber, 10) || 0;
  const group =
    isBusiness ? "1" : seatRow <= 10 ? "2" : seatRow <= 20 ? "3" : "4";
  const seq = (
    ((parseInt(parsed.ticketNumber.slice(-3), 10) || 1) % 250) + 1
  )
    .toString()
    .padStart(3, "0");
  const dt = new Date(flight.departureDate);
  const shortDate = isNaN(dt.getTime())
    ? flight.departureDate
    : `${dt.getDate().toString().padStart(2, "0")} ${MONTHS[dt.getMonth()]}`;

  const softBg = isBusiness ? "#fef3c7" : softTint(flight.airlineCode);
  const accentText = isBusiness ? "#92400e" : accentTextColor(flight.airlineCode);
  const accentGradient = isBusiness
    ? "from-amber-500 via-yellow-500 to-amber-600"
    : meta.gradient;

  const gate = flight.gateOrCheckpoint || "—";
  const departIn = departureCountdown(
    flight.departureDate,
    flight.departureTime,
    new Date(last.event.scannedAt),
  );

  return (
    <div className="space-y-3">
      {last.event.ktpVerification && (
        <KtpMatchBadge v={last.event.ktpVerification} />
      )}
      <div className="relative overflow-hidden rounded-3xl bg-white shadow-xl ring-1 ring-slate-200/80">
        <div className={cn("h-2 w-full bg-gradient-to-r", accentGradient)} />

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_230px]">
          {/* ── Bagian utama ── */}
          <div className="relative min-w-0 p-6">
            <Plane className="pointer-events-none absolute -right-6 top-6 h-44 w-44 rotate-[18deg] text-slate-50" />

            {/* Maskapai + nomor penerbangan */}
            <div className="relative flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {meta.logoSrc ? (
                  <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-white p-1 ring-1 ring-slate-200">
                    <Image
                      src={meta.logoSrc}
                      alt={meta.name}
                      width={48}
                      height={48}
                      className="h-full w-full object-contain"
                    />
                  </div>
                ) : (
                  <div className={cn(
                    "grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-sm font-bold text-white",
                    meta.gradient,
                  )}>
                    {flight.airlineCode}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-base font-bold tracking-tight" style={{ color: accentText }}>
                    {meta.name}
                  </p>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-400">
                    Boarding Pass · {isBusiness ? "Business" : "Economy"}
                  </p>
                </div>
              </div>
              <div className="shrink-0 rounded-2xl px-3.5 py-2 text-right" style={{ backgroundColor: softBg }}>
                <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  Penerbangan
                </p>
                <p className="font-mono text-2xl font-black leading-none tracking-tight" style={{ color: accentText }}>
                  {flight.flightNumber}
                </p>
              </div>
            </div>

            {/* Nama penumpang */}
            <div className="relative mt-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-400">
                Penumpang
              </p>
              <p className="mt-0.5 truncate text-2xl font-black tracking-tight text-slate-900" title={name}>
                {name}
              </p>
            </div>

            {/* Rute */}
            <div className="relative mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl bg-slate-50 px-5 py-4 ring-1 ring-slate-100">
              <div className="min-w-0">
                <p className="text-4xl font-black leading-none tracking-tight text-slate-900">
                  {flight.originAirport}
                </p>
                <p className="mt-1 truncate text-[12px] font-semibold text-slate-500">
                  {originCity}
                </p>
              </div>
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="h-px w-8 border-t-2 border-dashed border-slate-300 sm:w-14" />
                  <span
                    className="grid h-8 w-8 place-items-center rounded-full text-white shadow"
                    style={{ backgroundColor: accentText }}
                  >
                    <Plane className="h-4 w-4 rotate-45" />
                  </span>
                  <span className="h-px w-8 border-t-2 border-dashed border-slate-300 sm:w-14" />
                </div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  {shortDate} · {flight.departureTime}
                </p>
              </div>
              <div className="min-w-0 text-right">
                <p className="text-4xl font-black leading-none tracking-tight text-slate-900">
                  {flight.destinationAirport}
                </p>
                <p className="mt-1 truncate text-[12px] font-semibold text-slate-500">
                  {destCity}
                </p>
              </div>
            </div>

            {/* Detail */}
            <div className="relative mt-4 grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-5">
              <DetailCell label="PNR" value={parsed.pnr} mono accent={accentText} />
              <DetailCell label="Tiket" value={parsed.ticketNumber} mono />
              <DetailCell label="Kelas" value={isBusiness ? "Business" : "Economy"} accent={isBusiness ? "#92400e" : undefined} />
              <DetailCell label="Grup" value={group} />
              <DetailCell label="Seq" value={seq} mono />
            </div>
          </div>

          {/* Perforasi */}
          <div className="relative hidden md:block">
            <div className="absolute -left-2 top-0 h-4 w-4 -translate-y-1/2 rounded-full bg-slate-100" />
            <div className="absolute -left-2 bottom-0 h-4 w-4 translate-y-1/2 rounded-full bg-slate-100" />
            <div className="mx-auto h-full w-px border-l-2 border-dashed border-slate-300" />
          </div>

          {/* ── Stub: info yang dicari penumpang ── */}
          <div className="relative flex flex-col overflow-hidden p-5" style={{ backgroundColor: softBg }}>
            <Plane className="pointer-events-none absolute -right-5 bottom-3 h-28 w-28 rotate-[18deg] text-white/50" />

            <span className="relative inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-500 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-white shadow">
              <CheckCircle2 className="h-3 w-3" /> Terverifikasi
            </span>

            <div className="relative mt-4 grid grid-cols-2 gap-3 md:grid-cols-1">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">
                  Gate
                </p>
                <p
                  className={cn(
                    "font-black leading-none tracking-tight",
                    gate.length > 4 ? "text-3xl" : "text-6xl",
                  )}
                  style={{ color: accentText }}
                >
                  {gate}
                </p>
              </div>
              <div className="md:border-t md:border-black/10 md:pt-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">
                  Kursi
                </p>
                <p className="text-5xl font-black leading-none tracking-tight text-slate-900">
                  {parsed.seatNumber}
                </p>
              </div>
            </div>

            <div className="relative mt-4 rounded-2xl bg-white/75 px-3.5 py-2.5 ring-1 ring-white/80 backdrop-blur md:mt-auto">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                <Clock className="h-3 w-3" /> Berangkat {flight.departureTime}
              </p>
              <p className="mt-0.5 text-[15px] font-black leading-tight text-slate-900">
                {departIn}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-2.5">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            Divalidasi SIPANDAI · {new Date(last.event.scannedAt).toLocaleTimeString("id-ID")}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[13px] font-black" style={{ color: accentText }}>
            Silakan menuju Gate {gate}
            <ArrowRight className="h-4 w-4" />
          </span>
        </div>
      </div>
    </div>
  );
}

/** "dalam 1 j 05 m" / "berangkat sekarang" / "sudah lewat jadwal" relatif ke `at`. */
function departureCountdown(date: string, time: string, at: Date): string {
  const dep = new Date(`${date}T${time}:00`);
  if (isNaN(dep.getTime())) return "—";
  const mins = Math.round((dep.getTime() - at.getTime()) / 60_000);
  if (mins < -5) return "Sudah lewat jadwal";
  if (mins <= 5) return "Berangkat sekarang";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0
    ? `dalam ${h} j ${m.toString().padStart(2, "0")} m`
    : `dalam ${m} menit`;
}

function DetailCell({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 truncate text-sm font-bold leading-tight",
          mono && "font-mono tracking-tight",
        )}
        style={{ color: accent ?? "#0f172a" }}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

function softTint(code: string): string {
  switch (code) {
    case "GA": return "#e0f2fe";
    case "JT": case "QZ": case "SJ": case "XT": case "AK": return "#fee2e2";
    case "ID": return "#dbeafe";
    case "QG": case "IP": return "#d1fae5";
    case "IW": return "#ffedd5";
    case "IU": return "#fce7f3";
    case "SAA": return "#e0f2fe";
    case "SQ": return "#fef3c7";
    case "MH": return "#dbeafe";
    default: return "#f1f5f9";
  }
}

function accentTextColor(code: string): string {
  switch (code) {
    case "GA": return "#0369a1";
    case "JT": case "QZ": case "SJ": case "XT": case "AK": return "#b91c1c";
    case "ID": return "#1d4ed8";
    case "QG": case "IP": return "#047857";
    case "IW": return "#c2410c";
    case "IU": return "#be185d";
    case "SAA": return "#0369a1";
    case "SQ": return "#b45309";
    case "MH": return "#1d4ed8";
    default: return "#0f172a";
  }
}

/* ─────────────── Result modal body ─────────────── */

/** Arahan singkat per status untuk penumpang & petugas. */
const RESULT_GUIDANCE: Partial<Record<ScanResultStatus, string>> = {
  DUPLICATE_SCAN:
    "Boarding pass ini sudah divalidasi hari ini. Petugas: pastikan pemegangnya penumpang yang sama.",
  FLIGHT_NOT_TODAY:
    "Penerbangan ini bukan untuk hari ini. Silakan menuju konter maskapai.",
  FLIGHT_NOT_ACTIVE:
    "Boarding belum dibuka atau sudah ditutup. Silakan tunggu atau hubungi konter maskapai.",
  UNKNOWN_FLIGHT:
    "Nomor penerbangan tidak ada di jadwal hari ini. Silakan cek ke konter maskapai.",
  INVALID_BARCODE:
    "Barcode tidak terbaca. Scan ulang — pastikan layar ponsel terang dan barcode tidak terlipat.",
  KTP_MISMATCH:
    "Identitas tidak sesuai dengan boarding pass. Petugas akan memeriksa secara manual.",
};

const RESULT_TONE: Record<
  "success" | "warning" | "danger",
  { box: string; icon: string; text: string }
> = {
  success: {
    box: "bg-emerald-50 ring-emerald-200 dark:bg-emerald-500/10 dark:ring-emerald-500/30",
    icon: "bg-emerald-500 text-white",
    text: "text-emerald-900 dark:text-emerald-100",
  },
  warning: {
    box: "bg-amber-50 ring-amber-200 dark:bg-amber-500/10 dark:ring-amber-500/30",
    icon: "bg-amber-500 text-white",
    text: "text-amber-900 dark:text-amber-100",
  },
  danger: {
    box: "bg-rose-50 ring-rose-200 dark:bg-rose-500/10 dark:ring-rose-500/30",
    icon: "bg-rose-500 text-white",
    text: "text-rose-900 dark:text-rose-100",
  },
};

function ResultModalBody({
  last,
  meta,
}: {
  last: LastResult;
  meta: (typeof STATUS_META)[ScanResultStatus];
}) {
  const tone = RESULT_TONE[meta.modalTone];
  const guidance = RESULT_GUIDANCE[last.event.resultStatus];
  const airline = last.flight ? getAirlineMeta(last.flight.airlineCode) : null;
  // Barcode tak terbaca → tak ada data penerbangan; cukup tampilkan arahan.
  const hasInfo = !!(last.flightNumber || last.passengerName || last.seat);

  return (
    <div className="space-y-4">
      {/* Ringkasan penerbangan */}
      {hasInfo && (
      <div className="relative overflow-hidden rounded-2xl bg-slate-50 px-5 py-4 ring-1 ring-slate-100 dark:bg-white/5 dark:ring-hairline-soft">
        <div className={cn("absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b", meta.bar)} />
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-ink-subtle">
              Penerbangan
            </p>
            <p className="mt-0.5 font-mono text-4xl font-black leading-none tracking-tight text-slate-900 dark:text-ink">
              {last.flightNumber ?? "—"}
            </p>
            {(last.route || airline) && (
              <p className="mt-1.5 flex items-center gap-1.5 truncate text-sm font-semibold text-slate-600 dark:text-ink-muted">
                <Plane className="h-3.5 w-3.5 shrink-0 text-blue-500 dark:text-cyan-300" />
                {[airline?.name, last.route].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          {last.seat && (
            <div className="shrink-0 text-right">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-ink-subtle">
                Kursi
              </p>
              <p className="mt-0.5 flex items-center justify-end gap-1.5 text-3xl font-black leading-none text-slate-900 dark:text-ink">
                <Armchair className="h-5 w-5 text-slate-400 dark:text-ink-subtle" />
                {last.seat}
              </p>
            </div>
          )}
        </div>
        {last.passengerName && (
          <div className="mt-3 flex items-center gap-2 border-t border-slate-200/70 pt-3 dark:border-white/10">
            <User className="h-4 w-4 shrink-0 text-slate-400 dark:text-ink-subtle" />
            <span className="truncate text-[15px] font-bold uppercase tracking-tight text-slate-800 dark:text-ink">
              {last.passengerName}
            </span>
          </div>
        )}
      </div>
      )}

      {/* Arahan */}
      {guidance && (
        <div className={cn("flex items-start gap-3 rounded-2xl px-4 py-3 ring-1", tone.box)}>
          <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-xl", tone.icon)}>
            {meta.modalTone === "danger" ? (
              <XCircle className="h-4 w-4" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            )}
          </span>
          <p className={cn("text-[13.5px] font-semibold leading-snug", tone.text)}>
            {guidance}
          </p>
        </div>
      )}

      {last.event.ktpVerification && (
        <KtpMatchBadge v={last.event.ktpVerification} />
      )}

      <p className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-ink-subtle">
        <Clock className="h-3 w-3" />
        {new Date(last.event.scannedAt).toLocaleString("id-ID")}
      </p>
    </div>
  );
}
