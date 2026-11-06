"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ModalTone = "info" | "warning" | "danger" | "success" | "brand";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: ModalTone;
  size?: "sm" | "md" | "lg" | "xl";
  children?: React.ReactNode;
  footer?: React.ReactNode;
  closeOnBackdrop?: boolean;
  hideClose?: boolean;
}

const TONE: Record<
  ModalTone,
  {
    iconBg: string;
    iconText: string;
    iconRing: string;
    headerBg: string;
    accent: string;
  }
> = {
  info: {
    iconBg: "bg-blue-100",
    iconText: "text-blue-700",
    iconRing: "ring-blue-200 dark:ring-blue-400/30",
    headerBg: "from-blue-50/80 to-cyan-50/40 dark:from-blue-500/15 dark:to-cyan-500/5",
    accent: "from-blue-500 to-cyan-400",
  },
  warning: {
    iconBg: "bg-amber-100",
    iconText: "text-amber-700",
    iconRing: "ring-amber-200 dark:ring-amber-400/30",
    headerBg: "from-amber-50/80 to-orange-50/40 dark:from-amber-500/15 dark:to-orange-500/5",
    accent: "from-amber-500 to-orange-400",
  },
  danger: {
    iconBg: "bg-rose-100",
    iconText: "text-rose-700",
    iconRing: "ring-rose-200 dark:ring-rose-400/30",
    headerBg: "from-rose-50/80 to-pink-50/40 dark:from-rose-500/15 dark:to-pink-500/5",
    accent: "from-rose-500 to-pink-400",
  },
  success: {
    iconBg: "bg-emerald-100",
    iconText: "text-emerald-700",
    iconRing: "ring-emerald-200 dark:ring-emerald-400/30",
    headerBg: "from-emerald-50/80 to-teal-50/40 dark:from-emerald-500/15 dark:to-teal-500/5",
    accent: "from-emerald-500 to-teal-400",
  },
  brand: {
    iconBg: "bg-violet-100",
    iconText: "text-violet-700",
    iconRing: "ring-violet-200 dark:ring-violet-400/30",
    headerBg: "from-violet-50/80 to-fuchsia-50/40 dark:from-violet-500/15 dark:to-fuchsia-500/5",
    accent: "from-violet-500 to-fuchsia-400",
  },
};

const SIZE: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-xl",
  xl: "max-w-4xl",
};

export function Modal({
  open,
  onClose,
  title,
  description,
  icon,
  tone = "info",
  size = "md",
  children,
  footer,
  closeOnBackdrop = true,
  hideClose = false,
}: ModalProps) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  const t = TONE[tone];

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] isolate flex items-center justify-center overflow-y-auto px-4 py-4 print:hidden"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop — z-0 eksplisit supaya layer backdrop-blur tidak ter-composite
          di atas dialog (bug stacking Chromium saat backdrop-filter + transform). */}
      <button
        type="button"
        aria-label="Tutup"
        onClick={closeOnBackdrop ? onClose : undefined}
        className="absolute inset-0 z-0 cursor-default bg-slate-900/50 backdrop-blur-sm animate-fade-up"
      />

      {/* Dialog — z-10 eksplisit: selalu di atas backdrop, tidak bergantung urutan DOM. */}
      <div
        className={cn(
          "relative z-10 my-auto flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-lift animate-fade-up dark:border-hairline dark:bg-surface",
          SIZE[size],
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Accent bar */}
        <div
          className={cn(
            "h-1 w-full shrink-0 bg-gradient-to-r",
            t.accent,
          )}
        />

        {/* Header */}
        {(title || icon) && (
          <div
            className={cn(
              "relative flex shrink-0 items-start gap-3 bg-gradient-to-br px-5 py-4",
              t.headerBg,
            )}
          >
            <div
              className={cn(
                "deco-blob -right-6 -top-6 h-24 w-24 opacity-50",
                t.iconBg,
              )}
            />
            {icon && (
              <div
                className={cn(
                  "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 shadow-sm",
                  t.iconBg,
                  t.iconText,
                  t.iconRing,
                )}
              >
                {icon}
              </div>
            )}
            <div className="relative min-w-0 flex-1">
              {title && (
                <h3 className="text-base font-semibold tracking-tight text-slate-800 dark:text-ink">
                  {title}
                </h3>
              )}
              {description && (
                <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-ink-muted">
                  {description}
                </p>
              )}
            </div>
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Tutup"
                className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/70 hover:text-slate-700 dark:text-ink-subtle dark:hover:bg-white/5 dark:hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {/* Body */}
        {children && (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            {children}
          </div>
        )}

        {/* Footer */}
        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3 dark:border-hairline-soft dark:bg-white/5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
