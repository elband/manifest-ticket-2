"use client";

import * as React from "react";
import { Delete, Keyboard, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Keyboard virtual untuk monitor layar sentuh kiosk yang tidak punya keyboard
 * fisik. Tombol memakai onPointerDown + preventDefault supaya fokus tetap di
 * input (kursor tidak hilang, keyboard OS tidak ikut muncul).
 *
 * Pencarian riwayat tidak peka huruf besar/kecil, jadi cukup huruf kapital,
 * angka, dan spasi — itu yang dipakai nama, nomor flight, PNR, dan kursi.
 */
const ROWS: string[][] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"],
];

// Tahan tombol hapus → menghapus berulang.
const REPEAT_DELAY_MS = 450;
const REPEAT_EVERY_MS = 70;

export function TouchKeyboard({
  value,
  onChange,
  onClose,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Sembunyikan keyboard (tombol "Selesai"). */
  onClose: () => void;
  className?: string;
}) {
  // Ref ke nilai terbaru: dipakai pengulangan hapus yang berjalan di timer.
  const valueRef = React.useRef(value);
  valueRef.current = value;
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const repeatRef = React.useRef<{ delay?: number; every?: number }>({});
  const stopRepeat = React.useCallback(() => {
    window.clearTimeout(repeatRef.current.delay);
    window.clearInterval(repeatRef.current.every);
    repeatRef.current = {};
  }, []);
  React.useEffect(() => stopRepeat, [stopRepeat]);

  const type = (ch: string) => onChange(value + ch);
  const backspace = () => {
    const v = valueRef.current;
    if (v) onChangeRef.current(v.slice(0, -1));
  };

  // Tombol tidak boleh mencuri fokus dari input.
  const keep = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();

  const keyBase =
    "flex h-14 select-none items-center justify-center rounded-md bg-kiosk-cell text-[21px] font-semibold text-white ring-1 ring-kiosk-line transition active:scale-[0.96] active:bg-kiosk-sign touch-manipulation";

  return (
    <div
      role="group"
      aria-label="Keyboard layar sentuh"
      className={cn(
        "shrink-0 border-t border-kiosk-line bg-kiosk-asphalt px-3 pb-4 pt-3 shadow-[0_-18px_40px_-20px_rgba(0,0,0,0.7)] animate-fade-up motion-reduce:animate-none",
        className,
      )}
      onMouseDown={keep}
    >
      <p className="mb-2 flex items-center gap-1.5 px-1 text-[13px] text-white/55">
        <Keyboard className="h-4 w-4" />
        Ketuk huruf atau angka untuk mencari
      </p>

      <div className="space-y-1.5">
        {ROWS.map((row, i) => (
          <div
            key={i}
            className="grid gap-1.5"
            // Baris pendek tetap ditengah dengan lebar tombol yang sama.
            style={{ gridTemplateColumns: `repeat(${ROWS[0].length * 2}, minmax(0, 1fr))` }}
          >
            {/* Geser baris pendek agar rata tengah (setengah tombol per selisih). */}
            {row.length < ROWS[0].length && (
              <span style={{ gridColumn: `span ${ROWS[0].length - row.length}` }} aria-hidden />
            )}
            {row.map((k) => (
              <button
                key={k}
                type="button"
                tabIndex={-1}
                onPointerDown={keep}
                onClick={() => type(k)}
                className={cn(keyBase, "col-span-2")}
              >
                {k}
              </button>
            ))}
          </div>
        ))}

        <div className="grid grid-cols-12 gap-1.5">
          <button
            type="button"
            tabIndex={-1}
            onPointerDown={keep}
            onClick={() => onChange("")}
            disabled={!value}
            className={cn(keyBase, "col-span-2 text-[15px] disabled:opacity-40")}
          >
            Hapus semua
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Spasi"
            onPointerDown={keep}
            onClick={() => type(" ")}
            className={cn(keyBase, "col-span-5 text-[15px] text-white/70")}
          >
            spasi
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Hapus satu huruf"
            onPointerDown={(e) => {
              keep(e);
              backspace();
              stopRepeat();
              repeatRef.current.delay = window.setTimeout(() => {
                repeatRef.current.every = window.setInterval(backspace, REPEAT_EVERY_MS);
              }, REPEAT_DELAY_MS);
            }}
            onPointerUp={stopRepeat}
            onPointerLeave={stopRepeat}
            onPointerCancel={stopRepeat}
            onContextMenu={(e) => e.preventDefault()}
            className={cn(keyBase, "col-span-2")}
          >
            <Delete className="h-6 w-6" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            onPointerDown={keep}
            onClick={onClose}
            className={cn(
              keyBase,
              "col-span-3 gap-1.5 bg-kiosk-sign text-[16px] ring-kiosk-sign-glow active:bg-kiosk-sign-glow",
            )}
          >
            <ChevronDown className="h-5 w-5" />
            Selesai
          </button>
        </div>
      </div>
    </div>
  );
}
