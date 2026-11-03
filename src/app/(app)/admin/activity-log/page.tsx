"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronDown,
  Clock,
  Download,
  Filter,
  Globe,
  KeyRound,
  Loader2,
  Monitor,
  Plane,
  Radio,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Server,
  MonitorSmartphone,
  Settings as SettingsIcon,
  ShieldAlert,
  ShieldCheck,
  Timer,
  UserCog,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { downloadCsv } from "@/lib/csvExport";
import {
  ActivityCategory,
  ActivityLogFilter,
  ApiActivityLog,
  ApiActivitySummary,
  ApiUser,
  apiActivityActors,
  apiActivitySummary,
  apiListActivityLogs,
  getApiUser,
  isAuthed,
  subscribeAuth,
} from "@/lib/api/client";

const PER_PAGE = 30;
const LIVE_INTERVAL_MS = 30_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const CATEGORY: Record<
  ActivityCategory,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    dot: string;
    chip: string;
    color: string;
  }
> = {
  auth: {
    label: "Login",
    icon: KeyRound,
    dot: "bg-sky-500 text-white shadow-sky-500/30",
    chip: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/25",
    color: "#0ea5e9",
  },
  operator: {
    label: "Petugas",
    icon: UserCog,
    dot: "bg-violet-500 text-white shadow-violet-500/30",
    chip: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/25",
    color: "#8b5cf6",
  },
  flight: {
    label: "Penerbangan",
    icon: Plane,
    dot: "bg-blue-600 text-white shadow-blue-600/30",
    chip: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/25",
    color: "#2563eb",
  },
  settings: {
    label: "Pengaturan",
    icon: SettingsIcon,
    dot: "bg-amber-500 text-white shadow-amber-500/30",
    chip: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/25",
    color: "#f59e0b",
  },
  device: {
    label: "Perangkat",
    icon: MonitorSmartphone,
    dot: "bg-emerald-500 text-white shadow-emerald-500/30",
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/25",
    color: "#10b981",
  },
  system: {
    label: "Sistem",
    icon: Server,
    dot: "bg-slate-500 text-white shadow-slate-500/30",
    chip: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-surface-2 dark:text-ink-muted dark:ring-hairline",
    color: "#64748b",
  },
};
const CATEGORY_KEYS = Object.keys(CATEGORY) as ActivityCategory[];

const ROLE_TONE: Record<string, string> = {
  admin: "bg-blue-100 text-blue-700 ring-blue-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/25",
  supervisor:
    "bg-violet-100 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/25",
  operator:
    "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-surface-2 dark:text-ink-muted dark:ring-hairline",
  device:
    "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/25",
};

type RangePreset = "today" | "7d" | "30d" | "all" | "custom";
const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "today", label: "Hari ini" },
  { value: "7d", label: "7 hari" },
  { value: "30d", label: "30 hari" },
  { value: "all", label: "Semua" },
  { value: "custom", label: "Kustom" },
];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function toDateInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Rentang tanggal (ISO) sesuai preset, di zona waktu perangkat. */
function rangeBounds(
  preset: RangePreset,
  customFrom: string,
  customTo: string,
): { from?: string; to?: string } {
  const now = new Date();
  if (preset === "today") return { from: startOfDay(now).toISOString() };
  if (preset === "7d") return { from: startOfDay(new Date(now.getTime() - 6 * DAY_MS)).toISOString() };
  if (preset === "30d") return { from: startOfDay(new Date(now.getTime() - 29 * DAY_MS)).toISOString() };
  if (preset === "custom") {
    return {
      from: customFrom ? startOfDay(new Date(`${customFrom}T00:00:00`)).toISOString() : undefined,
      to: customTo ? endOfDay(new Date(`${customTo}T00:00:00`)).toISOString() : undefined,
    };
  }
  return {};
}

export default function ActivityLogPage() {
  const toast = useToast();
  const [authed, setAuthed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [backendUser, setBackendUser] = useState<ApiUser | null>(null);

  const [items, setItems] = useState<ApiActivityLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"idle" | "loading" | "more" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ApiActivitySummary | null>(null);
  const [actors, setActors] = useState<{ operatorId: string; name: string | null }[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);

  // Filter
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ActivityCategory | "">("");
  const [statusFilter, setStatusFilter] = useState<"" | "success" | "failed">("");
  const [actor, setActor] = useState("");
  const [range, setRange] = useState<RangePreset>("7d");
  const [customFrom, setCustomFrom] = useState(() => toDateInput(new Date(Date.now() - 6 * DAY_MS)));
  const [customTo, setCustomTo] = useState(() => toDateInput(new Date()));
  const [showFilters, setShowFilters] = useState(false);

  // Debounce pencarian supaya tidak menembak backend tiap ketikan.
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryInput.trim()), 350);
    return () => clearTimeout(t);
  }, [queryInput]);

  const filter = useMemo<ActivityLogFilter>(
    () => ({
      q: query || undefined,
      category: category || undefined,
      status: statusFilter || undefined,
      operatorId: actor || undefined,
      ...rangeBounds(range, customFrom, customTo),
    }),
    [query, category, statusFilter, actor, range, customFrom, customTo],
  );

  const activeFilterCount =
    (query ? 1 : 0) + (category ? 1 : 0) + (statusFilter ? 1 : 0) + (actor ? 1 : 0) + (range !== "7d" ? 1 : 0);

  const resetFilters = () => {
    setQueryInput("");
    setQuery("");
    setCategory("");
    setStatusFilter("");
    setActor("");
    setRange("7d");
  };

  // Abaikan respons basi bila filter berubah saat request masih jalan.
  const seq = useRef(0);

  const loadPage = useCallback(
    async (nextPage: number, silent = false) => {
      const my = ++seq.current;
      if (!silent) setStatus(nextPage === 1 ? "loading" : "more");
      const res = await apiListActivityLogs({ ...filter, page: nextPage, perPage: PER_PAGE });
      if (my !== seq.current) return;
      if (res.ok && res.data) {
        const data = res.data;
        setItems((prev) => (nextPage === 1 ? data.items : [...prev, ...data.items]));
        setTotal(data.total);
        setPage(nextPage);
        setStatus("ok");
        setError(null);
        setLastLoaded(new Date());
      } else {
        setStatus("error");
        setError(res.error ?? "Gagal memuat log aktivitas.");
      }
    },
    [filter],
  );

  const loadSummary = useCallback(async () => {
    const res = await apiActivitySummary(startOfDay(new Date()).toISOString());
    if (res.ok && res.data) setSummary(res.data);
  }, []);

  const checkAuth = useCallback(() => {
    const ok = isAuthed();
    setAuthed(ok);
    const u = ok ? getApiUser() : null;
    setBackendUser(u);
    setIsAdmin(u?.role === "admin");
  }, []);

  useEffect(() => {
    checkAuth();
    return subscribeAuth(checkAuth);
  }, [checkAuth]);

  useEffect(() => {
    if (!isAdmin) return;
    loadSummary();
    apiActivityActors().then((r) => r.ok && r.data && setActors(r.data.items));
  }, [isAdmin, loadSummary]);

  useEffect(() => {
    if (!isAdmin) return;
    setExpanded(null);
    loadPage(1);
  }, [isAdmin, loadPage]);

  // Mode live: segarkan halaman pertama & ringkasan selama tab terlihat.
  useEffect(() => {
    if (!live || !isAdmin) return;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      loadPage(1, true);
      loadSummary();
    }, LIVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [live, isAdmin, loadPage, loadSummary]);

  const refresh = () => {
    loadPage(1);
    loadSummary();
  };

  const groups = useMemo(() => groupByDay(items), [items]);

  const handleExport = () => {
    if (items.length === 0) {
      toast.warning("Tidak ada data untuk diekspor.");
      return;
    }
    downloadCsv({
      filename: `log-aktivitas-${toDateInput(new Date())}.csv`,
      meta: [
        { label: "Laporan", value: "Log Aktivitas SIPANDAI" },
        { label: "Diekspor", value: new Date().toLocaleString("id-ID") },
        { label: "Jumlah baris", value: items.length },
      ],
      headers: [
        "Waktu",
        "Pelaku",
        "Email",
        "Role",
        "Kategori",
        "Aksi",
        "Deskripsi",
        "Status",
        "HTTP",
        "Endpoint",
        "IP",
        "Perangkat",
        "Durasi (ms)",
        "Keterangan",
      ],
      rows: items.map((l) => [
        new Date(l.at).toLocaleString("id-ID"),
        l.operatorName ?? "",
        l.operatorEmail ?? "",
        l.operatorRole ?? "",
        CATEGORY[l.category]?.label ?? l.category,
        l.action,
        l.description,
        l.success ? "Berhasil" : "Gagal",
        l.statusCode,
        `${l.method} ${l.path}`,
        l.ip ?? "",
        parseDevice(l.userAgent),
        l.durationMs,
        l.meta?.error ?? "",
      ]),
    });
    toast.success(`${items.length} baris diekspor ke CSV.`);
  };

  return (
    <div className="space-y-4">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-blue-100/80 bg-gradient-to-br from-sky-50 via-white to-indigo-50/70 p-5 shadow-card ring-1 ring-white/60 dark:border-hairline dark:from-surface dark:via-surface dark:to-surface/80 dark:ring-hairline sm:p-6">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-indigo-300/25 blur-3xl dark:bg-indigo-500/10" />
        <div className="pointer-events-none absolute -bottom-28 left-1/4 h-64 w-64 rounded-full bg-sky-200/30 blur-3xl dark:bg-sky-500/10" />
        <HeroPulseArt />

        <div className="relative flex flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-indigo-700 ring-1 ring-indigo-200 backdrop-blur dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/25">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-indigo-600/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300">
                <ScrollText className="h-3.5 w-3.5" />
              </span>
              Log Aktivitas • Server
            </div>
            {isAdmin && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setLive((v) => !v)}
                  aria-pressed={live}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold shadow-sm ring-1 backdrop-blur transition",
                    live
                      ? "bg-emerald-500 text-white ring-emerald-500 hover:bg-emerald-600"
                      : "bg-white/90 text-ink ring-blue-100 hover:bg-white dark:bg-surface-2 dark:ring-hairline",
                  )}
                  title="Segarkan otomatis tiap 30 detik"
                >
                  <span className="relative flex h-2.5 w-2.5">
                    {live && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/80" />
                    )}
                    <span
                      className={cn(
                        "relative inline-flex h-2.5 w-2.5 rounded-full",
                        live ? "bg-white" : "bg-slate-300 dark:bg-ink-subtle",
                      )}
                    />
                  </span>
                  Live
                </button>
                <button
                  type="button"
                  onClick={refresh}
                  disabled={status === "loading"}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-blue-100 bg-white/90 px-3.5 py-2 text-sm font-semibold text-ink shadow-sm backdrop-blur transition hover:bg-white hover:shadow disabled:opacity-60 dark:border-hairline dark:bg-surface-2"
                >
                  {status === "loading" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  <span className="hidden sm:inline">Refresh</span>
                </button>
                <button
                  type="button"
                  onClick={handleExport}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-2 text-sm font-bold text-white shadow-md shadow-indigo-600/20 transition hover:from-indigo-700 hover:to-blue-700 hover:shadow-lg"
                >
                  <Download className="h-4 w-4" />
                  Ekspor CSV
                </button>
              </div>
            )}
          </div>

          <div className="max-w-xl">
            <h2 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
              Jejak Aktivitas Sistem
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Pantau siapa melakukan apa dan kapan — login, perubahan data petugas,
              penerbangan, hingga pengaturan global. Tercatat otomatis di server.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              icon={<Activity className="h-5 w-5" />}
              tone="indigo"
              label="Aktivitas Hari Ini"
              value={summary?.today}
              sub="Tindakan tercatat"
            />
            <StatCard
              icon={<Users className="h-5 w-5" />}
              tone="green"
              label="Pengguna Aktif"
              value={summary?.activeUsersToday}
              sub="Hari ini"
            />
            <StatCard
              icon={<XCircle className="h-5 w-5" />}
              tone="rose"
              label="Gagal / Ditolak"
              value={summary?.failedToday}
              sub="Hari ini"
            />
            <StatCard
              icon={<ShieldAlert className="h-5 w-5" />}
              tone="amber"
              label="Login Gagal"
              value={summary?.failedLogins24h}
              sub="24 jam terakhir"
              alert={(summary?.failedLogins24h ?? 0) >= 5}
            />
          </div>
        </div>
      </section>

      {!authed ? (
        <NotConnected />
      ) : !isAdmin ? (
        <NotBackendAdmin backendUser={backendUser} />
      ) : (
        <>
          {/* Insight: grafik 24 jam + kategori */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <HourlyChart summary={summary} />
            <CategoryDonut
              summary={summary}
              active={category}
              onPick={(c) => setCategory((cur) => (cur === c ? "" : c))}
            />
          </div>

          {/* Filter */}
          <section className="rounded-2xl border border-blue-100/70 bg-white/90 p-3 shadow-card backdrop-blur dark:border-hairline dark:bg-surface/95">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
                <input
                  type="search"
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  placeholder="Cari aktivitas, nama petugas, email, atau IP…"
                  className="w-full rounded-xl border border-blue-100 bg-surface py-2.5 pl-10 pr-3 text-sm text-ink outline-none ring-blue-200 transition focus:border-blue-300 focus:ring-2 dark:border-hairline"
                />
              </div>
              <div className="flex items-center gap-2">
                <Segmented
                  value={range}
                  onChange={(v) => setRange(v as RangePreset)}
                  options={RANGE_OPTIONS}
                />
                <button
                  type="button"
                  onClick={() => setShowFilters((v) => !v)}
                  className={cn(
                    "relative inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-bold transition lg:hidden",
                    showFilters
                      ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300"
                      : "border-blue-100 bg-surface text-ink dark:border-hairline",
                  )}
                  aria-expanded={showFilters}
                >
                  <Filter className="h-3.5 w-3.5" />
                  Filter
                  {activeFilterCount > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] text-white">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
              </div>
            </div>

            <div
              className={cn(
                "mt-3 flex-col gap-3 lg:flex lg:flex-row lg:items-center lg:justify-between",
                showFilters ? "flex" : "hidden",
              )}
            >
              <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:pb-0">
                <CategoryChip active={category === ""} onClick={() => setCategory("")}>
                  Semua
                </CategoryChip>
                {CATEGORY_KEYS.map((c) => {
                  const Icon = CATEGORY[c].icon;
                  return (
                    <CategoryChip key={c} active={category === c} onClick={() => setCategory(c)}>
                      <Icon className="h-3.5 w-3.5" />
                      {CATEGORY[c].label}
                    </CategoryChip>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                <FilterSelect
                  icon={<ShieldCheck className="h-3.5 w-3.5" />}
                  value={statusFilter}
                  onChange={(v) => setStatusFilter(v as "" | "success" | "failed")}
                  options={[
                    { value: "", label: "Semua Status" },
                    { value: "success", label: "Berhasil" },
                    { value: "failed", label: "Gagal" },
                  ]}
                />
                <FilterSelect
                  icon={<UserCog className="h-3.5 w-3.5" />}
                  value={actor}
                  onChange={setActor}
                  options={[
                    { value: "", label: "Semua Pelaku" },
                    ...actors.map((a) => ({ value: a.operatorId, label: a.name ?? a.operatorId })),
                  ]}
                />
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-bold text-rose-600 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset
                  </button>
                )}
              </div>
            </div>

            {range === "custom" && (
              <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-surface-2/60 p-2 ring-1 ring-hairline sm:flex sm:items-center">
                <DateField label="Dari" value={customFrom} onChange={setCustomFrom} max={customTo} />
                <DateField label="Sampai" value={customTo} onChange={setCustomTo} min={customFrom} />
              </div>
            )}
          </section>

          {/* Ringkasan hasil */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-ink-muted">
            <span>
              {status === "loading" ? (
                "Memuat…"
              ) : (
                <>
                  Menampilkan <b className="text-ink">{items.length}</b> dari{" "}
                  <b className="text-ink">{total.toLocaleString("id-ID")}</b> aktivitas
                </>
              )}
            </span>
            {lastLoaded && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Diperbarui {lastLoaded.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </div>

          {/* Timeline */}
          {status === "error" && items.length === 0 ? (
            <section className="rounded-3xl border border-rose-200 bg-rose-50/60 px-4 py-12 text-center text-sm text-rose-600 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300">
              <AlertTriangle className="mx-auto h-8 w-8" />
              <p className="mt-2 font-semibold">{error}</p>
              <button
                type="button"
                onClick={refresh}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-rose-700"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Coba lagi
              </button>
            </section>
          ) : status === "loading" && items.length === 0 ? (
            <TimelineSkeleton />
          ) : items.length === 0 ? (
            <EmptyState filtered={activeFilterCount > 0} onReset={resetFilters} />
          ) : (
            <div className={cn("space-y-5 transition-opacity", status === "loading" && "opacity-60")}>
              {groups.map((g) => (
                <section key={g.key}>
                  <div className="mb-2 flex items-center gap-2 py-1.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-bold text-ink shadow-sm ring-1 ring-blue-100 dark:bg-surface dark:ring-hairline">
                      <CalendarDays className="h-3.5 w-3.5 text-blue-600 dark:text-sky-300" />
                      {g.label}
                    </span>
                    <span className="text-[11px] font-semibold text-ink-subtle">
                      {g.items.length} aktivitas
                    </span>
                    <span className="h-px flex-1 bg-hairline" />
                  </div>
                  <ol className="relative ml-4 space-y-2.5 border-l-2 border-dashed border-blue-100 pl-6 dark:border-hairline sm:ml-5 sm:pl-7">
                    {g.items.map((log) => (
                      <TimelineItem
                        key={log.id}
                        log={log}
                        open={expanded === log.id}
                        onToggle={() => setExpanded((cur) => (cur === log.id ? null : log.id))}
                      />
                    ))}
                  </ol>
                </section>
              ))}

              {items.length < total && (
                <div className="flex justify-center pt-1">
                  <button
                    type="button"
                    onClick={() => loadPage(page + 1)}
                    disabled={status === "more"}
                    className="inline-flex items-center gap-2 rounded-2xl border border-blue-100 bg-white px-5 py-2.5 text-sm font-bold text-blue-700 shadow-card transition hover:-translate-y-0.5 hover:shadow-lift disabled:opacity-60 dark:border-hairline dark:bg-surface dark:text-sky-300"
                  >
                    {status === "more" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                    Muat lebih banyak
                    <span className="text-xs font-semibold text-ink-subtle">
                      ({(total - items.length).toLocaleString("id-ID")} lagi)
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────── Timeline ───────────────────────────

function TimelineItem({
  log,
  open,
  onToggle,
}: {
  log: ApiActivityLog;
  open: boolean;
  onToggle: () => void;
}) {
  const cat = CATEGORY[log.category] ?? CATEGORY.system;
  const Icon = cat.icon;
  const at = new Date(log.at);
  return (
    <li className="relative">
      {/* titik ikon di garis timeline */}
      <span
        className={cn(
          "absolute -left-[42px] top-3 flex h-8 w-8 items-center justify-center rounded-xl shadow-md ring-4 ring-white dark:ring-surface sm:-left-[46px]",
          cat.dot,
        )}
      >
        <Icon className="h-4 w-4" />
        {!log.success && (
          <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 ring-2 ring-white dark:ring-surface">
            <X className="h-2.5 w-2.5 text-white" />
          </span>
        )}
      </span>

      <div
        className={cn(
          "overflow-hidden rounded-2xl border bg-white/95 shadow-card transition dark:bg-surface/95",
          open
            ? "border-blue-200 shadow-lift dark:border-sky-500/30"
            : "border-blue-100/70 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lift dark:border-hairline",
          !log.success && "border-l-4 border-l-rose-400 dark:border-l-rose-500/70",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-start gap-3 p-3.5 text-left sm:items-center sm:p-4"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1", cat.chip)}>
                {cat.label}
              </span>
              <StatusPill success={log.success} code={log.statusCode} />
            </div>
            <p className="mt-1.5 text-sm font-semibold leading-snug text-ink">{log.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-ink-muted">
              <ActorBadge log={log} />
              <span className="inline-flex items-center gap-1" title={at.toLocaleString("id-ID")}>
                <Clock className="h-3 w-3" />
                {at.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                <span className="text-ink-subtle">· {relativeTime(at)}</span>
              </span>
              {log.ip && (
                <span className="hidden items-center gap-1 sm:inline-flex">
                  <Globe className="h-3 w-3" />
                  {log.ip}
                </span>
              )}
            </div>
          </div>
          <ChevronDown
            className={cn(
              "mt-1 h-4 w-4 shrink-0 text-ink-subtle transition-transform sm:mt-0",
              open && "rotate-180 text-blue-600",
            )}
          />
        </button>

        {open && <TimelineDetail log={log} />}
      </div>
    </li>
  );
}

function TimelineDetail({ log }: { log: ApiActivityLog }) {
  return (
    <div className="border-t border-hairline bg-surface-2/50 px-3.5 py-3.5 sm:px-4">
      {log.meta?.error && (
        <div className="mb-3 flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/25">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <b>Alasan gagal:</b> {log.meta.error}
          </span>
        </div>
      )}
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <DetailCell icon={<ScrollText className="h-3.5 w-3.5" />} label="Kode aksi">
          <code className="font-mono text-[11px]">{log.action}</code>
        </DetailCell>
        <DetailCell icon={<Server className="h-3.5 w-3.5" />} label="Endpoint">
          <code className="break-all font-mono text-[11px]">
            <span className="font-bold text-blue-700 dark:text-sky-300">{log.method}</span> {log.path}
          </code>
        </DetailCell>
        <DetailCell icon={<Timer className="h-3.5 w-3.5" />} label="Respons">
          HTTP {log.statusCode} · {log.durationMs.toLocaleString("id-ID")} ms
        </DetailCell>
        <DetailCell icon={<Globe className="h-3.5 w-3.5" />} label="Alamat IP">
          {log.ip ?? "—"}
        </DetailCell>
        <DetailCell icon={<Monitor className="h-3.5 w-3.5" />} label="Perangkat">
          <span title={log.userAgent ?? undefined}>{parseDevice(log.userAgent)}</span>
        </DetailCell>
        <DetailCell icon={<CalendarDays className="h-3.5 w-3.5" />} label="Waktu lengkap">
          {new Date(log.at).toLocaleString("id-ID", { dateStyle: "full", timeStyle: "medium" })}
        </DetailCell>
      </dl>
      {log.meta?.fields && log.meta.fields.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-ink-subtle">Field yang dikirim</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {log.meta.fields.map((f) => (
              <span
                key={f}
                className="rounded-lg bg-white px-2 py-0.5 font-mono text-[11px] text-ink ring-1 ring-hairline dark:bg-surface"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailCell({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-hairline dark:bg-surface">
      <dt className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-subtle">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 text-xs font-medium text-ink">{children}</dd>
    </div>
  );
}

function ActorBadge({ log }: { log: ApiActivityLog }) {
  const name = log.operatorName ?? log.operatorEmail ?? "Tidak dikenal";
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-extrabold text-white"
        style={{ background: avatarColor(log.operatorId ?? name) }}
      >
        {initialsOf(name)}
      </span>
      <span className="truncate font-semibold text-ink">{name}</span>
      {log.operatorRole && (
        <span
          className={cn(
            "rounded-full px-1.5 py-px text-[9px] font-bold uppercase ring-1",
            ROLE_TONE[log.operatorRole] ?? ROLE_TONE.operator,
          )}
        >
          {log.operatorRole}
        </span>
      )}
    </span>
  );
}

function StatusPill({ success, code }: { success: boolean; code: number }) {
  return success ? (
    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/25">
      <Check className="h-3 w-3" />
      Berhasil
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/25">
      <X className="h-3 w-3" />
      Gagal · {code}
    </span>
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-2.5 pl-10 sm:pl-12">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-2xl border border-blue-100/70 bg-white/90 p-4 dark:border-hairline dark:bg-surface/95"
        >
          <div className="flex gap-1.5">
            <div className="h-4 w-16 rounded bg-surface-2" />
            <div className="h-4 w-14 rounded bg-surface-2" />
          </div>
          <div className="mt-2.5 h-4 w-3/4 rounded bg-surface-2" />
          <div className="mt-2.5 h-3 w-1/2 rounded bg-surface-2" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ filtered, onReset }: { filtered: boolean; onReset: () => void }) {
  return (
    <section className="rounded-3xl border border-slate-200/70 bg-white/90 px-4 py-14 text-center dark:border-hairline dark:bg-surface/95">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-50 to-sky-50 text-indigo-500 ring-1 ring-indigo-100 dark:from-indigo-500/10 dark:to-sky-500/10 dark:text-indigo-300 dark:ring-indigo-500/25">
        <ScrollText className="h-7 w-7" />
      </span>
      <p className="mt-3 text-sm font-semibold text-ink">
        {filtered ? "Tidak ada aktivitas yang cocok" : "Belum ada aktivitas tercatat"}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-ink-muted">
        {filtered
          ? "Coba ubah kata kunci, kategori, atau rentang tanggal."
          : "Aktivitas seperti login, kelola petugas, dan perubahan pengaturan akan muncul di sini."}
      </p>
      {filtered && (
        <button
          type="button"
          onClick={onReset}
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-blue-700"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset filter
        </button>
      )}
    </section>
  );
}

// ─────────────────────────── Insight ───────────────────────────

function HourlyChart({ summary }: { summary: ApiActivitySummary | null }) {
  const buckets = useMemo(() => {
    const nowHour = Math.floor(Date.now() / HOUR_MS);
    const map = new Map((summary?.hourly ?? []).map((h) => [h.hour, h.count]));
    return Array.from({ length: 24 }, (_, i) => {
      const hour = nowHour - 23 + i;
      return { hour, count: map.get(hour) ?? 0, date: new Date(hour * HOUR_MS) };
    });
  }, [summary]);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const peak = buckets.reduce((a, b) => (b.count > a.count ? b : a), buckets[0]);

  return (
    <section className="rounded-3xl border border-blue-100/70 bg-white/90 p-4 shadow-card dark:border-hairline dark:bg-surface/95 sm:p-5 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
            <Radio className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />
            Aktivitas 24 Jam Terakhir
          </h3>
          <p className="mt-0.5 text-xs text-ink-muted">
            {total.toLocaleString("id-ID")} tindakan
            {peak && peak.count > 0 && (
              <>
                {" "}
                · puncak pukul <b className="text-ink">{fmtHour(peak.date)}</b> ({peak.count})
              </>
            )}
          </p>
        </div>
        {summary && summary.topActors.length > 0 && (
          <div className="flex -space-x-2">
            {summary.topActors.map((a) => (
              <span
                key={a.operatorId}
                title={`${a.name ?? "?"} — ${a.count} aktivitas (7 hari)`}
                className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-extrabold text-white ring-2 ring-white dark:ring-surface"
                style={{ background: avatarColor(a.operatorId) }}
              >
                {initialsOf(a.name ?? "?")}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex h-32 items-end gap-[3px] sm:h-36 sm:gap-1">
        {buckets.map((b, i) => {
          const pct = (b.count / max) * 100;
          const isNow = i === buckets.length - 1;
          return (
            <div key={b.hour} className="group relative flex h-full flex-1 flex-col justify-end">
              <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-bold text-white shadow-lg group-hover:block dark:bg-white dark:text-slate-900">
                {fmtHour(b.date)} · {b.count}
              </span>
              <div
                className={cn(
                  "w-full rounded-t-md transition-all duration-500 group-hover:opacity-80",
                  b.count === 0
                    ? "bg-slate-100 dark:bg-surface-2"
                    : isNow
                      ? "bg-gradient-to-t from-emerald-500 to-emerald-300"
                      : "bg-gradient-to-t from-indigo-600 to-sky-400",
                )}
                style={{ height: b.count === 0 ? "4px" : `${Math.max(8, pct)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] font-semibold text-ink-subtle">
        {[0, 6, 12, 18, 23].map((i) => (
          <span key={i}>{i === 23 ? "Sekarang" : fmtHour(buckets[i].date)}</span>
        ))}
      </div>
    </section>
  );
}

function CategoryDonut({
  summary,
  active,
  onPick,
}: {
  summary: ApiActivitySummary | null;
  active: ActivityCategory | "";
  onPick: (c: ActivityCategory) => void;
}) {
  const rows = CATEGORY_KEYS.map((c) => ({
    c,
    count: summary?.byCategory.find((r) => r.category === c)?.count ?? 0,
  }));
  const total = rows.reduce((s, r) => s + r.count, 0);
  let acc = 0;
  const stops = rows
    .filter((r) => r.count > 0)
    .map((r) => {
      const start = (acc / total) * 360;
      acc += r.count;
      const end = (acc / total) * 360;
      return `${CATEGORY[r.c].color} ${start}deg ${end}deg`;
    });
  const gradient = total > 0 ? `conic-gradient(${stops.join(", ")})` : undefined;

  return (
    <section className="rounded-3xl border border-blue-100/70 bg-white/90 p-4 shadow-card dark:border-hairline dark:bg-surface/95 sm:p-5">
      <h3 className="text-sm font-bold text-ink">Kategori (7 Hari)</h3>
      <p className="mt-0.5 text-xs text-ink-muted">Ketuk kategori untuk memfilter.</p>
      <div className="mt-4 flex items-center gap-5">
        <div
          className="relative h-28 w-28 shrink-0 rounded-full bg-slate-100 dark:bg-surface-2"
          style={gradient ? { background: gradient } : undefined}
        >
          <div className="absolute inset-3 flex flex-col items-center justify-center rounded-full bg-white dark:bg-surface">
            <span className="text-xl font-extrabold tracking-tight text-ink">
              {summary ? total.toLocaleString("id-ID") : "—"}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">total</span>
          </div>
        </div>
        <ul className="min-w-0 flex-1 space-y-1">
          {rows.map((r) => (
            <li key={r.c}>
              <button
                type="button"
                onClick={() => onPick(r.c)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1 text-xs transition",
                  active === r.c
                    ? "bg-blue-50 ring-1 ring-blue-200 dark:bg-sky-500/10 dark:ring-sky-500/30"
                    : "hover:bg-surface-2",
                )}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CATEGORY[r.c].color }} />
                <span className="flex-1 truncate text-left font-medium text-ink">{CATEGORY[r.c].label}</span>
                <span className="font-bold tabular-nums text-ink">{r.count}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ─────────────────────────── Kecil-kecil ───────────────────────────

const STAT_TONE: Record<string, string> = {
  indigo:
    "bg-indigo-50 text-indigo-600 ring-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/25",
  green:
    "bg-emerald-50 text-emerald-600 ring-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/25",
  rose: "bg-rose-50 text-rose-600 ring-rose-100 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/25",
  amber:
    "bg-amber-50 text-amber-600 ring-amber-100 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/25",
};

function StatCard({
  icon,
  tone,
  label,
  value,
  sub,
  alert,
}: {
  icon: React.ReactNode;
  tone: string;
  label: string;
  value: number | undefined;
  sub: string;
  alert?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/70 bg-white/85 p-4 shadow-card ring-1 ring-blue-100/50 backdrop-blur transition hover:-translate-y-0.5 hover:shadow-lift dark:border-hairline dark:bg-surface-2/70 dark:ring-hairline",
        alert && "ring-2 ring-amber-300 dark:ring-amber-500/50",
      )}
    >
      <span className={cn("inline-flex h-9 w-9 items-center justify-center rounded-xl ring-1", STAT_TONE[tone])}>
        {icon}
      </span>
      {alert && (
        <span className="absolute right-3 top-3 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold uppercase text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
          Perhatian
        </span>
      )}
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-0.5 text-2xl font-extrabold tracking-tight text-ink">
        {value === undefined ? <span className="inline-block h-7 w-10 animate-pulse rounded bg-surface-2" /> : value.toLocaleString("id-ID")}
      </p>
      <p className="text-[11px] text-ink-subtle">{sub}</p>
    </div>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex min-w-0 flex-1 overflow-x-auto rounded-xl bg-surface-2 p-1 ring-1 ring-hairline lg:flex-none">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-bold transition sm:px-3",
            value === o.value
              ? "bg-white text-blue-700 shadow-sm ring-1 ring-blue-100 dark:bg-surface dark:text-sky-300 dark:ring-hairline"
              : "text-ink-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ring-1 transition",
        active
          ? "bg-blue-600 text-white ring-blue-600 shadow-sm shadow-blue-600/20"
          : "bg-surface text-ink-muted ring-hairline hover:text-ink hover:ring-blue-200",
      )}
    >
      {children}
    </button>
  );
}

function FilterSelect({
  icon,
  value,
  onChange,
  options,
}: {
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative w-full sm:w-auto">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle">{icon}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-xl border border-blue-100 bg-surface py-2.5 pl-8 pr-7 text-xs font-semibold text-ink outline-none ring-blue-200 transition focus:border-blue-300 focus:ring-2 dark:border-hairline sm:w-auto sm:max-w-[200px]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
      <span className="text-[10px] font-bold uppercase tracking-wide text-ink-subtle">{label}</span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-blue-100 bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink outline-none ring-blue-200 focus:ring-2 dark:border-hairline"
      />
    </label>
  );
}

/** Ilustrasi detak aktivitas (dekoratif) di pojok hero. */
function HeroPulseArt() {
  return (
    <svg
      viewBox="0 0 220 80"
      aria-hidden="true"
      className="pointer-events-none absolute right-6 top-16 hidden h-24 w-64 text-indigo-400/60 dark:text-indigo-400/30 md:block"
    >
      <path
        d="M0 50 H60 L72 22 L86 70 L100 12 L114 58 L124 42 H220"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="124" cy="42" r="5" className="fill-emerald-400" />
    </svg>
  );
}

function NotConnected() {
  return (
    <section className="rounded-3xl border border-amber-200 bg-amber-50/70 p-6 text-center dark:border-amber-500/25 dark:bg-amber-500/10">
      <Server className="mx-auto h-8 w-8 text-amber-600" />
      <p className="mt-2 text-sm font-semibold text-ink">Belum tersambung ke backend</p>
      <p className="mt-1 text-xs text-ink-muted">
        Log aktivitas tersimpan di server, jadi perlu login backend sebagai <b>admin</b>.
      </p>
      <Link
        href="/connect"
        className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-blue-700"
      >
        Buka Koneksi Backend
      </Link>
    </section>
  );
}

function NotBackendAdmin({ backendUser }: { backendUser: ApiUser | null }) {
  return (
    <section className="rounded-3xl border border-amber-200 bg-amber-50/70 p-6 text-center dark:border-amber-500/25 dark:bg-amber-500/10">
      <ShieldCheck className="mx-auto h-8 w-8 text-amber-600" />
      <p className="mt-2 text-sm font-semibold text-ink">Perlu login backend sebagai admin</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-ink-muted">
        Login aplikasi (sidebar) <b>terpisah</b> dari login server. Log aktivitas hanya bisa
        dibaca akun <b>admin backend</b>.
      </p>
      {backendUser && (
        <p className="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-xl bg-surface px-3 py-1.5 text-[11px] text-ink-muted ring-1 ring-hairline">
          <UserCog className="h-3.5 w-3.5" />
          Sekarang terhubung sebagai <b className="text-ink">{backendUser.name}</b>
          <span className="rounded-full bg-surface-2 px-1.5 py-0.5 font-bold uppercase ring-1 ring-hairline">
            {backendUser.role}
          </span>
        </p>
      )}
      <div className="mt-4">
        <Link
          href="/connect"
          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-blue-700"
        >
          Login ulang sebagai admin (Koneksi Backend)
        </Link>
      </div>
    </section>
  );
}

// ─────────────────────────── Util ───────────────────────────

function groupByDay(items: ApiActivityLog[]) {
  const today = startOfDay(new Date()).getTime();
  const out: { key: string; label: string; items: ApiActivityLog[] }[] = [];
  for (const it of items) {
    const d = new Date(it.at);
    const key = toDateInput(d);
    let g = out[out.length - 1];
    if (!g || g.key !== key) {
      const day = startOfDay(d).getTime();
      const label =
        day === today
          ? "Hari ini"
          : day === today - DAY_MS
            ? "Kemarin"
            : d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      g = { key, label, items: [] };
      out.push(g);
    }
    g.items.push(it);
  }
  return out;
}

function relativeTime(d: Date): string {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 45) return "baru saja";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const days = Math.round(h / 24);
  return `${days} hari lalu`;
}

function fmtHour(d: Date): string {
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function initialsOf(name: string): string {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

const AVATAR_COLORS = ["#2563eb", "#7c3aed", "#0891b2", "#db2777", "#ea580c", "#059669", "#4f46e5"];
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

/** Ringkas user-agent → "Chrome · Windows" (cukup untuk audit, tanpa library). */
function parseDevice(ua: string | null): string {
  if (!ua) return "—";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Electron\//.test(ua)
        ? "Aplikasi Desktop"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : /Safari\//.test(ua)
              ? "Safari"
              : /curl|python|node|axios/i.test(ua)
                ? "Skrip/API"
                : "Browser lain";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  return os ? `${browser} · ${os}` : browser;
}
