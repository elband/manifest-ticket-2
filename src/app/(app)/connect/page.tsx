"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  DownloadCloud,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Plane,
  Plug,
  RefreshCw,
  Server,
  UploadCloud,
  User as UserIcon,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { cn, todayDateString } from "@/lib/utils";
import { getSettings, saveSettings, subscribeSettings } from "@/lib/settings";
import {
  ApiUser,
  apiLogin,
  clearAuth,
  getApiBase,
  getApiUser,
  isAuthed,
  subscribeAuth,
} from "@/lib/api/client";
import { pullFlights } from "@/lib/api/flightSync";
import { pullFidsKeberangkatan } from "@/lib/jadwal/flightSync";
import {
  ApiOutboxSummary,
  clearApiOutbox,
  flushApiOutbox,
  getApiOutboxSummary,
  retryAllApiFailed,
  subscribeApiOutbox,
} from "@/lib/api/outbox";

// Kredensial seed backend hanya ditampilkan/diisi di dev (literal agar
// teksnya terbuang dari bundle produksi).
const SHOW_SEED_CREDENTIALS = process.env.NODE_ENV !== "production";

export default function ConnectPage() {
  const toast = useToast();
  const [authed, setAuthed] = useState(false);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [syncOn, setSyncOn] = useState(false);
  const [summary, setSummary] = useState<ApiOutboxSummary>({
    pending: 0,
    failed: 0,
    total: 0,
    lastSyncedAt: null,
    lastError: null,
    online: true,
  });

  // Login form
  const [email, setEmail] = useState(SHOW_SEED_CREDENTIALS ? "admin@afvs.local" : "");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  // Pull flights
  const [pullDate, setPullDate] = useState(() => todayDateString());
  const [pullStation, setPullStation] = useState("");
  const [pulling, setPulling] = useState(false);
  const [flushing, setFlushing] = useState(false);

  // Pull jadwal dari FIDS bandara (tanpa perlu login backend)
  const [fidsDate, setFidsDate] = useState(() => todayDateString());
  const [fidsPulling, setFidsPulling] = useState(false);

  const refresh = useCallback(() => {
    setAuthed(isAuthed());
    setUser(getApiUser());
    setSummary(getApiOutboxSummary());
    setSyncOn(getSettings().apiSyncEnabled);
  }, []);

  useEffect(() => {
    refresh();
    setPullStation(getApiUser()?.station ?? "");
    const offAuth = subscribeAuth(refresh);
    const offBox = subscribeApiOutbox(refresh);
    const offSet = subscribeSettings((s) => setSyncOn(s.apiSyncEnabled));
    return () => {
      offAuth();
      offBox();
      offSet();
    };
  }, [refresh]);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      toast.warning("Isi email & password dulu.");
      return;
    }
    setLoggingIn(true);
    const res = await apiLogin(email.trim(), password);
    setLoggingIn(false);
    if (res.ok && res.data) {
      setPassword("");
      setPullStation(res.data.user.station ?? "");
      toast.success(`Login sebagai ${res.data.user.name}`, "Terhubung");
      // Otomatis aktifkan sync setelah login berhasil.
      if (!getSettings().apiSyncEnabled) saveSettings({ apiSyncEnabled: true });
    } else {
      toast.error(res.error ?? "Login gagal", "Gagal");
    }
    refresh();
  };

  const handleLogout = () => {
    clearAuth();
    toast.info("Token dihapus dari perangkat ini.");
    refresh();
  };

  const toggleSync = () => {
    const next = !getSettings().apiSyncEnabled;
    saveSettings({ apiSyncEnabled: next });
    setSyncOn(next);
    if (next) flushApiOutbox().catch(() => {});
  };

  const handlePull = async () => {
    if (!authed) {
      toast.warning("Login dulu sebelum tarik jadwal.");
      return;
    }
    setPulling(true);
    const res = await pullFlights({
      date: pullDate || undefined,
      station: pullStation.trim() || undefined,
    });
    setPulling(false);
    if (res.ok) {
      toast.success(
        `${res.total} jadwal (+${res.added} baru, ${res.updated} update)`,
        "Jadwal ditarik",
      );
    } else {
      toast.error(res.error ?? "Gagal tarik jadwal", "Gagal");
    }
  };

  const handleFidsPull = async () => {
    setFidsPulling(true);
    const res = await pullFidsKeberangkatan(fidsDate || undefined);
    setFidsPulling(false);
    if (res.ok) {
      toast.success(
        `${res.total} jadwal (+${res.added} baru, ${res.updated} update)`,
        "Jadwal FIDS ditarik",
      );
    } else {
      toast.error(res.error ?? "Gagal tarik jadwal FIDS", "Gagal");
    }
  };

  const handleFlush = async () => {
    setFlushing(true);
    const r = await flushApiOutbox({ maxItems: 100 });
    setFlushing(false);
    toast.info(
      `Terkirim ${r.sent}, gagal ${r.failed}, tunda ${r.skipped}.`,
      "Flush selesai",
    );
    refresh();
  };

  const apiBase = getApiBase();
  const roleLabel = user?.role ? user.role.toUpperCase() : "—";

  return (
    <>
      <div className="mx-auto max-w-3xl space-y-4">
        {/* Header */}
        <section className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-white/95 p-5 shadow-card dark:border-hairline dark:bg-surface/95 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-blue-700 ring-1 ring-blue-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/25">
                <Server className="h-3.5 w-3.5" />
                Koneksi Backend
              </div>
              <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-ink">
                Sinkronisasi ke Backend SIPANDAI
              </h2>
              <p className="mt-1.5 text-sm leading-6 text-ink-muted">
                Login ke server NestJS untuk push scan event + tarik jadwal
                penerbangan. Tanpa ini, aplikasi tetap jalan offline (localStorage).
              </p>
            </div>
            <StatusDot authed={authed} online={summary.online} />
          </div>

          <div className="mt-4 flex items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2 text-xs text-ink-muted ring-1 ring-hairline">
            <Plug className="h-3.5 w-3.5 shrink-0 text-blue-500" />
            <span className="font-semibold text-ink">Endpoint:</span>
            <code className="truncate font-mono">{apiBase}</code>
          </div>
        </section>

        {/* Auth */}
        <section className="rounded-3xl border border-slate-200/70 bg-white/95 p-5 shadow-card dark:border-hairline dark:bg-surface/95">
          {authed && user ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300">
                  <UserIcon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[15px] font-bold text-ink">{user.name}</p>
                  <p className="text-xs text-ink-muted">
                    {user.email} ·{" "}
                    <span className="font-semibold">{roleLabel}</span>
                    {user.station ? ` · ${user.station}` : ""}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300"
              >
                <LogOut className="h-3.5 w-3.5" />
                Logout
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <LogIn className="h-4 w-4 text-blue-600" />
                Login ke backend
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-ink-muted">
                    Email
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none ring-blue-200 focus:ring-2"
                    placeholder="admin@afvs.local"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-ink-muted">
                    Password
                  </span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                    className="w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none ring-blue-200 focus:ring-2"
                    placeholder="••••••••"
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                {SHOW_SEED_CREDENTIALS ? (
                  <p className="inline-flex items-center gap-1.5 text-[11px] text-ink-subtle">
                    <KeyRound className="h-3.5 w-3.5" />
                    Seed: admin@afvs.local / ChangeMe!2026 · operator@afvs.local /
                    operator123
                  </p>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={handleLogin}
                  disabled={loggingIn}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
                >
                  {loggingIn ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LogIn className="h-4 w-4" />
                  )}
                  Login
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Sync toggle */}
        <section className="flex items-center justify-between gap-4 rounded-3xl border border-slate-200/70 bg-white/95 p-5 shadow-card dark:border-hairline dark:bg-surface/95">
          <div>
            <p className="text-sm font-bold text-ink">Sinkronisasi scan ke backend</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Setiap scan otomatis di-push ke server (idempotent, offline-safe via
              outbox).
            </p>
          </div>
          <button
            type="button"
            onClick={toggleSync}
            role="switch"
            aria-checked={syncOn}
            className={cn(
              "relative h-7 w-12 shrink-0 rounded-full transition",
              syncOn ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition",
                syncOn ? "left-[22px]" : "left-0.5",
              )}
            />
          </button>
        </section>

        {/* Pull flights */}
        <section className="rounded-3xl border border-slate-200/70 bg-white/95 p-5 shadow-card dark:border-hairline dark:bg-surface/95">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <DownloadCloud className="h-4 w-4 text-blue-600" />
            Tarik jadwal penerbangan
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-muted">
                Tanggal
              </span>
              <input
                type="date"
                value={pullDate}
                onChange={(e) => setPullDate(e.target.value)}
                className="w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none ring-blue-200 focus:ring-2"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-muted">
                Station (opsional)
              </span>
              <input
                type="text"
                value={pullStation}
                onChange={(e) => setPullStation(e.target.value)}
                placeholder="mis. CGK-T3"
                className="w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none ring-blue-200 focus:ring-2"
              />
            </label>
            <button
              type="button"
              onClick={handlePull}
              disabled={pulling || !authed}
              className="inline-flex h-[38px] items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
            >
              {pulling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <DownloadCloud className="h-4 w-4" />
              )}
              Tarik
            </button>
          </div>
          <p className="mt-2 text-[11px] text-ink-subtle">
            Jadwal di-merge ke data lokal (cocok by nomor flight + tanggal).
            Lihat hasilnya di menu Jadwal Penerbangan.
          </p>
        </section>

        {/* Pull jadwal dari FIDS bandara */}
        <section className="rounded-3xl border border-slate-200/70 bg-white/95 p-5 shadow-card dark:border-hairline dark:bg-surface/95">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Plane className="h-4 w-4 text-emerald-600" />
            Tarik jadwal dari FIDS Bandara
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            Sumber langsung dari display jadwal bandara (APT Pranoto). Hanya
            keberangkatan yang di-merge ke data scan. Tidak perlu login backend.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-muted">
                Tanggal
              </span>
              <input
                type="date"
                value={fidsDate}
                onChange={(e) => setFidsDate(e.target.value)}
                className="w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none ring-emerald-200 focus:ring-2"
              />
            </label>
            <button
              type="button"
              onClick={handleFidsPull}
              disabled={fidsPulling}
              className="inline-flex h-[38px] items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {fidsPulling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <DownloadCloud className="h-4 w-4" />
              )}
              Tarik FIDS
            </button>
          </div>
          <p className="mt-2 text-[11px] text-ink-subtle">
            Lihat papan keberangkatan &amp; kedatangan di menu Jadwal (FIDS).
          </p>
        </section>

        {/* Outbox status */}
        <section className="rounded-3xl border border-slate-200/70 bg-white/95 p-5 shadow-card dark:border-hairline dark:bg-surface/95">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <UploadCloud className="h-4 w-4 text-blue-600" />
              Antrian push scan
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleFlush}
                disabled={flushing}
                className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink transition hover:bg-surface-2 disabled:opacity-60"
              >
                {flushing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Flush
              </button>
              {summary.failed > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    retryAllApiFailed();
                    flushApiOutbox().catch(() => {});
                  }}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300"
                >
                  Coba ulang gagal
                </button>
              )}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2.5">
            <QueueStat label="Pending" value={summary.pending} tone="sky" />
            <QueueStat label="Gagal" value={summary.failed} tone="rose" />
            <QueueStat label="Total" value={summary.total} tone="slate" />
          </div>

          {summary.lastError && (
            <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-[11px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {summary.lastError}
            </p>
          )}
          {summary.total > 0 && (
            <button
              type="button"
              onClick={() => {
                clearApiOutbox();
                toast.info("Antrian dikosongkan.");
              }}
              className="mt-3 text-[11px] font-semibold text-ink-subtle underline-offset-2 hover:underline"
            >
              Kosongkan antrian
            </button>
          )}
        </section>
      </div>
    </>
  );
}

function StatusDot({ authed, online }: { authed: boolean; online: boolean }) {
  const ok = authed && online;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1",
        ok
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25"
          : "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-surface-2 dark:text-ink-muted dark:ring-hairline",
      )}
    >
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : (
        <CloudOff className="h-3.5 w-3.5" />
      )}
      {authed ? (online ? "Terhubung" : "Offline") : "Belum login"}
    </span>
  );
}

function QueueStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "sky" | "rose" | "slate";
}) {
  const toneCls = {
    sky: "text-sky-700 dark:text-sky-300",
    rose: "text-rose-700 dark:text-rose-300",
    slate: "text-ink",
  }[tone];
  return (
    <div className="rounded-2xl bg-surface-2 px-3 py-2.5 ring-1 ring-hairline">
      <p className={cn("text-2xl font-extrabold tabular-nums", toneCls)}>
        {value}
      </p>
      <p className="text-[11px] font-semibold text-ink-muted">{label}</p>
    </div>
  );
}
