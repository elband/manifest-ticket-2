"use client";

import * as React from "react";
import {
  Building2,
  CalendarClock,
  Clock,
  IdCard,
  Loader2,
  MapPin,
  Plane,
  UserRound,
  X,
} from "lucide-react";
import { AirlineLogo } from "@/components/ui/AirlineLogo";
import { FaceThumb } from "@/components/scan/FaceThumb";
import { getAirlineMeta } from "@/lib/airlines";
import { parseBarcode } from "@/lib/barcode";
import { daysUntil, formatPasDate } from "@/lib/pas";
import {
  apiGetPasScanDetail,
  type ApiPasScan,
  type PasCard,
  type PasStatus,
} from "@/lib/api/client";
import type { Flight, ScanEvent, ScanResultStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Kartu boarding pass / PAS bandara yang tampil di samping laci riwayat scan
 * kiosk saat salah satu baris disentuh. Animasi: kartu "ditarik" keluar dari
 * laci (putar 3D, melewati sedikit, mendarat), kilau menyapu permukaan, lalu
 * cap status jatuh seperti stempel.
 */

// ───────────────────────────── Panggung ─────────────────────────────

export function TicketStage({
  leaving,
  onDismiss,
  onActivity,
  children,
}: {
  leaving: boolean;
  onDismiss: () => void;
  /** Sentuhan di panggung dihitung aktivitas (laci tak menutup sendiri). */
  onActivity: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      // HP/tablet sempit: laci selebar layar → kartu menimpa laci dengan
      // latar gelap. Layar lebar: kartu di area kiri, di samping laci.
      className={cn(
        "absolute inset-0 z-20 flex items-center justify-center overflow-y-auto p-5 lg:right-[620px] lg:p-8",
        "max-lg:bg-kiosk-asphalt/75 max-lg:backdrop-blur-sm",
        leaving ? "animate-fade-out" : "max-lg:animate-fade-in",
      )}
      onClick={onDismiss}
      onPointerDown={onActivity}
    >
      <div className="relative my-auto w-full max-w-[460px] [perspective:1400px]">
        {/* Pendar lembut di belakang kartu. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-10 rounded-[48px] bg-kiosk-sign-glow/25 blur-3xl animate-ticket-glow motion-reduce:animate-none"
        />
        <div
          className={cn(
            "relative origin-right [transform-style:preserve-3d] motion-reduce:animate-none",
            leaving ? "animate-ticket-out" : "animate-ticket-in",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Tutup kartu"
            className="absolute -right-3 -top-3 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full bg-kiosk-asphalt text-white shadow-lg ring-2 ring-white/80 transition hover:bg-kiosk-cell animate-fade-in [animation-delay:0.6s] motion-reduce:animate-none"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="relative mt-4 text-center text-[13px] text-white/55 animate-fade-in [animation-delay:0.9s] motion-reduce:animate-none">
          Ketuk di luar kartu untuk menutup
        </p>
      </div>
    </div>
  );
}

// ───────────────────────────── Bagian bersama ─────────────────────────────

type StampTone = "go" | "hold" | "stop";

const STAMP_TONE: Record<StampTone, string> = {
  go: "border-emerald-600 text-emerald-600",
  hold: "border-amber-500 text-amber-600",
  stop: "border-rose-600 text-rose-600",
};

function Stamp({ label, tone, className }: { label: string; tone: StampTone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-10 select-none whitespace-nowrap rounded-lg border-[3px] bg-white/40 px-3 py-1 font-sign text-[22px] font-black uppercase leading-none tracking-[0.12em] mix-blend-multiply animate-stamp-in motion-reduce:animate-none",
        STAMP_TONE[tone],
        className,
      )}
      style={{ transform: "rotate(-12deg)" }}
    >
      {label}
    </span>
  );
}

/** Kilau cahaya yang menyapu permukaan kartu sekali setelah mendarat. */
function Shine() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <span className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/70 to-transparent animate-ticket-shine motion-reduce:hidden" />
    </span>
  );
}

/** Muncul berurutan setelah kartu mendarat. */
function Reveal({
  delay,
  className,
  children,
}: {
  delay: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("animate-fade-up motion-reduce:animate-none", className)}
      style={{ animationDelay: `${delay}s` }}
    >
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-slate-400">{children}</p>
  );
}

// Lubang perforasi asli (bukan lingkaran warna latar): sudut bawah bagian
// utama & sudut atas sobekan dilubangi lewat mask.
const NOTCH = 13;
const maskBottomNotches: React.CSSProperties = {
  WebkitMask: `radial-gradient(circle ${NOTCH}px at 0 100%, #0000 ${NOTCH - 0.5}px, #000 ${NOTCH}px) 0 0/51% 100% no-repeat, radial-gradient(circle ${NOTCH}px at 100% 100%, #0000 ${NOTCH - 0.5}px, #000 ${NOTCH}px) 100% 0/51% 100% no-repeat`,
  mask: `radial-gradient(circle ${NOTCH}px at 0 100%, #0000 ${NOTCH - 0.5}px, #000 ${NOTCH}px) 0 0/51% 100% no-repeat, radial-gradient(circle ${NOTCH}px at 100% 100%, #0000 ${NOTCH - 0.5}px, #000 ${NOTCH}px) 100% 0/51% 100% no-repeat`,
};
const maskTopNotches: React.CSSProperties = {
  WebkitMask: `radial-gradient(circle ${NOTCH}px at 0 0, #0000 ${NOTCH - 0.5}px, #000 ${NOTCH}px) 0 0/51% 100% no-repeat, radial-gradient(circle ${NOTCH}px at 100% 0, #0000 ${NOTCH - 0.5}px, #000 ${NOTCH}px) 100% 0/51% 100% no-repeat`,
  mask: `radial-gradient(circle ${NOTCH}px at 0 0, #0000 ${NOTCH - 0.5}px, #000 ${NOTCH}px) 0 0/51% 100% no-repeat, radial-gradient(circle ${NOTCH}px at 100% 0, #0000 ${NOTCH - 0.5}px, #000 ${NOTCH}px) 100% 0/51% 100% no-repeat`,
};

/** Garis barcode dekoratif, diturunkan dari isi barcode (selalu sama per scan). */
function DecorBarcode({ seed }: { seed: string }) {
  const bars = React.useMemo(() => {
    const out: number[] = [];
    let h = 2166136261;
    for (let i = 0; i < 64; i++) {
      h ^= seed.charCodeAt(i % Math.max(1, seed.length)) + i;
      h = Math.imul(h, 16777619) >>> 0;
      out.push((h % 3) + 1);
    }
    return out;
  }, [seed]);
  return (
    <div aria-hidden className="flex h-12 items-stretch gap-[2px] overflow-hidden">
      {bars.map((w, i) => (
        <span
          key={i}
          className={i % 2 ? "bg-transparent" : "bg-slate-900"}
          style={{ width: w * 2 }}
        />
      ))}
    </div>
  );
}

function fmtClock(iso: string): string {
  const t = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
}

/** "2026-11-04" → "04 NOV 2026". */
function bpDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const mon = ["JAN", "FEB", "MAR", "APR", "MEI", "JUN", "JUL", "AGU", "SEP", "OKT", "NOV", "DES"];
  return `${m[3]} ${mon[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

// ───────────────────────────── Boarding pass ─────────────────────────────

const BP_STAMP: Record<ScanResultStatus, { label: string; tone: StampTone }> = {
  VALID_FLIGHT: { label: "Valid", tone: "go" },
  DUPLICATE_SCAN: { label: "Duplikat", tone: "hold" },
  FLIGHT_NOT_TODAY: { label: "Ditolak", tone: "stop" },
  FLIGHT_NOT_ACTIVE: { label: "Ditolak", tone: "stop" },
  UNKNOWN_FLIGHT: { label: "Ditolak", tone: "stop" },
  INVALID_BARCODE: { label: "Ditolak", tone: "stop" },
  KTP_MISMATCH: { label: "Ditolak", tone: "stop" },
};

export function BoardingPassTicket({
  e,
  flight,
  officer,
}: {
  e: ScanEvent;
  flight: Flight | null;
  officer: string;
}) {
  const parsed = React.useMemo(() => parseBarcode(e.rawBarcode), [e.rawBarcode]);
  const flightNumber = flight?.flightNumber ?? e.parsedFlightNumber ?? parsed?.flightNumber ?? null;
  const airlineCode =
    flight?.airlineCode ??
    parsed?.airlineCode ??
    /^([A-Z0-9]{2})/i.exec(flightNumber ?? "")?.[1]?.toUpperCase() ??
    null;
  const airline = getAirlineMeta(airlineCode);
  const origin = flight?.originAirport ?? parsed?.originAirport ?? null;
  const dest = flight?.destinationAirport ?? parsed?.destinationAirport ?? null;
  const date = bpDate(flight?.departureDate ?? parsed?.flightDate);
  const stamp = BP_STAMP[e.resultStatus];
  const name = e.parsedPassengerName ?? parsed?.passengerName ?? null;

  return (
    <article
      aria-label={`Boarding pass ${name ?? ""}`}
      className="relative text-slate-900 [filter:drop-shadow(0_28px_40px_rgba(0,0,0,0.5))]"
    >
      {/* Bagian utama */}
      <div className="relative overflow-hidden rounded-t-[22px] bg-white" style={maskBottomNotches}>
        <div className={cn("relative flex items-center gap-3 bg-gradient-to-r px-5 py-4 text-white", airline.gradient)}>
          <AirlineLogo code={airlineCode} size="md" mode="chip" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[16px] font-extrabold tracking-tight">{airline.name}</p>
            <p className="text-[10.5px] font-bold uppercase tracking-[0.26em] opacity-85">
              Boarding Pass
            </p>
          </div>
          {e.isTest && (
            <span className="rounded bg-white/25 px-2 py-0.5 text-[11px] font-bold">UJI</span>
          )}
          <Plane className="h-6 w-6 shrink-0 opacity-85" />
        </div>

        <div className="relative space-y-4 px-5 pb-6 pt-5">
          <Stamp label={stamp.label} tone={stamp.tone} className="right-4 top-3" />

          <Reveal delay={0.3}>
            <Label>Nama penumpang</Label>
            <p className="mt-0.5 break-words pr-28 text-[22px] font-black uppercase leading-tight tracking-tight">
              {name ?? "Nama tidak terbaca"}
            </p>
          </Reveal>

          {(origin || dest) && (
            <Reveal delay={0.38} className="flex items-center gap-3">
              <span className="font-board text-[40px] font-bold leading-none">{origin ?? "—"}</span>
              <span className="relative h-0 flex-1 border-t-2 border-dashed border-slate-300">
                <Plane className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-white px-0.5 text-slate-500" />
              </span>
              <span className="font-board text-[40px] font-bold leading-none">{dest ?? "—"}</span>
            </Reveal>
          )}

          <Reveal delay={0.46} className="grid grid-cols-3 gap-x-4 gap-y-3">
            <div>
              <Label>Penerbangan</Label>
              <p className="font-board text-[22px] font-bold leading-tight">{flightNumber ?? "—"}</p>
            </div>
            <div>
              <Label>Tanggal</Label>
              <p className="text-[15px] font-extrabold leading-tight">{date ?? "—"}</p>
            </div>
            <div>
              <Label>Kursi</Label>
              <p className="font-board text-[30px] font-bold leading-none">
                {e.parsedSeatNumber ?? parsed?.seatNumber ?? "—"}
              </p>
            </div>
            <div>
              <Label>PNR</Label>
              <p className="font-mono text-[15px] font-extrabold">{e.parsedPnr ?? parsed?.pnr ?? "—"}</p>
            </div>
            <div className="col-span-2">
              <Label>No. tiket / Seq</Label>
              <p className="break-all font-mono text-[15px] font-extrabold">
                {e.parsedTicketNumber ?? parsed?.ticketNumber ?? "—"}
              </p>
            </div>
            {flight?.departureTime && (
              <div>
                <Label>Berangkat</Label>
                <p className="font-board text-[20px] font-bold leading-tight">{flight.departureTime}</p>
              </div>
            )}
            {flight?.gateOrCheckpoint && (
              <div className="col-span-2">
                <Label>Gate</Label>
                <p className="text-[15px] font-extrabold">{flight.gateOrCheckpoint}</p>
              </div>
            )}
          </Reveal>
        </div>
        <Shine />
      </div>

      {/* Garis sobek */}
      <div aria-hidden className="relative h-0 bg-white">
        <span className="absolute inset-x-[18px] top-0 border-t-2 border-dashed border-slate-300" />
      </div>

      {/* Sobekan (stub) */}
      <div className="relative overflow-hidden rounded-b-[22px] bg-white" style={maskTopNotches}>
        <div className="space-y-3 px-5 pb-5 pt-5">
          {stamp.tone === "stop" && e.message && (
            <Reveal delay={0.55}>
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13.5px] font-semibold leading-snug text-rose-800 ring-1 ring-rose-200">
                {e.message}
              </p>
            </Reveal>
          )}
          <Reveal delay={0.6} className="flex items-center gap-4">
            <FaceThumb
              faceCaptureId={e.faceCaptureId}
              size={76}
              alt={`Foto wajah ${name ?? "penumpang"}`}
              className="rounded-xl"
            />
            <div className="min-w-0 flex-1">
              <DecorBarcode seed={e.rawBarcode || e.id} />
              <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-500">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  Dipindai {fmtClock(e.scannedAt)} oleh {officer}
                </span>
              </p>
            </div>
          </Reveal>
        </div>
        <Shine />
      </div>
    </article>
  );
}

// ───────────────────────────── Kartu PAS ─────────────────────────────

const PAS_STAMP: Record<PasStatus, { label: string; tone: StampTone }> = {
  VALID: { label: "Valid", tone: "go" },
  EXPIRED: { label: "Kedaluwarsa", tone: "stop" },
  NOT_FOUND: { label: "Tak terdaftar", tone: "stop" },
  ERROR: { label: "Cek manual", tone: "hold" },
};

const CARD_COLOR_CSS: Record<string, string> = {
  MERAH: "#dc2626",
  BIRU: "#2563eb",
  KUNING: "#eab308",
  HIJAU: "#16a34a",
  PUTIH: "#e2e8f0",
  ORANYE: "#f97316",
  JINGGA: "#f97316",
  UNGU: "#7c3aed",
  HITAM: "#111827",
  ABU: "#9ca3af",
};

function todayWita(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Makassar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function PasTicket({ scan, officer }: { scan: ApiPasScan; officer: string }) {
  // Foto tidak disimpan di DB — ambil data kartu terkini dari server PAS.
  const [live, setLive] = React.useState<{ loading: boolean; card: PasCard | null }>({
    loading: true,
    card: null,
  });
  React.useEffect(() => {
    let active = true;
    setLive({ loading: true, card: null });
    apiGetPasScanDetail(scan.id).then((res) => {
      if (active) setLive({ loading: false, card: res.ok ? (res.data?.live.card ?? null) : null });
    });
    return () => {
      active = false;
    };
  }, [scan.id]);

  const card = live.card;
  const name = scan.name ?? card?.name ?? null;
  const position = scan.position ?? card?.position ?? null;
  const company = scan.company ?? card?.company ?? null;
  const pasNumber = scan.pasNumber ?? card?.pasNumber ?? null;
  const cardColor = scan.cardColor ?? card?.cardColor ?? null;
  const validUntil = scan.validUntil ?? card?.validUntil ?? null;
  const areaCodes = scan.areaCodes
    ? scan.areaCodes.split(/\s+/).filter(Boolean)
    : (card?.areaCodes ?? []);
  const colorCss =
    card?.cardColorCss ?? (cardColor ? CARD_COLOR_CSS[cardColor.toUpperCase()] : null) ?? "#0f172a";
  const left = daysUntil(validUntil, todayWita());
  const stamp = PAS_STAMP[scan.status] ?? PAS_STAMP.ERROR;

  return (
    <article
      aria-label={`Kartu PAS ${name ?? ""}`}
      className="relative mx-auto max-w-[400px] overflow-hidden rounded-[24px] bg-white text-slate-900 shadow-[0_28px_60px_-12px_rgba(0,0,0,0.6)]"
    >
      {/* Pita warna kartu + lubang tali */}
      <div className="relative h-24 px-5 pt-4 text-white" style={{ background: colorCss }}>
        <span className="absolute inset-0 bg-gradient-to-br from-white/25 via-transparent to-black/25" />
        <span
          aria-hidden
          className="absolute left-1/2 top-3 h-3 w-16 -translate-x-1/2 rounded-full bg-black/45 shadow-inner"
        />
        <div className="relative mt-4 flex items-center justify-between">
          <p className="text-[12px] font-black uppercase tracking-[0.3em] drop-shadow">Pas Bandara</p>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] opacity-90 drop-shadow">
            {scan.passType ?? card?.passType ?? ""}
          </p>
        </div>
      </div>

      <div className="relative -mt-10 flex flex-col items-center px-5 pb-6 text-center">
        <Stamp label={stamp.label} tone={stamp.tone} className="right-3 top-14" />

        <Reveal delay={0.25}>
          {card?.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={card.photoUrl}
              alt={`Foto ${name ?? "pemegang pas"}`}
              referrerPolicy="no-referrer"
              className="h-40 w-32 rounded-2xl bg-slate-200 object-cover shadow-lg ring-4 ring-white"
            />
          ) : (
            <div className="grid h-40 w-32 place-items-center rounded-2xl bg-slate-200 text-slate-400 shadow-lg ring-4 ring-white">
              {live.loading ? <Loader2 className="h-8 w-8 animate-spin" /> : <UserRound className="h-14 w-14" />}
            </div>
          )}
        </Reveal>

        <Reveal delay={0.35} className="mt-3 w-full">
          <p className="break-words text-[22px] font-black uppercase leading-tight tracking-tight">
            {name ?? "Kartu tidak terdaftar"}
          </p>
          {(position || company) && (
            <p className="mt-1 flex items-center justify-center gap-1.5 text-[14px] font-semibold text-slate-600">
              <Building2 className="h-4 w-4 shrink-0" />
              <span className="min-w-0 break-words">{[position, company].filter(Boolean).join(" · ")}</span>
            </p>
          )}
        </Reveal>

        <Reveal delay={0.45} className="mt-4 grid w-full grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-200 pt-4 text-left">
          <div className="col-span-2">
            <Label>Nomor pas</Label>
            <p className="flex items-center gap-1.5 font-mono text-[17px] font-extrabold">
              <IdCard className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="break-all">{pasNumber ?? "—"}</span>
            </p>
          </div>
          <div>
            <Label>Kategori</Label>
            <p className="text-[15px] font-extrabold">{scan.category ?? card?.category ?? "—"}</p>
          </div>
          <div>
            <Label>Warna kartu</Label>
            <p className="flex items-center gap-2 text-[15px] font-extrabold">
              {cardColor && (
                <span className="h-4 w-4 shrink-0 rounded ring-1 ring-black/15" style={{ background: colorCss }} />
              )}
              {cardColor ?? "—"}
            </p>
          </div>
          <div className="col-span-2">
            <Label>Berlaku s/d</Label>
            <p
              className={cn(
                "flex flex-wrap items-center gap-1.5 text-[15px] font-extrabold",
                scan.status === "EXPIRED" && "text-rose-600",
              )}
            >
              <CalendarClock className="h-4 w-4 shrink-0" />
              {formatPasDate(validUntil)}
              {left != null && (
                <span className="text-[12px] font-semibold text-slate-500">
                  {left < 0 ? `(lewat ${-left} hari)` : left === 0 ? "(hari terakhir)" : `(${left} hari lagi)`}
                </span>
              )}
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.55} className="mt-4 w-full border-t border-slate-200 pt-4 text-left">
          <p className="flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[0.18em] text-slate-400">
            <MapPin className="h-3 w-3" />
            Kode area
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {areaCodes.length ? (
              areaCodes.map((a) => (
                <span
                  key={a}
                  className="grid h-10 min-w-10 place-items-center rounded-lg bg-slate-900 px-2 font-mono text-[19px] font-black text-white"
                >
                  {a}
                </span>
              ))
            ) : (
              <span className="text-[14px] font-semibold text-slate-500">—</span>
            )}
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-500">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            Dicek {fmtClock(scan.createdAt)} oleh {officer}
          </p>
        </Reveal>
      </div>
      <Shine />
    </article>
  );
}
