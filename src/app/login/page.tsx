"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plane,
  ShieldCheck,
  LogIn,
  AlertCircle,
  Sparkles,
  ScanLine,
  Zap,
  Eye,
  EyeOff,
  KeyRound,
  UserRoundCheck,
  Delete,
  CornerDownLeft,
} from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ensureSeed, getSession, setSession } from "@/lib/storage";
import { login, loginWithPin } from "@/lib/auth";
import { apiLogin, apiLoginPin } from "@/lib/api/client";
import { saveSettings } from "@/lib/settings";
import type { UserRole } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@airport.test");
  const [password, setPassword] = useState("password");
  const [pin, setPin] = useState("");
  const [authMode, setAuthMode] = useState<"pin" | "password">("pin");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    ensureSeed();
    const s = getSession();
    if (s) {
      router.replace(s.role === "security" ? "/scan/kiosk" : "/dashboard");
      return;
    }
    // Mobile: selalu tampilkan tata cara dulu, kecuali baru selesai onboarding
    if (typeof window !== "undefined") {
      const isMobile = window.matchMedia("(max-width: 1023px)").matches;
      const params = new URLSearchParams(window.location.search);
      const fromOnboarding = params.get("from") === "onboarding";
      if (isMobile && !fromOnboarding) {
        router.replace("/onboarding");
      }
    }
  }, [router]);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    // Admin/Supervisor: coba backend dulu (biar dapat token server + role
    // backend untuk menu admin seperti Kelola Petugas), fallback ke akun lokal
    // kalau backend mati/akun cuma ada lokal (mis. akun demo).
    if (authMode === "password") {
      try {
        const api = await apiLogin(email.trim(), password);
        if (api.ok && api.data) {
          const u = api.data.user;
          const role: UserRole =
            u.role === "admin"
              ? "admin"
              : u.role === "supervisor"
                ? "supervisor"
                : "security";
          setSession({ id: u.id, email: u.email, name: u.name, role });
          saveSettings({ apiSyncEnabled: true });
          setLoading(false);
          router.replace(role === "security" ? "/scan/kiosk" : "/dashboard");
          return;
        }
      } catch {
        /* backend offline → fallback lokal di bawah */
      }

      const res = login(email, password);
      setLoading(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.replace(res.user.role === "security" ? "/scan/kiosk" : "/dashboard");
      return;
    }

    // PIN petugas: coba backend dulu (auto-connect + aktifkan sync), lalu
    // fallback ke PIN lokal kalau backend mati/offline.
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
        setSession({ id: u.id, email: u.email, name: u.name, role });
        saveSettings({ apiSyncEnabled: true }); // scan langsung ter-push ke station petugas
        setLoading(false);
        router.replace(role === "security" ? "/scan/kiosk" : "/dashboard");
        return;
      }

      // Fallback offline / PIN hanya ada lokal.
      const local = loginWithPin(pin);
      setLoading(false);
      if (!local.ok) {
        setError(local.error);
        return;
      }
      router.replace(
        local.user.role === "security" ? "/scan/kiosk" : "/dashboard",
      );
    } catch {
      const local = loginWithPin(pin);
      setLoading(false);
      if (!local.ok) {
        setError(local.error);
        return;
      }
      router.replace(
        local.user.role === "security" ? "/scan/kiosk" : "/dashboard",
      );
    }
  };

  const quick = (e: string, pw = "password") => {
    setEmail(e);
    setPassword(pw);
    setAuthMode("password");
  };

  const quickPin = (p: string) => {
    setPin(p);
    setAuthMode("pin");
  };

  const PIN_MAX = 6;
  const pressDigit = (d: string) => {
    setError(null);
    setPin((p) => (p.length >= PIN_MAX ? p : p + d));
  };
  const pressBackspace = () => {
    setError(null);
    setPin((p) => p.slice(0, -1));
  };

  // Ref ke submit terbaru supaya listener keyboard tidak memakai state basi.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const pinLenRef = useRef(pin.length);
  pinLenRef.current = pin.length;

  // Mode PIN: terima input dari tombol angka keyboard (baris atas & numpad),
  // Backspace/Delete untuk hapus, Enter untuk masuk.
  useEffect(() => {
    if (authMode !== "pin") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        pressDigit(e.key);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        pressBackspace();
      } else if (e.key === "Enter") {
        // preventDefault juga mencegah Enter "mengklik" tombol yang sedang fokus.
        e.preventDefault();
        if (pinLenRef.current >= 4) void submitRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [authMode]);

  return (
    <div className="relative flex min-h-screen w-full items-stretch overflow-hidden bg-slate-950">
      {/* ============ animated background (full-screen) ============ */}
      <AnimatedBackdrop />

      {/* ============ left brand panel (desktop only) ============ */}
      <div className="relative z-10 hidden w-1/2 flex-col justify-between p-10 text-white lg:flex xl:p-14">
        <div className="flex items-center gap-3 animate-fade-up">
          <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/25 backdrop-blur">
            <ShieldCheck className="h-6 w-6" />
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse-glow-emerald rounded-full bg-emerald-400" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/70">
              SIPANDAI
            </p>
            <p className="text-lg font-bold tracking-tight">
              Sistem Validasi Boarding Pass
            </p>
          </div>
        </div>

        <div className="space-y-6">
          <div
            className="inline-flex animate-fade-up items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ring-1 ring-white/20 backdrop-blur"
            style={{ animationDelay: "120ms" }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Pos Validasi Real-time
          </div>

          <h2
            className="animate-fade-up text-5xl font-black leading-[1.05] tracking-tight"
            style={{ animationDelay: "200ms" }}
          >
            Validasi Boarding Pass
            <br />
            <span className="inline-block bg-[length:200%_200%] bg-gradient-to-r from-cyan-200 via-white to-blue-200 bg-clip-text text-transparent animate-gradient-shift">
              Cepat. Aman. Akurat.
            </span>
          </h2>

          <p
            className="max-w-md animate-fade-up text-sm leading-relaxed text-white/75"
            style={{ animationDelay: "320ms" }}
          >
            Scan barcode boarding pass — sistem akan mengecek apakah kode
            penerbangan terdaftar di jadwal hari ini, statusnya aktif, dan
            belum pernah di-scan sebelumnya.
          </p>

          <div className="grid max-w-md grid-cols-3 gap-3">
            {[
              { v: "5+", k: "Flight aktif", icon: Plane },
              { v: "100%", k: "Offline-ready", icon: ScanLine },
              { v: "<1s", k: "Validasi", icon: Zap },
            ].map((s, idx) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.k}
                  className="relative animate-fade-up overflow-hidden rounded-2xl border border-white/15 bg-white/[0.07] p-3 backdrop-blur transition hover:bg-white/[0.12]"
                  style={{ animationDelay: `${440 + idx * 100}ms` }}
                >
                  <Icon className="absolute -bottom-2 -right-2 h-12 w-12 text-white/10" />
                  <p className="text-2xl font-bold drop-shadow">{s.v}</p>
                  <p className="text-[11px] text-white/70">{s.k}</p>
                </div>
              );
            })}
          </div>
        </div>

        <p className="text-xs text-white/50">
          © {new Date().getFullYear()} SIPANDAI — Internal Operation Tool.
        </p>
      </div>

      {/* ============ right form (and full-width on mobile) ============ */}
      <div className="relative z-10 flex flex-1 items-center justify-center overflow-y-auto px-4 py-8 sm:px-8 [@media(max-height:760px)]:py-4">
        <div className="w-full max-w-md">
          {/* Mobile-only hero badge */}
          <div className="mb-6 flex flex-col items-center text-center text-white lg:hidden">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-500 to-cyan-400 shadow-glow animate-bp-rise">
              <ShieldCheck className="h-7 w-7 drop-shadow" />
              <span className="absolute -right-1 -top-1 h-3 w-3 animate-pulse-glow-emerald rounded-full bg-emerald-400" />
            </div>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/70 animate-fade-up">
              SIPANDAI
            </p>
            <h1
              className="mt-1 animate-fade-up text-2xl font-black tracking-tight"
              style={{ animationDelay: "120ms" }}
            >
              Sistem Validasi Boarding Pass
            </h1>
            <p
              className="mt-1 max-w-xs animate-fade-up text-xs text-white/65"
              style={{ animationDelay: "200ms" }}
            >
              Validasi cepat & aman untuk setiap boarding pass.
            </p>
          </div>

          {/* Glassmorphism card */}
          <div
            className="relative animate-fade-up overflow-hidden rounded-3xl border border-white/15 bg-white/[0.06] p-5 shadow-lift backdrop-blur-2xl sm:p-7"
            style={{ animationDelay: "280ms" }}
          >
            {/* card sheen */}
            <div className="pointer-events-none absolute -top-1/2 left-0 h-[200%] w-1/2 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent" />

            <div className="relative">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-200">
                Selamat datang kembali
              </p>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">
                Masuk ke Panel Operasi
              </h2>
              <p className="mt-1 text-sm text-white/65">
                Gunakan akun petugas Anda untuk melanjutkan.
              </p>

              <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl border border-white/15 bg-white/[0.05] p-1.5 backdrop-blur">
                {[
                  { mode: "pin" as const, label: "PIN Petugas", icon: KeyRound },
                  {
                    mode: "password" as const,
                    label: "Admin/Supervisor",
                    icon: ShieldCheck,
                  },
                ].map((item) => {
                  const Icon = item.icon;
                  const active = authMode === item.mode;
                  return (
                    <button
                      key={item.mode}
                      type="button"
                      onClick={() => {
                        setAuthMode(item.mode);
                        setError(null);
                      }}
                      className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition ${
                        active
                          ? "bg-cyan-300 text-slate-950 shadow-sm"
                          : "text-white/70 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {item.label}
                    </button>
                  );
                })}
              </div>

              {authMode === "pin" ? (
                <form onSubmit={submit} className="mt-5 space-y-4">
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-white/70">
                      PIN Petugas
                    </label>

                    {/* PIN dots indicator */}
                    <div className="mt-3 flex items-center justify-center gap-3">
                      {Array.from({ length: PIN_MAX }).map((_, i) => {
                        const filled = i < pin.length;
                        return (
                          <span
                            key={i}
                            className={`h-3.5 w-3.5 rounded-full transition-all duration-150 ${
                              filled
                                ? "scale-110 bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.7)]"
                                : "bg-white/15 ring-1 ring-white/20"
                            }`}
                          />
                        );
                      })}
                    </div>

                    {/* Numeric keypad */}
                    <div className="mt-4 grid grid-cols-3 gap-2.5 [@media(max-height:760px)]:mt-2 [@media(max-height:760px)]:gap-2">
                      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => pressDigit(d)}
                          className="flex h-14 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.06] text-2xl font-bold text-white backdrop-blur transition active:scale-95 hover:border-cyan-300/40 hover:bg-white/[0.12] active:bg-cyan-300/20 [@media(max-height:760px)]:h-12 [@media(max-height:760px)]:text-xl"
                        >
                          {d}
                        </button>
                      ))}

                      {/* Enter / submit */}
                      <button
                        type="submit"
                        disabled={loading || pin.length < 4}
                        className="flex h-14 items-center justify-center rounded-2xl border border-emerald-300/40 bg-emerald-500/20 text-emerald-100 backdrop-blur transition active:scale-95 hover:bg-emerald-400/30 disabled:cursor-not-allowed disabled:opacity-40 [@media(max-height:760px)]:h-12"
                        aria-label="Masuk"
                      >
                        <CornerDownLeft className="h-6 w-6" />
                      </button>

                      <button
                        type="button"
                        onClick={() => pressDigit("0")}
                        className="flex h-14 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.06] text-2xl font-bold text-white backdrop-blur transition active:scale-95 hover:border-cyan-300/40 hover:bg-white/[0.12] active:bg-cyan-300/20"
                      >
                        0
                      </button>

                      {/* Backspace */}
                      <button
                        type="button"
                        onClick={pressBackspace}
                        disabled={pin.length === 0}
                        className="flex h-14 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.06] text-white backdrop-blur transition active:scale-95 hover:border-rose-300/40 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40 [@media(max-height:760px)]:h-12"
                        aria-label="Hapus"
                      >
                        <Delete className="h-6 w-6" />
                      </button>
                    </div>

                    <p className="mt-3 text-center text-xs text-white/55">
                      Login cukup dengan PIN Anda (4–6 digit) — bisa juga
                      diketik lewat keyboard, Enter untuk masuk.
                    </p>
                  </div>

                  {error && (
                    <div className="flex animate-fade-up items-start gap-2 rounded-xl border border-rose-300/40 bg-rose-500/15 px-3 py-2 text-sm text-rose-100 backdrop-blur">
                      <AlertCircle className="mt-0.5 h-4 w-4" />
                      <span>{error}</span>
                    </div>
                  )}

                  <Button
                    type="submit"
                    size="lg"
                    className="group relative w-full overflow-hidden bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500 bg-[length:200%_100%] shadow-lift transition-all hover:bg-[position:100%_0]"
                    disabled={loading}
                  >
                    <span className="relative z-[1] flex items-center justify-center gap-2">
                      {loading ? (
                        <>
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                          Memproses...
                        </>
                      ) : (
                        <>
                          <UserRoundCheck className="h-4 w-4" />
                          Masuk Petugas
                        </>
                      )}
                    </span>
                  </Button>
                </form>
              ) : (
              <form onSubmit={submit} className="mt-5 space-y-4">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-white/70">
                    Email
                  </label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nama@airport.test"
                    required
                    className="mt-1.5 border-white/20 bg-white/10 text-white placeholder:text-white/40 focus:border-cyan-300 focus:ring-cyan-300/30"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-white/70">
                    Password
                  </label>
                  <div className="relative mt-1.5">
                    <Input
                      type={showPw ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      className="border-white/20 bg-white/10 pr-10 text-white placeholder:text-white/40 focus:border-cyan-300 focus:ring-cyan-300/30"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
                      aria-label={showPw ? "Sembunyikan" : "Tampilkan"}
                    >
                      {showPw ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="flex animate-fade-up items-start gap-2 rounded-xl border border-rose-300/40 bg-rose-500/15 px-3 py-2 text-sm text-rose-100 backdrop-blur">
                    <AlertCircle className="mt-0.5 h-4 w-4" />
                    <span>{error}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  size="lg"
                  className="group relative w-full overflow-hidden bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500 bg-[length:200%_100%] shadow-lift transition-all hover:bg-[position:100%_0]"
                  disabled={loading}
                >
                  <span className="relative z-[1] flex items-center justify-center gap-2">
                    {loading ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                        Memproses…
                      </>
                    ) : (
                      <>
                        <LogIn className="h-4 w-4" />
                        Masuk
                      </>
                    )}
                  </span>
                </Button>
              </form>
              )}

              {authMode === "pin" ? (
                <div className="mt-5 rounded-2xl border border-white/15 bg-white/[0.05] p-3 backdrop-blur">
                  <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-200">
                    <Sparkles className="h-3 w-3" />
                    Demo rolling petugas
                  </p>
                  <div className="mt-2 grid grid-cols-3 gap-1.5">
                    {[
                      { p: "1234", n: "Security" },
                      { p: "2345", n: "Petugas A" },
                      { p: "3456", n: "Petugas B" },
                    ].map((u) => (
                      <button
                        key={u.p}
                        type="button"
                        onClick={() => quickPin(u.p)}
                        className="rounded-xl border border-white/10 bg-white/[0.04] px-2 py-2 text-center text-white/85 transition hover:-translate-y-0.5 hover:border-cyan-300/40 hover:bg-white/10"
                      >
                        <span className="block font-mono text-sm font-black tracking-widest">
                          {u.p}
                        </span>
                        <span className="block truncate text-[10px] text-white/55">
                          {u.n}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
              {/* Demo accounts */}
              <div className="mt-5 rounded-2xl border border-white/15 bg-white/[0.05] p-3 backdrop-blur">
                <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-200">
                  <Sparkles className="h-3 w-3" />
                  Akun Demo
                </p>
                <div className="mt-2 grid gap-1.5">
                  {[
                    {
                      e: "admin@afvs.local",
                      pw: "ChangeMe!2026",
                      r: "Admin (server)",
                      note: "akses penuh + Kelola Petugas",
                    },
                    {
                      e: "admin@airport.test",
                      pw: "password",
                      r: "Admin (lokal)",
                      note: "offline saja",
                    },
                    {
                      e: "supervisor@airport.test",
                      pw: "password",
                      r: "Supervisor",
                      note: "offline saja",
                    },
                  ].map((u) => (
                    <button
                      key={u.e}
                      type="button"
                      onClick={() => quick(u.e, u.pw)}
                      className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/85 transition hover:-translate-y-0.5 hover:border-cyan-300/40 hover:bg-white/10"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{u.e}</span>
                        <span className="block truncate text-[10px] text-white/45">
                          {u.note}
                        </span>
                      </span>
                      <span className="ml-1 shrink-0 rounded-full bg-cyan-400/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cyan-100 ring-1 ring-cyan-300/30">
                        {u.r}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-white/45">
                  Untuk menu <b className="text-white/70">Kelola Petugas</b>, login
                  dengan akun <b className="text-white/70">server</b>
                  {" "}(butuh backend NestJS + Laragon nyala).
                </p>
              </div>
                </>
              )}
            </div>
          </div>

          <p className="mt-4 text-center text-[11px] text-white/40">
            © {new Date().getFullYear()} SIPANDAI — Internal Operation Tool.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------
   Animated backdrop: deep gradient, drifting blobs, animated flight paths,
   slow-spinning compass ring, and a soft star/dust layer.
---------------------------------------------------------------------- */
function AnimatedBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* base deep gradient */}
      <div className="absolute inset-0 bg-[length:200%_200%] bg-gradient-to-br from-slate-950 via-blue-950 to-cyan-950 animate-gradient-shift" />

      {/* dotted noise / star layer */}
      <div
        className="absolute inset-0 opacity-[0.18] mix-blend-screen"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />

      {/* drifting color blobs */}
      <div className="absolute -left-32 top-1/4 h-96 w-96 animate-drift rounded-full bg-blue-500/30 blur-3xl" />
      <div
        className="absolute -right-40 top-10 h-[28rem] w-[28rem] animate-drift rounded-full bg-cyan-400/25 blur-3xl"
        style={{ animationDelay: "2s" }}
      />
      <div
        className="absolute -bottom-32 left-1/3 h-96 w-96 animate-drift rounded-full bg-violet-500/25 blur-3xl"
        style={{ animationDelay: "3.5s" }}
      />

      {/* slow-spinning compass ring */}
      <svg
        className="absolute -right-40 top-1/2 h-[40rem] w-[40rem] -translate-y-1/2 animate-spin-slow opacity-[0.08]"
        viewBox="0 0 100 100"
        fill="none"
        stroke="currentColor"
      >
        <circle cx="50" cy="50" r="48" strokeWidth="0.25" />
        <circle cx="50" cy="50" r="40" strokeWidth="0.15" />
        <circle cx="50" cy="50" r="30" strokeWidth="0.15" />
        {Array.from({ length: 24 }).map((_, i) => {
          const a = (i / 24) * Math.PI * 2;
          const x1 = 50 + Math.cos(a) * 44;
          const y1 = 50 + Math.sin(a) * 44;
          const x2 = 50 + Math.cos(a) * 48;
          const y2 = 50 + Math.sin(a) * 48;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              strokeWidth="0.3"
            />
          );
        })}
      </svg>

      {/* animated flight paths */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1200 800"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="lp-grad-1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgb(125 211 252)" stopOpacity="0" />
            <stop offset="50%" stopColor="rgb(125 211 252)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="rgb(125 211 252)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lp-grad-2" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgb(196 181 253)" stopOpacity="0" />
            <stop offset="50%" stopColor="rgb(196 181 253)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="rgb(196 181 253)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* curved dashed paths */}
        <path
          d="M -50 650 Q 300 200 700 350 T 1300 200"
          stroke="url(#lp-grad-1)"
          strokeWidth="1.5"
          strokeDasharray="6 10"
          fill="none"
          className="animate-fade-in"
        />
        <path
          d="M -100 300 Q 400 600 800 450 T 1300 700"
          stroke="url(#lp-grad-2)"
          strokeWidth="1.2"
          strokeDasharray="4 12"
          fill="none"
          className="animate-fade-in"
        />
        <path
          d="M -50 100 Q 500 50 900 250 T 1300 400"
          stroke="rgba(255,255,255,0.18)"
          strokeWidth="0.8"
          strokeDasharray="3 9"
          fill="none"
        />
      </svg>

      {/* fly-by planes */}
      <Plane
        className="absolute left-0 top-1/3 h-7 w-7 -rotate-12 animate-fly-by text-cyan-200/70 drop-shadow-[0_0_8px_rgba(125,211,252,0.6)]"
      />
      <Plane
        className="absolute left-0 top-2/3 h-5 w-5 -rotate-12 animate-fly-by text-white/50"
        style={{ animationDelay: "5s", animationDuration: "18s" }}
      />

      {/* floating airline-tone dots (badge-style) */}
      <FloatingBadges />

      {/* vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(2,6,23,0.7)_100%)]" />
    </div>
  );
}

function FloatingBadges() {
  // small floating IATA chips that reference real airline brand colors
  const items: { code: string; cls: string; pos: string; delay: string }[] = [
    {
      code: "GA",
      cls: "from-sky-500 to-blue-700",
      pos: "left-[10%] top-[18%]",
      delay: "0s",
    },
    {
      code: "JT",
      cls: "from-rose-500 to-red-700",
      pos: "left-[18%] top-[78%]",
      delay: "1s",
    },
    {
      code: "QG",
      cls: "from-emerald-500 to-green-700",
      pos: "right-[14%] top-[28%]",
      delay: "2s",
    },
    {
      code: "ID",
      cls: "from-indigo-500 to-blue-800",
      pos: "right-[8%] top-[70%]",
      delay: "1.5s",
    },
  ];
  return (
    <>
      {items.map((it) => (
        <div
          key={it.code}
          className={`absolute hidden h-10 w-10 animate-float items-center justify-center rounded-2xl bg-gradient-to-br ${it.cls} text-[11px] font-black text-white opacity-50 shadow-lift ring-1 ring-white/20 backdrop-blur sm:flex ${it.pos}`}
          style={{ animationDelay: it.delay }}
        >
          {it.code}
        </div>
      ))}
    </>
  );
}
