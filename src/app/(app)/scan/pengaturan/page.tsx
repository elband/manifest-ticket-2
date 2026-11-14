"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  Check,
  KeyRound,
  Loader2,
  Lock,
  Monitor,
  Moon,
  Pencil,
  RefreshCw,
  Sun,
  Trash2,
  UserRound,
  Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import {
  ApiOperator,
  apiChangeOwnPin,
  apiDeleteOwnPhoto,
  apiGetProfile,
  apiSetOwnPhoto,
  apiUpdateProfile,
  getOwnPhotoObjectUrl,
} from "@/lib/api/client";
import {
  ApiOutboxSummary,
  describeApiOutbox,
  flushApiOutbox,
  getApiOutboxSummary,
  retryAllApiFailed,
  subscribeApiOutbox,
} from "@/lib/api/outbox";
import { AppSettings, getSettings, saveSettings, subscribeSettings } from "@/lib/settings";
import { applyTheme } from "@/lib/theme";
import { previewFeedbackSound } from "@/lib/scanService";
import { updateSession } from "@/lib/storage";
import type { ScanResultStatus } from "@/lib/types";

const STATION_LABEL: Record<string, string> = {
  SCP2: "SCP 2",
  BLUESKY: "Lounge Bluesky",
};

const ROLE_LABEL: Record<string, string> = {
  operator: "Petugas",
  security: "Petugas",
  supervisor: "Supervisor",
  admin: "Administrator",
};

export default function PetugasSettingsPage() {
  const [settings, setSettingsState] = useState<AppSettings | null>(null);

  useEffect(() => {
    setSettingsState(getSettings());
    return subscribeSettings(setSettingsState);
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Pengaturan</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Profil Anda dan setelan untuk perangkat ini.
          </p>
        </div>
        <Link
          href="/scan/kiosk"
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-ink-muted ring-1 ring-hairline transition hover:bg-surface-2 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Kembali ke kiosk
        </Link>
      </header>

      <ProfileSection />
      <PinSection />
      {settings && <SoundSection settings={settings} />}
      {settings && <ThemeSection settings={settings} />}
      <DeviceSection />
      {settings && <RulesSection settings={settings} />}
    </div>
  );
}

// ───────────────────────────── Kerangka ─────────────────────────────

function Section({
  icon,
  title,
  note,
  children,
  quiet,
}: {
  icon: React.ReactNode;
  title: string;
  note?: string;
  children: React.ReactNode;
  quiet?: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded-3xl border p-5 sm:p-6",
        quiet
          ? "border-dashed border-slate-300/80 dark:border-hairline"
          : "border-slate-200/70 bg-white/95 shadow-card dark:border-hairline dark:bg-surface/95",
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="text-ink-subtle">{icon}</span>
        <h2 className="text-[15px] font-bold text-ink">{title}</h2>
        {note && (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-ink-muted ring-1 ring-hairline">
            {note}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2",
        checked ? "bg-blue-600" : "bg-slate-300 dark:bg-white/20",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
          checked ? "left-[1.375rem]" : "left-0.5",
        )}
      />
    </button>
  );
}

const inputCls =
  "w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none ring-blue-200 focus:ring-2";
const primaryBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60";
const secondaryBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-ink-muted ring-1 ring-hairline transition hover:bg-surface-2 hover:text-ink disabled:opacity-60";

function ServerNotice({ error }: { error: string }) {
  return (
    <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/30">
      {error}
    </p>
  );
}

function profileError(status: number | undefined, error: string | undefined): string {
  if (status === 401 || status === 403) {
    return "Profil hanya bisa dibuka saat masuk sebagai petugas dan tersambung ke server. Keluar, lalu masuk lagi dengan PIN Anda.";
  }
  return error ?? "Server tidak bisa dihubungi. Coba lagi saat koneksi pulih.";
}

// ───────────────────────────── Profil ─────────────────────────────

function ProfileSection() {
  const toast = useToast();
  const [profile, setProfile] = useState<ApiOperator | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadPhoto = useCallback(async () => {
    const u = await getOwnPhotoObjectUrl();
    setPhotoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return u;
    });
  }, []);

  useEffect(() => {
    let active = true;
    apiGetProfile().then((res) => {
      if (!active) return;
      if (res.ok && res.data) {
        setProfile(res.data);
        // Nama bisa saja diganti admin sejak login — samakan sesi lokal.
        updateSession({ name: res.data.name, email: res.data.email });
        if (res.data.hasPhoto) void loadPhoto();
      } else {
        setLoadError(profileError(res.status, res.error));
      }
    });
    return () => {
      active = false;
    };
  }, [loadPhoto]);

  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  const startEdit = () => {
    if (!profile) return;
    setName(profile.name);
    setEmail(profile.email);
    setFormError(null);
    setEditing(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    const n = name.trim();
    const m = email.trim();
    if (n.length < 2) {
      setFormError("Nama minimal 2 huruf.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) {
      setFormError("Email belum valid. Contoh: andi@afvs.local");
      return;
    }
    setSaving(true);
    const res = await apiUpdateProfile({
      ...(n !== profile.name && { name: n }),
      ...(m.toLowerCase() !== profile.email && { email: m }),
    });
    setSaving(false);
    if (!res.ok || !res.data) {
      setFormError(res.error ?? "Gagal menyimpan. Coba lagi.");
      return;
    }
    setProfile(res.data);
    // Nama di header & catatan scan perangkat ini ikut berubah.
    updateSession({ name: res.data.name, email: res.data.email });
    setEditing(false);
    toast.success("Data profil disimpan.");
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast.error("Pilih foto JPG, PNG, atau WebP.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Ukuran foto maksimal 2 MB.");
      return;
    }
    setPhotoBusy(true);
    const res = await apiSetOwnPhoto(file);
    setPhotoBusy(false);
    if (!res.ok || !res.data) {
      toast.error(res.error ?? "Foto gagal diunggah.");
      return;
    }
    setProfile(res.data);
    await loadPhoto();
    toast.success("Foto profil diganti.");
  };

  const removePhoto = async () => {
    setPhotoBusy(true);
    const res = await apiDeleteOwnPhoto();
    setPhotoBusy(false);
    if (!res.ok || !res.data) {
      toast.error(res.error ?? "Foto gagal dihapus.");
      return;
    }
    setProfile(res.data);
    setPhotoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    toast.success("Foto profil dihapus.");
  };

  return (
    <Section icon={<UserRound className="h-4 w-4" />} title="Profil saya">
      {loadError ? (
        <ServerNotice error={loadError} />
      ) : !profile ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Memuat profil…
        </div>
      ) : (
        <div className="flex flex-col gap-5 sm:flex-row">
          {/* Foto */}
          <div className="flex shrink-0 flex-row items-center gap-3 sm:flex-col sm:items-stretch">
            <div className="relative h-28 w-24 overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-hairline sm:h-36 sm:w-28">
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt="Foto profil" className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full w-full place-items-center text-ink-subtle">
                  <UserRound className="h-10 w-10" />
                </div>
              )}
              {photoBusy && (
                <div className="absolute inset-0 grid place-items-center bg-black/40 text-white">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                className={secondaryBtn}
                disabled={photoBusy}
                onClick={() => fileRef.current?.click()}
              >
                <Camera className="h-4 w-4" />
                {profile.hasPhoto ? "Ganti foto" : "Unggah foto"}
              </button>
              {profile.hasPhoto && (
                <button
                  type="button"
                  className={cn(secondaryBtn, "text-rose-600 dark:text-rose-300")}
                  disabled={photoBusy}
                  onClick={removePhoto}
                >
                  <Trash2 className="h-4 w-4" />
                  Hapus foto
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="user"
                className="hidden"
                onChange={(e) => {
                  void pickPhoto(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          {/* Data */}
          <div className="min-w-0 flex-1">
            {editing ? (
              <form onSubmit={save} className="space-y-3" noValidate>
                <label className="block">
                  <span className="text-xs font-semibold text-ink-muted">Nama lengkap</span>
                  <input
                    className={cn(inputCls, "mt-1")}
                    value={name}
                    maxLength={80}
                    autoComplete="name"
                    onChange={(e) => {
                      setName(e.target.value);
                      setFormError(null);
                    }}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-ink-muted">Email</span>
                  <input
                    className={cn(inputCls, "mt-1")}
                    type="email"
                    value={email}
                    autoComplete="email"
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setFormError(null);
                    }}
                  />
                </label>
                {formError && (
                  <p className="text-[13px] font-semibold text-rose-600 dark:text-rose-300">
                    {formError}
                  </p>
                )}
                <div className="flex gap-2">
                  <button type="submit" className={primaryBtn} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Simpan perubahan
                  </button>
                  <button
                    type="button"
                    className={secondaryBtn}
                    disabled={saving}
                    onClick={() => setEditing(false)}
                  >
                    Batal
                  </button>
                </div>
              </form>
            ) : (
              <>
                <p className="break-words text-xl font-extrabold tracking-tight text-ink">
                  {profile.name}
                </p>
                <p className="mt-0.5 break-all text-sm text-ink-muted">{profile.email}</p>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-ink-subtle">Pos</dt>
                    <dd className="font-semibold text-ink">
                      {profile.station ? (STATION_LABEL[profile.station] ?? profile.station) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-subtle">Peran</dt>
                    <dd className="font-semibold text-ink">
                      {ROLE_LABEL[profile.role] ?? profile.role}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-ink-subtle">
                  Pos dan peran hanya bisa diubah admin.
                </p>
                <button type="button" className={cn(secondaryBtn, "mt-4")} onClick={startEdit}>
                  <Pencil className="h-4 w-4" />
                  Ubah data
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

// ───────────────────────────── PIN ─────────────────────────────

function PinSection() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4,6}$/.test(current)) return setError("Masukkan PIN lama (4–6 angka).");
    if (!/^\d{4,6}$/.test(next)) return setError("PIN baru harus 4–6 angka.");
    if (next !== repeat) return setError("Ulangi PIN baru dengan angka yang sama.");
    if (next === current) return setError("PIN baru harus berbeda dari PIN lama.");
    setSaving(true);
    const res = await apiChangeOwnPin(current, next);
    setSaving(false);
    if (!res.ok) {
      setError(
        res.status === 401 || res.status === 403
          ? profileError(res.status, res.error)
          : (res.error ?? "PIN gagal diganti. Coba lagi."),
      );
      return;
    }
    setCurrent("");
    setNext("");
    setRepeat("");
    setError(null);
    toast.success("PIN diganti. Pakai PIN baru saat masuk berikutnya.");
  };

  const field = (label: string, value: string, set: (v: string) => void, auto: string) => (
    <label className="block">
      <span className="text-xs font-semibold text-ink-muted">{label}</span>
      <input
        className={cn(inputCls, "mt-1 font-mono tracking-[0.3em]")}
        type="password"
        inputMode="numeric"
        autoComplete={auto}
        value={value}
        onChange={(e) => {
          set(digits(e.target.value));
          setError(null);
        }}
      />
    </label>
  );

  return (
    <Section icon={<KeyRound className="h-4 w-4" />} title="Ganti PIN">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-3">
          {field("PIN lama", current, setCurrent, "current-password")}
          {field("PIN baru", next, setNext, "new-password")}
          {field("Ulangi PIN baru", repeat, setRepeat, "new-password")}
        </div>
        <p className="text-xs text-ink-subtle">
          Hindari angka sama atau berurutan seperti 1111 atau 1234.
        </p>
        {error && (
          <p className="text-[13px] font-semibold text-rose-600 dark:text-rose-300">{error}</p>
        )}
        <button type="submit" className={primaryBtn} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Ganti PIN
        </button>
      </form>
    </Section>
  );
}

// ───────────────────────────── Suara & getar ─────────────────────────────

const SOUND_SAMPLES: { status: ScanResultStatus; label: string }[] = [
  { status: "VALID_FLIGHT", label: "Berhasil" },
  { status: "DUPLICATE_SCAN", label: "Tiket sudah dipakai" },
  { status: "INVALID_BARCODE", label: "Gagal" },
];

function SoundSection({ settings }: { settings: AppSettings }) {
  const volume = settings.soundVolume ?? 100;
  return (
    <Section icon={<Volume2 className="h-4 w-4" />} title="Suara dan getar" note="Perangkat ini">
      <Row
        title="Suara hasil scan"
        description="Nada lalu suara “Berhasil”, “Tiket sudah dipakai”, atau “Gagal”."
      >
        <Switch
          label="Suara hasil scan"
          checked={settings.soundOn}
          onChange={(v) => saveSettings({ soundOn: v })}
        />
      </Row>
      <Row title="Volume">
        <div className="flex w-full items-center gap-3 sm:w-64">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={volume}
            aria-label="Volume suara"
            onChange={(e) => saveSettings({ soundVolume: Number(e.target.value) })}
            className="w-full accent-blue-600"
          />
          <span className="w-10 text-right text-sm font-semibold tabular-nums text-ink">
            {volume}%
          </span>
        </div>
      </Row>
      <Row title="Uji suara" description="Tetap berbunyi walau suara hasil scan dimatikan.">
        <div className="flex flex-wrap gap-1.5">
          {SOUND_SAMPLES.map((s) => (
            <button
              key={s.status}
              type="button"
              className={secondaryBtn}
              onClick={() => previewFeedbackSound(s.status)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Row>
      <Row title="Getar" description="Hanya di perangkat yang punya motor getar, misalnya HP.">
        <Switch
          label="Getar"
          checked={settings.hapticOn}
          onChange={(v) => saveSettings({ hapticOn: v })}
        />
      </Row>
    </Section>
  );
}

// ───────────────────────────── Tampilan ─────────────────────────────

function ThemeSection({ settings }: { settings: AppSettings }) {
  const options = [
    { key: "airport" as const, label: "Terang", icon: Sun },
    { key: "dark" as const, label: "Gelap", icon: Moon },
  ];
  return (
    <Section icon={<Sun className="h-4 w-4" />} title="Tampilan" note="Perangkat ini">
      <Row title="Tema">
        <div className="inline-flex gap-1 rounded-2xl bg-surface-2 p-1 ring-1 ring-hairline">
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={settings.theme === o.key}
              onClick={() => {
                saveSettings({ theme: o.key });
                applyTheme(o.key);
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold transition",
                settings.theme === o.key
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              <o.icon className="h-4 w-4" />
              {o.label}
            </button>
          ))}
        </div>
      </Row>
    </Section>
  );
}

// ───────────────────────────── Status perangkat ─────────────────────────────

function appLabel(): string {
  if (typeof navigator === "undefined") return "—";
  const m = /SIPANDAI-Desktop\/([\d.]+)/.exec(navigator.userAgent);
  return m ? `Aplikasi desktop v${m[1]}` : "Browser";
}

function DeviceSection() {
  const toast = useToast();
  const [sum, setSum] = useState<ApiOutboxSummary | null>(null);
  const [sending, setSending] = useState(false);
  const [app, setApp] = useState("—");

  useEffect(() => {
    setApp(appLabel());
    setSum(getApiOutboxSummary());
    return subscribeApiOutbox(() => setSum(getApiOutboxSummary()));
  }, []);

  if (!sum) return null;
  const d = describeApiOutbox(sum);
  const toneCls = {
    ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200",
    busy: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200",
    warn: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
    bad: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200",
  }[d.tone];
  const waiting = sum.pending + sum.failed;

  const sendNow = async () => {
    setSending(true);
    // Tombol ini = coba ulang manual: data yang sudah "gagal kirim" ikut dikirim lagi.
    retryAllApiFailed();
    const r = await flushApiOutbox({ maxItems: 100 });
    setSending(false);
    setSum(getApiOutboxSummary());
    if (r.sent > 0) toast.success(`${r.sent} scan terkirim ke server.`);
    else if (waiting > 0) toast.warning(describeApiOutbox(getApiOutboxSummary()).hint, "Belum terkirim");
  };

  return (
    <Section icon={<Monitor className="h-4 w-4" />} title="Status perangkat">
      <Row title="Server">
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", toneCls)} title={d.hint}>
          {d.label}
        </span>
      </Row>
      <Row
        title="Scan belum terkirim"
        description="Scan saat offline dikirim otomatis begitu server tersambung."
      >
        <div className="flex items-center gap-3">
          <span className="text-lg font-extrabold tabular-nums text-ink">{waiting}</span>
          <button
            type="button"
            className={secondaryBtn}
            disabled={sending || waiting === 0}
            onClick={sendNow}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Kirim sekarang
          </button>
        </div>
      </Row>
      <Row title="Kode perangkat" description="Sebutkan kode ini saat melapor ke IT.">
        <span className="font-mono text-sm font-semibold text-ink">{sum.deviceCode ?? "—"}</span>
      </Row>
      <Row title="Aplikasi">
        <span className="text-sm font-semibold text-ink">{app}</span>
      </Row>
    </Section>
  );
}

// ───────────────────────────── Aturan dari admin ─────────────────────────────

function minutesLabel(min: number): string {
  if (min % 60 === 0) return `${min / 60} jam`;
  return min > 60 ? `${Math.floor(min / 60)} jam ${min % 60} menit` : `${min} menit`;
}

function RulesSection({ settings }: { settings: AppSettings }) {
  const rules: { title: string; value: string }[] = [
    {
      title: "Scan dibuka",
      value: "Sejak awal hari keberangkatan",
    },
    {
      title: "Scan ditutup",
      value: settings.boardingCloseEnabled
        ? `${minutesLabel(settings.boardingCloseMinutesAfter)} setelah jadwal berangkat`
        : "Mengikuti status penerbangan",
    },
    {
      title: "Lama tampil hasil scan (selain boarding pass valid)",
      value:
        settings.kioskResultDurationSec === 0
          ? "Sampai ditutup"
          : `${settings.kioskResultDurationSec} detik`,
    },
  ];
  return (
    <Section icon={<Lock className="h-4 w-4" />} title="Aturan dari admin" quiet>
      <p className="-mt-1 mb-3 text-xs text-ink-muted">
        Berlaku di semua perangkat. Hubungi supervisor untuk mengubahnya.
      </p>
      {rules.map((r) => (
        <Row key={r.title} title={r.title}>
          <span className="text-sm text-ink-muted">{r.value}</span>
        </Row>
      ))}
    </Section>
  );
}

