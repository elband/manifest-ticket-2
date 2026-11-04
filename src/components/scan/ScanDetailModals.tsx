"use client";

import * as React from "react";
import {
  AlertOctagon,
  AlertTriangle,
  BadgeCheck,
  CalendarX2,
  Camera,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Fingerprint,
  IdCard,
  Loader2,
  MapPin,
  Monitor,
  Plane,
  ScanLine,
  UserRound,
} from "lucide-react";
import { Modal, type ModalTone } from "@/components/ui/Modal";
import { AirlineLogo } from "@/components/ui/AirlineLogo";
import {
  ApiPasScan,
  ApiPasScanDetail,
  ApiScanEvent,
  PasCard,
  PasStatus,
  apiGetPasScanDetail,
  getFacePhotoObjectUrl,
} from "@/lib/api/client";
import { parseBarcode } from "@/lib/barcode";
import { getAirlineMeta } from "@/lib/airlines";
import { cn } from "@/lib/utils";
import { PasResultBody } from "./PasResultBody";

const STATION_LABEL: Record<string, string> = {
  SCP2: "SCP 2",
  BLUESKY: "Lounge Bluesky",
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function MetaItem({
  icon,
  label,
  children,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-ink-subtle">
        {icon}
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 break-words text-[13px] font-semibold text-slate-800 dark:text-ink",
          mono && "break-all font-mono text-[12px]",
        )}
      >
        {children}
      </p>
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
    >
      Tutup
    </button>
  );
}

// ───────────────────────────── Boarding pass ─────────────────────────────

const RESULT_META: Record<string, { label: string; tone: ModalTone; icon: React.ReactNode }> = {
  VALID_FLIGHT: { label: "Valid", tone: "success", icon: <CheckCircle2 className="h-5 w-5" /> },
  DUPLICATE_SCAN: { label: "Duplikat", tone: "warning", icon: <Copy className="h-5 w-5" /> },
  FLIGHT_NOT_TODAY: { label: "Bukan hari ini", tone: "danger", icon: <AlertOctagon className="h-5 w-5" /> },
  FLIGHT_NOT_ACTIVE: { label: "Flight tidak aktif", tone: "danger", icon: <AlertOctagon className="h-5 w-5" /> },
  UNKNOWN_FLIGHT: { label: "Flight tidak dikenal", tone: "danger", icon: <AlertOctagon className="h-5 w-5" /> },
  INVALID_BARCODE: { label: "Barcode rusak", tone: "danger", icon: <AlertOctagon className="h-5 w-5" /> },
  KTP_MISMATCH: { label: "KTP tidak cocok", tone: "danger", icon: <AlertOctagon className="h-5 w-5" /> },
};

const KTP_LABEL: Record<string, string> = {
  matched: "Cocok (OCR otomatis)",
  mismatch: "Tidak cocok (OCR otomatis)",
  manual_pass: "Sesuai — diputuskan petugas",
  manual_reject: "Tidak sesuai — diputuskan petugas",
  skipped: "Dilewati",
  ocr_failed: "OCR gagal membaca",
  exempted: "Dikecualikan (tanpa KTP)",
};

const TONE_BOX: Record<ModalTone, string> = {
  success: "bg-emerald-50 text-emerald-900 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-100 dark:ring-emerald-500/30",
  warning: "bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/30",
  danger: "bg-rose-50 text-rose-900 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-100 dark:ring-rose-500/30",
  info: "bg-blue-50 text-blue-900 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-100 dark:ring-blue-500/30",
  brand: "bg-violet-50 text-violet-900 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-100 dark:ring-violet-500/30",
};

/** "2026-11-04" → "04 NOV 2026" (gaya boarding pass). */
function bpDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const mon = ["JAN", "FEB", "MAR", "APR", "MEI", "JUN", "JUL", "AGU", "SEP", "OKT", "NOV", "DES"];
  return `${m[3]} ${mon[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

function useFacePhoto(eventId: string | null, enabled: boolean) {
  const [state, setState] = React.useState<{ url: string | null; loading: boolean }>({
    url: null,
    loading: false,
  });
  React.useEffect(() => {
    if (!eventId || !enabled) {
      setState({ url: null, loading: false });
      return;
    }
    let active = true;
    let created: string | null = null;
    setState({ url: null, loading: true });
    getFacePhotoObjectUrl(eventId).then((u) => {
      if (!active) {
        if (u) URL.revokeObjectURL(u);
        return;
      }
      created = u;
      setState({ url: u, loading: false });
    });
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [eventId, enabled]);
  return state;
}

export function BoardingScanModal({
  ev,
  onClose,
}: {
  ev: ApiScanEvent | null;
  onClose: () => void;
}) {
  const photo = useFacePhoto(ev?.eventId ?? null, Boolean(ev?.facePhotoPath));
  if (!ev) return null;

  const parsed = parseBarcode(ev.rawBarcode);
  const airlineCode =
    parsed?.airlineCode ?? /^([A-Z0-9]{2})/i.exec(ev.flightNumber ?? "")?.[1]?.toUpperCase() ?? null;
  const airline = getAirlineMeta(airlineCode);
  const rm = RESULT_META[ev.resultStatus] ?? {
    label: ev.resultStatus.replace(/_/g, " ").toLowerCase(),
    tone: "danger" as ModalTone,
    icon: <AlertOctagon className="h-5 w-5" />,
  };
  const name = ev.passengerName ?? parsed?.passengerName ?? null;
  const origin = parsed?.originAirport ?? null;
  const dest = parsed?.destinationAirport ?? null;
  const flightDate = bpDate(parsed?.flightDate);

  return (
    <Modal
      open
      onClose={onClose}
      tone={rm.tone}
      size="xl"
      icon={<ScanLine className="h-5 w-5" />}
      title="Detail Scan Boarding Pass"
      description={`${STATION_LABEL[ev.station] ?? ev.station} · ${fmtDateTime(ev.scannedAt)}`}
      footer={<CloseButton onClose={onClose} />}
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          {/* Kartu boarding pass */}
          <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm dark:bg-white/5 dark:ring-hairline">
            <div
              className={cn(
                "flex items-center gap-3 bg-gradient-to-r px-4 py-3 text-white",
                airline.gradient,
              )}
            >
              <AirlineLogo code={airlineCode} size="md" mode="chip" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold tracking-tight">{airline.name}</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] opacity-80">
                  Boarding Pass
                </p>
              </div>
              <Plane className="h-5 w-5 shrink-0 opacity-80" />
            </div>

            <div className="space-y-4 px-4 py-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-ink-subtle">
                  Nama Penumpang
                </p>
                <p className="break-words text-xl font-black uppercase leading-tight tracking-tight text-slate-900 dark:text-ink">
                  {name ?? "—"}
                </p>
              </div>

              {(origin || dest) && (
                <div className="flex items-center gap-3">
                  <span className="font-mono text-3xl font-black text-slate-900 dark:text-ink">
                    {origin ?? "—"}
                  </span>
                  <span className="relative h-px flex-1 border-t-2 border-dashed border-slate-300 dark:border-white/20">
                    <Plane className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-white text-slate-400 dark:bg-surface" />
                  </span>
                  <span className="font-mono text-3xl font-black text-slate-900 dark:text-ink">
                    {dest ?? "—"}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <BpField label="Penerbangan">{ev.flightNumber ?? parsed?.flightNumber ?? "—"}</BpField>
                <BpField label="Tanggal">{flightDate ?? "—"}</BpField>
                <BpField label="Kursi" big>
                  {ev.seat ?? parsed?.seatNumber ?? "—"}
                </BpField>
                <BpField label="Kode Booking (PNR)" mono>
                  {ev.pnr ?? parsed?.pnr ?? "—"}
                </BpField>
                <BpField label="No. Tiket / Seq" mono className="sm:col-span-2">
                  {ev.ticketNumber ?? parsed?.ticketNumber ?? "—"}
                </BpField>
              </div>
            </div>

            {/* Perforasi */}
            <div className="relative border-t-2 border-dashed border-slate-200 dark:border-white/10">
              <span className="absolute -left-2 -top-2 h-4 w-4 rounded-full bg-white ring-1 ring-slate-200 dark:bg-surface dark:ring-hairline" />
              <span className="absolute -right-2 -top-2 h-4 w-4 rounded-full bg-white ring-1 ring-slate-200 dark:bg-surface dark:ring-hairline" />
            </div>
            <div className="px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-ink-subtle">
                Isi barcode
              </p>
              <p className="mt-1 break-all rounded-lg bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-slate-600 ring-1 ring-slate-100 dark:bg-black/20 dark:text-ink-muted dark:ring-hairline-soft">
                {ev.rawBarcode}
              </p>
            </div>
          </div>

          {/* Foto wajah */}
          <div className="flex flex-col items-center gap-2 sm:items-stretch">
            {photo.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photo.url}
                alt={`Foto wajah ${name ?? "penumpang"}`}
                className="h-60 w-48 rounded-2xl bg-slate-200 object-cover ring-1 ring-slate-200 sm:h-64 sm:w-full dark:bg-white/10 dark:ring-white/10"
              />
            ) : (
              <div className="grid h-60 w-48 place-items-center rounded-2xl bg-slate-100 text-slate-400 ring-1 ring-slate-200 sm:h-64 sm:w-full dark:bg-white/5 dark:ring-hairline">
                {photo.loading ? (
                  <Loader2 className="h-8 w-8 animate-spin" />
                ) : (
                  <div className="flex flex-col items-center gap-2 px-3 text-center">
                    <UserRound className="h-14 w-14" />
                    <span className="text-[11px] font-semibold">
                      {ev.facePhotoPath ? "Foto tidak bisa dimuat" : "Tanpa foto wajah"}
                    </span>
                  </div>
                )}
              </div>
            )}
            <p className="flex items-center justify-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-ink-muted">
              <Camera className="h-3.5 w-3.5" />
              Foto wajah saat scan
            </p>
          </div>
        </div>

        {/* Hasil scan */}
        <div className={cn("flex items-start gap-3 rounded-2xl px-4 py-3 ring-1", TONE_BOX[rm.tone])}>
          <span className="mt-0.5 shrink-0">{rm.icon}</span>
          <div className="min-w-0">
            <p className="text-sm font-extrabold uppercase tracking-wide">{rm.label}</p>
            {ev.message && <p className="mt-0.5 text-[13px] leading-snug">{ev.message}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100 sm:grid-cols-4 dark:bg-white/5 dark:ring-hairline-soft">
          <MetaItem icon={<Fingerprint className="h-3 w-3" />} label="Cek KTP/SIM">
            {ev.ktpStatus ? (KTP_LABEL[ev.ktpStatus] ?? ev.ktpStatus) : "—"}
          </MetaItem>
          <MetaItem icon={<IdCard className="h-3 w-3" />} label="Nama di KTP">
            {ev.ktpName ?? "—"}
          </MetaItem>
          <MetaItem icon={<BadgeCheck className="h-3 w-3" />} label="Kemiripan nama">
            {ev.ktpSimilarity != null ? `${Math.round(ev.ktpSimilarity * 100)}%` : "—"}
          </MetaItem>
          <MetaItem icon={<MapPin className="h-3 w-3" />} label="Pos">
            {STATION_LABEL[ev.station] ?? ev.station}
          </MetaItem>
          <MetaItem icon={<Clock className="h-3 w-3" />} label="Waktu scan">
            {fmtDateTime(ev.scannedAt)}
          </MetaItem>
          <MetaItem icon={<ScanLine className="h-3 w-3" />} label="ID event" mono>
            {ev.eventId}
          </MetaItem>
        </div>
      </div>
    </Modal>
  );
}

function BpField({
  label,
  children,
  mono,
  big,
  className,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  big?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-ink-subtle">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 break-words font-extrabold text-slate-900 dark:text-ink",
          big ? "text-2xl leading-none" : "text-[15px]",
          mono && "font-mono",
        )}
      >
        {children}
      </p>
    </div>
  );
}

// ───────────────────────────── Kartu PAS ─────────────────────────────

const PAS_META: Record<PasStatus, { label: string; tone: ModalTone; icon: React.ReactNode }> = {
  VALID: { label: "PAS bandara valid", tone: "success", icon: <BadgeCheck className="h-5 w-5" /> },
  EXPIRED: { label: "PAS kedaluwarsa", tone: "danger", icon: <CalendarX2 className="h-5 w-5" /> },
  NOT_FOUND: { label: "PAS tidak terdaftar", tone: "danger", icon: <AlertOctagon className="h-5 w-5" /> },
  ERROR: { label: "Cek manual", tone: "warning", icon: <AlertTriangle className="h-5 w-5" /> },
};

/** Kartu dari data tersimpan saat scan, dilengkapi data terkini (foto dll.) dari server PAS. */
function mergeCard(scan: ApiPasScan, live: PasCard | null | undefined): PasCard | null {
  const hasStored = Boolean(scan.name || scan.pasNumber);
  if (!hasStored && !live) return null;
  return {
    name: scan.name ?? live?.name ?? null,
    position: scan.position ?? live?.position ?? null,
    company: scan.company ?? live?.company ?? null,
    category: scan.category ?? live?.category ?? null,
    categoryNote: live?.categoryNote ?? null,
    pasNumber: scan.pasNumber ?? live?.pasNumber ?? null,
    cardColor: scan.cardColor ?? live?.cardColor ?? null,
    cardColorCss: live?.cardColorCss ?? null,
    passType: scan.passType ?? live?.passType ?? null,
    issuedAt: scan.issuedAt ?? live?.issuedAt ?? null,
    validUntil: scan.validUntil ?? live?.validUntil ?? null,
    areaCodes: scan.areaCodes ? scan.areaCodes.split(/\s+/).filter(Boolean) : (live?.areaCodes ?? []),
    photoUrl: live?.photoUrl ?? null,
  };
}

export function PasScanModal({
  scan,
  onClose,
}: {
  scan: ApiPasScan | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = React.useState<
    | { phase: "loading" }
    | { phase: "done"; data: ApiPasScanDetail }
    | { phase: "failed"; error: string }
  >({ phase: "loading" });

  React.useEffect(() => {
    if (!scan) return;
    let active = true;
    setDetail({ phase: "loading" });
    apiGetPasScanDetail(scan.id).then((res) => {
      if (!active) return;
      if (res.ok && res.data) setDetail({ phase: "done", data: res.data });
      else setDetail({ phase: "failed", error: res.error ?? "Gagal mengambil data kartu." });
    });
    return () => {
      active = false;
    };
  }, [scan]);

  if (!scan) return null;

  const meta = PAS_META[scan.status] ?? PAS_META.ERROR;
  const live = detail.phase === "done" ? detail.data.live : null;
  const card = mergeCard(scan, live?.card);
  const device = detail.phase === "done" ? detail.data.scan.device?.name : null;
  const sourceUrl = detail.phase === "done" ? detail.data.sourceUrl : null;

  return (
    <Modal
      open
      onClose={onClose}
      tone={meta.tone}
      size="xl"
      icon={meta.icon}
      title={`Kartu PAS — ${meta.label}`}
      description={`${STATION_LABEL[scan.station] ?? scan.station} · ${fmtDateTime(scan.createdAt)}`}
      footer={
        <>
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mr-auto inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-blue-700 transition hover:bg-blue-50 dark:text-sky-300 dark:hover:bg-white/5"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Buka di pas.aptpairport.id
            </a>
          )}
          <CloseButton onClose={onClose} />
        </>
      }
    >
      <div className="space-y-4">
        {card ? (
          <PasResultBody
            hideGuidance
            photoLoading={detail.phase === "loading"}
            state={{
              phase: "done",
              key: scan.id,
              result: {
                id: scan.id,
                pasId: scan.pasId,
                status: scan.status,
                message: "",
                card,
                checkedAt: scan.createdAt,
              },
            }}
          />
        ) : (
          <div className={cn("flex items-start gap-3 rounded-2xl px-4 py-3 ring-1", TONE_BOX[meta.tone])}>
            <span className="mt-0.5 shrink-0">{meta.icon}</span>
            <p className="text-[13.5px] font-semibold leading-snug">
              {detail.phase === "loading"
                ? "Mengambil data kartu dari server PAS…"
                : "Tidak ada data kartu untuk scan ini — kartu tidak terdaftar atau server PAS tidak bisa dihubungi saat itu."}
            </p>
          </div>
        )}

        {/* Catatan data terkini dari server PAS */}
        {detail.phase === "failed" && (
          <Notice tone="warning">Foto kartu tidak bisa diambil: {detail.error}</Notice>
        )}
        {live && live.status === "ERROR" && <Notice tone="warning">{live.message}</Notice>}
        {live && live.status !== "ERROR" && live.status !== scan.status && (
          <Notice tone="info">
            Status terkini di server PAS: <b>{PAS_META[live.status].label}</b> — {live.message}
          </Notice>
        )}
        {live && live.card && !live.card.photoUrl && (
          <Notice tone="info">Server PAS tidak menyediakan foto untuk kartu ini.</Notice>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100 sm:grid-cols-3 dark:bg-white/5 dark:ring-hairline-soft">
          <MetaItem icon={<MapPin className="h-3 w-3" />} label="Pos">
            {STATION_LABEL[scan.station] ?? scan.station}
          </MetaItem>
          <MetaItem icon={<UserRound className="h-3 w-3" />} label="Petugas">
            {scan.operator?.name ?? "—"}
          </MetaItem>
          <MetaItem icon={<Monitor className="h-3 w-3" />} label="Perangkat">
            {detail.phase === "loading" ? "…" : (device ?? "—")}
          </MetaItem>
          <MetaItem icon={<Clock className="h-3 w-3" />} label="Waktu cek">
            {fmtDateTime(scan.createdAt)}
          </MetaItem>
          <MetaItem icon={<IdCard className="h-3 w-3" />} label="ID kartu (QR)" mono>
            {scan.pasId}
          </MetaItem>
        </div>
      </div>
    </Modal>
  );
}

function Notice({ tone, children }: { tone: ModalTone; children: React.ReactNode }) {
  return (
    <div className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-[12.5px] ring-1", TONE_BOX[tone])}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="leading-snug">{children}</p>
    </div>
  );
}
