"use client";

import * as React from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  CalendarClock,
  CalendarX2,
  Clock,
  IdCard,
  Loader2,
  MapPin,
  UserRound,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PasStatus, PasVerifyResult } from "@/lib/api/client";
import { daysUntil, formatPasDate } from "@/lib/pas";

export type PasCheckState =
  | { phase: "loading"; key: string }
  | { phase: "done"; key: string; result: PasVerifyResult }
  | { phase: "failed"; key: string; error: string };

export type PasTone = "success" | "warning" | "danger" | "info";

export const PAS_STATUS_META: Record<
  PasStatus,
  { label: string; tone: PasTone; icon: React.ReactNode }
> = {
  VALID: {
    label: "PAS BANDARA VALID",
    tone: "success",
    icon: <BadgeCheck className="h-12 w-12" />,
  },
  EXPIRED: {
    label: "PAS KEDALUWARSA",
    tone: "danger",
    icon: <CalendarX2 className="h-12 w-12" />,
  },
  NOT_FOUND: {
    label: "PAS TIDAK TERDAFTAR",
    tone: "danger",
    icon: <XCircle className="h-12 w-12" />,
  },
  ERROR: {
    label: "PERIKSA MANUAL",
    tone: "warning",
    icon: <AlertTriangle className="h-12 w-12" />,
  },
};

/** Judul/ikon/nada modal untuk tiap fase pengecekan. */
export function pasModalMeta(state: PasCheckState): {
  label: string;
  tone: PasTone;
  icon: React.ReactNode;
  description: string;
} {
  if (state.phase === "loading") {
    return {
      label: "MEMERIKSA PAS BANDARA",
      tone: "info",
      icon: <Loader2 className="h-12 w-12 animate-spin" />,
      description: "Mengambil data kartu dari server Pas Bandara…",
    };
  }
  if (state.phase === "failed") {
    return {
      ...PAS_STATUS_META.ERROR,
      description: state.error,
    };
  }
  return {
    ...PAS_STATUS_META[state.result.status],
    description: state.result.message,
  };
}

const GUIDANCE: Partial<Record<PasStatus, string>> = {
  VALID:
    "Cocokkan wajah pemegang dengan foto, lalu pastikan kode area mengizinkan masuk ke area ini.",
  EXPIRED: "Masa berlaku pas sudah habis. Tolak masuk dan arahkan ke kantor Pas Bandara.",
  NOT_FOUND:
    "Pas tidak terdaftar atau sudah tidak aktif. Tolak masuk dan hubungi supervisor.",
  ERROR:
    "Data tidak bisa diambil saat ini. Periksa kartu fisik & identitas secara manual.",
};

const TONE_BOX: Record<PasTone, string> = {
  success: "bg-emerald-50 text-emerald-900 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-100 dark:ring-emerald-500/30",
  warning: "bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/30",
  danger: "bg-rose-50 text-rose-900 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-100 dark:ring-rose-500/30",
  info: "bg-blue-50 text-blue-900 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-100 dark:ring-blue-500/30",
};

/** Warna chip kartu dari nama warna di kartu (cadangan bila CSS halaman kosong). */
const CARD_COLOR_CSS: Record<string, string> = {
  MERAH: "#dc2626",
  BIRU: "#2563eb",
  KUNING: "#eab308",
  HIJAU: "#16a34a",
  PUTIH: "#ffffff",
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

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-ink-subtle">
        {label}
      </p>
      <div className="mt-0.5 break-words text-[15px] font-bold text-slate-900 dark:text-ink">
        {children}
      </div>
    </div>
  );
}

export function PasResultBody({ state }: { state: PasCheckState }) {
  if (state.phase === "loading") {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-5 py-6 ring-1 ring-slate-100 dark:bg-white/5 dark:ring-hairline-soft">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500 dark:text-cyan-300" />
        <p className="text-sm font-semibold text-slate-600 dark:text-ink-muted">
          Mohon tunggu, sedang memeriksa kartu…
        </p>
      </div>
    );
  }

  if (state.phase === "failed") {
    return (
      <div className={cn("flex items-start gap-3 rounded-2xl px-4 py-3 ring-1", TONE_BOX.warning)}>
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <p className="text-[13.5px] font-semibold leading-snug">{GUIDANCE.ERROR}</p>
      </div>
    );
  }

  const { result } = state;
  const card = result.card;
  const tone = PAS_STATUS_META[result.status].tone;
  const left = card ? daysUntil(card.validUntil, todayWita()) : null;
  const colorCss =
    card?.cardColorCss ?? (card?.cardColor ? CARD_COLOR_CSS[card.cardColor.toUpperCase()] : null);

  return (
    <div className="space-y-4">
      {card && (
        // HP: foto & nama berdampingan, detail di bawah selebar kartu.
        // Layar lebar: foto besar di kiri merentang setinggi semua detail.
        <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-100 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-x-5 sm:p-4 dark:bg-white/5 dark:ring-hairline-soft">
          {/* Foto — petugas membandingkan dengan wajah di depannya. */}
          <div className="sm:row-span-3">
            {card.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={card.photoUrl}
                alt={`Foto ${card.name ?? "pemegang pas"}`}
                referrerPolicy="no-referrer"
                className="h-32 w-[6.5rem] rounded-xl bg-slate-200 object-cover ring-1 ring-slate-200 sm:h-56 sm:w-44 dark:bg-white/10 dark:ring-white/10"
              />
            ) : (
              <div className="grid h-32 w-[6.5rem] place-items-center rounded-xl bg-slate-200 text-slate-400 sm:h-56 sm:w-44 dark:bg-white/10">
                <UserRound className="h-12 w-12 sm:h-16 sm:w-16" />
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col justify-center sm:block">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-ink-subtle">
              Nama Lengkap
            </p>
            <p className="break-words text-xl font-black uppercase leading-tight tracking-tight text-slate-900 sm:text-2xl dark:text-ink">
              {card.name ?? "—"}
            </p>
            <p className="mt-1 flex items-start gap-1.5 text-sm font-semibold text-slate-600 dark:text-ink-muted">
              <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 break-words">
                {[card.position, card.company].filter(Boolean).join(" · ") || "—"}
              </span>
            </p>
          </div>

          <div className="col-span-2 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-200/70 pt-3 sm:col-span-1 sm:col-start-2 dark:border-white/10">
            <Field label="Nomor Pas" className="col-span-2 sm:col-span-1">
              <span className="flex items-center gap-1.5 font-mono">
                <IdCard className="h-4 w-4 shrink-0 text-slate-400" />
                {card.pasNumber ?? "—"}
              </span>
            </Field>
            <Field label="Warna Kartu">
              <span className="flex items-center gap-2">
                {colorCss && (
                  <span
                    className="h-4 w-4 shrink-0 rounded ring-1 ring-black/15"
                    style={{ background: colorCss }}
                  />
                )}
                {card.cardColor ?? "—"}
              </span>
            </Field>
            <Field label="Kategori" className="sm:col-span-2">
              <span title={card.categoryNote ?? undefined}>{card.category ?? "—"}</span>
            </Field>
            <Field label="Jenis Pas">{card.passType ?? "—"}</Field>
            <Field label="Diterbitkan">{formatPasDate(card.issuedAt)}</Field>
            <Field label="Berlaku s/d" className="col-span-2">
              <span
                className={cn(
                  "flex items-center gap-1.5",
                  result.status === "EXPIRED" && "text-rose-600 dark:text-rose-300",
                )}
              >
                <CalendarClock className="h-4 w-4 shrink-0" />
                {formatPasDate(card.validUntil)}
                {left != null && (
                  <span className="text-xs font-semibold text-slate-500 dark:text-ink-muted">
                    {left < 0
                      ? `(lewat ${-left} hari)`
                      : left === 0
                        ? "(hari terakhir)"
                        : `(${left} hari lagi)`}
                  </span>
                )}
              </span>
            </Field>
          </div>

          <div className="col-span-2 border-t border-slate-200/70 pt-3 sm:col-span-1 sm:col-start-2 dark:border-white/10">
            <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-ink-subtle">
              <MapPin className="h-3 w-3" />
              Kode Area
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {card.areaCodes.length ? (
                card.areaCodes.map((a) => (
                  <span
                    key={a}
                    className="grid h-9 min-w-9 place-items-center rounded-lg bg-slate-900 px-2 font-mono text-lg font-black text-white dark:bg-white dark:text-slate-900"
                  >
                    {a}
                  </span>
                ))
              ) : (
                <span className="text-sm font-semibold text-slate-500">—</span>
              )}
            </div>
          </div>
        </div>
      )}

      {GUIDANCE[result.status] && (
        <div className={cn("flex items-start gap-3 rounded-2xl px-4 py-3 ring-1", TONE_BOX[tone])}>
          {tone === "success" ? (
            <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          )}
          <p className="text-[13.5px] font-semibold leading-snug">{GUIDANCE[result.status]}</p>
        </div>
      )}

      <p className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-ink-subtle">
        <Clock className="h-3 w-3" />
        {new Date(result.checkedAt).toLocaleString("id-ID")} · sumber: pas.aptpairport.id
      </p>
    </div>
  );
}
