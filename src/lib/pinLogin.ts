"use client";

import { apiLoginPin, type ApiResult } from "@/lib/api/client";
import { loginWithPin } from "@/lib/auth";
import { saveSettings } from "@/lib/settings";
import { setSession } from "@/lib/storage";
import type { SessionUser, UserRole } from "@/lib/types";

/** Pesan gagal login backend saat tidak ada fallback akun lokal (produksi). */
export function serverLoginError(res: ApiResult<unknown>, mode: "pin" | "password"): string {
  if (!res.status) {
    return "Server SIPANDAI tidak dapat dihubungi. Periksa jaringan, lalu coba lagi.";
  }
  if (res.status === 401) {
    return mode === "pin" ? "PIN tidak valid." : "Email atau password salah.";
  }
  return res.error ?? "Login gagal.";
}

/**
 * Login petugas dengan PIN: coba backend dulu (dapat token server + aktifkan
 * sync), lalu fallback ke PIN lokal kalau backend mati/offline (akun demo, dev
 * saja). Sesi hanya diganti bila berhasil — kalau gagal, sesi lama tetap utuh
 * (dipakai juga oleh "Ganti petugas" di kiosk).
 */
export async function signInWithPin(
  pin: string,
): Promise<{ ok: true; user: SessionUser } | { ok: false; error: string }> {
  try {
    const api = await apiLoginPin(pin);
    if (api.ok && api.data) {
      const u = api.data.user;
      const role: UserRole =
        u.role === "admin"
          ? "admin"
          : u.role === "supervisor"
            ? "supervisor"
            : "security";
      const user: SessionUser = { id: u.id, email: u.email, name: u.name, role };
      setSession(user);
      saveSettings({ apiSyncEnabled: true }); // scan langsung ter-push ke station petugas
      return { ok: true, user };
    }
    // Build produksi tidak menerima PIN demo lokal (ditulis literal agar blok
    // demo terbuang dari bundle).
    if (process.env.NODE_ENV === "production") {
      return { ok: false, error: serverLoginError(api, "pin") };
    }
  } catch {
    /* backend offline → fallback lokal di bawah */
  }
  // Fallback offline / PIN hanya ada lokal.
  return loginWithPin(pin);
}
