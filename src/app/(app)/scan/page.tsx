"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ScanLine,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  CopyCheck,
  Plane,
  Clock,
  Volume2,
  VolumeX,
  Bug,
  Camera,
  User,
  Calendar,
  Route,
  Armchair,
  DoorOpen,
  Printer,
  Sparkles,
  Monitor,
  FlaskConical,
  ScanBarcode,
} from "lucide-react";
import { CameraScanner } from "@/components/scan/CameraScanner";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { FlightStatusBadge } from "@/components/ui/StatusBadge";
import {
  Flight,
  ScanEvent,
  ScanResultStatus,
  SessionUser,
} from "@/lib/types";
import { getFlights, getScanEvents, getSession } from "@/lib/storage";
import {
  playFeedbackHaptic,
  playFeedbackSound,
  primeFeedbackAudio,
  processScan,
} from "@/lib/scanService";
import { canManageFlights } from "@/lib/auth";
import { applyTestFlightForBarcode } from "@/lib/testFlights";
import { testFlightsEnabled } from "@/lib/dummyFlight";
import { formatTime, todayDateString } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { getSettings, saveSettings, subscribeSettings } from "@/lib/settings";
import { useToast } from "@/components/ui/Toast";
import { PageHero, HeroChip } from "@/components/layout/PageHero";

interface LastResult {
  status: ScanResultStatus;
  message: string;
  raw: string;
  flightNumber: string | null;
  seat: string | null;
  passengerName: string | null;
  pnr: string | null;
  scannedAt: string;
  origin: string | null;
  destination: string | null;
  gate: string | null;
  departureDate: string | null;
  departureTime: string | null;
  /** Hasil pada penerbangan UJI (bukan data operasional). */
  isTest: boolean;
}

export default function ScanPage() {
  return (
    <Suspense
      fallback={
        <>
          <div className="flex h-[60vh] items-center justify-center">
            <div className="flex items-center gap-3 rounded-2xl bg-white/90 px-5 py-3 text-sm text-slate-600 shadow-card ring-1 ring-slate-200 backdrop-blur">
              <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
              Memuat pos validasi...
            </div>
          </div>
        </>
      }
    >
      <ScanPageContent />
    </Suspense>
  );
}

function ScanPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const source = searchParams?.get("source");
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [session, setSession] = useState<SessionUser | null>(null);
  const [last, setLast] = useState<LastResult | null>(null);
  const [recent, setRecent] = useState<ScanEvent[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [soundOn, setSoundOn] = useState(true);
  const [debugOn, setDebugOn] = useState(false);
  const [keyLog, setKeyLog] = useState<string[]>([]);
  const [pulseKey, setPulseKey] = useState(0);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [resultModalOpen, setResultModalOpen] = useState(false);
  // "Scan ulang pakai scanner": tampilkan penanda siap sampai scan berikutnya masuk.
  const [awaitingScanner, setAwaitingScanner] = useState(false);
  const toast = useToast();

  useEffect(() => {
    primeFeedbackAudio();
    const s = getSession();
    setSession(s);
    setFlights(getFlights());
    setRecent(getScanEvents().slice(0, 8));
    setSoundOn(getSettings().soundOn);
    const unsub = subscribeSettings((next) => setSoundOn(next.soundOn));
    setTimeout(() => inputRef.current?.focus(), 50);
    return unsub;
  }, []);

  // honor ?source=camera|usb|manual from BottomNav scan picker
  useEffect(() => {
    if (source === "camera") {
      setCameraOpen(true);
    } else if (source === "usb" || source === "manual") {
      setCameraOpen(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [source]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    saveSettings({ soundOn: next });
  };

  useEffect(() => {
    const handler = () => {
      if (document.activeElement !== inputRef.current) {
        inputRef.current?.focus();
      }
    };
    const t = window.setInterval(handler, 1500);
    return () => window.clearInterval(t);
  }, []);

  const today = todayDateString();
  const flightsToday = useMemo(
    () =>
      flights
        .filter((f) => f.departureDate === today)
        .sort((a, b) => a.departureTime.localeCompare(b.departureTime)),
    [flights, today],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (debugOn) {
      const k = e.key.length === 1 ? e.key : `<${e.key}>`;
      setKeyLog((prev) => [...prev.slice(-119), k]);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  const submit = (rawInput?: string) => {
    if (!session) return;
    const raw = rawInput ?? value;
    if (!raw.trim()) {
      setValue("");
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    setAwaitingScanner(false);
    const { outcome, event } = processScan(raw, session.email);
    playFeedbackSound(outcome.status);
    playFeedbackHaptic(outcome.status);
    if (outcome.status === "VALID_FLIGHT") {
      toast.success(
        `${outcome.flight?.flightNumber ?? "Flight"} · seat ${outcome.parsed?.seatNumber ?? "—"}`,
        event.isTest ? "Valid — penerbangan uji" : "Valid",
      );
    } else if (outcome.status === "DUPLICATE_SCAN") {
      toast.warning(outcome.message, "Duplicate - valid hari ini");
    } else {
      toast.error(outcome.message, "Rejected");
    }
    setLast({
      status: outcome.status,
      message: outcome.message,
      raw: event.rawBarcode,
      flightNumber:
        outcome.flight?.flightNumber ?? outcome.parsed?.flightNumber ?? null,
      seat: outcome.parsed?.seatNumber ?? null,
      passengerName: outcome.parsed?.passengerName ?? null,
      pnr: outcome.parsed?.pnr ?? null,
      scannedAt: event.scannedAt,
      origin: outcome.flight?.originAirport ?? null,
      destination: outcome.flight?.destinationAirport ?? null,
      gate: outcome.flight?.gateOrCheckpoint ?? null,
      departureDate: outcome.flight?.departureDate ?? null,
      departureTime: outcome.flight?.departureTime ?? null,
      isTest: event.isTest === true,
    });
    setRecent(getScanEvents().slice(0, 8));
    setPulseKey((k) => k + 1);
    setValue("");
    setCameraOpen(false);
    setResultModalOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // Scanner mode keyboard (USB HID) tetap jalan saat modal hasil terbuka:
  // fokus tidak di input, jadi tangkap ketikan di window & proses saat Enter.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (!resultModalOpen) return;
    let buffer = "";
    const onKey = (e: KeyboardEvent) => {
      if (e.target === inputRef.current) return;
      if (e.key === "Enter") {
        if (buffer.trim()) {
          e.preventDefault();
          const raw = buffer;
          buffer = "";
          submitRef.current(raw);
        }
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        buffer += e.key;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [resultModalOpen]);

  // Testing: barcode ditolak (flight tak dikenal / bukan hari ini / tidak
  // aktif) → siapkan PENERBANGAN UJI hari ini, lalu scan ulang barcode ASLI.
  const createTestFlightAndRescan = (raw: string) => {
    const res = applyTestFlightForBarcode(raw);
    if (!res.ok) {
      toast.error(
        res.reason === "conflict"
          ? `${res.flight.flightNumber} adalah penerbangan terjadwal hari ini — tidak bisa dijadikan penerbangan uji. Pakai boarding pass dengan nomor flight lain.`
          : res.reason === "disabled"
            ? "Fitur penerbangan uji dimatikan di lingkungan ini."
            : "Barcode tidak dikenali, penerbangan uji tidak dibuat.",
        "Penerbangan uji ditolak",
      );
      return;
    }
    setFlights(getFlights());
    toast.success(
      `${res.flight.flightNumber} · ${res.flight.originAirport} → ${res.flight.destinationAirport}`,
      res.created ? "Penerbangan uji dibuat" : "Penerbangan uji dibuka",
    );
    submit(raw);
  };

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-3">
        {/* Scanner area */}
        <div className="space-y-5 xl:col-span-2">
          <PageHero
            tone="emerald"
            eyebrow="Pos Validasi"
            eyebrowIcon={<ScanLine className="h-3.5 w-3.5" />}
            ghostIcon={<ScanLine className="h-full w-full" strokeWidth={1.5} />}
            title="Pos Validasi Boarding Pass"
            description="Scan barcode dengan scanner USB/Bluetooth. Input tersubmit otomatis saat scanner mengirim Enter."
            actions={
              <>
                <button
                  onClick={() => router.push("/scan/kiosk")}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-2 text-xs font-semibold text-white shadow-sm ring-1 ring-white/20 transition hover:shadow-lift"
                  title="Buka mode Kiosk fullscreen (scanner USB + capture wajah)"
                >
                  <Monitor className="h-3.5 w-3.5" />
                  Mode Kiosk
                </button>
                <button
                  onClick={() => setCameraOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-emerald-700 shadow-sm ring-1 ring-white/40 transition hover:shadow-lift"
                >
                  <Camera className="h-3.5 w-3.5" />
                  Pakai Kamera
                </button>
                <button
                  onClick={() => {
                    setDebugOn((v) => !v);
                    setKeyLog([]);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold ring-1 backdrop-blur transition",
                    debugOn
                      ? "bg-amber-100 text-amber-800 ring-amber-200"
                      : "bg-white/15 text-white ring-white/25 hover:bg-white/25",
                  )}
                >
                  <Bug className="h-3.5 w-3.5" />
                  {debugOn ? "Debug ON" : "Debug"}
                </button>
                <button
                  onClick={toggleSound}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold ring-1 backdrop-blur transition",
                    soundOn
                      ? "bg-white text-emerald-700 ring-white/40"
                      : "bg-white/15 text-white ring-white/25 hover:bg-white/25",
                  )}
                >
                  {soundOn ? (
                    <>
                      <Volume2 className="h-3.5 w-3.5" /> Sound aktif
                    </>
                  ) : (
                    <>
                      <VolumeX className="h-3.5 w-3.5" /> Sound mati
                    </>
                  )}
                </button>
              </>
            }
            meta={
              <HeroChip
                icon={<ScanLine className="h-3 w-3" />}
                label="Recent"
                value={recent.length}
              />
            }
          />

          <Card className="animate-fade-up stagger-1">
            <div className="deco-blob -right-16 -top-16 h-48 w-48 bg-blue-200" />
            <div className="deco-blob -bottom-16 -left-16 h-48 w-48 bg-cyan-200 opacity-40" />
            <CardBody>
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-700/80">
                  Barcode Boarding Pass
                </span>
                {awaitingScanner && (
                  <div className="mt-2 flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm animate-fade-up">
                    <ScanBarcode className="h-4 w-4 shrink-0 animate-pulse" />
                    Scanner siap — dekatkan barcode boarding pass ke scanner.
                  </div>
                )}
                <div className="relative mt-2 animate-pulse-glow rounded-2xl">
                  <ScanLine className="absolute left-4 top-1/2 -translate-y-1/2 h-6 w-6 text-blue-600" />
                  <Input
                    ref={inputRef}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="GA123|AB12CD|990001|12A"
                    className="h-16 border-blue-200 bg-white pl-14 text-lg font-mono tracking-wide shadow-inner focus:border-blue-400 focus:ring-blue-200"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Mendukung barcode boarding pass asli (IATA BCBP) maupun
                  format MVP <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-700">FLIGHT|PNR|TICKET|SEAT</code>. Tekan Enter
                  untuk submit manual.
                </p>
              </label>
            </CardBody>
          </Card>

          {debugOn && (
            <Card className="animate-fade-up border-amber-200/80">
              <CardHeader>
                <CardTitle>
                  <span className="inline-flex items-center gap-2 text-amber-800">
                    <Bug className="h-4 w-4" />
                    Debug Scanner
                  </span>
                </CardTitle>
                <button
                  className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200 transition hover:bg-amber-100"
                  onClick={() => setKeyLog([])}
                >
                  Clear
                </button>
              </CardHeader>
              <CardBody className="space-y-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Raw keystrokes (urutan persis dari scanner)
                  </p>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-3 text-xs text-emerald-300 ring-1 ring-slate-800">
                    {keyLog.length === 0
                      ? "(belum ada keystroke — scan sekali sambil input ter-focus)"
                      : keyLog.join("")}
                  </pre>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Isi input sekarang (sebelum Enter)
                  </p>
                  <code className="mt-1 block break-all rounded-xl bg-slate-50 p-3 text-xs text-slate-700 ring-1 ring-slate-100">
                    {value || "(empty)"}
                  </code>
                </div>
                <p className="text-[11px] text-slate-500">
                  Tekan tombol scanner lagi — Anda akan lihat persis karakter
                  yang dikirim. Jika hasilnya hanya angka pendek seperti
                  <code className="mx-1 rounded bg-slate-100 px-1">0035</code>
                  berarti scanner Anda 1D-only dan membaca barcode sequence
                  number, bukan PDF417 BCBP.
                </p>
              </CardBody>
            </Card>
          )}

          <div key={pulseKey} className="animate-fade-up">
            <ResultCard last={last} />
          </div>

          <Card className="animate-fade-up stagger-2 lift">
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-100 text-cyan-700 ring-1 ring-cyan-200">
                    <ScanLine className="h-3.5 w-3.5" />
                  </span>
                  Scan Terbaru
                </span>
              </CardTitle>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
                {recent.length} entry
              </span>
            </CardHeader>
            <CardBody className="p-0">
              {recent.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-slate-500">
                  Belum ada hasil scan. Mulai pindai boarding pass.
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {recent.map((e, idx) => (
                    <li
                      key={e.id}
                      className="animate-fade-up px-5 py-3 transition hover:bg-blue-50/40"
                      style={{ animationDelay: `${idx * 40}ms` }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-semibold text-slate-800">
                          {e.parsedFlightNumber ?? "—"}{" "}
                          <span className="font-normal text-slate-400">
                            · seat {e.parsedSeatNumber ?? "—"}
                          </span>
                        </p>
                        <ResultPill status={e.resultStatus} />
                      </div>
                      {e.parsedPassengerName && (
                        <p className="mt-0.5 text-[12px] text-slate-700">
                          {e.parsedPassengerName}
                        </p>
                      )}
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {formatTime(e.scannedAt)} — {e.message}
                      </p>
                      <code className="mt-1 block truncate rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-500 ring-1 ring-slate-100">
                        {e.rawBarcode || "(empty)"}
                      </code>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Side: today flights */}
        <div>
          <Card className="animate-fade-up stagger-3 lift">
            <div className="deco-blob -right-10 -top-10 h-32 w-32 bg-blue-200" />
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700 ring-1 ring-blue-200">
                    <Plane className="h-3.5 w-3.5" />
                  </span>
                  Flight Hari Ini
                </span>
              </CardTitle>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
                {today}
              </span>
            </CardHeader>
            <CardBody className="p-0">
              {flightsToday.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-slate-500">
                  Tidak ada flight hari ini.
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {flightsToday.map((f, idx) => (
                    <li
                      key={f.id}
                      className="animate-fade-up px-5 py-3 transition hover:bg-blue-50/40"
                      style={{ animationDelay: `${idx * 50}ms` }}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-slate-800">
                          {f.flightNumber}
                        </p>
                        <FlightStatusBadge status={f.status} />
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {f.originAirport} → {f.destinationAirport} ·{" "}
                        {f.gateOrCheckpoint}
                      </p>
                      <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-500">
                        <Clock className="h-3 w-3" />
                        {f.departureTime}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
      <CameraScanner
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onDecode={(raw) => submit(raw)}
      />
      <ScanResultModal
        open={resultModalOpen}
        last={last}
        onClose={() => {
          setResultModalOpen(false);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        onScanAgainCamera={() => {
          setResultModalOpen(false);
          setCameraOpen(true);
        }}
        onScanAgainScanner={() => {
          setResultModalOpen(false);
          setAwaitingScanner(true);
          setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }, 0);
        }}
        onCreateDummy={
          canManageFlights(session?.role) && testFlightsEnabled()
            ? createTestFlightAndRescan
            : undefined
        }
      />
    </>
  );
}

function ScanResultModal({
  open,
  last,
  onClose,
  onScanAgainCamera,
  onScanAgainScanner,
  onCreateDummy,
}: {
  open: boolean;
  last: LastResult | null;
  onClose: () => void;
  onScanAgainCamera: () => void;
  /** Scan ulang pakai scanner barcode fisik (USB, mis. Blueprint). */
  onScanAgainScanner: () => void;
  /** Hanya untuk admin/supervisor — tampil saat flight tak dikenal / bukan
   *  hari ini / tidak aktif. */
  onCreateDummy?: (raw: string) => void;
}) {
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    if (!open) setShowDetail(false);
  }, [open]);

  if (!last) return null;
  const theme = getResultTheme(last.status);
  const Icon = theme.icon;
  const isValid = last.status === "VALID_FLIGHT";

  const printPass = () => {
    if (typeof window === "undefined") return;
    window.print();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      hideClose
      closeOnBackdrop
    >
      <div className="relative -mx-5 -my-4 overflow-hidden rounded-xl">
        {/* Soft tinted backdrop */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 -z-10 opacity-90",
            theme.bgWash,
          )}
        />
        {/* Decorative concentric circles in background */}
        <svg
          aria-hidden
          viewBox="0 0 400 400"
          className={cn(
            "pointer-events-none absolute -left-10 top-1/2 -z-10 h-[340px] w-[340px] -translate-y-1/2 opacity-25",
            theme.ringStroke,
          )}
        >
          <circle cx="200" cy="200" r="60" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="200" cy="200" r="110" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 6" />
          <circle cx="200" cy="200" r="160" fill="none" stroke="currentColor" strokeWidth="0.8" />
          <circle cx="200" cy="40" r="3" fill="currentColor" />
          <circle cx="60" cy="200" r="2.5" fill="currentColor" />
          <circle cx="200" cy="360" r="2" fill="currentColor" />
        </svg>

        <div className="relative grid gap-6 px-6 py-7 sm:px-8 sm:py-8 md:grid-cols-[210px,1fr] md:items-center">
          {/* Animated icon */}
          <div className="relative mx-auto flex h-[200px] w-[200px] items-center justify-center md:mx-0">
            {/* Ripple rings */}
            <span
              aria-hidden
              className={cn(
                "absolute inset-0 rounded-full ring-2",
                theme.ripple,
              )}
              style={{ animation: "ripple 2.4s ease-out infinite" }}
            />
            <span
              aria-hidden
              className={cn(
                "absolute inset-4 rounded-full ring-2",
                theme.ripple,
              )}
              style={{ animation: "ripple 2.4s ease-out infinite", animationDelay: "0.8s" }}
            />
            <span
              aria-hidden
              className={cn(
                "absolute inset-8 rounded-full ring-2",
                theme.ripple,
              )}
              style={{ animation: "ripple 2.4s ease-out infinite", animationDelay: "1.6s" }}
            />

            {/* Decorative orbit dots */}
            <span
              aria-hidden
              className={cn("absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full", theme.dot)}
              style={{ "--orbit-r": "92px", animation: "orbit-dot 6s linear infinite" } as React.CSSProperties}
            />
            <span
              aria-hidden
              className={cn("absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full", theme.dot)}
              style={{ "--orbit-r": "76px", animation: "orbit-dot 4s linear infinite reverse" } as React.CSSProperties}
            />

            {/* Center badge */}
            <div
              className={cn(
                "relative flex h-[110px] w-[110px] items-center justify-center rounded-[28px] shadow-[0_18px_40px_-10px_rgba(0,0,0,0.25)] animate-check-pop",
                theme.badgeBg,
              )}
            >
              <span
                aria-hidden
                className="absolute inset-1 rounded-[24px] bg-white/15 backdrop-blur-sm"
              />
              <Icon className="relative h-14 w-14 text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.25)]" strokeWidth={2.5} />
            </div>

            {/* Top notch dot */}
            <span
              aria-hidden
              className={cn(
                "absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full ring-2 ring-white",
                theme.dot,
              )}
            />
          </div>

          {/* Content */}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-slate-500">
                Status Validasi
              </span>
              <span className={cn("inline-flex items-center gap-1 text-[22px] font-extrabold tracking-tight sm:text-[26px]", theme.titleText)}>
                {theme.title.toUpperCase()}
                <span className={cn("ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full", theme.badgeBg)}>
                  <Icon className="h-3 w-3 text-white" strokeWidth={3} />
                </span>
              </span>
              {last.isTest && (
                <span
                  title="Penerbangan uji — bukan data operasional, tidak dikirim ke server"
                  className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-white"
                >
                  <FlaskConical className="h-3 w-3" />
                  Uji
                </span>
              )}
            </div>

            <p className="mt-1 text-[13.5px] text-slate-600">
              {last.isTest ? last.message : (theme.tagline ?? last.message)}
            </p>

            {/* Top chip row: Penumpang / Flight / Tanggal */}
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <DetailChip
                icon={<User className="h-3.5 w-3.5" />}
                label="Penumpang"
                value={last.passengerName ?? "—"}
                iconBg="bg-slate-100 text-slate-600"
              />
              <DetailChip
                icon={<Plane className="h-3.5 w-3.5" />}
                label="Flight"
                value={last.flightNumber ?? "—"}
                iconBg="bg-blue-100 text-blue-600"
              />
              <DetailChip
                icon={<Calendar className="h-3.5 w-3.5" />}
                label="Tanggal"
                value={formatShortDate(last.departureDate)}
                iconBg="bg-violet-100 text-violet-600"
              />
            </div>

            {/* Bottom chip row: Rute / Seat / Gate / Waktu */}
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <DetailChip
                icon={<Route className="h-3.5 w-3.5" />}
                label="Rute"
                value={
                  last.origin && last.destination
                    ? `${last.origin} → ${last.destination}`
                    : "—"
                }
                iconBg="bg-cyan-100 text-cyan-600"
              />
              <DetailChip
                icon={<Armchair className="h-3.5 w-3.5" />}
                label="Seat"
                value={last.seat ?? "—"}
                iconBg="bg-amber-100 text-amber-600"
              />
              <DetailChip
                icon={<DoorOpen className="h-3.5 w-3.5" />}
                label="Gate"
                value={last.gate ?? "—"}
                iconBg="bg-rose-100 text-rose-600"
              />
              <DetailChip
                icon={<Clock className="h-3.5 w-3.5" />}
                label="Waktu"
                value={last.departureTime ?? formatTime(last.scannedAt).slice(0, 5)}
                iconBg="bg-emerald-100 text-emerald-600"
              />
            </div>

            {/* Detail expansion */}
            {showDetail && (
              <div className="mt-3 animate-fade-up rounded-xl bg-white/70 p-3 ring-1 ring-slate-200 backdrop-blur-sm">
                <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
                  Detail Tambahan
                </p>
                <dl className="mt-1.5 grid grid-cols-2 gap-2 text-[12px]">
                  <div>
                    <dt className="text-slate-500">PNR</dt>
                    <dd className="font-semibold text-slate-800">{last.pnr ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Scan jam</dt>
                    <dd className="font-semibold text-slate-800">{formatTime(last.scannedAt)}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-slate-500">Pesan</dt>
                    <dd className="font-medium text-slate-700">{last.message}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-slate-500">Barcode</dt>
                    <dd>
                      <code className="mt-0.5 block break-all rounded-md bg-slate-900 px-2 py-1.5 text-[11px] text-emerald-300">
                        {last.raw || "(empty)"}
                      </code>
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            {/* Actions */}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowDetail((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-[12.5px] font-semibold text-slate-700 ring-1 ring-slate-200 shadow-sm transition hover:bg-slate-50 hover:ring-slate-300"
              >
                {showDetail ? "Sembunyikan Detail" : "Lihat Detail"}
              </button>
              {isValid ? (
                <button
                  type="button"
                  onClick={printPass}
                  className={cn(
                    "group inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[12.5px] font-bold text-white shadow-[0_10px_24px_-6px_rgba(16,185,129,0.55)] ring-1 transition hover:-translate-y-0.5 hover:shadow-[0_14px_28px_-6px_rgba(16,185,129,0.7)]",
                    theme.ctaBg,
                    theme.ctaRing,
                  )}
                >
                  <Printer className="h-3.5 w-3.5" />
                  Cetak / Simpan
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={onScanAgainScanner}
                    title="Tutup hasil & siapkan scan berikutnya dari scanner barcode USB"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[12.5px] font-bold text-white shadow-sm ring-1 transition hover:-translate-y-0.5",
                      theme.ctaBg,
                      theme.ctaRing,
                    )}
                  >
                    <ScanBarcode className="h-3.5 w-3.5" />
                    Scan Ulang (Scanner)
                  </button>
                  <button
                    type="button"
                    onClick={onScanAgainCamera}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-[12.5px] font-semibold text-slate-700 ring-1 ring-slate-200 shadow-sm transition hover:bg-slate-50 hover:ring-slate-300"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    Kamera
                  </button>
                </>
              )}
              {onCreateDummy &&
                (last.status === "UNKNOWN_FLIGHT" ||
                  last.status === "FLIGHT_NOT_TODAY" ||
                  last.status === "FLIGHT_NOT_ACTIVE") && (
                <button
                  type="button"
                  onClick={() => onCreateDummy(last.raw)}
                  title="Testing: siapkan penerbangan uji hari ini untuk barcode ini (tanggal barcode diabaikan), lalu scan ulang barcode yang sama"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-[12.5px] font-bold text-white shadow-sm ring-1 ring-blue-700 transition hover:-translate-y-0.5 hover:bg-blue-700"
                >
                  <FlaskConical className="h-3.5 w-3.5" />
                  Jadikan Penerbangan Uji &amp; Scan Ulang
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900/5 px-3.5 py-2.5 text-[12.5px] font-semibold text-slate-600 transition hover:bg-slate-900/10"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function DetailChip({
  icon,
  label,
  value,
  iconBg,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  iconBg: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-white/85 px-3 py-2 ring-1 ring-slate-200/70 shadow-sm backdrop-blur-sm">
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset", iconBg)}>
        {icon}
      </span>
      <div className="min-w-0 leading-tight">
        <p className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-500">
          {label}
        </p>
        <p className="truncate text-[13px] font-bold text-slate-800">{value}</p>
      </div>
    </div>
  );
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

interface ResultTheme {
  icon: typeof CheckCircle2;
  title: string;
  tagline: string;
  bgWash: string;
  ringStroke: string;
  ripple: string;
  dot: string;
  badgeBg: string;
  titleText: string;
  ctaBg: string;
  ctaRing: string;
}

function getResultTheme(status: ScanResultStatus): ResultTheme {
  switch (status) {
    case "VALID_FLIGHT":
      return {
        icon: CheckCircle2,
        title: "Valid Flight",
        tagline: "Boarding pass valid. Selamat terbang!",
        bgWash: "bg-gradient-to-br from-emerald-50 via-white to-teal-50",
        ringStroke: "text-emerald-400",
        ripple: "ring-emerald-300/60",
        dot: "bg-emerald-400",
        badgeBg: "bg-gradient-to-br from-emerald-400 to-teal-500",
        titleText: "text-emerald-600",
        ctaBg: "bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600",
        ctaRing: "ring-emerald-300/60",
      };
    case "DUPLICATE_SCAN":
      return {
        icon: CopyCheck,
        title: "Duplicate - Valid Hari Ini",
        tagline:
          "Boarding pass cocok untuk flight hari ini, tetapi sudah pernah discan.",
        bgWash: "bg-gradient-to-br from-amber-50 via-white to-orange-50",
        ringStroke: "text-amber-400",
        ripple: "ring-amber-300/60",
        dot: "bg-amber-400",
        badgeBg: "bg-gradient-to-br from-amber-400 to-orange-500",
        titleText: "text-amber-600",
        ctaBg: "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600",
        ctaRing: "ring-amber-300/60",
      };
    case "FLIGHT_NOT_TODAY":
      return {
        icon: AlertTriangle,
        title: "Bukan Hari Ini",
        tagline: "Tanggal penerbangan tidak sesuai dengan hari ini.",
        bgWash: "bg-gradient-to-br from-rose-50 via-white to-pink-50",
        ringStroke: "text-rose-400",
        ripple: "ring-rose-300/60",
        dot: "bg-rose-400",
        badgeBg: "bg-gradient-to-br from-rose-400 to-pink-500",
        titleText: "text-rose-600",
        ctaBg: "bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600",
        ctaRing: "ring-rose-300/60",
      };
    case "FLIGHT_NOT_ACTIVE":
      return {
        icon: AlertTriangle,
        title: "Flight Tidak Aktif",
        tagline: "Status flight tidak memperbolehkan validasi saat ini.",
        bgWash: "bg-gradient-to-br from-rose-50 via-white to-pink-50",
        ringStroke: "text-rose-400",
        ripple: "ring-rose-300/60",
        dot: "bg-rose-400",
        badgeBg: "bg-gradient-to-br from-rose-400 to-pink-500",
        titleText: "text-rose-600",
        ctaBg: "bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600",
        ctaRing: "ring-rose-300/60",
      };
    case "UNKNOWN_FLIGHT":
      return {
        icon: XCircle,
        title: "Flight Tidak Dikenal",
        tagline: "Flight number tidak ditemukan di sistem.",
        bgWash: "bg-gradient-to-br from-rose-50 via-white to-pink-50",
        ringStroke: "text-rose-400",
        ripple: "ring-rose-300/60",
        dot: "bg-rose-400",
        badgeBg: "bg-gradient-to-br from-rose-400 to-pink-500",
        titleText: "text-rose-600",
        ctaBg: "bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600",
        ctaRing: "ring-rose-300/60",
      };
    case "INVALID_BARCODE":
    default:
      return {
        icon: XCircle,
        title: "Barcode Invalid",
        tagline: "Format barcode tidak dapat dibaca. Coba scan ulang.",
        bgWash: "bg-gradient-to-br from-rose-50 via-white to-pink-50",
        ringStroke: "text-rose-400",
        ripple: "ring-rose-300/60",
        dot: "bg-rose-400",
        badgeBg: "bg-gradient-to-br from-rose-400 to-pink-500",
        titleText: "text-rose-600",
        ctaBg: "bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600",
        ctaRing: "ring-rose-300/60",
      };
  }
}

function ResultCard({ last }: { last: LastResult | null }) {
  if (!last) {
    return (
      <Card className="border-dashed border-slate-200">
        <CardBody className="py-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 text-slate-400 ring-1 ring-slate-200">
            <ScanLine className="h-7 w-7" />
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-700">
            Menunggu scan…
          </p>
          <p className="text-xs text-slate-500">
            Arahkan barcode boarding pass ke scanner.
          </p>
        </CardBody>
      </Card>
    );
  }

  const cfg = getResultConfig(last.status);
  const Icon = cfg.icon;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border p-6 shadow-card transition-all duration-300",
        cfg.container,
        cfg.glowAnim,
      )}
    >
      <div className={cn("deco-blob -right-10 -top-10 h-32 w-32", cfg.blob)} />
      <div className="relative z-[1] flex items-start gap-4">
        <div
          className={cn(
            "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset shadow-sm animate-badge-pop",
            cfg.iconBg,
          )}
        >
          <Icon className={cn("h-7 w-7", cfg.iconColor)} />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-[11px] font-bold uppercase tracking-wider",
              cfg.label,
            )}
          >
            {cfg.title}
          </p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            {last.flightNumber ?? "—"}
            {last.seat && (
              <span className="text-lg font-normal text-slate-400">
                {"  "}· seat {last.seat}
              </span>
            )}
          </p>
          {last.passengerName && (
            <p className="mt-0.5 text-sm font-medium text-slate-700">
              {last.passengerName}
              {last.pnr && last.pnr !== "—" && (
                <span className="font-normal text-slate-400">
                  {"  "}· PNR {last.pnr}
                </span>
              )}
            </p>
          )}
          <p className="mt-1 text-sm text-slate-700">{last.message}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
            <span>
              <strong className="text-slate-600">Barcode:</strong>{" "}
              <code className="text-slate-700">{last.raw || "(empty)"}</code>
            </span>
            <span>
              <strong className="text-slate-600">Waktu:</strong>{" "}
              {formatTime(last.scannedAt)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultPill({ status }: { status: ScanResultStatus }) {
  const cfg = getResultConfig(status);
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
        cfg.pill,
      )}
    >
      <Icon className="h-3 w-3" />
      {cfg.title}
    </span>
  );
}

function getResultConfig(status: ScanResultStatus) {
  switch (status) {
    case "VALID_FLIGHT":
      return {
        title: "Valid Flight",
        icon: CheckCircle2,
        container:
          "bg-gradient-to-br from-emerald-50 via-white to-green-100 border-emerald-200",
        iconBg: "bg-white ring-emerald-200",
        iconColor: "text-emerald-600",
        label: "text-emerald-700",
        pill: "bg-emerald-50 text-emerald-700 ring-emerald-200",
        blob: "bg-emerald-300",
        glowAnim: "animate-pulse-glow-emerald",
      };
    case "DUPLICATE_SCAN":
      return {
        title: "Duplicate - Valid Hari Ini",
        icon: CopyCheck,
        container:
          "bg-gradient-to-br from-amber-50 via-white to-yellow-100 border-amber-200",
        iconBg: "bg-white ring-amber-200",
        iconColor: "text-amber-600",
        label: "text-amber-700",
        pill: "bg-amber-50 text-amber-700 ring-amber-200",
        blob: "bg-amber-300",
        glowAnim: "",
      };
    case "FLIGHT_NOT_TODAY":
      return {
        title: "Bukan Hari Ini",
        icon: AlertTriangle,
        container:
          "bg-gradient-to-br from-rose-50 via-white to-pink-100 border-rose-200",
        iconBg: "bg-white ring-rose-200",
        iconColor: "text-rose-600",
        label: "text-rose-700",
        pill: "bg-rose-50 text-rose-700 ring-rose-200",
        blob: "bg-rose-300",
        glowAnim: "animate-pulse-glow-rose",
      };
    case "FLIGHT_NOT_ACTIVE":
      return {
        title: "Flight Tidak Aktif",
        icon: AlertTriangle,
        container:
          "bg-gradient-to-br from-rose-50 via-white to-pink-100 border-rose-200",
        iconBg: "bg-white ring-rose-200",
        iconColor: "text-rose-600",
        label: "text-rose-700",
        pill: "bg-rose-50 text-rose-700 ring-rose-200",
        blob: "bg-rose-300",
        glowAnim: "animate-pulse-glow-rose",
      };
    case "UNKNOWN_FLIGHT":
      return {
        title: "Flight Tidak Dikenal",
        icon: XCircle,
        container:
          "bg-gradient-to-br from-rose-50 via-white to-pink-100 border-rose-200",
        iconBg: "bg-white ring-rose-200",
        iconColor: "text-rose-600",
        label: "text-rose-700",
        pill: "bg-rose-50 text-rose-700 ring-rose-200",
        blob: "bg-rose-300",
        glowAnim: "animate-pulse-glow-rose",
      };
    case "INVALID_BARCODE":
    default:
      return {
        title: "Barcode Invalid",
        icon: XCircle,
        container:
          "bg-gradient-to-br from-rose-50 via-white to-pink-100 border-rose-200",
        iconBg: "bg-white ring-rose-200",
        iconColor: "text-rose-600",
        label: "text-rose-700",
        pill: "bg-rose-50 text-rose-700 ring-rose-200",
        blob: "bg-rose-300",
        glowAnim: "animate-pulse-glow-rose",
      };
  }
}
