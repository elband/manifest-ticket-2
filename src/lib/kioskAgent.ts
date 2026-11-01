"use client";

/**
 * Klien untuk SIPANDAI Kiosk Agent (kiosk-agent/ di repo) — agen kecil yang
 * berjalan di perangkat kiosk Lubuntu dan bisa menutup browser / mematikan
 * perangkat, hal yang tidak boleh dilakukan halaman web sendiri.
 *
 * Agen hanya listen di 127.0.0.1 dan hanya menerima Origin SIPANDAI. Bila agen
 * tidak terpasang (mis. kiosk dibuka di laptop biasa), daftar aksinya kosong
 * dan halaman memakai fallback.
 *
 * Di aplikasi desktop SIPANDAI (desktop/ di repo, Electron) aksi yang sama
 * dijalankan langsung lewat `window.sipandaiDesktop`, tanpa agen HTTP.
 */

const AGENT_URL = (
  process.env.NEXT_PUBLIC_KIOSK_AGENT_URL ?? "http://127.0.0.1:47800"
).replace(/\/$/, "");

export type KioskAgentAction = "close-browser" | "shutdown" | "minimize-browser";

/** Jembatan dari desktop/preload.js; hanya ada di aplikasi desktop SIPANDAI. */
type DesktopBridge = {
  getActions(): Promise<string[]>;
  runAction(action: KioskAgentAction): Promise<boolean>;
};

function desktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { sipandaiDesktop?: DesktopBridge }).sipandaiDesktop ?? null;
}

async function call(
  path: string,
  method: "GET" | "POST",
  timeoutMs: number,
): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${AGENT_URL}${path}`, {
      method,
      // Header khusus → browser wajib preflight CORS (agen memeriksa Origin).
      headers: { "Content-Type": "application/json", "X-Sipandai-Kiosk": "1" },
      body: method === "POST" ? "{}" : undefined,
      signal: ctrl.signal,
      cache: "no-store",
    });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Aksi yang didukung agen di perangkat ini (mis. "minimize-browser" hanya ada
 * bila xdotool terpasang & sesi X11), atau [] bila agen tidak terpasang /
 * tidak mengizinkan halaman ini.
 */
export async function getKioskAgentActions(): Promise<KioskAgentAction[]> {
  const desktop = desktopBridge();
  if (desktop) {
    try {
      const actions = await desktop.getActions();
      return actions.filter((a) => typeof a === "string") as KioskAgentAction[];
    } catch {
      return [];
    }
  }
  const res = await call("/health", "GET", 1200);
  if (!res) return [];
  try {
    const body = (await res.json()) as { actions?: unknown };
    return Array.isArray(body.actions)
      ? body.actions
          .filter((a): a is string => typeof a === "string")
          .map((a) => a.replace(/^\//, "") as KioskAgentAction)
      : [];
  } catch {
    return [];
  }
}

/** Minta agen menjalankan aksi; true bila agen menerima & menjalankannya. */
export async function runKioskAgentAction(action: KioskAgentAction): Promise<boolean> {
  const desktop = desktopBridge();
  if (desktop) return desktop.runAction(action).catch(() => false);
  return (await call(`/${action}`, "POST", 5000)) !== null;
}
