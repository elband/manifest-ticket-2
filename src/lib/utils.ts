import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function todayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Tanggal LOKAL (YYYY-MM-DD) dari timestamp ISO/Date. Pakai ini — bukan
 * `iso.slice(0, 10)` — saat membandingkan dengan `todayDateString()`:
 * timestamp disimpan dalam UTC, jadi slice memberi tanggal UTC yang di WITA
 * (UTC+8) baru berganti pukul 08.00 pagi.
 */
export function localDateKey(value: string | Date): string {
  const t = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(t.getTime())) return "";
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function tomorrowDateString(): string {
  return dateStringFromOffset(1);
}

export function yesterdayDateString(): string {
  return dateStringFromOffset(-1);
}

export function dateStringFromOffset(offsetDays: number): string {
  const t = new Date();
  t.setDate(t.getDate() + offsetDays);
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
