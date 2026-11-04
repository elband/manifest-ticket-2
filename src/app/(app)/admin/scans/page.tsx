"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertOctagon,
  AlertTriangle,
  BadgeCheck,
  CalendarX2,
  Camera,
  CheckCircle2,
  Copy,
  Database,
  IdCard,
  Loader2,
  MapPin,
  RefreshCw,
  Server,
  ShieldAlert,
  User as UserIcon,
} from "lucide-react";
import { cn, todayDateString } from "@/lib/utils";
import {
  ApiPasScan,
  ApiScanEvent,
  apiListAllScans,
  apiListPasScans,
  getFacePhotoObjectUrl,
  isAuthed,
  subscribeAuth,
} from "@/lib/api/client";
import { getSession } from "@/lib/storage";
import { Pagination } from "@/components/ui/Pagination";
import { BoardingScanModal, PasScanModal } from "@/components/scan/ScanDetailModals";

const PAGE_SIZE = 25; // P-08: render bertahap, bukan 200 baris sekaligus

const STATIONS = [
  { key: "", label: "Semua pos" },
  { key: "SCP2", label: "SCP 2" },
  { key: "BLUESKY", label: "Lounge Bluesky" },
];

const STATION_LABEL: Record<string, string> = {
  SCP2: "SCP 2",
  BLUESKY: "Lounge Bluesky",
};

const RESULT_STYLE: Record<
  string,
  { label: string; cls: string; icon: React.ComponentType<{ className?: string }> }
> = {
  VALID_FLIGHT: {
    label: "Valid",
    cls: "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300",
    icon: CheckCircle2,
  },
  DUPLICATE_SCAN: {
    label: "Duplikat",
    cls: "bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300",
    icon: Copy,
  },
};
const RESULT_FALLBACK = {
  cls: "bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300",
  icon: AlertOctagon,
};

const PAS_STYLE: Record<
  string,
  { label: string; cls: string; icon: React.ComponentType<{ className?: string }> }
> = {
  VALID: {
    label: "Valid",
    cls: "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300",
    icon: BadgeCheck,
  },
  EXPIRED: {
    label: "Kedaluwarsa",
    cls: RESULT_FALLBACK.cls,
    icon: CalendarX2,
  },
  NOT_FOUND: {
    label: "Tidak terdaftar",
    cls: RESULT_FALLBACK.cls,
    icon: AlertOctagon,
  },
  ERROR: {
    label: "Cek manual",
    cls: "bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300",
    icon: AlertTriangle,
  },
};

/** Riwayat PAS diambil sekaligus (backend cap 200/halaman) lalu dipaginasi di klien. */
const PAS_MAX_PAGES = 25;

type ScanKind = "boarding" | "pas";

export default function AdminScansPage() {
  const [authed, setAuthed] = useState(false);
  const [kind, setKind] = useState<ScanKind>("boarding");
  const [station, setStation] = useState("");
  const [date, setDate] = useState(() => todayDateString());
  const [items, setItems] = useState<ApiScanEvent[]>([]);
  const [pasItems, setPasItems] = useState<ApiPasScan[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  // Halaman Koneksi Backend khusus admin; role lain login ulang lewat /login.
  const [canConnect, setCanConnect] = useState(false);
  const [openScan, setOpenScan] = useState<ApiScanEvent | null>(null);
  const [openPas, setOpenPas] = useState<ApiPasScan | null>(null);
  const closeScan = useCallback(() => setOpenScan(null), []);
  const closePas = useCallback(() => setOpenPas(null), []);

  useEffect(() => {
    setCanConnect(getSession()?.role === "admin");
  }, []);

  const load = useCallback(async () => {
    if (!isAuthed()) {
      setAuthed(false);
      return;
    }
    setAuthed(true);
    setStatus("loading");
    if (kind === "pas") {
      const all: ApiPasScan[] = [];
      let err: string | null = null;
      let count = 0;
      for (let p = 1; p <= PAS_MAX_PAGES; p++) {
        const res = await apiListPasScans({
          station: station || undefined,
          date: date || undefined,
          page: p,
          perPage: 200,
        });
        if (!res.ok || !res.data) {
          err = res.error ?? "Gagal memuat data.";
          break;
        }
        all.push(...res.data.items);
        count = res.data.total;
        if (res.data.items.length === 0 || all.length >= count) break;
      }
      if (err) {
        setStatus("error");
        setError(err);
      } else {
        setPasItems(all);
        setTotal(count);
        setStatus("ok");
        setError(null);
      }
      return;
    }
    const res = await apiListAllScans({
      station: station || undefined,
      date: date || undefined,
    });
    if (res.ok && res.data) {
      setItems(res.data.items);
      setTotal(res.data.total);
      setStatus("ok");
      setError(null);
    } else {
      setStatus("error");
      setError(res.error ?? "Gagal memuat data.");
    }
  }, [kind, station, date]);

  useEffect(() => {
    load();
    const off = subscribeAuth(() => load());
    return off;
  }, [load]);

  const stats = useMemo(() => {
    const s = {
      total: items.length,
      scp2: 0,
      bluesky: 0,
      valid: 0,
      duplicate: 0,
      rejected: 0,
    };
    for (const it of items) {
      if (it.station === "SCP2") s.scp2++;
      else if (it.station === "BLUESKY") s.bluesky++;
      if (it.resultStatus === "VALID_FLIGHT") s.valid++;
      else if (it.resultStatus === "DUPLICATE_SCAN") s.duplicate++;
      else s.rejected++;
    }
    return s;
  }, [items]);

  const pasStats = useMemo(() => {
    const s = { total: pasItems.length, valid: 0, expired: 0, notFound: 0, error: 0 };
    for (const it of pasItems) {
      if (it.status === "VALID") s.valid++;
      else if (it.status === "EXPIRED") s.expired++;
      else if (it.status === "NOT_FOUND") s.notFound++;
      else s.error++;
    }
    return s;
  }, [pasItems]);

  // P-08: paginasi client-side — hanya ~25 baris (& ~25 fetch foto) per halaman.
  const listLength = kind === "pas" ? pasItems.length : items.length;
  const totalPages = Math.max(1, Math.ceil(listLength / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = useMemo(
    () => items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [items, currentPage],
  );
  const paginatedPas = useMemo(
    () => pasItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [pasItems, currentPage],
  );
  useEffect(() => {
    setPage(1);
  }, [kind, station, date]);

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <section className="flex flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white/95 p-5 shadow-card dark:border-hairline dark:bg-surface/95 sm:flex-row sm:items-end sm:justify-between sm:p-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-blue-700 ring-1 ring-blue-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/25">
              <Database className="h-3.5 w-3.5" />
              Monitor Scan · Server
            </div>
            <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-ink">
              Scan Gabungan 2 Titik Pemeriksaan
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Data scan dari <b>SCP 2</b> &amp; <b>Lounge Bluesky</b> langsung dari
              backend (bukan data lokal gate ini).
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={status === "loading"}
            className="inline-flex items-center gap-1.5 self-start rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
          >
            {status === "loading" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </button>
        </section>

        {!authed ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50/70 p-6 text-center dark:border-amber-500/25 dark:bg-amber-500/10">
            <Server className="mx-auto h-8 w-8 text-amber-600" />
            <p className="mt-2 text-sm font-semibold text-ink">
              Belum tersambung ke backend
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              {canConnect
                ? "Login dulu ke server untuk melihat scan dari kedua pos."
                : "Keluar lalu login ulang untuk menyambung ke server."}
            </p>
            {canConnect && (
              <Link
                href="/connect"
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-blue-700"
              >
                Buka Koneksi Backend
              </Link>
            )}
          </section>
        ) : (
          <>
            {/* Jenis scan */}
            <div className="inline-flex gap-1 self-start rounded-2xl border border-slate-200/70 bg-white/95 p-1 shadow-card dark:border-hairline dark:bg-surface/95">
              {(
                [
                  { key: "boarding", label: "Boarding pass", icon: Database },
                  { key: "pas", label: "Kartu PAS karyawan", icon: IdCard },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setKind(t.key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold transition",
                    kind === t.key
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              ))}
            </div>

            {/* Stats */}
            {kind === "pas" ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard label="Total cek PAS" value={pasStats.total} tone="slate" icon={<IdCard className="h-4 w-4" />} />
              <StatCard label="Valid" value={pasStats.valid} tone="emerald" icon={<BadgeCheck className="h-4 w-4" />} />
              <StatCard label="Kedaluwarsa" value={pasStats.expired} tone="rose" icon={<CalendarX2 className="h-4 w-4" />} />
              <StatCard label="Tidak terdaftar" value={pasStats.notFound} tone="rose" icon={<ShieldAlert className="h-4 w-4" />} />
              <StatCard label="Cek manual" value={pasStats.error} tone="amber" icon={<AlertTriangle className="h-4 w-4" />} />
            </div>
            ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard label="Total scan" value={stats.total} tone="slate" icon={<Database className="h-4 w-4" />} />
              <StatCard label="SCP 2" value={stats.scp2} tone="sky" icon={<MapPin className="h-4 w-4" />} />
              <StatCard label="Lounge Bluesky" value={stats.bluesky} tone="violet" icon={<MapPin className="h-4 w-4" />} />
              <StatCard label="Valid" value={stats.valid} tone="emerald" icon={<CheckCircle2 className="h-4 w-4" />} />
              <StatCard label="Duplikat" value={stats.duplicate} tone="amber" icon={<Copy className="h-4 w-4" />} />
              <StatCard label="Ditolak" value={stats.rejected} tone="rose" icon={<ShieldAlert className="h-4 w-4" />} />
            </div>
            )}

            {/* Filters */}
            <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200/70 bg-white/95 p-3 shadow-card dark:border-hairline dark:bg-surface/95">
              <div className="flex items-center gap-1.5">
                {STATIONS.map((s) => (
                  <button
                    key={s.key || "all"}
                    type="button"
                    onClick={() => setStation(s.key)}
                    className={cn(
                      "rounded-xl px-3 py-1.5 text-[12px] font-semibold transition",
                      station === s.key
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-xl border border-hairline bg-surface px-3 py-1.5 text-sm text-ink outline-none ring-blue-200 focus:ring-2"
              />
              <span className="text-xs text-ink-subtle">
                {total} hasil{station ? ` · ${STATION_LABEL[station]}` : ""}
              </span>
            </section>

            {/* List */}
            <section className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white/95 shadow-card dark:border-hairline dark:bg-surface/95">
              {status === "error" ? (
                <p className="px-4 py-10 text-center text-sm text-rose-600">
                  {error}
                </p>
              ) : listLength === 0 && status === "ok" ? (
                <p className="px-4 py-10 text-center text-sm text-ink-muted">
                  Tidak ada scan pada filter ini.
                </p>
              ) : (
                <>
                  <div className="divide-y divide-hairline">
                    {kind === "pas"
                      ? paginatedPas.map((it) => (
                          <PasRow key={it.id} ev={it} onOpen={setOpenPas} />
                        ))
                      : paginated.map((it) => (
                          <ScanRow key={it.eventId} ev={it} onOpen={setOpenScan} />
                        ))}
                  </div>
                  <div className="px-3 py-3 sm:px-4">
                    <Pagination
                      page={currentPage}
                      totalPages={totalPages}
                      total={listLength}
                      pageSize={PAGE_SIZE}
                      onPageChange={setPage}
                      label="scan"
                    />
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </div>
      <BoardingScanModal ev={openScan} onClose={closeScan} />
      <PasScanModal scan={openPas} onClose={closePas} />
    </>
  );
}

const ROW_CLS =
  "flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-surface-2/60 focus-visible:bg-surface-2/60 focus-visible:outline-none sm:px-4";

function ScanRow({
  ev,
  onOpen,
}: {
  ev: ApiScanEvent;
  onOpen: (ev: ApiScanEvent) => void;
}) {
  const rs = RESULT_STYLE[ev.resultStatus];
  const badgeCls = rs?.cls ?? RESULT_FALLBACK.cls;
  const BadgeIcon = rs?.icon ?? RESULT_FALLBACK.icon;
  const time = new Date(ev.scannedAt).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <button type="button" onClick={() => onOpen(ev)} className={ROW_CLS}>
      <FaceThumb eventId={ev.eventId} hasPhoto={Boolean(ev.facePhotoPath)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[13px] font-bold text-ink">
            {ev.passengerName || ev.pnr || "—"}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ring-1",
              badgeCls,
            )}
          >
            <BadgeIcon className="h-3 w-3" />
            {rs?.label ?? ev.resultStatus.replace(/_/g, " ").toLowerCase()}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-1.5 py-0.5 text-[9px] font-bold uppercase text-ink-muted ring-1 ring-hairline">
            <MapPin className="h-3 w-3" />
            {STATION_LABEL[ev.station] ?? ev.station}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-ink-muted">
          {ev.flightNumber ?? "—"}
          {ev.seat ? ` · seat ${ev.seat}` : ""}
          {ev.ktpStatus ? ` · KTP: ${ev.ktpStatus}` : ""}
        </p>
      </div>
      <span className="shrink-0 text-[11px] tabular-nums text-ink-subtle">
        {time}
      </span>
    </button>
  );
}

function PasRow({
  ev,
  onOpen,
}: {
  ev: ApiPasScan;
  onOpen: (ev: ApiPasScan) => void;
}) {
  const ps = PAS_STYLE[ev.status] ?? PAS_STYLE.ERROR;
  const time = new Date(ev.createdAt).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <button type="button" onClick={() => onOpen(ev)} className={ROW_CLS}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-subtle ring-1 ring-hairline">
        <IdCard className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[13px] font-bold text-ink">
            {ev.name || ev.pasNumber || ev.pasId}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ring-1",
              ps.cls,
            )}
          >
            <ps.icon className="h-3 w-3" />
            {ps.label}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-1.5 py-0.5 text-[9px] font-bold uppercase text-ink-muted ring-1 ring-hairline">
            <MapPin className="h-3 w-3" />
            {STATION_LABEL[ev.station] ?? ev.station}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-ink-muted">
          {[
            ev.pasNumber,
            ev.company,
            ev.areaCodes ? `area ${ev.areaCodes}` : null,
            ev.validUntil ? `s/d ${ev.validUntil}` : null,
            ev.operator?.name ? `petugas ${ev.operator.name}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "—"}
        </p>
      </div>
      <span className="shrink-0 text-[11px] tabular-nums text-ink-subtle">
        {time}
      </span>
    </button>
  );
}

function FaceThumb({
  eventId,
  hasPhoto,
}: {
  eventId: string;
  hasPhoto: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const placeholderRef = useRef<HTMLSpanElement | null>(null);

  // P-08: tunda fetch foto sampai thumbnail benar-benar mendekati viewport,
  // supaya tidak ratusan fetch sekaligus saat halaman dibuka.
  useEffect(() => {
    if (!hasPhoto || visible) return;
    const el = placeholderRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasPhoto, visible]);

  useEffect(() => {
    if (!hasPhoto || !visible) return;
    let revoked: string | null = null;
    let active = true;
    getFacePhotoObjectUrl(eventId).then((u) => {
      if (active && u) {
        revoked = u;
        setUrl(u);
      } else if (u) {
        URL.revokeObjectURL(u);
      }
    });
    return () => {
      active = false;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [eventId, hasPhoto, visible]);

  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={url}
        alt="wajah"
        className="h-10 w-10 shrink-0 rounded-xl object-cover ring-1 ring-hairline"
      />
    );
  }
  return (
    <span
      ref={placeholderRef}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-subtle ring-1 ring-hairline"
    >
      {hasPhoto ? (
        <Camera className="h-4 w-4 animate-pulse" />
      ) : (
        <UserIcon className="h-4 w-4" />
      )}
    </span>
  );
}

const TONES: Record<string, string> = {
  slate: "text-ink",
  sky: "text-sky-700 dark:text-sky-300",
  violet: "text-violet-700 dark:text-violet-300",
  emerald: "text-emerald-700 dark:text-emerald-300",
  amber: "text-amber-700 dark:text-amber-300",
  rose: "text-rose-700 dark:text-rose-300",
};

function StatCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: keyof typeof TONES;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/95 p-3 shadow-card dark:border-hairline dark:bg-surface/95">
      <div className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">
        {icon}
        {label}
      </div>
      <p className={cn("mt-1 text-2xl font-extrabold tabular-nums", TONES[tone])}>
        {value}
      </p>
    </div>
  );
}
