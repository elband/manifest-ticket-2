"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Plane,
  ScanLine,
  CheckCircle2,
  AlertOctagon,
  CopyCheck,
  ArrowRight,
  Clock,
} from "lucide-react";
import { PremiumStatCard } from "@/components/dashboard/PremiumStatCard";
import { ScanStatusBadge } from "@/components/ui/StatusBadge";
import { Flight, ScanEvent } from "@/lib/types";
import { getFlights, getScanEvents, getSession } from "@/lib/storage";
import { cn, formatTime, localDateKey, todayDateString } from "@/lib/utils";
import { useCountUp } from "@/lib/useCountUp";
import {
  boardingProgressFromCount,
  buildBoardedCounts,
  getBoardingProgress,
} from "@/lib/boarding";
import { AirlineLogo } from "@/components/ui/AirlineLogo";
import { getSettings, subscribeSettings } from "@/lib/settings";
import {
  apiManifestByAirline,
  apiListAllScans,
  isAuthed,
} from "@/lib/api/client";
import { getEffectiveFlightStatus } from "@/lib/flightStatus";
import { LargeTitle } from "@/components/mobile/LargeTitle";
import { ListSection } from "@/components/mobile/GroupedList";
import { FlightRow } from "@/components/mobile/FlightRow";
import { EventRow } from "@/components/mobile/EventRow";
import { AirportHero } from "@/components/dashboard/AirportHero";

export default function DashboardPage() {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [settings, setSettings] = useState(() => getSettings());
  const [now, setNow] = useState(() => new Date());
  const [userName, setUserName] = useState("Admin Operator");

  useEffect(() => {
    setFlights(getFlights());
    setEvents(getScanEvents());
    setSettings(getSettings());
    const sess = getSession();
    if (sess?.name) setUserName(sess.name);
    const unsub = subscribeSettings(setSettings);
    const tick = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      setNow(new Date());
    }, 30_000);
    return () => {
      unsub();
      clearInterval(tick);
    };
  }, []);

  const today = todayDateString();

  const flightsToday = useMemo(
    () => flights.filter((f) => f.departureDate === today),
    [flights, today],
  );

  const effectiveStats = useMemo(() => {
    const counts = { open: 0, active: 0, closed: 0, draft: 0, cancelled: 0 };
    for (const f of flightsToday) {
      const eff = getEffectiveFlightStatus(f, now, settings).status;
      if (eff === "OPEN") counts.open += 1;
      else if (eff === "ACTIVE") counts.active += 1;
      else if (eff === "CLOSED") counts.closed += 1;
      else if (eff === "DRAFT") counts.draft += 1;
      else if (eff === "CANCELLED") counts.cancelled += 1;
    }
    return counts;
  }, [flightsToday, now, settings]);

  const boardableNow = effectiveStats.open + effectiveStats.active;

  const eventsToday = useMemo(
    () => events.filter((e) => localDateKey(e.scannedAt) === today),
    [events, today],
  );

  // P-07: index boarded-count dibangun sekali, dipakai per-flight O(1).
  const boardedCounts = useMemo(() => buildBoardedCounts(events), [events]);

  // Data SERVER (agar angka mencakup scan dari SEMUA pos, bukan cuma perangkat
  // ini). Fallback ke lokal bila offline / belum login.
  const [serverCounts, setServerCounts] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [serverStats, setServerStats] = useState<{
    total: number;
    valid: number;
    dup: number;
    rejected: number;
  } | null>(null);
  useEffect(() => {
    if (!settings.apiSyncEnabled || !isAuthed()) {
      setServerCounts(new Map());
      setServerStats(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rep = await apiManifestByAirline({ date: today, detail: true });
        if (!cancelled && rep.ok && rep.data) {
          const m = new Map<string, number>();
          for (const a of rep.data.airlines)
            for (const fd of a.flightsDetail)
              m.set(
                `${fd.flightNumber.toUpperCase()}|${fd.std.slice(0, 10)}`,
                fd.passengers,
              );
          setServerCounts(m);
        }
      } catch {
        /* fallback lokal */
      }
      try {
        const sc = await apiListAllScans({ date: today });
        if (!cancelled && sc.ok && sc.data) {
          const it = sc.data.items;
          const valid = it.filter((e) => e.resultStatus === "VALID_FLIGHT").length;
          const dup = it.filter((e) => e.resultStatus === "DUPLICATE_SCAN").length;
          setServerStats({
            total: it.length,
            valid,
            dup,
            rejected: it.length - valid - dup,
          });
        }
      } catch {
        /* fallback lokal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [today, settings.apiSyncEnabled, flights.length]);

  const boardedOf = (f: Flight) =>
    serverCounts.get(`${f.flightNumber.toUpperCase()}|${f.departureDate}`) ??
    boardedCounts.get(f.id) ??
    0;

  const localValid = eventsToday.filter(
    (e) => e.resultStatus === "VALID_FLIGHT",
  ).length;
  const localDup = eventsToday.filter(
    (e) => e.resultStatus === "DUPLICATE_SCAN",
  ).length;
  // Statistik efektif: server (lintas-pos) > lokal.
  const stats = serverStats ?? {
    total: eventsToday.length,
    valid: localValid,
    dup: localDup,
    rejected: eventsToday.length - localValid - localDup,
  };
  const validCount = stats.valid;
  const dupCount = stats.dup;
  const rejectedCount = stats.rejected;

  const flightsCnt = useCountUp(flightsToday.length);
  const scanCnt = useCountUp(stats.total);
  const validCnt = useCountUp(stats.valid);
  const dupCnt = useCountUp(stats.dup);
  const rejectedCnt = useCountUp(stats.rejected);

  const sortedFlightsToday = useMemo(
    () =>
      flightsToday
        .slice()
        .sort((a, b) => a.departureTime.localeCompare(b.departureTime)),
    [flightsToday],
  );

  const todayLabel = useMemo(() => {
    const d = new Date(now);
    return d.toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }, [now]);

  return (
    <>
      {/* ---------- MOBILE ---------- */}
      <div className="space-y-4 lg:hidden">
        <LargeTitle
          eyebrow={todayLabel}
          title="Dashboard"
          subtitle="Ringkasan aktivitas hari ini"
          trailing={
            <Link
              href="/scan"
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-sm"
            >
              <ScanLine className="h-3.5 w-3.5" />
              Scan
            </Link>
          }
        />

        <div className="grid grid-cols-3 gap-2">
          <MobileKpi
            label="Flight"
            value={flightsCnt}
            sub={
              boardableNow > 0 ? `${boardableNow} aktif` : `${flightsToday.length} hari ini`
            }
            tone="blue"
            icon={<Plane className="h-3.5 w-3.5" />}
          />
          <MobileKpi
            label="Scan"
            value={scanCnt}
            sub="hari ini"
            tone="sky"
            icon={<ScanLine className="h-3.5 w-3.5" />}
          />
          <MobileKpi
            label="Valid"
            value={validCnt}
            sub="boarding pass"
            tone="emerald"
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          />
          <MobileKpi
            label="Duplikat"
            value={dupCnt}
            sub="re-scan"
            tone="amber"
            icon={<CopyCheck className="h-3.5 w-3.5" />}
          />
          <MobileKpi
            label="Ditolak"
            value={rejectedCnt}
            sub="invalid"
            tone="rose"
            icon={<AlertOctagon className="h-3.5 w-3.5" />}
          />
          <Link
            href="/flights"
            className="flex flex-col items-center justify-center gap-1 rounded-2xl bg-surface ring-1 ring-hairline shadow-card px-2 py-3 text-center transition active:bg-surface-2"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
              <ArrowRight className="h-3.5 w-3.5" />
            </span>
            <span className="text-[11px] font-semibold text-ink-muted">Lihat semua</span>
            <span className="text-[10px] text-ink-subtle">flight</span>
          </Link>
        </div>

        <ListSection
          header={
            <span className="flex items-center justify-between">
              <span>Penerbangan Hari Ini</span>
              <Link href="/flights" className="text-blue-600 normal-case tracking-normal text-[12px] font-semibold">
                Semua
              </Link>
            </span>
          }
        >
          {sortedFlightsToday.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-ink-muted">
              Belum ada flight terjadwal.
            </div>
          ) : (
            sortedFlightsToday.slice(0, 6).map((f) => {
              const eff = getEffectiveFlightStatus(f, now, settings);
              return (
                <FlightRow
                  key={f.id}
                  flight={f}
                  effectiveStatus={eff.status}
                  effectiveAuto={eff.status !== f.status}
                  progress={boardingProgressFromCount(f, boardedOf(f))}
                />
              );
            })
          )}
        </ListSection>

        <ListSection
          header={
            <span className="flex items-center justify-between">
              <span>Aktivitas Terbaru</span>
              <Link
                href="/scan-events"
                className="text-blue-600 normal-case tracking-normal text-[12px] font-semibold"
              >
                Riwayat
              </Link>
            </span>
          }
        >
          {events.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-ink-muted">
              Belum ada aktivitas scan.
            </div>
          ) : (
            events.slice(0, 8).map((e) => <EventRow key={e.id} event={e} />)
          )}
        </ListSection>
      </div>

      {/* ---------- DESKTOP ---------- */}
      <div className="space-y-6 hidden lg:block">
        <AirportHero
          userName={userName}
          flightsToday={flightsToday.length}
          scansToday={eventsToday.length}
          validToday={validCount}
        />

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          <div className="h-full animate-fade-up stagger-1">
            <PremiumStatCard
              label="Flight Hari Ini"
              value={flightsCnt}
              helper={
                boardableNow > 0
                  ? `${boardableNow} sedang boarding`
                  : `Tanggal ${today}`
              }
              tone="blue"
              icon={<Plane className="h-5 w-5" />}
            />
          </div>
          <div className="h-full animate-fade-up stagger-2">
            <PremiumStatCard
              label="Total Scan"
              value={scanCnt}
              helper="Hari ini"
              tone="cyan"
              icon={<ScanLine className="h-5 w-5" />}
            />
          </div>
          <div className="h-full animate-fade-up stagger-3">
            <PremiumStatCard
              label="Valid"
              value={validCnt}
              helper="Boarding pass valid"
              tone="emerald"
              icon={<CheckCircle2 className="h-5 w-5" />}
            />
          </div>
          <div className="h-full animate-fade-up stagger-4">
            <PremiumStatCard
              label="Duplicate"
              value={dupCnt}
              helper="Pernah di-scan"
              tone="amber"
              icon={<CopyCheck className="h-5 w-5" />}
            />
          </div>
          <div className="h-full animate-fade-up stagger-5">
            <PremiumStatCard
              label="Rejected"
              value={rejectedCnt}
              helper="Invalid / tidak hari ini"
              tone="rose"
              icon={<AlertOctagon className="h-5 w-5" />}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          {/* Today flights — premium panel */}
          <section className="relative animate-fade-up stagger-2 overflow-hidden rounded-3xl border border-slate-200/70 bg-white/95 shadow-[0_18px_40px_-24px_rgba(15,42,98,0.35)] backdrop-blur-sm dark:border-hairline dark:bg-surface/95 xl:col-span-2">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-blue-300/40 blur-3xl dark:bg-sky-500/20"
            />
            <header className="relative flex items-center justify-between gap-3 px-6 py-5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-[0_8px_18px_-6px_rgba(37,99,235,0.7)] ring-1 ring-white/40">
                  <Plane className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-[15px] font-bold tracking-tight text-slate-800 dark:text-ink">
                    Jadwal Penerbangan Hari Ini
                  </h3>
                  <p className="mt-0.5 text-[12px] text-slate-500 dark:text-ink-muted">
                    Flight yang boleh divalidasi pada pos pengecekan.
                  </p>
                </div>
              </div>
              <Link
                href="/flights"
                className="group inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-4 py-1.5 text-[12px] font-semibold text-blue-700 ring-1 ring-blue-200 transition hover:bg-blue-100 hover:shadow-[0_4px_12px_-2px_rgba(37,99,235,0.35)]"
              >
                Lihat semua
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </header>

            <div className="relative">
              {flightsToday.length === 0 ? (
                <div className="px-6 py-14 text-center text-sm text-slate-500">
                  Belum ada flight terjadwal untuk hari ini.
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 px-2 pb-2 dark:divide-hairline">
                  {flightsToday
                    .slice()
                    .sort((a, b) =>
                      a.departureTime.localeCompare(b.departureTime),
                    )
                    .map((f, idx) => {
                      const eff = getEffectiveFlightStatus(f, now, settings);
                      const differs = eff.status !== f.status;
                      const progress = boardingProgressFromCount(f, boardedOf(f));
                      return (
                        <li
                          key={f.id}
                          className="animate-fade-up"
                          style={{ animationDelay: `${idx * 40}ms` }}
                        >
                          <Link
                            href={`/flights/${f.id}`}
                            className="group grid items-center gap-4 rounded-xl px-3 py-3 transition-colors hover:bg-slate-50/80 dark:hover:bg-surface-elev/60 grid-cols-[44px_minmax(0,1fr)_160px_72px_100px_56px]"
                          >
                            {/* Logo */}
                            <div className="shrink-0 transition-transform group-hover:scale-105">
                              <AirlineLogo code={f.airlineCode} size="md" />
                            </div>

                            {/* Flight info */}
                            <div className="min-w-0">
                              <p className="truncate text-[14px] font-bold tracking-tight text-slate-800 dark:text-ink">
                                {f.flightNumber}{" "}
                                <span className="text-[12px] font-medium text-slate-400">
                                  · {f.airlineCode}
                                </span>
                              </p>
                              <p className="mt-0.5 truncate text-[12px] text-slate-500 dark:text-ink-muted">
                                {f.originAirport} → {f.destinationAirport} ·{" "}
                                {f.gateOrCheckpoint}
                              </p>
                            </div>

                            {/* Progress */}
                            <FlightProgressInline progress={progress} />

                            {/* Time */}
                            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-600 dark:text-ink-muted">
                              <Clock className="h-3.5 w-3.5 text-slate-400" />
                              {f.departureTime}
                            </span>

                            {/* Status pill */}
                            <div className="flex justify-start">
                              <StatusPill
                                status={eff.status}
                                title={
                                  differs
                                    ? `Manual: ${f.status} • ${eff.description}`
                                    : eff.description
                                }
                              />
                            </div>

                            {/* AUTO tag */}
                            <span
                              className={cn(
                                "justify-self-end rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                                differs
                                  ? "bg-slate-100 text-slate-500 ring-1 ring-slate-200 dark:bg-surface-elev dark:text-ink-muted dark:ring-hairline"
                                  : "text-slate-300 dark:text-ink-subtle",
                              )}
                            >
                              AUTO
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                </ul>
              )}
            </div>
          </section>

          {/* Recent events — modern timeline */}
          <section className="relative animate-fade-up stagger-3 overflow-hidden rounded-3xl border border-slate-200/70 bg-white/95 shadow-[0_18px_40px_-24px_rgba(15,42,98,0.35)] backdrop-blur-sm dark:border-hairline dark:bg-surface/95">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-emerald-300/40 blur-3xl dark:bg-emerald-500/15"
            />
            <header className="relative flex items-center justify-between gap-3 px-6 py-5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-[0_8px_18px_-6px_rgba(16,185,129,0.7)] ring-1 ring-white/40">
                  <ScanLine className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-[15px] font-bold tracking-tight text-slate-800 dark:text-ink">
                    Aktivitas Scan Terbaru
                  </h3>
                  <p className="mt-0.5 text-[12px] text-slate-500 dark:text-ink-muted">
                    10 event terakhir.
                  </p>
                </div>
              </div>
              <Link
                href="/scan-events"
                className="group inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-4 py-1.5 text-[12px] font-semibold text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100 hover:shadow-[0_4px_12px_-2px_rgba(16,185,129,0.35)]"
              >
                Riwayat
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </header>

            <div className="relative px-5 pb-5">
              {events.length === 0 ? (
                <div className="px-2 py-14 text-center text-sm text-slate-500">
                  Belum ada aktivitas scan.
                </div>
              ) : (
                <ol className="relative space-y-1">
                  {/* Vertical timeline line */}
                  <span
                    aria-hidden
                    className="absolute left-[10px] top-2 bottom-2 w-px bg-gradient-to-b from-emerald-200 via-slate-200 to-transparent dark:from-emerald-500/30 dark:via-hairline dark:to-transparent"
                  />
                  {events.slice(0, 10).map((e, idx) => {
                    const isValid = e.resultStatus === "VALID_FLIGHT";
                    const isDup = e.resultStatus === "DUPLICATE_SCAN";
                    return (
                      <li
                        key={e.id}
                        className="relative animate-fade-up rounded-xl pl-7 pr-2 py-2.5 transition-all hover:bg-slate-50 dark:hover:bg-surface-elev"
                        style={{ animationDelay: `${idx * 40}ms` }}
                      >
                        {/* Timeline dot */}
                        <span
                          aria-hidden
                          className={cn(
                            "absolute left-[5px] top-4 flex h-3 w-3 items-center justify-center rounded-full ring-2 ring-white dark:ring-surface",
                            isValid
                              ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.7)]"
                              : isDup
                                ? "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.6)]"
                                : "bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.6)]",
                          )}
                        >
                          {isValid && (
                            <span className="absolute h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                          )}
                        </span>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[13.5px] font-bold tracking-tight text-slate-800">
                            {e.parsedFlightNumber ?? "—"}
                          </p>
                          <ScanStatusBadge status={e.resultStatus} />
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {formatTime(e.scannedAt)} ·{" "}
                          <span className="font-medium text-slate-600">
                            oleh {e.scannedBy}
                          </span>
                        </p>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

const DASH_TONE: Record<
  "neutral" | "info" | "warning" | "success" | "danger",
  { bar: string; text: string; chip: string }
> = {
  neutral: {
    bar: "bg-slate-400",
    text: "text-slate-600",
    chip: "bg-slate-50 ring-slate-200",
  },
  info: {
    bar: "bg-blue-500",
    text: "text-blue-700",
    chip: "bg-blue-50 ring-blue-200",
  },
  warning: {
    bar: "bg-amber-500",
    text: "text-amber-700",
    chip: "bg-amber-50 ring-amber-200",
  },
  success: {
    bar: "bg-emerald-500",
    text: "text-emerald-700",
    chip: "bg-emerald-50 ring-emerald-200",
  },
  danger: {
    bar: "bg-rose-500",
    text: "text-rose-700",
    chip: "bg-rose-50 ring-rose-200",
  },
};

function FlightProgressInline({
  progress,
}: {
  progress: ReturnType<typeof getBoardingProgress>;
}) {
  if (progress.expected === null) {
    return (
      <div>
        <span className="text-[12px] font-semibold text-slate-400">
          {progress.boarded} pax
        </span>
      </div>
    );
  }
  const t = DASH_TONE[progress.tone];
  const percent = progress.percent ?? 0;
  return (
    <div>
      <div className="flex items-baseline gap-1.5 text-[12.5px] font-semibold tabular-nums text-slate-700 dark:text-ink">
        <span>
          {progress.boarded}/{progress.expected}
        </span>
        <span className="text-[11px] font-medium text-slate-400">
          {percent}%
        </span>
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-surface-elev">
        <div
          className={cn("h-full rounded-full transition-all", t.bar)}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

const STATUS_PILL: Record<
  ReturnType<typeof getEffectiveFlightStatus>["status"],
  { dot: string; text: string; bg: string; ring: string; label: string }
> = {
  OPEN: {
    dot: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-50 dark:bg-emerald-500/10",
    ring: "ring-emerald-100 dark:ring-emerald-500/20",
    label: "Open",
  },
  ACTIVE: {
    dot: "bg-cyan-500",
    text: "text-cyan-700 dark:text-cyan-300",
    bg: "bg-cyan-50 dark:bg-cyan-500/10",
    ring: "ring-cyan-100 dark:ring-cyan-500/20",
    label: "Active",
  },
  CLOSED: {
    dot: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-50 dark:bg-emerald-500/10",
    ring: "ring-emerald-100 dark:ring-emerald-500/20",
    label: "Closed",
  },
  DRAFT: {
    dot: "bg-blue-500",
    text: "text-blue-700 dark:text-blue-300",
    bg: "bg-blue-50 dark:bg-blue-500/10",
    ring: "ring-blue-100 dark:ring-blue-500/20",
    label: "Draft",
  },
  CANCELLED: {
    dot: "bg-rose-500",
    text: "text-rose-700 dark:text-rose-300",
    bg: "bg-rose-50 dark:bg-rose-500/10",
    ring: "ring-rose-100 dark:ring-rose-500/20",
    label: "Cancelled",
  },
};

function StatusPill({
  status,
  title,
}: {
  status: ReturnType<typeof getEffectiveFlightStatus>["status"];
  title?: string;
}) {
  const t = STATUS_PILL[status];
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ring-1",
        t.bg,
        t.text,
        t.ring,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", t.dot)} />
      {t.label}
    </span>
  );
}

const MOBILE_KPI_TONE: Record<
  "blue" | "sky" | "emerald" | "amber" | "rose",
  { icon: string; value: string }
> = {
  blue: { icon: "bg-blue-100 text-blue-700", value: "text-blue-700" },
  sky: { icon: "bg-sky-100 text-sky-700", value: "text-sky-700" },
  emerald: { icon: "bg-emerald-100 text-emerald-700", value: "text-emerald-700" },
  amber: { icon: "bg-amber-100 text-amber-700", value: "text-amber-700" },
  rose: { icon: "bg-rose-100 text-rose-700", value: "text-rose-700" },
};

function MobileKpi({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: number;
  sub: string;
  tone: keyof typeof MOBILE_KPI_TONE;
  icon: React.ReactNode;
}) {
  const t = MOBILE_KPI_TONE[tone];
  return (
    <div className="rounded-2xl bg-surface ring-1 ring-hairline shadow-card px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", t.icon)}>
          {icon}
        </span>
      </div>
      <p className={cn("mt-1.5 text-[22px] font-extrabold tabular-nums leading-none", t.value)}>
        {value}
      </p>
      <p className="mt-1 text-[11px] font-semibold text-ink">{label}</p>
      <p className="text-[10px] text-ink-subtle">{sub}</p>
    </div>
  );
}
