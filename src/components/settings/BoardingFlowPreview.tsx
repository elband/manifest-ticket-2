"use client";

import {
  DoorClosed,
  DoorOpen,
  AlarmClockCheck,
  Plane,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppSettings } from "@/lib/settings";

/**
 * Pratinjau hidup alur status boarding untuk Jadwal Penerbangan.
 *
 * Menerjemahkan toggle + ambang menit (open/active/close) ke garis waktu nyata
 * memakai contoh STD 14:00, supaya supervisor langsung paham bahwa flight TIDAK
 * "OPEN terus" / "ACTIVE terus" — melainkan bergerak otomatis:
 *
 *   OPEN (sejak awal hari) → ACTIVE (final call) → CLOSED
 *
 * mengikuti waktu & ambang yang dia set. Murni tampilan (tak menyimpan apa pun).
 */

const SAMPLE_STD = 14 * 60; // contoh 14:00 dalam menit

function fmt(totalMin: number): string {
  const m = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

interface Seg {
  key: string;
  label: string;
  at: string | null; // jam mulai segmen (null = tak relevan)
  scan: boolean; // boleh scan di fase ini?
  icon?: React.ReactNode;
  bar: string;
  chip: string;
}

export function BoardingFlowPreview({
  settings,
  onReset,
}: {
  settings: AppSettings;
  onReset?: () => void;
}) {
  const activeEnabled = settings.boardingActiveEnabled !== false;
  const closeEnabled = settings.boardingCloseEnabled !== false;

  const activeBefore = Math.max(0, settings.boardingActiveMinutesBefore);
  const closeAfter = Math.max(0, settings.boardingCloseMinutesAfter);

  const activeAt = SAMPLE_STD - activeBefore;
  const closeAt = SAMPLE_STD + closeAfter;

  const segs: Seg[] = [];

  // OPEN sejak awal hari keberangkatan (tanpa fase DRAFT berbasis waktu).
  segs.push({
    key: "open",
    label: "OPEN · sejak pagi",
    at: "00:00",
    scan: true,
    icon: <DoorOpen className="h-3 w-3" />,
    bar: "bg-cyan-400",
    chip: "text-cyan-700 dark:text-cyan-300",
  });

  // ACTIVE / final call — hanya bila diaktifkan.
  if (activeEnabled) {
    segs.push({
      key: "active",
      label: "ACTIVE · final call",
      at: fmt(activeAt),
      scan: true,
      icon: <AlarmClockCheck className="h-3 w-3" />,
      bar: "bg-sky-500",
      chip: "text-sky-700 dark:text-sky-300",
    });
  }

  // CLOSED.
  segs.push({
    key: "closed",
    label: closeEnabled ? "CLOSED" : "tetap buka · tutup manual",
    at: closeEnabled ? fmt(closeAt) : null,
    scan: false,
    icon: <DoorClosed className="h-3 w-3" />,
    bar: closeEnabled ? "bg-rose-400" : "bg-amber-400",
    chip: closeEnabled
      ? "text-rose-600 dark:text-rose-300"
      : "text-amber-600 dark:text-amber-300",
  });

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-slate-50/60 p-3.5 dark:border-hairline dark:bg-white/[0.03]">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-ink-subtle">
          Pratinjau alur status
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10.5px] font-bold text-slate-600 ring-1 ring-slate-200 dark:bg-surface-elev dark:text-ink-muted dark:ring-hairline">
          <Plane className="h-3 w-3" />
          Contoh STD {fmt(SAMPLE_STD)}
        </span>
      </div>

      {onReset && (
        <button
          type="button"
          onClick={onReset}
          className="mb-3 inline-flex items-center gap-1.5 rounded-lg bg-cyan-50 px-2.5 py-1.5 text-[11px] font-bold text-cyan-700 ring-1 ring-cyan-200 transition hover:bg-cyan-100 active:scale-95 dark:bg-cyan-500/10 dark:text-cyan-300 dark:ring-cyan-500/25 dark:hover:bg-cyan-500/20"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset boarding ke rekomendasi (pos pendataan)
        </button>
      )}

      {/* Garis waktu */}
      <div className="flex items-stretch gap-1">
        {segs.map((s) => (
          <div key={s.key} className="min-w-0 flex-1">
            <div className={cn("h-1.5 w-full rounded-full", s.bar)} />
            <div className="mt-1.5">
              <div
                className={cn(
                  "flex items-center gap-1 truncate text-[10.5px] font-bold",
                  s.chip,
                )}
              >
                {s.icon}
                <span className="truncate">{s.label}</span>
              </div>
              <div className="mt-0.5 font-mono text-[10px] tabular-nums text-slate-400 dark:text-ink-subtle">
                {s.at ? `≈ ${s.at}` : "—"}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Keterangan boleh-scan */}
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-slate-500 dark:text-ink-muted">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Boleh scan: OPEN &amp; ACTIVE
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-slate-400" />
          Diblokir: DRAFT, CLOSED, CANCELLED
        </span>
      </p>
    </div>
  );
}
