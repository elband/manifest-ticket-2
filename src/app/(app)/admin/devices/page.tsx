"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Ban,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  MonitorSmartphone,
  Pencil,
  RefreshCw,
  Server,
  ShieldCheck,
  ShieldX,
  Trash2,
  X,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/utils";
import {
  ApiDevice,
  apiApproveDevice,
  apiDeleteDevice,
  apiListDevices,
  apiRevokeDevice,
  apiUpdateDevice,
  getApiUser,
  getDeviceState,
  isAuthed,
  subscribeAuth,
} from "@/lib/api/client";

/** Station yang sudah dikenal (sama dengan Kelola Petugas) — boleh diketik bebas. */
const KNOWN_STATIONS = ["SCP2", "BLUESKY"];
/** Daftar dimuat ulang berkala supaya permintaan izin baru langsung terlihat. */
const REFRESH_MS = 15_000;

const STATUS_META: Record<
  ApiDevice["status"],
  { label: string; tone: string; icon: React.ComponentType<{ className?: string }> }
> = {
  pending: {
    label: "Menunggu izin",
    tone: "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/25",
    icon: Clock,
  },
  approved: {
    label: "Diizinkan",
    tone: "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/25",
    icon: CheckCircle2,
  },
  revoked: {
    label: "Dicabut",
    tone: "bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/25",
    icon: ShieldX,
  },
};

function timeAgo(iso: string | null): string {
  if (!iso) return "belum pernah";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "baru saja";
  if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function describeAgent(ua: string | null): string {
  if (!ua) return "Tidak diketahui";
  const desktop = ua.match(/SIPANDAI-Desktop\/([\d.]+)/);
  if (desktop) return `Aplikasi desktop SIPANDAI ${desktop[1]}`;
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Linux/.test(ua)
          ? "Linux"
          : /Mac OS/.test(ua)
            ? "macOS"
            : "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  return os ? `${browser} · ${os}` : browser;
}

type FormState = { device: ApiDevice; mode: "approve" | "edit" };

export default function DevicesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [authed, setAuthed] = useState(true);
  const [isAdmin, setIsAdmin] = useState(true);
  const [items, setItems] = useState<ApiDevice[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [thisDeviceId, setThisDeviceId] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!isAuthed()) {
      setAuthed(false);
      return;
    }
    setAuthed(true);
    const admin = getApiUser()?.role === "admin";
    setIsAdmin(admin);
    if (!admin) return; // /devices khusus admin (pasti 403)
    if (!silent) setStatus("loading");
    const res = await apiListDevices();
    if (res.ok && res.data) {
      setItems(res.data.items);
      setStatus("ok");
      setError(null);
    } else if (!silent) {
      setStatus("error");
      setError(res.error ?? "Gagal memuat daftar perangkat.");
    }
  }, []);

  useEffect(() => {
    setThisDeviceId(getDeviceState().id ?? null);
    load();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") load(true);
    }, REFRESH_MS);
    const unsub = subscribeAuth(() => load());
    return () => {
      window.clearInterval(id);
      unsub();
    };
  }, [load]);

  const groups = useMemo(
    () => ({
      pending: items.filter((d) => d.status === "pending"),
      approved: items.filter((d) => d.status === "approved"),
      revoked: items.filter((d) => d.status === "revoked"),
    }),
    [items],
  );

  const stationOptions = useMemo(
    () =>
      Array.from(
        new Set([...KNOWN_STATIONS, ...items.map((d) => d.station).filter(Boolean)]),
      ) as string[],
    [items],
  );

  const handleSave = async (name: string, station: string) => {
    if (!form) return;
    setSaving(true);
    const { device, mode } = form;
    const res =
      mode === "approve"
        ? await apiApproveDevice(device.id, { name, station })
        : await apiUpdateDevice(device.id, { name, station });
    setSaving(false);
    if (res.ok) {
      toast.success(
        mode === "approve"
          ? `${name} kini bisa mengirim & mengambil data tanpa login.`
          : "Data perangkat diperbarui.",
        mode === "approve" ? "Perangkat diizinkan" : "Tersimpan",
      );
      setForm(null);
      load(true);
    } else {
      toast.error(res.error ?? "Gagal menyimpan.", "Gagal");
    }
  };

  const handleRevoke = async (d: ApiDevice) => {
    const { confirmed } = await confirm({
      title: `Cabut izin "${d.name}"?`,
      description:
        "Perangkat langsung tidak bisa mengirim/mengambil data dari server. Scan yang belum terkirim tetap tersimpan di perangkat dan terkirim bila diizinkan lagi.",
      tone: "warning",
      confirmLabel: "Cabut izin",
      destructive: true,
    });
    if (!confirmed) return;
    const res = await apiRevokeDevice(d.id);
    if (res.ok) {
      toast.success("Izin perangkat dicabut.");
      load(true);
    } else {
      toast.error(res.error ?? "Gagal mencabut izin.", "Gagal");
    }
  };

  const handleDelete = async (d: ApiDevice) => {
    const { confirmed } = await confirm({
      title: `Hapus "${d.name}" dari daftar?`,
      description:
        "Bila perangkat ini dibuka lagi, ia akan meminta izin ulang dengan kode baru.",
      tone: "danger",
      confirmLabel: "Hapus",
      destructive: true,
    });
    if (!confirmed) return;
    const res = await apiDeleteDevice(d.id);
    if (res.ok) {
      toast.success("Perangkat dihapus.");
      load(true);
    } else {
      toast.error(res.error ?? "Gagal menghapus.", "Gagal");
    }
  };

  return (
    <>
      <div className="space-y-4">
        <section className="relative overflow-hidden rounded-3xl border border-blue-100/80 bg-gradient-to-br from-sky-50 via-white to-blue-50/60 p-5 shadow-card ring-1 ring-white/60 dark:border-hairline dark:from-surface dark:via-surface dark:to-surface/80 dark:ring-hairline sm:p-6">
          <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-blue-300/25 blur-3xl dark:bg-sky-500/10" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-blue-700 ring-1 ring-blue-200 backdrop-blur dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/25">
                <MonitorSmartphone className="h-3.5 w-3.5" />
                Perangkat • Server
              </div>
              <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
                Akses Perangkat
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Perangkat yang diizinkan bisa mengirim scan &amp; mengambil jadwal
                tanpa login manual ke server. Petugas tetap masuk dengan PIN agar
                tercatat siapa yang melakukan scan. Cocokkan <b>kode</b> yang tampil
                di layar perangkat sebelum mengizinkan.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Stat label="Menunggu" value={groups.pending.length} tone="text-amber-600" />
              <Stat label="Diizinkan" value={groups.approved.length} tone="text-emerald-600" />
              <Stat label="Dicabut" value={groups.revoked.length} tone="text-rose-600" />
              <button
                type="button"
                onClick={() => load()}
                disabled={status === "loading"}
                className="inline-flex items-center gap-1.5 rounded-xl border border-blue-100 bg-white/90 px-3.5 py-2 text-sm font-semibold text-ink shadow-sm transition hover:bg-white disabled:opacity-60 dark:border-hairline dark:bg-surface-2"
              >
                {status === "loading" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Refresh
              </button>
            </div>
          </div>
        </section>

        {!authed || !isAdmin ? (
          <NeedAdmin connected={authed} />
        ) : status === "error" ? (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300">
            {error}
          </section>
        ) : (
          <>
            <DeviceGroup
              title="Menunggu izin"
              empty="Tidak ada perangkat yang menunggu izin. Perangkat baru otomatis muncul di sini saat aplikasi pertama kali dibuka."
              items={groups.pending}
              thisDeviceId={thisDeviceId}
              onApprove={(d) => setForm({ device: d, mode: "approve" })}
              onDelete={handleDelete}
            />
            <DeviceGroup
              title="Diizinkan"
              empty="Belum ada perangkat yang diizinkan."
              items={groups.approved}
              thisDeviceId={thisDeviceId}
              onEdit={(d) => setForm({ device: d, mode: "edit" })}
              onRevoke={handleRevoke}
            />
            {groups.revoked.length > 0 && (
              <DeviceGroup
                title="Dicabut"
                empty=""
                items={groups.revoked}
                thisDeviceId={thisDeviceId}
                onApprove={(d) => setForm({ device: d, mode: "approve" })}
                onDelete={handleDelete}
              />
            )}
          </>
        )}
      </div>

      {form && (
        <DeviceFormModal
          form={form}
          stations={stationOptions}
          saving={saving}
          onSubmit={handleSave}
          onClose={() => setForm(null)}
        />
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="min-w-[72px] rounded-2xl bg-white/80 px-3 py-2 text-center ring-1 ring-blue-100 dark:bg-surface-2 dark:ring-hairline">
      <p className={cn("text-xl font-black tabular-nums", tone)}>{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</p>
    </div>
  );
}

function DeviceGroup({
  title,
  empty,
  items,
  thisDeviceId,
  onApprove,
  onEdit,
  onRevoke,
  onDelete,
}: {
  title: string;
  empty: string;
  items: ApiDevice[];
  thisDeviceId: string | null;
  onApprove?: (d: ApiDevice) => void;
  onEdit?: (d: ApiDevice) => void;
  onRevoke?: (d: ApiDevice) => void;
  onDelete?: (d: ApiDevice) => void;
}) {
  return (
    <section className="rounded-2xl border border-blue-100/70 bg-white/90 p-4 shadow-card dark:border-hairline dark:bg-surface/95">
      <h3 className="text-sm font-bold text-ink">
        {title} <span className="text-ink-subtle">({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-ink-muted">{empty}</p>
      ) : (
        <ul className="mt-3 grid gap-3 lg:grid-cols-2">
          {items.map((d) => {
            const meta = STATUS_META[d.status];
            const StatusIcon = meta.icon;
            return (
              <li
                key={d.id}
                className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">
                      {d.name}
                      {d.id === thisDeviceId && (
                        <span className="ml-2 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-sky-500/15 dark:text-sky-300">
                          Perangkat ini
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-muted">{describeAgent(d.userAgent)}</p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1",
                      meta.tone,
                    )}
                  >
                    <StatusIcon className="h-3 w-3" />
                    {meta.label}
                  </span>
                </div>

                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] sm:grid-cols-4">
                  <Info label="Kode">
                    <span className="font-mono text-sm font-black tracking-widest text-ink">{d.code}</span>
                  </Info>
                  <Info label="Station">
                    {d.station ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-ink">
                        <MapPin className="h-3 w-3" />
                        {d.station}
                      </span>
                    ) : (
                      "—"
                    )}
                  </Info>
                  <Info label="Terakhir aktif">{timeAgo(d.lastSeenAt)}</Info>
                  <Info label="IP · Scan">
                    {d.lastIp ?? "—"} · {d.scanCount}
                  </Info>
                </dl>

                <div className="flex flex-wrap justify-end gap-2">
                  {onApprove && (
                    <ActionButton tone="primary" onClick={() => onApprove(d)}>
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {d.status === "revoked" ? "Izinkan lagi" : "Izinkan"}
                    </ActionButton>
                  )}
                  {onEdit && (
                    <ActionButton onClick={() => onEdit(d)}>
                      <Pencil className="h-3.5 w-3.5" />
                      Ubah
                    </ActionButton>
                  )}
                  {onRevoke && (
                    <ActionButton tone="danger" onClick={() => onRevoke(d)}>
                      <Ban className="h-3.5 w-3.5" />
                      Cabut izin
                    </ActionButton>
                  )}
                  {onDelete && d.scanCount === 0 && (
                    <ActionButton tone="danger" onClick={() => onDelete(d)}>
                      <Trash2 className="h-3.5 w-3.5" />
                      Hapus
                    </ActionButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</dt>
      <dd className="truncate text-ink-muted">{children}</dd>
    </div>
  );
}

function ActionButton({
  tone = "neutral",
  onClick,
  children,
}: {
  tone?: "neutral" | "primary" | "danger";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition",
        tone === "primary" && "bg-blue-600 text-white shadow-sm hover:bg-blue-700",
        tone === "danger" &&
          "text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50 dark:text-rose-300 dark:ring-rose-500/30 dark:hover:bg-rose-500/10",
        tone === "neutral" && "text-ink ring-1 ring-hairline hover:bg-surface-2",
      )}
    >
      {children}
    </button>
  );
}

function DeviceFormModal({
  form,
  stations,
  saving,
  onSubmit,
  onClose,
}: {
  form: FormState;
  stations: string[];
  saving: boolean;
  onSubmit: (name: string, station: string) => void;
  onClose: () => void;
}) {
  const { device, mode } = form;
  const [name, setName] = useState(device.name);
  const [station, setStation] = useState(device.station ?? "");
  const valid = name.trim().length >= 2 && station.trim().length >= 1;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4 print:hidden"
      onClick={onClose}
    >
      <form
        className="w-full max-w-md overflow-hidden rounded-t-3xl bg-surface shadow-lift ring-1 ring-hairline sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !saving) onSubmit(name.trim(), station.trim());
        }}
      >
        <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-bold text-ink">
            <MonitorSmartphone className="h-4 w-4 text-blue-600" />
            {mode === "approve" ? "Izinkan perangkat" : "Ubah perangkat"}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="rounded-lg p-1.5 text-ink-muted transition hover:bg-surface-2"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          {mode === "approve" && (
            <div className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25">
              Pastikan layar perangkat menampilkan kode{" "}
              <span className="font-mono text-sm font-black tracking-widest">{device.code}</span>.
            </div>
          )}
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              Nama perangkat
            </span>
            <input
              autoFocus
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="mis. Kiosk SCP 2 – Gate 1"
              className="mt-1 w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none ring-blue-200 focus:ring-2"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              Station / pos
            </span>
            <input
              list="device-stations"
              value={station}
              maxLength={32}
              onChange={(e) => setStation(e.target.value.toUpperCase())}
              placeholder="mis. SCP2"
              className="mt-1 w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none ring-blue-200 focus:ring-2"
            />
            <datalist id="device-stations">
              {stations.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <span className="mt-1 block text-[11px] text-ink-subtle">
              Semua scan dari perangkat ini tercatat di station tersebut.
            </span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-hairline px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-hairline bg-surface px-3 py-2 text-sm font-semibold text-ink transition hover:bg-surface-2"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={!valid || saving}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {mode === "approve" ? "Izinkan" : "Simpan"}
          </button>
        </div>
      </form>
    </div>
  );
}

function NeedAdmin({ connected }: { connected: boolean }) {
  return (
    <section className="rounded-3xl border border-amber-200 bg-amber-50/70 p-6 text-center dark:border-amber-500/25 dark:bg-amber-500/10">
      <Server className="mx-auto h-8 w-8 text-amber-600" />
      <p className="mt-2 text-sm font-semibold text-ink">
        {connected ? "Perlu login backend sebagai admin" : "Belum tersambung ke backend"}
      </p>
      <p className="mx-auto mt-1 max-w-md text-xs text-ink-muted">
        Mengelola perangkat butuh akun <b>admin backend</b>. Akses atas nama
        perangkat (tanpa login) setara petugas dan tidak bisa membuka menu ini.
      </p>
      <Link
        href="/connect"
        className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-blue-700"
      >
        Buka Koneksi Backend
      </Link>
    </section>
  );
}
