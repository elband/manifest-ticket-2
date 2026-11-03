"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ScanLine,
  Scan,
  Usb,
  Keyboard,
  Smartphone,
  Ticket,
  X,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Plane,
  User,
  Armchair,
  Clock,
  ShieldCheck,
  Sun,
  Moon,
  ArrowRight,
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
  AppWindow,
  RefreshCw,
  Minimize2,
  Maximize,
  Minimize,
  UserRoundCheck,
  Delete,
  CornerDownLeft,
  AlertCircle,
  History,
  Search,
  Camera,
} from "lucide-react";
import { CameraScanner } from "@/components/scan/CameraScanner";
import { useCountUp } from "@/lib/useCountUp";
import {
  getKioskAgentActions,
  runKioskAgentAction,
  type KioskAgentAction,
} from "@/lib/kioskAgent";
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
  demoScanEnabled,
  ensureDemoBoardingFlight,
} from "@/lib/seedBoardingPasses";
import { useToast } from "@/components/ui/Toast";
import {
  archiveOldScanEvents,
  getSession,
  getScanEvents,
  getFlights,
  getUsers,
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
import {
  PasResultBody,
  pasModalMeta,
  type PasCheckState,
} from "@/components/scan/PasResultBody";
import { isPasQr } from "@/lib/pas";
import { getEffectiveFlightStatus } from "@/lib/flightStatus";
import {
  flushOutbox,
  getOutboxSummary,
  subscribeOutbox,
  type OutboxSummary,
} from "@/lib/sikerenOutbox";
import {
  enqueueIdentityDecision,
  flushApiOutbox,
  getApiOutboxSummary,
  resolveStation,
  subscribeApiOutbox,
  type ApiOutboxSummary,
} from "@/lib/api/outbox";
import {
  apiVerifyPas,
  getDeviceState,
  isAuthed,
  subscribeDevice,
  type DeviceState,
} from "@/lib/api/client";
import { logout } from "@/lib/auth";
import { signInWithPin } from "@/lib/pinLogin";
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

/** Kode yang sama dari kamera diabaikan selama masih terlihat + jeda ini. */
const CAMERA_SAME_CODE_MS = 3500;

const PHONE_QUERY = "(max-width: 767px)";

/** Layar selebar HP (bukan monitor kiosk) → tampilkan mode kamera. */
function useIsPhone(): boolean {
  const [phone, setPhone] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return phone;
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

type PowerAction = "close" | "minimize" | "shutdown";

const POWER_CONFIRM: Record<
  PowerAction,
  {
    title: string;
    body: string;
    confirm: string;
    icon: React.ElementType;
    tone: ModalToneName;
    button: string;
  }
> = {
  close: {
    title: "Tutup browser?",
    body: "Layar kiosk akan ditutup dan scanner tidak menerima boarding pass sampai browser dibuka kembali.",
    confirm: "Tutup Browser",
    icon: AppWindow,
    tone: "danger",
    button: "bg-rose-600 hover:bg-rose-700",
  },
  minimize: {
    title: "Perkecil browser?",
    body: "Selama browser diperkecil, scan boarding pass TIDAK tercatat. Buka kembali lewat taskbar Lubuntu atau Alt+Tab.",
    confirm: "Perkecil",
    icon: Minimize2,
    tone: "warning",
    button: "bg-amber-500 hover:bg-amber-600",
  },
  shutdown: {
    title: "Matikan perangkat?",
    body: "Perangkat kiosk akan dimatikan. Scanner tidak bisa dipakai sampai perangkat dinyalakan kembali.",
    confirm: "Matikan",
    icon: Power,
    tone: "danger",
    button: "bg-rose-600 hover:bg-rose-700",
  },
};

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
  // Status izin perangkat — chip server tetap tampil selama belum diizinkan,
  // supaya kode perangkat terlihat untuk dicocokkan admin.
  const [deviceStatus, setDeviceStatus] = React.useState<DeviceState["status"]>("approved");
  React.useEffect(() => {
    setDeviceStatus(getDeviceState().status);
    return subscribeDevice((s) => setDeviceStatus(s.status));
  }, []);
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
  // Cek kartu Pas Bandara karyawan (QR pas.aptpairport.id) — modal tersendiri.
  const [pasCheck, setPasCheck] = React.useState<PasCheckState | null>(null);
  const [pasOpen, setPasOpen] = React.useState(false);
  // Kiosk di HP: tak ada scanner USB → mode kamera (boarding pass & kartu PAS).
  const isPhone = useIsPhone();
  const [cameraOpen, setCameraOpen] = React.useState(false);
  const cameraGateRef = React.useRef<{ raw: string; until: number }>({ raw: "", until: 0 });
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
  // Konfirmasi aksi perangkat: tutup / perkecil browser, matikan perangkat.
  const [powerConfirm, setPowerConfirm] = React.useState<PowerAction | null>(null);
  const [powerBusy, setPowerBusy] = React.useState(false);
  // Ganti petugas lewat PIN tanpa keluar kiosk. Selama modal PIN terbuka,
  // input scanner tersembunyi dijeda supaya digit PIN tidak terkirim sebagai scan.
  const [officerSwitchOpen, setOfficerSwitchOpen] = React.useState(false);
  // Riwayat scan (laci kanan). Kolom cari di dalamnya juga butuh keyboard,
  // jadi scanner dijeda dengan cara yang sama seperti keypad PIN.
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const scanPaused = officerSwitchOpen || historyOpen;
  const scanPausedRef = React.useRef(false);
  React.useEffect(() => {
    scanPausedRef.current = scanPaused;
    if (scanPaused) {
      setValue("");
    } else {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [scanPaused]);
  // Agen lokal Lubuntu (kiosk-agent/) — aksi yang didukungnya di perangkat
  // ini. Tanpa agen: kosong → "Matikan" & "Perkecil" disembunyikan.
  const [agentActions, setAgentActions] = React.useState<KioskAgentAction[]>([]);
  React.useEffect(() => {
    let alive = true;
    const probe = () =>
      getKioskAgentActions().then((actions) => {
        if (alive) setAgentActions(actions);
      });
    probe();
    const t = setInterval(probe, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
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
    // Kiosk tidak memakai AppShell → arsip harian dijalankan di sini juga,
    // supaya localStorage tidak penuh setelah berhari-hari (maks. 1x/hari;
    // antrean kirim ke server tidak tersentuh).
    archiveOldScanEvents(1);
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
      if (!el || scanPausedRef.current) return;
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
        // Modal PIN menutup dirinya sendiri lewat Escape (jangan keluar kiosk).
        if (ktpFlowOpen || officerSwitchOpen) return;
        if (modalOpen) setModalOpen(false);
        else if (historyOpen) setHistoryOpen(false);
        else router.push("/scan");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, modalOpen, ktpFlowOpen, officerSwitchOpen, historyOpen]);

  React.useEffect(() => {
    return () => {
      if (lastFaceUrlRef.current) {
        URL.revokeObjectURL(lastFaceUrlRef.current);
        lastFaceUrlRef.current = null;
      }
    };
  }, []);

  // Lama card hasil scan tampil (Pengaturan → Mode Kiosk). 0 = tanpa batas
  // waktu: card tetap tampil sampai ditutup petugas atau diganti scan berikutnya.
  const modalAutoCloseMs = Math.max(0, rawSettings.kioskResultDurationSec) * 1000;

  React.useEffect(() => {
    if (!modalOpen || modalAutoCloseMs <= 0) return;
    const t = setTimeout(() => setModalOpen(false), modalAutoCloseMs);
    return () => clearTimeout(t);
  }, [modalOpen, modalAutoCloseMs, last?.event.id]);

  // Hasil cek PAS: hitung mundur baru mulai setelah data tampil (bukan saat memuat).
  const pasPhaseKey = pasCheck ? `${pasCheck.key}-${pasCheck.phase}` : null;
  React.useEffect(() => {
    if (!pasOpen || modalAutoCloseMs <= 0 || pasCheck?.phase === "loading") return;
    const t = setTimeout(() => setPasOpen(false), modalAutoCloseMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasOpen, modalAutoCloseMs, pasPhaseKey]);

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

    // === Kartu Pas Bandara karyawan: bukan boarding pass — dicek online ke
    // server PAS lewat backend, tak lewat processScan/outbox. ===
    if (isPasQr(raw)) {
      try {
        await checkPasCard(raw);
      } finally {
        submittingRef.current = false;
      }
      return;
    }
    setPasOpen(false);

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

  const checkPasCard = async (raw: string) => {
    const key = `pas-${Date.now()}`;
    setModalOpen(false);
    setPasCheck({ phase: "loading", key });
    setPasOpen(true);
    setValue("");
    setTimeout(() => inputRef.current?.focus(), 0);

    const res = await apiVerifyPas({
      raw,
      operatorId: session?.id,
      station: resolveStation(),
    });
    // Scan lain (PAS/boarding) sudah menggantikan yang ini → abaikan hasil lama.
    setPasCheck((cur) => {
      if (cur?.key !== key) return cur;
      if (res.ok && res.data) return { phase: "done", key, result: res.data };
      return {
        phase: "failed",
        key,
        error: `Tidak dapat memeriksa kartu PAS: ${res.error ?? "server tidak merespons"}.`,
      };
    });
    playFeedbackHaptic(
      res.ok && res.data?.status === "VALID" ? "VALID_FLIGHT" : "INVALID_BARCODE",
    );
  };

  // Kamera terus membaca selama kode masih di depan lensa. Kode yang sama baru
  // diterima lagi setelah hilang dari bidikan ±3,5 dtk — tanpa ini boarding pass
  // yang masih diarahkan langsung tercatat DUPLICATE begitu modal tertutup.
  const onCameraDecode = (raw: string) => {
    const now = Date.now();
    const gate = cameraGateRef.current;
    if (raw === gate.raw && now < gate.until) {
      gate.until = now + CAMERA_SAME_CODE_MS;
      return;
    }
    // Hasil scan sebelumnya masih tampil / menunggu keputusan petugas.
    if (submittingRef.current || modalOpen || pasOpen || ktpFlow || ktpDecision) return;
    cameraGateRef.current = { raw, until: now + CAMERA_SAME_CODE_MS };
    setInputMode("idle");
    void submit(raw);
  };

  const exitKiosk = () => router.push("/scan");
  const cancelPower = () => {
    setPowerConfirm(null);
    inputRef.current?.focus();
  };
  // Tutup browser: utamakan agen lokal (selalu berhasil). Tanpa agen, pakai
  // window.close() — browser hanya mengizinkannya bila riwayat tab cuma 1
  // halaman; selain itu ditolak diam-diam → beri petunjuk tutup manual.
  const closeBrowser = async () => {
    setPowerBusy(true);
    const viaAgent = await runKioskAgentAction("close-browser");
    setPowerBusy(false);
    setPowerConfirm(null);
    if (viaAgent) return;
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
  const shutdownDevice = async () => {
    setPowerBusy(true);
    const ok = await runKioskAgentAction("shutdown");
    setPowerBusy(false);
    setPowerConfirm(null);
    if (ok) {
      toast.info("Perangkat sedang dimatikan…", "Shutdown");
    } else {
      setAgentActions([]);
      toast.error(
        "Agen kiosk tidak merespons. Matikan perangkat secara manual.",
        "Gagal shutdown",
      );
      inputRef.current?.focus();
    }
  };
  const minimizeBrowser = async () => {
    setPowerBusy(true);
    const ok = await runKioskAgentAction("minimize-browser");
    setPowerBusy(false);
    setPowerConfirm(null);
    if (!ok) {
      toast.error(
        "Browser tidak bisa diperkecil. Pastikan sesi Lubuntu memakai X11 dan xdotool terpasang.",
        "Gagal perkecil",
      );
      inputRef.current?.focus();
    }
  };
  const runPowerAction = (action: PowerAction) =>
    action === "shutdown"
      ? shutdownDevice()
      : action === "minimize"
        ? minimizeBrowser()
        : closeBrowser();
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
    if (!demoScanEnabled() || demoLoading || submittingRef.current) return;
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

  // Petugas membandingkan nama di card dengan KTP/SIM penumpang. Hasilnya
  // dicatat di scan event (manual_pass / manual_reject) untuk audit dan
  // dikirim ke backend lewat outbox; "Tidak sesuai" menurunkan scan jadi
  // ditolak (backend ikut menarik penumpang dari manifest).
  const decideIdentity = (match: boolean) => {
    if (!last || last.event.ktpVerification) return;
    const eventId = last.event.id;
    const decidedAt = new Date().toISOString();
    const v: KtpVerification = {
      status: match ? "manual_pass" : "manual_reject",
      ocrName: null,
      capturedAt: decidedAt,
    };
    const sync = (patch: Partial<ScanEvent>) => {
      try {
        enqueueIdentityDecision({ ...last.event, ...patch }, match, decidedAt);
        flushApiOutbox().catch(() => {});
      } catch {
        /* sync backend tidak boleh mengganggu keputusan petugas */
      }
    };
    if (match) {
      updateScanEvent(eventId, { ktpVerification: v });
      sync({ ktpVerification: v });
      setLast((prev) =>
        prev && prev.event.id === eventId
          ? { ...prev, event: { ...prev.event, ktpVerification: v } }
          : prev,
      );
      toast.success("Identitas penumpang sesuai.", "Sesuai");
      setModalOpen(false);
    } else {
      const message =
        "Ditolak petugas: identitas penumpang tidak sesuai dengan boarding pass.";
      updateScanEvent(eventId, {
        ktpVerification: v,
        resultStatus: "KTP_MISMATCH",
        message,
      });
      sync({ ktpVerification: v, resultStatus: "KTP_MISMATCH", message });
      setLast((prev) =>
        prev && prev.event.id === eventId
          ? {
              ...prev,
              event: {
                ...prev.event,
                ktpVerification: v,
                resultStatus: "KTP_MISMATCH",
                message,
              },
            }
          : prev,
      );
      setSessionStats((prev) => ({
        ...prev,
        valid: Math.max(0, prev.valid - 1),
        rejected: prev.rejected + 1,
      }));
      setRecent(getScanEvents().slice(0, 6));
      const today = new Date().toISOString().slice(0, 10);
      setTodayScans(getScanEvents().filter((e) => e.scannedAt.slice(0, 10) === today));
      playFeedbackHaptic("KTP_MISMATCH");
      toast.error(message, "Tidak sesuai");
    }
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const lastMeta = last ? STATUS_META[last.event.resultStatus] : null;

  // Sebelum mounted: render shell kosong (sama di server & client) → no mismatch.
  if (!mounted) {
    return <div className="h-screen bg-kiosk-concrete dark:bg-kiosk-concrete-dark" />;
  }

  return (
    <div
      className={cn(
        "relative flex h-screen flex-col overflow-clip font-sign transition-colors",
        "bg-kiosk-concrete text-kiosk-asphalt",
        "dark:bg-kiosk-concrete-dark dark:text-white",
      )}
    >
      {/* Header = bidang rambu biru, teks putih. Di HP chip status turun ke
          baris kedua supaya judul & menu tidak terdorong keluar layar. */}
      <header className="relative z-30 flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-kiosk-sign px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-white sm:flex-nowrap sm:px-6 sm:py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white text-kiosk-sign sm:h-12 sm:w-12">
            <ShieldCheck className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={2.25} />
          </span>
          <div className="min-w-0 leading-none">
            <h1 className="truncate text-[17px] font-bold tracking-tight sm:text-[22px]">
              <span className="sm:hidden">Pemeriksaan</span>
              <span className="hidden sm:inline">Pemeriksaan boarding pass</span>
            </h1>
            <p className="mt-1 truncate text-[13px] font-medium text-white/75 sm:text-[15px]">
              {session?.name ?? "—"}, {flightsToday} flight hari ini
            </p>
          </div>
        </div>

        {/* HP: baris kedua selebar layar (order-last); layar lebar: sebaris. */}
        <div className="order-last flex w-full min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none] sm:order-none sm:w-auto sm:shrink-0 sm:overflow-visible">
          <ScannerStatusPill mode={inputMode} />
          <HeaderClock now={now} />
          {(settings.apiSyncEnabled || deviceStatus !== "approved") && (
            <ServerSyncChip
              onRelogin={() => {
                // Antrean tetap tersimpan: logout hanya menghapus sesi lokal.
                logout();
                router.replace("/login");
              }}
            />
          )}
          {settings.sikerenEnabled && (
            <SikerenSyncChip
              summary={outbox}
              syncing={syncing}
              onClick={onForceSync}
            />
          )}
          {demoScanEnabled() && (
            <button
              type="button"
              onClick={handleDemoScan}
              disabled={demoLoading}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-white/15 px-2.5 text-[12px] font-semibold text-white transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-60 sm:h-11 sm:gap-2 sm:px-3.5 sm:text-[14px]"
            >
              <Sparkles className="h-4 w-4" />
              {demoLoading ? "Memproses…" : "Demo scan"}
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <HardRefreshButton />
          <KioskMenu
            isDark={isDark}
            soundOn={settings.soundOn}
            onToggleSound={toggleSound}
            onToggleTheme={toggleTheme}
            onReset={handleReset}
            onSwitchOfficer={() => setOfficerSwitchOpen(true)}
            onExit={exitKiosk}
            onCloseBrowser={() => setPowerConfirm("close")}
            onShutdown={
              agentActions.includes("shutdown")
                ? () => setPowerConfirm("shutdown")
                : undefined
            }
            onMinimizeBrowser={
              agentActions.includes("minimize-browser")
                ? () => setPowerConfirm("minimize")
                : undefined
            }
            onFullscreenBrowser={
              agentActions.includes("fullscreen-browser")
                ? () => void runKioskAgentAction("fullscreen-browser")
                : undefined
            }
          />
        </div>
      </header>

      {/* Hidden input */}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        // Nonaktif selama keypad PIN / riwayat terbuka: input tak bisa
        // difokus/diketik, jadi ketikan di sana tidak terkirim sebagai scan.
        disabled={scanPaused}
        // Fokus dipaksa tiap 500 ms — di HP jangan sampai memunculkan keyboard
        // layar. Scanner USB/Bluetooth tetap mengetik seperti biasa.
        inputMode="none"
        autoComplete="off"
        spellCheck={false}
        aria-label="Scanner input"
        className="pointer-events-none fixed -left-[9999px] top-0 h-px w-px opacity-0"
      />

      {/* Aula: panel scanner boarding pass layar penuh (untuk penumpang). */}
      <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3 sm:px-6 sm:py-5 lg:overflow-visible">
        <ScanReadyCard
          ktpFirst={settings.ktpScanFirst}
          pendingName={pendingKtp?.name ?? null}
          showExempt={settings.ktpScanFirst && settings.allowNoKtpExemption}
          exemptActive={exemptNext}
          onToggleExempt={() => setExemptNext(!exemptNextRef.current)}
          onOpenCamera={isPhone ? () => setCameraOpen(true) : undefined}
          historyCount={todayScans.length}
          onOpenHistory={() => setHistoryOpen(true)}
        />
        <HistoryEdgeTab count={todayScans.length} onOpen={() => setHistoryOpen(true)} />
      </main>

      {/* Papan keberangkatan (flight boarding + statistik shift untuk AVSEC). */}
      <DepartureBoard
        flights={todayFlights}
        scans={todayScans}
        now={now}
        settings={settings}
        highlightFlightId={last?.event.flightId ?? null}
      />

      {/* Ticker info berjalan (bawah) — pengingat keamanan/instruksi. */}
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
                durationMs={modalAutoCloseMs}
                resetKey={last.event.id}
              />
            }
          >
            {isValid ? (
              <BoardingPassModalBody
                last={last}
                onIdentityDecision={
                  last.event.ktpVerification ? undefined : decideIdentity
                }
              />
            ) : (
              <ResultModalBody last={last} meta={lastMeta} />
            )}
          </Modal>
        );
      })()}

      {pasCheck && (() => {
        const meta = pasModalMeta(pasCheck);
        return (
          <Modal
            open={pasOpen}
            onClose={() => setPasOpen(false)}
            tone={meta.tone}
            size="xl"
            icon={meta.icon}
            title={
              <span className="text-xl font-black tracking-tight">{meta.label}</span>
            }
            description={meta.description}
            footer={
              <ModalCloseFooter
                onClose={() => setPasOpen(false)}
                barGradient={
                  meta.tone === "info" ? "from-blue-500 to-cyan-400" : ACCENT_BAR[meta.tone]
                }
                // Tunggu hasil dulu; hitung mundur baru mulai setelah data tampil.
                durationMs={pasCheck.phase === "loading" ? 0 : modalAutoCloseMs}
                resetKey={`${pasCheck.key}-${pasCheck.phase}`}
              />
            }
          >
            <PasResultBody state={pasCheck} />
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

      {(() => {
        const cfg = powerConfirm ? POWER_CONFIRM[powerConfirm] : POWER_CONFIRM.close;
        const Icon = cfg.icon;
        return (
          <Modal
            open={powerConfirm !== null}
            onClose={() => {
              if (!powerBusy) cancelPower();
            }}
            tone={cfg.tone}
            size="sm"
            title={cfg.title}
            icon={<Icon className="h-5 w-5" />}
          >
            <div className="space-y-4 p-1">
              <p className="text-[13px] leading-snug text-slate-600 dark:text-ink-muted">
                {cfg.body}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={cancelPower}
                  disabled={powerBusy}
                  className="rounded-2xl bg-slate-100 px-3 py-2.5 text-[13px] font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-white/10 dark:text-white/80 dark:hover:bg-white/15"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={() => powerConfirm && void runPowerAction(powerConfirm)}
                  disabled={powerBusy}
                  className={cn(
                    "inline-flex items-center justify-center gap-2 rounded-2xl px-3 py-2.5 text-[13px] font-bold text-white disabled:opacity-70",
                    cfg.button,
                  )}
                >
                  {powerBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {cfg.confirm}
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}

      <CameraScanner
        open={cameraOpen && isPhone && !scanPaused}
        onClose={() => {
          setCameraOpen(false);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        onDecode={(raw) => onCameraDecode(raw)}
        initialHint="Arahkan ke barcode boarding pass atau QR kartu PAS…"
        variant="fullscreen"
      />

      <ScanHistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        scans={todayScans}
        flights={todayFlights}
        currentOfficer={session}
      />

      <OfficerSwitchModal
        open={officerSwitchOpen}
        currentName={session?.name ?? null}
        onClose={() => setOfficerSwitchOpen(false)}
        onSwitched={(user) => {
          setSession(user);
          setOfficerSwitchOpen(false);
          toast.success(`Sekarang bertugas: ${user.name}`, "Petugas berganti");
        }}
      />

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

/**
 * Running-text di dasar layar: pengingat keamanan & instruksi. Track digandakan
 * 2x lalu digeser -50% (animate-marquee) supaya loop mulus. motion-reduce →
 * diam (hormati prefers-reduced-motion).
 */
function KioskTicker() {
  const Row = () => (
    <div className="flex shrink-0 items-center pr-2" aria-hidden>
      {TICKER_ITEMS.map((t, i) => (
        <span key={i} className="flex items-center whitespace-nowrap">
          {/* pemisah: belah ketupat biru */}
          <span className="mx-6 inline-block h-2 w-2 rotate-45 bg-kiosk-sign-glow" />
          <span className="text-[15px] font-medium text-white/85">{t}</span>
        </span>
      ))}
    </div>
  );
  return (
    <footer className="relative z-20 flex shrink-0 items-stretch overflow-hidden border-t border-kiosk-line bg-kiosk-asphalt">
      <div className="relative z-10 flex shrink-0 items-center gap-2 bg-kiosk-sign px-3 text-white sm:px-4">
        <Megaphone className="h-4 w-4" />
        <span className="hidden text-[14px] font-bold sm:inline">Info bandara</span>
      </div>
      <div className="relative flex-1 overflow-hidden py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:py-2.5">
        <p className="sr-only">{TICKER_ITEMS.join(". ")}</p>
        <div className="flex w-max animate-marquee motion-reduce:animate-none">
          <Row />
          <Row />
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-kiosk-asphalt to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-kiosk-asphalt to-transparent" />
      </div>
    </footer>
  );
}

/* ─────────────── Scan ready card with audio waveform ─────────────── */

/**
 * Panel scanner layar penuh untuk penumpang: gelombang suara, ikon dalam
 * bingkai bidik dengan cincin berputar, lalu instruksi scan.
 */
function ScanReadyCard({
  ktpFirst = false,
  pendingName = null,
  showExempt = false,
  exemptActive = false,
  onToggleExempt,
  onOpenCamera,
  historyCount = 0,
  onOpenHistory,
}: {
  ktpFirst?: boolean;
  pendingName?: string | null;
  showExempt?: boolean;
  exemptActive?: boolean;
  onToggleExempt?: () => void;
  /** Ada bila kiosk berjalan di HP → tombol besar "Scan dengan kamera". */
  onOpenCamera?: () => void;
  /** Di HP tab riwayat di tepi kanan disembunyikan; diganti tombol di kartu. */
  historyCount?: number;
  onOpenHistory?: () => void;
}) {
  const cameraMode = !!onOpenCamera;
  // 3 keadaan: (a) KTP-first menunggu KTP, (b) KTP terbaca menunggu boarding pass,
  // (c) normal menunggu boarding pass.
  const identityReady = ktpFirst && !!pendingName;
  const waitingKtp = ktpFirst && !pendingName;

  const icon = identityReady ? (
    <CheckCircle2 className="h-11 w-11 tall:h-14 tall:w-14" />
  ) : waitingKtp ? (
    <IdCard className="h-11 w-11 tall:h-14 tall:w-14" />
  ) : (
    <Scan className="h-11 w-11 tall:h-14 tall:w-14" />
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
      : cameraMode
        ? "Scan boarding pass penumpang atau QR kartu PAS karyawan dengan kamera."
        : "Arahkan Boarding pass ke scanner untuk memulai validasi.";

  return (
    // min-h-fit: di HP isi kartu bisa lebih tinggi dari ruang tersisa → kartu
    // memanjang & <main> yang menggulir, bukan isinya terpotong.
    <div className="relative flex min-h-fit w-full flex-1 flex-col justify-center overflow-hidden rounded-2xl bg-kiosk-paper px-4 py-5 shadow-[0_30px_60px_-30px_rgba(30,34,40,0.45)] sm:rounded-xl sm:px-6 sm:py-6 tall:py-8 dark:bg-kiosk-asphalt">
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-cyan-50/50 via-transparent to-blue-50/50 dark:from-cyan-500/5 dark:to-blue-500/5"
      />
      {/* Cincin konsentris samar di belakang ikon */}
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {[760, 580, 400].map((d) => (
          <span
            key={d}
            className="absolute rounded-full border border-cyan-400/15 dark:border-cyan-300/10"
            style={{ width: d, height: d }}
          />
        ))}
      </div>

      <div className="relative flex flex-col items-center gap-4 sm:gap-5 tall:gap-7">
        <Waveform />

        {/* Ikon + bingkai bidik + cincin putus-putus berputar */}
        <div className="relative flex h-32 w-32 items-center justify-center sm:h-44 sm:w-44 tall:h-56 tall:w-56">
          <span
            aria-hidden
            className="absolute inset-0 rounded-full border-2 border-dashed border-cyan-400/40 animate-spin-slow motion-reduce:animate-none dark:border-cyan-300/30"
          />
          <span
            aria-hidden
            className={cn(
              "absolute inset-4 rounded-full animate-ripple sm:inset-5 tall:inset-6 motion-reduce:animate-none",
              identityReady ? "bg-emerald-300/30" : "bg-cyan-300/30",
            )}
          />
          <span aria-hidden className="absolute inset-5 sm:inset-7 tall:inset-8">
            <span className="absolute left-0 top-0 h-5 w-5 rounded-tl-lg tall:h-6 tall:w-6 border-l-[3px] border-t-[3px] border-cyan-500 dark:border-cyan-300" />
            <span className="absolute right-0 top-0 h-5 w-5 rounded-tr-lg tall:h-6 tall:w-6 border-r-[3px] border-t-[3px] border-cyan-500 dark:border-cyan-300" />
            <span className="absolute bottom-0 left-0 h-5 w-5 rounded-bl-lg tall:h-6 tall:w-6 border-b-[3px] border-l-[3px] border-cyan-500 dark:border-cyan-300" />
            <span className="absolute bottom-0 right-0 h-5 w-5 rounded-br-lg tall:h-6 tall:w-6 border-b-[3px] border-r-[3px] border-cyan-500 dark:border-cyan-300" />
          </span>
          <span
            className={cn(
              "relative flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br text-white shadow-2xl ring-4 ring-white/70 sm:h-24 sm:w-24 tall:h-28 tall:w-28 dark:ring-white/10",
              chip,
            )}
          >
            {icon}
          </span>
        </div>

        <div className="text-center">
          {identityReady && (
            <p className="mb-1 text-[13px] font-bold uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-300">
              Identitas KTP
            </p>
          )}
          <p className="font-board text-[28px] font-bold leading-tight tracking-tight sm:text-4xl tall:text-5xl 2xl:text-6xl">
            {cameraMode && !ktpFirst ? "SIAP SCAN" : title}
          </p>
          <p className="mx-auto mt-2 max-w-xl text-[15px] leading-snug text-slate-500 sm:text-[17px] dark:text-white/55">
            {subtitle}
          </p>
        </div>

        {/* HP: tombol utama membuka kamera layar penuh. */}
        {cameraMode && !waitingKtp && (
          <button
            type="button"
            onClick={onOpenCamera}
            className="group relative flex w-full max-w-sm items-center justify-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 px-5 py-4 text-white shadow-lg shadow-blue-600/30 ring-1 ring-white/20 transition active:scale-[0.98]"
          >
            <span
              aria-hidden
              className="absolute inset-0 bg-[linear-gradient(110deg,transparent_30%,rgba(255,255,255,0.25)_50%,transparent_70%)] animate-shimmer motion-reduce:animate-none"
            />
            <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
              <Camera className="h-6 w-6" />
            </span>
            <span className="relative text-left leading-tight">
              <span className="block text-[17px] font-bold">Scan dengan kamera</span>
              <span className="block text-[12.5px] font-medium text-white/80">
                Boarding pass · QR kartu PAS
              </span>
            </span>
          </button>
        )}

        {/* Sumber yang bisa dipindai */}
        {!waitingKtp && (
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-2.5">
            {[
              { icon: Smartphone, label: "Layar HP" },
              { icon: Ticket, label: "Kertas boarding pass" },
              { icon: IdCard, label: "Kartu PAS" },
            ].map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/10 px-3 py-1.5 text-[12.5px] font-bold text-cyan-700 ring-1 ring-cyan-500/25 sm:px-4 sm:py-2 sm:text-[14px] dark:text-cyan-300"
              >
                <Icon className="h-4 w-4" />
                {label}
              </span>
            ))}
          </div>
        )}

        {onOpenHistory && (
          <button
            type="button"
            onClick={onOpenHistory}
            className="inline-flex items-center gap-2 rounded-xl bg-kiosk-asphalt px-4 py-2.5 text-[14px] font-semibold text-white shadow-md ring-1 ring-kiosk-line sm:hidden"
          >
            <History className="h-4 w-4" />
            Riwayat scan
            <span className="rounded-md bg-white/10 px-1.5 py-0.5 font-board text-[15px] leading-none tabular-nums text-kiosk-sign-glow">
              {historyCount}
            </span>
          </button>
        )}

        {showExempt && (
          <button
            type="button"
            onClick={onToggleExempt}
            aria-pressed={exemptActive}
            title="Penumpang tanpa KTP — scan berikutnya dilewati pencocokan KTP & dicatat"
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-[13px] font-bold uppercase tracking-wider ring-1 transition",
              exemptActive
                ? "bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md shadow-amber-500/30 ring-amber-300 animate-pulse"
                : "bg-amber-500/10 text-amber-700 ring-amber-300/50 hover:bg-amber-500/20 dark:text-amber-300 dark:ring-amber-400/20",
            )}
          >
            <UserX className="h-4 w-4" />
            {exemptActive ? "Tanpa KTP AKTIF — scan boarding pass" : "Tanpa KTP"}
          </button>
        )}
      </div>
    </div>
  );
}

function Waveform() {
  // 56 batang vertikal, tinggi deterministik, animasi via delay CSS
  const bars = React.useMemo(
    () =>
      Array.from({ length: 56 }, (_, i) => {
        const seed = Math.sin(i * 1.7) * 0.5 + 0.5;
        const h = 30 + Math.round(seed * 70);
        const delay = (i % 10) * 80;
        return { h, delay };
      }),
    [],
  );
  return (
    // Hiasan saja — di HP ruang vertikal dipakai untuk tombol kamera.
    <div className="hidden h-16 items-center gap-1.5 sm:flex tall:h-24">
      {bars.map((b, i) => (
        <span
          key={i}
          className="block w-[3px] rounded-full bg-gradient-to-t from-cyan-500/70 to-cyan-300/90 animate-wave motion-reduce:animate-none dark:from-cyan-500/70 dark:to-cyan-200"
          style={{
            height: `${b.h}%`,
            animationDelay: `${b.delay}ms`,
          }}
        />
      ))}
    </div>
  );
}

/** Status input scanner di header (bidang biru). */
const INPUT_MODE_META: Record<
  "idle" | "scanner" | "manual",
  { label: string; dot: string; icon: typeof Usb }
> = {
  idle: { label: "Menunggu input", dot: "bg-white/60", icon: ScanLine },
  scanner: { label: "Scanner USB", dot: "bg-emerald-400", icon: Usb },
  manual: { label: "Input manual", dot: "bg-amber-400", icon: Keyboard },
};

/* ─────────────── Papan keberangkatan: flight boarding + statistik shift ─────────────── */

interface FlightCardData {
  flight: Flight;
  effectiveStatus: "OPEN" | "ACTIVE";
  boarded: number;
  lastScanAt: number;
}

const BOARD_PAGE_MS = 8000;
const BOARD_CELL_STRIDE = 236; // lebar sel (224) + gap (12)

function DepartureBoard({
  flights,
  scans,
  now,
  settings,
  highlightFlightId,
}: {
  flights: Flight[];
  scans: ScanEvent[];
  now: Date;
  settings: AppSettings;
  highlightFlightId: string | null;
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

  // Tampilkan sel sebanyak yang muat di lebar papan; sisanya bergiliran per
  // halaman seperti papan keberangkatan bandara.
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const [perPage, setPerPage] = React.useState(4);
  React.useEffect(() => {
    const el = rowRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const recompute = () =>
      setPerPage(Math.max(1, Math.floor((el.clientWidth + 12) / BOARD_CELL_STRIDE)));
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pages = Math.max(1, Math.ceil(cards.length / perPage));
  const [page, setPage] = React.useState(0);
  React.useEffect(() => {
    if (pages <= 1) return;
    const t = setInterval(() => setPage((p) => (p + 1) % pages), BOARD_PAGE_MS);
    return () => clearInterval(t);
  }, [pages]);

  // Flight yang barusan di-scan → lompat ke halamannya. `cards` dibaca lewat
  // ref karena dihitung ulang tiap detik (now) dan tak boleh mereset giliran.
  const cardsRef = React.useRef(cards);
  cardsRef.current = cards;
  React.useEffect(() => {
    if (!highlightFlightId) return;
    const i = cardsRef.current.findIndex((c) => c.flight.id === highlightFlightId);
    if (i >= 0) setPage(Math.floor(i / perPage));
  }, [highlightFlightId, perPage]);

  const safePage = Math.min(page, pages - 1);
  const shown = cards.slice(safePage * perPage, (safePage + 1) * perPage);

  return (
    <section className="relative z-20 shrink-0 bg-kiosk-asphalt text-white">
      {/* HP: judul sebaris di atas, sel flight selebar layar di bawahnya. */}
      <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-stretch sm:gap-4 sm:px-6 sm:py-3">
        <div className="flex shrink-0 flex-col justify-center sm:w-[180px]">
          <div className="flex items-baseline justify-between gap-3 leading-none sm:block">
            <h2 className="font-board text-[18px] font-semibold text-kiosk-sign-glow sm:text-[26px]">
              Sedang boarding
            </h2>
            <p className="text-[12px] text-white/60 sm:mt-1 sm:text-[14px]">
              Now boarding
              {pages > 1 && (
                <span className="tabular-nums">
                  , {safePage + 1}/{pages}
                </span>
              )}
            </p>
          </div>
        </div>

        <div ref={rowRef} className="flex min-w-0 flex-1 items-stretch gap-3 overflow-hidden">
          {cards.length === 0 ? (
            <p className="flex items-center text-[15px] text-white/55">
              Belum ada flight yang dibuka untuk boarding.
            </p>
          ) : (
            shown.map((c) => (
              <FlightBoardCell
                key={c.flight.id}
                data={c}
                highlight={highlightFlightId === c.flight.id}
              />
            ))
          )}
        </div>

        <ShiftStats scans={scans} now={now} />
      </div>
    </section>
  );
}

function FlightBoardCell({
  data,
  highlight,
}: {
  data: FlightCardData;
  highlight: boolean;
}) {
  const { flight, effectiveStatus, boarded } = data;
  const expected = flight.expectedPax ?? null;
  const airlineName = getAirlineMeta(flight.airlineCode).name;
  const pct =
    expected && expected > 0 ? Math.min(100, Math.round((boarded / expected) * 100)) : null;
  const boarding = effectiveStatus === "ACTIVE";

  return (
    <div
      title={`${flight.flightNumber}, ${airlineName}, ${flight.originAirport} ke ${flight.destinationAirport}`}
      className={cn(
        "flex min-w-0 flex-1 basis-0 flex-col justify-between gap-2 rounded-[4px] bg-kiosk-cell px-3 py-2.5 ring-1 ring-kiosk-line sm:min-w-[224px] sm:max-w-[320px]",
        highlight && "ring-2 ring-kiosk-sign-glow",
      )}
    >
      <div className="flex items-center gap-2">
        <AirlineLogo code={flight.airlineCode} size="sm" mode="rich" />
        <span className="truncate font-board text-[22px] font-semibold leading-none tabular-nums text-kiosk-sign-glow">
          {flight.flightNumber}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-white/75">
          <span
            className={cn("h-2 w-2 rounded-full", boarding ? "bg-kiosk-go" : "bg-white/50")}
          />
          {boarding ? "Boarding" : "Dibuka"}
        </span>
      </div>

      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0 leading-none">
          <span className="block font-board text-[30px] font-semibold leading-none tracking-wide">
            {flight.destinationAirport}
          </span>
          <span className="mt-1 block truncate text-[12px] text-white/55">{airlineName}</span>
        </div>
        <span className="shrink-0 font-board text-[22px] font-medium leading-none tabular-nums text-white/85">
          {flight.departureTime}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-kiosk-line">
          {pct !== null && (
            <div
              className={cn("h-full rounded-full", boarding ? "bg-kiosk-go" : "bg-white/60")}
              style={{ width: `${pct}%` }}
            />
          )}
        </div>
        <span className="shrink-0 text-[12px] tabular-nums text-white/70">
          <b className="font-semibold text-white">{boarded}</b>
          {expected !== null && `/${expected}`} pax
        </span>
      </div>
    </div>
  );
}

/** Statistik shift ringkas untuk petugas AVSEC (sisi kanan papan). */
function ShiftStats({ scans, now }: { scans: ScanEvent[]; now: Date }) {
  const stats = React.useMemo(() => {
    let valid = 0;
    let duplicate = 0;
    let rejected = 0;
    let lastHour = 0;
    const hourly = new Array<number>(24).fill(0);
    const nowMs = now.getTime();
    const localDay = now.toDateString();
    for (const e of scans) {
      if (e.resultStatus === "VALID_FLIGHT") valid++;
      else if (e.resultStatus === "DUPLICATE_SCAN") duplicate++;
      else rejected++;
      const d = new Date(e.scannedAt);
      if (nowMs - d.getTime() <= 3_600_000) lastHour++;
      // Grafik per jam hanya untuk hari lokal yang sama (todayScans difilter
      // berdasarkan tanggal UTC).
      if (d.toDateString() === localDay) hourly[d.getHours()]++;
    }
    const curHour = now.getHours();
    const bars: { hour: number; n: number }[] = [];
    for (let h = Math.max(0, curHour - 11); h <= curHour; h++) {
      bars.push({ hour: h, n: hourly[h] });
    }
    const max = Math.max(1, ...bars.map((b) => b.n));
    return { valid, duplicate, rejected, total: scans.length, lastHour, bars, max, curHour };
  }, [scans, now]);

  return (
    <div className="hidden shrink-0 items-stretch gap-5 border-l border-kiosk-line pl-5 lg:flex">
      <StatFigure label="Valid" value={stats.valid} dot="bg-kiosk-go" />
      <StatFigure label="Duplikat" value={stats.duplicate} dot="bg-kiosk-hold" />
      <StatFigure label="Ditolak" value={stats.rejected} dot="bg-kiosk-stop" />
      <div className="flex w-[140px] flex-col justify-between gap-2">
        <div className="leading-tight">
          <p className="text-[13px] text-white/65">
            <b className="font-board text-[22px] font-semibold tabular-nums text-white">
              {stats.lastHour}
            </b>{" "}
            scan/jam terakhir
          </p>
          <p className="text-[12px] tabular-nums text-white/50">{stats.total} scan hari ini</p>
        </div>
        {/* scan per jam, 12 jam terakhir; jam berjalan berwarna kuning */}
        <div
          className="flex h-9 items-end gap-[3px]"
          title="Scan per jam, 12 jam terakhir"
        >
          {stats.bars.map((b) => (
            <span
              key={b.hour}
              className={cn(
                "flex-1 rounded-t-[2px]",
                b.hour === stats.curHour ? "bg-kiosk-sign-glow" : "bg-white/30",
              )}
              style={{ height: b.n > 0 ? `max(${(b.n / stats.max) * 100}%, 3px)` : "1px" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function StatFigure({ label, value, dot }: { label: string; value: number; dot: string }) {
  const shown = useCountUp(value);
  return (
    <div className="flex flex-col justify-center leading-none">
      <span className="font-board text-[40px] font-semibold tabular-nums">{shown}</span>
      <span className="mt-1 flex items-center gap-1.5 text-[13px] text-white/65">
        <span className={cn("h-2 w-2 rounded-[2px]", dot)} />
        {label}
      </span>
    </div>
  );
}

/* ─────────────── Header chips ─────────────── */

/**
 * Hard refresh: buang Cache Storage service worker (aset cache-first di
 * public/sw.js), minta SW cek versi baru, lalu muat ulang halaman. Data
 * localStorage (sesi, pengaturan, riwayat scan) tidak disentuh.
 */
/** Server halaman terjangkau? (permintaan kecil, lewati cache & SW). */
async function serverReachable(timeoutMs = 4000): Promise<boolean> {
  if (navigator.onLine === false) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`/offline.html?probe=${Date.now()}`, {
      cache: "no-store",
      signal: ctrl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function ScannerStatusPill({ mode }: { mode: "idle" | "scanner" | "manual" }) {
  const cfg = INPUT_MODE_META[mode];
  const Icon = cfg.icon;
  return (
    <div className="hidden h-11 items-center gap-2 rounded-md bg-white/15 px-3.5 text-[14px] font-semibold lg:flex">
      <Icon className="h-4 w-4" />
      <span className={cn("h-2 w-2 rounded-full", cfg.dot)} />
      {cfg.label}
    </div>
  );
}

function HeaderClock({ now }: { now: Date }) {
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
    <div className="hidden px-2 text-right leading-none md:block">
      <div className="font-board text-[28px] font-semibold tabular-nums">
        {hh}:{mm}
        <span className="ml-1 text-[16px] font-medium text-white/70">{ss} WIB</span>
      </div>
      <div className="mt-1 text-[13px] text-white/75">{dateStr}</div>
    </div>
  );
}

function HardRefreshButton() {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    // Hard refresh menghapus cache halaman offline. Saat server tak terjangkau
    // itu justru membuat kiosk tidak bisa dibuka lagi → batalkan.
    if (!(await serverReachable())) {
      setBusy(false);
      toast.warning(
        "Server tidak terjangkau. Hard Refresh dibatalkan supaya kiosk tetap bisa dipakai offline; scan tetap tersimpan.",
        "Sedang offline",
      );
      return;
    }
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.update().catch(() => {})));
      }
    } catch {
      // Tetap reload walau pembersihan cache gagal.
    }
    window.location.reload();
  };
  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy}
      title="Hard refresh — bersihkan cache & muat ulang halaman"
      aria-label={busy ? "Memuat ulang…" : "Hard refresh"}
      className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-white/15 text-white transition hover:bg-white/25 disabled:opacity-70"
    >
      <RefreshCw className={cn("h-5 w-5", busy && "animate-spin")} />
    </button>
  );
}

/* ─────────────── Riwayat scan (laci kanan bergaya papan keberangkatan) ─────────────── */

/**
 * Tab tarik di tepi kanan aula — pegangan laci riwayat yang muncul dari sisi
 * yang sama. Teks vertikal supaya tak memakan ruang panel scanner.
 */
function HistoryEdgeTab({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Buka riwayat scan, ${count} scan hari ini`}
      className="group absolute right-0 top-1/2 z-20 hidden -translate-y-1/2 flex-col items-center sm:flex gap-3 rounded-l-xl bg-kiosk-asphalt py-4 pl-3 pr-2.5 text-white shadow-[-10px_0_30px_-12px_rgba(30,34,40,0.6)] ring-1 ring-kiosk-line transition hover:pl-4 hover:pr-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kiosk-sign-glow motion-reduce:transition-none"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-kiosk-sign">
        <History className="h-5 w-5" />
      </span>
      <span className="rotate-180 text-[15px] font-semibold tracking-wide [writing-mode:vertical-rl]">
        Riwayat scan
      </span>
      <span className="min-w-[2.25rem] rounded-md bg-white/10 px-1.5 py-1 text-center font-board text-[18px] font-semibold leading-none tabular-nums text-kiosk-sign-glow">
        {count}
      </span>
    </button>
  );
}

type HistoryGroup = "valid" | "duplicate" | "rejected";
type HistoryFilter = "all" | HistoryGroup;

const HISTORY_PAGE = 100;
// Kiosk tak boleh tertahan di riwayat: laci menutup sendiri bila didiamkan.
const HISTORY_IDLE_MS = 60_000;

function historyGroupOf(status: ScanResultStatus): HistoryGroup {
  if (status === "VALID_FLIGHT") return "valid";
  if (status === "DUPLICATE_SCAN") return "duplicate";
  return "rejected";
}

const HISTORY_GROUP_META: Record<HistoryGroup, { label: string; dot: string; text: string }> = {
  valid: { label: "Valid", dot: "bg-kiosk-go", text: "text-emerald-300" },
  duplicate: { label: "Duplikat", dot: "bg-kiosk-hold", text: "text-amber-300" },
  rejected: { label: "Ditolak", dot: "bg-kiosk-stop", text: "text-rose-300" },
};

const HISTORY_STATUS_LABEL: Record<ScanResultStatus, string> = {
  VALID_FLIGHT: "Valid",
  DUPLICATE_SCAN: "Duplikat",
  FLIGHT_NOT_TODAY: "Bukan hari ini",
  FLIGHT_NOT_ACTIVE: "Flight tidak aktif",
  UNKNOWN_FLIGHT: "Flight tak dikenal",
  INVALID_BARCODE: "Barcode tidak valid",
  KTP_MISMATCH: "KTP tidak cocok",
};

const HISTORY_FILTERS: { key: HistoryFilter; label: string; dot: string }[] = [
  { key: "all", label: "Semua", dot: "bg-kiosk-sign-glow" },
  { key: "valid", label: "Valid", dot: HISTORY_GROUP_META.valid.dot },
  { key: "duplicate", label: "Duplikat", dot: HISTORY_GROUP_META.duplicate.dot },
  { key: "rejected", label: "Ditolak", dot: HISTORY_GROUP_META.rejected.dot },
];

function ScanHistoryDrawer({
  open,
  onClose,
  scans,
  flights,
  currentOfficer,
}: {
  open: boolean;
  onClose: () => void;
  scans: ScanEvent[];
  flights: Flight[];
  /** Petugas yang login (bisa akun server yang tak ada di daftar lokal). */
  currentOfficer: SessionUser | null;
}) {
  const [filter, setFilter] = React.useState<HistoryFilter>("all");
  const [query, setQuery] = React.useState("");
  const [limit, setLimit] = React.useState(HISTORY_PAGE);
  const closeRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setFilter("all");
    setQuery("");
    setLimit(HISTORY_PAGE);
    setTimeout(() => closeRef.current?.focus(), 0);
  }, [open]);

  // Tutup otomatis setelah didiamkan; setiap sentuhan/ketikan/gulir mereset.
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const [activity, setActivity] = React.useState(0);
  const touch = () => setActivity((n) => n + 1);
  React.useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => onCloseRef.current(), HISTORY_IDLE_MS);
    return () => window.clearTimeout(t);
  }, [open, activity]);

  const flightById = React.useMemo(
    () => new Map(flights.map((f) => [f.id, f])),
    [flights],
  );
  // scannedBy berisi email (atau id) petugas → tampilkan namanya bila dikenal.
  const officerName = React.useMemo(() => {
    const m = new Map<string, string>();
    if (!open) return m;
    for (const u of getUsers()) {
      m.set(u.email.toLowerCase(), u.name);
      m.set(u.id, u.name);
    }
    if (currentOfficer) {
      m.set(currentOfficer.email.toLowerCase(), currentOfficer.name);
      m.set(currentOfficer.id, currentOfficer.name);
    }
    return m;
  }, [open, currentOfficer]);

  const sorted = React.useMemo(
    () => [...scans].sort((a, b) => b.scannedAt.localeCompare(a.scannedAt)),
    [scans],
  );
  const counts = React.useMemo(() => {
    const c: Record<HistoryFilter, number> = { all: sorted.length, valid: 0, duplicate: 0, rejected: 0 };
    for (const e of sorted) c[historyGroupOf(e.resultStatus)]++;
    return c;
  }, [sorted]);
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter((e) => {
      if (filter !== "all" && historyGroupOf(e.resultStatus) !== filter) return false;
      if (!q) return true;
      return [
        e.parsedPassengerName,
        e.parsedFlightNumber,
        e.parsedPnr,
        e.parsedSeatNumber,
        e.parsedTicketNumber,
      ].some((v) => v?.toLowerCase().includes(q));
    });
  }, [sorted, filter, query]);

  // Kelompokkan per jam (daftar sudah urut terbaru → terlama).
  const shown = filtered.slice(0, limit);
  const groups: { hour: number; items: ScanEvent[] }[] = [];
  for (const e of shown) {
    const h = new Date(e.scannedAt).getHours();
    const g = groups[groups.length - 1];
    if (g && g.hour === h) g.items.push(e);
    else groups.push({ hour: h, items: [e] });
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end font-sign"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scan-history-title"
    >
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-kiosk-asphalt/60 backdrop-blur-[2px] animate-fade-in motion-reduce:animate-none"
      />
      <aside
        onPointerDown={touch}
        onKeyDown={touch}
        onScrollCapture={touch}
        className="relative flex h-full w-full max-w-[620px] flex-col bg-kiosk-asphalt text-white shadow-[-24px_0_60px_-20px_rgba(0,0,0,0.6)] animate-drawer-in motion-reduce:animate-none"
      >
        <header className="flex shrink-0 items-center gap-3 bg-kiosk-sign px-5 py-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white text-kiosk-sign">
            <History className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1 leading-none">
            <h2 id="scan-history-title" className="truncate text-[21px] font-bold">
              Riwayat scan hari ini
            </h2>
            <p className="mt-1 text-[14px] text-white/75">
              {counts.all} scan, terbaru di atas
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Tutup riwayat"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white/15 transition hover:bg-white/25"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="shrink-0 space-y-3 border-b border-kiosk-line px-5 py-4">
          <div className="grid grid-cols-4 gap-2" role="tablist" aria-label="Saring status">
            {HISTORY_FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setFilter(f.key);
                    setLimit(HISTORY_PAGE);
                  }}
                  className={cn(
                    "flex flex-col items-start rounded-md px-3 py-2 text-left ring-1 transition",
                    active
                      ? "bg-kiosk-cell ring-2 ring-kiosk-sign-glow"
                      : "ring-kiosk-line hover:bg-kiosk-cell/60",
                  )}
                >
                  <span className="font-board text-[28px] font-semibold leading-none tabular-nums">
                    {counts[f.key]}
                  </span>
                  <span className="mt-1 flex items-center gap-1.5 text-[13px] text-white/70">
                    <span className={cn("h-2 w-2 rounded-[2px]", f.dot)} />
                    {f.label}
                  </span>
                </button>
              );
            })}
          </div>
          <label className="relative block">
            <span className="sr-only">Cari riwayat scan</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(HISTORY_PAGE);
              }}
              placeholder="Cari nama, flight, PNR, atau kursi"
              autoComplete="off"
              spellCheck={false}
              className="h-11 w-full rounded-md bg-kiosk-cell pl-9 pr-3 text-[15px] text-white ring-1 ring-kiosk-line placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-kiosk-sign-glow"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
          {filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center">
              <History className="h-10 w-10 text-white/25" />
              <p className="text-[16px] font-semibold text-white/80">
                {counts.all === 0 ? "Belum ada scan hari ini" : "Tidak ada scan yang cocok"}
              </p>
              <p className="text-[14px] text-white/50">
                {counts.all === 0
                  ? "Scan boarding pass pertama akan muncul di sini."
                  : "Ubah kata kunci atau pilih status lain."}
              </p>
            </div>
          ) : (
            groups.map((g) => {
              const hh = String(g.hour).padStart(2, "0");
              return (
                <section key={g.hour} aria-label={`Jam ${hh}.00 sampai ${hh}.59`}>
                  <h3 className="sticky top-0 z-10 -mx-5 flex items-baseline justify-between bg-kiosk-asphalt/95 px-5 pb-2 pt-4 backdrop-blur">
                    <span className="font-board text-[18px] font-semibold tabular-nums text-kiosk-sign-glow">
                      {hh}.00–{hh}.59
                    </span>
                    <span className="text-[12px] tabular-nums text-white/50">
                      {g.items.length} scan
                    </span>
                  </h3>
                  <ol className="space-y-1.5">
                    {g.items.map((e) => (
                      <HistoryRow
                        key={e.id}
                        e={e}
                        flight={e.flightId ? flightById.get(e.flightId) ?? null : null}
                        officer={
                          officerName.get(e.scannedBy.toLowerCase()) ??
                          officerName.get(e.scannedBy) ??
                          e.scannedBy.split("@")[0]
                        }
                      />
                    ))}
                  </ol>
                </section>
              );
            })
          )}

          {filtered.length > limit && (
            <button
              type="button"
              onClick={() => setLimit((l) => l + HISTORY_PAGE)}
              className="mt-4 w-full rounded-md py-3 text-[14px] font-semibold text-white/80 ring-1 ring-kiosk-line transition hover:bg-kiosk-cell"
            >
              Tampilkan {Math.min(HISTORY_PAGE, filtered.length - limit)} scan lagi
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

function HistoryRow({
  e,
  flight,
  officer,
}: {
  e: ScanEvent;
  flight: Flight | null;
  officer: string;
}) {
  const group = historyGroupOf(e.resultStatus);
  const meta = HISTORY_GROUP_META[group];
  const t = new Date(e.scannedAt);
  const hhmm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  const ss = String(t.getSeconds()).padStart(2, "0");
  const details = [
    e.parsedSeatNumber && `Kursi ${e.parsedSeatNumber}`,
    e.parsedPnr && `PNR ${e.parsedPnr}`,
    `oleh ${officer}`,
  ].filter(Boolean);

  return (
    <li className="relative flex gap-3 overflow-hidden rounded-[4px] bg-kiosk-cell py-2.5 pl-4 pr-3 ring-1 ring-kiosk-line">
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", meta.dot)} />
      <div className="w-[58px] shrink-0 pt-0.5 leading-none">
        <span className="block font-board text-[20px] font-semibold tabular-nums">{hhmm}</span>
        <span className="mt-1 block text-[12px] tabular-nums text-white/45">:{ss}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {flight && <AirlineLogo code={flight.airlineCode} size="sm" mode="rich" />}
          <span className="font-board text-[19px] font-semibold leading-none tabular-nums text-kiosk-sign-glow">
            {flight?.flightNumber ?? e.parsedFlightNumber ?? "—"}
          </span>
          {flight && (
            <span className="flex items-center gap-1 text-[13px] tabular-nums text-white/60">
              {flight.originAirport}
              <ArrowRight className="h-3 w-3" />
              {flight.destinationAirport}
            </span>
          )}
          {e.isTest && (
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold text-white/70">
              Uji
            </span>
          )}
          <span className={cn("ml-auto shrink-0 text-[13px] font-semibold", meta.text)}>
            {HISTORY_STATUS_LABEL[e.resultStatus]}
          </span>
        </div>
        <p className="mt-1 truncate text-[15px] font-semibold">
          {e.parsedPassengerName ?? "Nama tidak terbaca"}
        </p>
        <p className="mt-0.5 truncate text-[12.5px] text-white/55">{details.join(", ")}</p>
        {group === "rejected" && (
          <p className="mt-1 text-[12.5px] leading-snug text-rose-300/90">{e.message}</p>
        )}
      </div>
    </li>
  );
}

/* ─────────────── Ganti petugas (keypad PIN) ─────────────── */

const OFFICER_PIN_MAX = 6;

/**
 * Keypad PIN untuk mengganti petugas tanpa keluar kiosk. Sesi petugas lama
 * baru diganti bila PIN berhasil; gagal/batal → petugas lama tetap bertugas.
 * PIN juga bisa diketik lewat keyboard (angka, Backspace, Enter).
 */
function OfficerSwitchModal({
  open,
  currentName,
  onClose,
  onSwitched,
}: {
  open: boolean;
  currentName: string | null;
  onClose: () => void;
  onSwitched: (user: SessionUser) => void;
}) {
  const [pin, setPin] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setPin("");
    setError(null);
    setLoading(false);
  }, [open]);

  const pressDigit = (d: string) => {
    setError(null);
    setPin((p) => (p.length >= OFFICER_PIN_MAX ? p : p + d));
  };
  const pressBackspace = () => {
    setError(null);
    setPin((p) => p.slice(0, -1));
  };

  const submit = async () => {
    if (loading || pin.length < 4) return;
    setLoading(true);
    setError(null);
    const res = await signInWithPin(pin);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      setPin("");
      return;
    }
    onSwitched(res.user);
  };

  // Ref ke submit terbaru supaya listener keyboard tidak memakai state basi.
  const submitRef = React.useRef(submit);
  submitRef.current = submit;

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        pressDigit(e.key);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        pressBackspace();
      } else if (e.key === "Enter") {
        // preventDefault juga mencegah Enter "mengklik" tombol yang sedang fokus.
        e.preventDefault();
        void submitRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const keyClass =
    "flex h-14 items-center justify-center rounded-xl bg-slate-100 text-2xl font-bold text-kiosk-asphalt transition active:scale-95 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/10 dark:text-white dark:hover:bg-white/15";

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!loading) onClose();
      }}
      tone="info"
      size="sm"
      title="Ganti petugas"
      description={
        currentName
          ? `Sekarang bertugas: ${currentName}. Masukkan PIN petugas pengganti.`
          : "Masukkan PIN petugas yang akan bertugas."
      }
      icon={<UserRoundCheck className="h-5 w-5" />}
    >
      <div className="space-y-4 p-1 font-sign">
        {/* Indikator digit PIN */}
        <div className="flex items-center justify-center gap-3" aria-live="polite">
          <span className="sr-only">{pin.length} digit diisi</span>
          {Array.from({ length: OFFICER_PIN_MAX }).map((_, i) => (
            <span
              key={i}
              aria-hidden
              className={cn(
                "h-3.5 w-3.5 rounded-full transition",
                i < pin.length
                  ? "bg-kiosk-sign"
                  : "bg-slate-200 dark:bg-white/15",
              )}
            />
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => pressDigit(d)}
              disabled={loading}
              className={keyClass}
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={pressBackspace}
            disabled={loading || pin.length === 0}
            aria-label="Hapus"
            className={keyClass}
          >
            <Delete className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={() => pressDigit("0")}
            disabled={loading}
            className={keyClass}
          >
            0
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={loading || pin.length < 4}
            aria-label="Masuk"
            className="flex h-14 items-center justify-center rounded-xl bg-kiosk-sign text-white transition active:scale-95 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <CornerDownLeft className="h-6 w-6" />
            )}
          </button>
        </div>

        {error ? (
          <p className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-[14px] text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-200 dark:ring-rose-500/30">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : (
          <p className="text-center text-[13px] text-slate-500 dark:text-white/55">
            PIN 4–6 digit. Bisa diketik lewat keyboard, Enter untuk masuk.
          </p>
        )}
      </div>
    </Modal>
  );
}

function KioskMenu({
  isDark,
  soundOn,
  onToggleSound,
  onToggleTheme,
  onReset,
  onSwitchOfficer,
  onExit,
  onCloseBrowser,
  onShutdown,
  onMinimizeBrowser,
  onFullscreenBrowser,
}: {
  isDark: boolean;
  soundOn: boolean;
  onToggleSound: () => void;
  onToggleTheme: () => void;
  /** Kosongkan statistik & riwayat tampilan kiosk. */
  onReset: () => void;
  /** Buka keypad PIN untuk mengganti petugas yang bertugas di kiosk. */
  onSwitchOfficer: () => void;
  onExit: () => void;
  onCloseBrowser: () => void;
  /** Hanya ada bila agen kiosk lokal terdeteksi. */
  onShutdown?: () => void;
  /** Hanya ada bila agen mendukung minimize (xdotool + X11). */
  onMinimizeBrowser?: () => void;
  /**
   * Hanya di aplikasi desktop: layar penuh jendela seperti F11 (tanpa judul &
   * taskbar). Selalu ditampilkan karena ukuran jendela tak cukup untuk menebak
   * apakah window manager benar-benar memasang layar penuh.
   */
  onFullscreenBrowser?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  // Ikuti status fullscreen dari browser (juga saat user keluar via Esc/F11).
  // Tombol selalu ditampilkan: menebak "browser sudah layar penuh" dari ukuran
  // jendela keliru di Chromium Lubuntu (zoom < 100% / jendela seukuran layar
  // tapi taskbar LXQt tetap di atas) sehingga tombolnya hilang.
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  React.useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toast = useToast();
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      return;
    }
    if (!document.fullscreenEnabled) {
      toast.warning(
        "Browser tidak mengizinkan halaman masuk layar penuh. Tekan F11.",
        "Layar penuh diblokir",
      );
      return;
    }
    // Sebagian browser menolak tanpa error / tak pernah menyelesaikan promise
    // → cek hasilnya setelah jeda singkat.
    const check = setTimeout(() => {
      if (!document.fullscreenElement) {
        toast.warning(
          "Browser tidak merespons permintaan layar penuh. Tekan F11.",
          "Layar penuh gagal",
        );
      }
    }, 1500);
    try {
      await document.documentElement.requestFullscreen();
    } catch (e) {
      clearTimeout(check);
      toast.warning(
        `Browser menolak layar penuh${e instanceof Error && e.message ? ` (${e.message})` : ""}. Tekan F11.`,
        "Layar penuh gagal",
      );
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
          "inline-flex h-11 w-11 items-center justify-center rounded-md transition",
          open
            ? "bg-white text-kiosk-asphalt"
            : "bg-white/15 text-white hover:bg-white/25",
        )}
      >
        <Settings className={cn("h-5 w-5 transition-transform", open && "rotate-45")} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-lg bg-white p-1.5 shadow-xl ring-1 ring-slate-200 dark:bg-kiosk-asphalt dark:ring-kiosk-line"
        >
          <MenuItem
            icon={<UserRoundCheck className="h-4 w-4" />}
            label="Ganti petugas"
            onClick={() => {
              setOpen(false);
              onSwitchOfficer();
            }}
          />
          <div className="my-1 h-px bg-slate-200/70 dark:bg-white/10" />
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
          {onFullscreenBrowser ? (
            <MenuItem
              icon={<Maximize className="h-4 w-4" />}
              label="Layar penuh (F11)"
              onClick={() => {
                setOpen(false);
                onFullscreenBrowser();
              }}
            />
          ) : (
            <MenuItem
              icon={isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              label={isFullscreen ? "Keluar layar penuh" : "Layar penuh"}
              onClick={() => {
                setOpen(false);
                void toggleFullscreen();
              }}
            />
          )}
          <MenuItem
            icon={<RotateCcw className="h-4 w-4" />}
            label="Reset statistik tampilan"
            onClick={() => {
              setOpen(false);
              onReset();
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
          {onMinimizeBrowser && (
            <MenuItem
              icon={<Minimize2 className="h-4 w-4" />}
              label="Perkecil Browser"
              onClick={() => {
                setOpen(false);
                onMinimizeBrowser();
              }}
            />
          )}
          <MenuItem
            icon={<AppWindow className="h-4 w-4" />}
            label="Tutup Browser"
            danger
            onClick={() => {
              setOpen(false);
              onCloseBrowser();
            }}
          />
          {onShutdown && (
            <MenuItem
              icon={<Power className="h-4 w-4" />}
              label="Matikan Perangkat"
              danger
              onClick={() => {
                setOpen(false);
                onShutdown();
              }}
            />
          )}
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


/**
 * Status kiriman scan ke server SIPANDAI (outbox backend). Scan selalu
 * tersimpan lokal dulu; chip ini memberi tahu petugas berapa yang belum
 * terkirim saat jaringan/server terganggu, dan kapan perlu login ulang.
 */
function ServerSyncChip({ onRelogin }: { onRelogin: () => void }) {
  const [summary, setSummary] = React.useState<ApiOutboxSummary | null>(null);
  const [device, setDevice] = React.useState<DeviceState | null>(null);
  React.useEffect(() => {
    const refresh = () => setSummary(getApiOutboxSummary());
    refresh();
    return subscribeApiOutbox(refresh);
  }, []);
  React.useEffect(() => {
    setDevice(getDeviceState());
    return subscribeDevice(setDevice);
  }, []);
  if (!summary || !device) return null;

  // Perangkat belum/tidak diizinkan & tak ada petugas yang login ke server →
  // kiriman tertahan sampai admin mengizinkan perangkat ini.
  const deviceBlocked = device.status !== "approved" && !isAuthed();

  let tone:
    | "ok"
    | "pending"
    | "failed"
    | "offline"
    | "syncing"
    | "login"
    | "device"
    | "revoked" = "ok";
  if (deviceBlocked && device.status === "revoked") tone = "revoked";
  else if (deviceBlocked) tone = "device";
  else if (summary.needsLogin) tone = "login";
  else if (summary.syncing > 0) tone = "syncing";
  else if (!summary.online) tone = "offline";
  else if (summary.failed > 0) tone = "failed";
  else if (summary.pending > 0) tone = "pending";

  const toneClass: Record<typeof tone, string> = {
    ok: "bg-emerald-100 text-emerald-700 ring-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
    pending:
      "bg-sky-100 text-sky-700 ring-sky-300 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30",
    failed:
      "bg-rose-100 text-rose-700 ring-rose-300 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
    login:
      "bg-rose-100 text-rose-700 ring-rose-300 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
    offline:
      "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
    syncing:
      "bg-cyan-100 text-cyan-700 ring-cyan-300 dark:bg-cyan-500/15 dark:text-cyan-300 dark:ring-cyan-500/30",
    device:
      "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
    revoked:
      "bg-rose-100 text-rose-700 ring-rose-300 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
  };

  const waiting = summary.pending > 0 ? ` · ${summary.pending} menunggu` : "";
  const code = device.code ?? "…";
  const label =
    tone === "device"
      ? `Menunggu izin · ${code}${waiting}`
      : tone === "revoked"
        ? `Perangkat dicabut${waiting}`
        : tone === "login"
      ? `Login ulang${waiting}`
      : tone === "syncing"
        ? `Mengirim ${summary.pending}…`
        : tone === "offline"
          ? `Server offline${waiting}`
          : tone === "failed"
            ? `Gagal kirim ${summary.failed}`
            : tone === "pending"
              ? `Menunggu ${summary.pending}`
              : "Server tersinkron";

  const icon =
    tone === "syncing" ? (
      <Loader2 className="h-3 w-3 animate-spin" />
    ) : tone === "offline" ? (
      <CloudOff className="h-3 w-3" />
    ) : (
      <Cloud className="h-3 w-3" />
    );

  const lastSync = summary.lastSyncedAt
    ? new Date(summary.lastSyncedAt).toLocaleTimeString("id-ID")
    : "belum pernah";
  const hint =
    tone === "device"
      ? `Perangkat ini belum diizinkan mengakses server. Minta admin mengizinkan kode ${code} di menu Perangkat. Scan tetap tersimpan dan terkirim otomatis setelah diizinkan.`
      : tone === "revoked"
        ? "Admin mencabut izin perangkat ini. Scan tetap tersimpan di perangkat; hubungi admin untuk mengizinkan kembali."
        : tone === "login"
      ? "Sesi server habis. Klik untuk login ulang; data yang menunggu tetap tersimpan dan terkirim setelah login."
      : tone === "offline"
        ? "Server tidak terjangkau. Scan tetap tersimpan di perangkat dan dikirim otomatis saat koneksi pulih."
        : "Klik untuk kirim sekarang.";

  return (
    <button
      type="button"
      onClick={() => {
        if (tone === "login") onRelogin();
        else if (tone === "device" || tone === "revoked")
          window.dispatchEvent(new CustomEvent("afvs:device-recheck"));
        else void flushApiOutbox({ maxItems: 100 });
      }}
      title={`${label} · terakhir terkirim: ${lastSync}${
        summary.lastError && tone !== "ok" ? ` · ${summary.lastError}` : ""
      }\n${hint}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 transition hover:brightness-110",
        toneClass[tone],
      )}
    >
      {icon}
      <span className="tabular-nums">{label}</span>
    </button>
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
    if (durationMs <= 0) return;
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
      {durationMs <= 0 ? (
      <p className="flex-1 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500 dark:text-ink-subtle">
        Tampil sampai ditutup
      </p>
      ) : (
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
      )}
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
      <span className="truncate font-bold">
        {v.ocrName ??
          (v.status === "manual_pass"
            ? "dicek manual petugas · sesuai"
            : v.status === "manual_reject"
              ? "dicek manual petugas · tidak sesuai"
              : "tidak terbaca")}
      </span>
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

function BoardingPassModalBody({
  last,
  onIdentityDecision,
}: {
  last: LastResult;
  /** Petugas membandingkan nama dengan KTP/SIM: true = sesuai. */
  onIdentityDecision?: (match: boolean) => void;
}) {
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

            {/* Nama penumpang — fokus utama: petugas mencocokkan dengan KTP/SIM.
                Tidak di-truncate supaya nama panjang terbaca utuh. */}
            <div className="relative mt-5 rounded-2xl bg-sky-50 px-5 py-4 ring-2 ring-sky-200">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-sky-700">
                <IdCard className="h-4 w-4" />
                Nama penumpang · cocokkan dengan identitas
              </p>
              <p className="mt-1 break-words text-4xl font-black leading-tight tracking-tight text-slate-900">
                {name}
              </p>
              <p className="mt-1.5 text-[12px] font-medium leading-snug text-slate-600">
                {parsed.passengerNameTruncated
                  ? "Nama di boarding pass terpotong (maks. 20 huruf) — cocokkan bagian awal nama. Urutan nama bisa berbeda dari identitas."
                  : "Urutan nama bisa berbeda dari identitas, dan gelar (MR/MRS/MS) bisa ikut tercetak."}
              </p>
            </div>

            {/* Rute */}
            <div className="relative mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl bg-slate-50 px-5 py-4 ring-1 ring-slate-100">
              <div className="min-w-0">
                <p className="text-3xl font-black leading-none tracking-tight text-slate-900">
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
                <p className="text-3xl font-black leading-none tracking-tight text-slate-900">
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
                    gate.length > 4 ? "text-3xl" : "text-5xl",
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
                <p className="text-4xl font-black leading-none tracking-tight text-slate-900">
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

      {onIdentityDecision && (
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onIdentityDecision(false)}
            className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-rose-600 text-lg font-black text-white shadow-md transition hover:bg-rose-700 active:scale-[0.98]"
          >
            <XCircle className="h-6 w-6" />
            Tidak sesuai
          </button>
          <button
            type="button"
            onClick={() => onIdentityDecision(true)}
            className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-lg font-black text-white shadow-md transition hover:bg-emerald-700 active:scale-[0.98]"
          >
            <CheckCircle2 className="h-6 w-6" />
            Sesuai
          </button>
        </div>
      )}
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
