"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Settings as SettingsIcon,
  User as UserIcon,
  Sliders,
  Database,
  Volume2,
  VolumeX,
  Vibrate,
  Languages,
  Download,
  Trash2,
  RefreshCw,
  Archive,
  CalendarCheck,
  Timer,
  DoorOpen,
  AlarmClockCheck,
  DoorClosed,
  Palette,
  Plane,
  Moon,
  Monitor,
  Camera,
  Image as ImageIcon,
  ScanFace,
  Send,
  Plug,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Wifi,
  WifiOff,
  IdCard,
  UserX,
} from "lucide-react";
import { facePhotoStore } from "@/lib/facePhotoStore";
import type { ThemeMode } from "@/lib/theme";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  exportAllData,
  getScanEventsArchive,
  getSession,
  purgeScanEventsArchive,
  resetAll,
  saveScanEvents,
} from "@/lib/storage";
import {
  AppSettings,
  Locale,
  KIOSK_RESULT_DURATION_OPTIONS,
  RECOMMENDED_BOARDING,
  SikerenSyncMode,
  getSettings,
  saveSettings,
} from "@/lib/settings";
import {
  clearOutbox,
  flushOutbox,
  getOutboxSummary,
  retryAllFailed,
  subscribeOutbox,
  type OutboxSummary,
} from "@/lib/sikerenOutbox";
import { pingSikeren } from "@/lib/sikerenClient";
import { SessionUser, UserRole } from "@/lib/types";
import { useT } from "@/lib/useT";
import { cn } from "@/lib/utils";
import { PageHero, HeroChip } from "@/components/layout/PageHero";
import { LargeTitle } from "@/components/mobile/LargeTitle";
import {
  ListSection,
  ListRow,
  ListSwitch,
  ListStepper,
} from "@/components/mobile/GroupedList";
import { SegmentedControl } from "@/components/mobile/SegmentedControl";
import { BoardingFlowPreview } from "@/components/settings/BoardingFlowPreview";

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Administrator",
  supervisor: "Supervisor",
  security: "Security",
};

const TABS = [
  { id: "profile", icon: UserIcon, key: "settings.tab.profile" as const },
  { id: "preferences", icon: Sliders, key: "settings.tab.preferences" as const },
  { id: "data", icon: Database, key: "settings.tab.data" as const },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function SettingsPage() {
  const router = useRouter();
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [session, setSession] = useState<SessionUser | null>(null);
  const [settings, setSettings] = useState<AppSettings>(getSettings);
  const [tab, setTab] = useState<TabId>("profile");
  const [archiveCount, setArchiveCount] = useState(0);
  const [faceUsage, setFaceUsage] = useState({ count: 0, bytes: 0 });
  const [outbox, setOutbox] = useState<OutboxSummary>(() => getOutboxSummary());
  const [pinging, setPinging] = useState(false);
  const [flushing, setFlushing] = useState(false);

  const refreshFaceUsage = () => {
    facePhotoStore.estimateUsage().then(setFaceUsage).catch(() => {});
  };

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSession(s);
    setSettings(getSettings());
    setArchiveCount(getScanEventsArchive().length);
    refreshFaceUsage();
    setOutbox(getOutboxSummary());
    const unsub = subscribeOutbox(() => setOutbox(getOutboxSummary()));
    return unsub;
  }, [router]);

  const update = (patch: Partial<AppSettings>) => {
    saveSettings(patch);
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  const onResetBoarding = () => {
    update(RECOMMENDED_BOARDING);
    toast.success(
      "Buka 4 jam · final call OFF · tutup ikut FIDS (pengaman STD+30').",
      "Boarding direset ke rekomendasi",
    );
  };

  const onTestSikeren = async () => {
    if (!settings.sikerenEndpoint.trim()) {
      toast.warning("Isi endpoint Sikeren dulu sebelum test koneksi.");
      return;
    }
    setPinging(true);
    try {
      const r = await pingSikeren(
        settings.sikerenEndpoint.trim(),
        settings.sikerenApiKey.trim(),
      );
      if (r.ok) {
        toast.success(`Sikeren OK (HTTP ${r.status})`, "Test koneksi");
      } else {
        toast.error(r.error ?? "Gagal", "Test koneksi");
      }
    } finally {
      setPinging(false);
    }
  };

  const onForceFlush = async () => {
    setFlushing(true);
    try {
      const r = await flushOutbox({ maxItems: 50 });
      if (r.sent === 0 && r.failed === 0 && r.skipped === 0) {
        toast.info("Tidak ada item untuk dikirim.", "Sync Sikeren");
      } else {
        toast.success(
          `Sent ${r.sent}, retry ${r.skipped}, failed ${r.failed}`,
          "Sync Sikeren",
        );
      }
      setOutbox(getOutboxSummary());
    } finally {
      setFlushing(false);
    }
  };

  const onRetryFailed = () => {
    retryAllFailed();
    setOutbox(getOutboxSummary());
    toast.info("Item failed dikembalikan ke pending.", "Sikeren");
  };

  const onClearOutbox = async () => {
    const res = await confirm({
      title: "Kosongkan outbox Sikeren?",
      description: `${outbox.total} item akan dihapus permanen tanpa dikirim ke Sikeren.`,
      confirmLabel: "Hapus",
      destructive: true,
      tone: "danger",
    });
    if (!res.confirmed) return;
    clearOutbox();
    setOutbox(getOutboxSummary());
    toast.success("Outbox Sikeren dikosongkan.");
  };

  const onExportAll = () => {
    const json = exportAllData();
    download(`afvs_backup_${stamp()}.json`, json, "application/json");
    toast.success("Backup data berhasil di-download.");
  };

  const onExportArchive = () => {
    const data = getScanEventsArchive();
    if (data.length === 0) {
      toast.info("Arsip kosong — belum ada scan event yang diarsipkan.");
      return;
    }
    download(
      `afvs_scan_archive_${stamp()}.json`,
      JSON.stringify(data, null, 2),
      "application/json",
    );
    toast.success(`${data.length} event arsip di-download.`);
  };

  const onPurgeArchive = async () => {
    if (archiveCount === 0) {
      toast.info("Arsip sudah kosong.");
      return;
    }
    const res = await confirm({
      title: `Hapus ${archiveCount} scan event arsip?`,
      description:
        "Data scan event yang sudah diarsipkan akan dihapus permanen. Aksi ini tidak bisa dibatalkan.",
      tone: "danger",
      destructive: true,
      confirmLabel: "Hapus Arsip",
      cancelLabel: "Batal",
    });
    if (!res.confirmed) return;
    purgeScanEventsArchive();
    setArchiveCount(0);
    toast.success("Arsip scan event dihapus.");
  };

  const onClearFaces = async () => {
    if (faceUsage.count === 0) {
      toast.info("Belum ada foto wajah tersimpan.");
      return;
    }
    const res = await confirm({
      title: "Hapus semua foto wajah?",
      description: `${faceUsage.count} foto (${formatBytes(faceUsage.bytes)}) akan dihapus dari IndexedDB. Catatan scan tetap tersimpan, hanya thumbnail yang hilang.`,
      tone: "danger",
      destructive: true,
      confirmLabel: "Hapus",
    });
    if (!res.confirmed) return;
    await facePhotoStore.clearAll();
    refreshFaceUsage();
    toast.success("Semua foto wajah dihapus.");
  };

  // Reset ber-lingkup: hanya scan/statistik. Jadwal, setting, & sesi TETAP.
  const onResetScans = async () => {
    const res = await confirm({
      title: "Reset statistik & riwayat scan?",
      description:
        "Menghapus SEMUA scan event + arsipnya (statistik boarding kembali 0). " +
        "Jadwal penerbangan, pengaturan, dan sesi login TIDAK dihapus. " +
        "Cocok untuk mulai shift/hari baru.",
      tone: "warning",
      confirmLabel: "Reset Scan",
      cancelLabel: "Batal",
    });
    if (!res.confirmed) return;
    saveScanEvents([]);
    purgeScanEventsArchive();
    toast.success("Scan & statistik direset. Memuat ulang…");
    setTimeout(() => window.location.reload(), 600);
  };

  const onReset = async () => {
    const res = await confirm({
      title: "Hapus SEMUA data lokal?",
      description:
        "⚠️ Menghapus SEMUA data lokal di perangkat ini: jadwal penerbangan, " +
        "scan, pengaturan, dan sesi login (auto-logout). Data di server TIDAK " +
        "terpengaruh — setelah reset, jadwal bisa ditarik ulang dari server " +
        "via /connect (Tarik jadwal) atau /jadwal (FIDS). Lanjutkan?",
      tone: "danger",
      destructive: true,
      confirmLabel: "Hapus Semua",
      cancelLabel: "Batal",
    });
    if (!res.confirmed) return;
    resetAll();
    toast.success("Semua data lokal dihapus. Memuat ulang…");
    setTimeout(() => window.location.reload(), 600);
  };

  if (!session) return null;

  const mobileTabOptions = TABS.map((tabDef) => ({
    value: tabDef.id,
    label: t(tabDef.key),
    icon: <tabDef.icon className="h-3.5 w-3.5" />,
  }));

  return (
    <>
      {/* ============ MOBILE — iOS-native layout ============ */}
      <div className="space-y-5 lg:hidden">
        <LargeTitle
          eyebrow={ROLE_LABEL[session.role]}
          title={t("settings.title")}
          subtitle={t("settings.subtitle")}
        />
        <SegmentedControl
          value={tab}
          onChange={(v) => setTab(v as TabId)}
          options={mobileTabOptions}
        />

        {tab === "profile" && (
          <ListSection header="Akun">
            <ListRow
              icon={<UserIcon className="h-4 w-4" />}
              title={t("settings.profile.name")}
              value={session.name}
            />
            <ListRow
              icon={<UserIcon className="h-4 w-4" />}
              iconBg="bg-sky-100 text-sky-700"
              title={t("settings.profile.email")}
              value={session.email}
            />
            <ListRow
              icon={<UserIcon className="h-4 w-4" />}
              iconBg="bg-violet-100 text-violet-700"
              title={t("settings.profile.role")}
              value={ROLE_LABEL[session.role]}
            />
          </ListSection>
        )}

        {tab === "preferences" && (
          <div className="space-y-5">
            <ListSection
              header="Umum"
              caption="Beep dan getaran akan menyala tiap kali scanner menerima atau menolak boarding pass."
            >
              <ListRow
                icon={
                  settings.soundOn ? (
                    <Volume2 className="h-4 w-4" />
                  ) : (
                    <VolumeX className="h-4 w-4" />
                  )
                }
                iconBg="bg-amber-100 text-amber-700"
                title={t("settings.pref.sound")}
                trailing={
                  <ListSwitch
                    checked={settings.soundOn}
                    onChange={(v) => update({ soundOn: v })}
                    ariaLabel={t("settings.pref.sound")}
                  />
                }
              />
              <ListRow
                icon={<Vibrate className="h-4 w-4" />}
                iconBg="bg-rose-100 text-rose-700"
                title={t("settings.pref.haptic")}
                trailing={
                  <ListSwitch
                    checked={settings.hapticOn}
                    onChange={(v) => update({ hapticOn: v })}
                    ariaLabel={t("settings.pref.haptic")}
                  />
                }
              />
              <ListRow
                icon={<Languages className="h-4 w-4" />}
                iconBg="bg-blue-100 text-blue-700"
                title={t("settings.pref.locale")}
                trailing={
                  <SegmentedControl
                    size="sm"
                    value={settings.locale}
                    onChange={(v) => update({ locale: v as Locale })}
                    options={[
                      { value: "id", label: "ID" },
                      { value: "en", label: "EN" },
                    ]}
                    className="w-[88px]"
                  />
                }
              />
            </ListSection>

            <ListSection header={t("settings.section.appearance")}>
              <ListRow
                icon={<Plane className="h-4 w-4" />}
                iconBg="bg-blue-100 text-blue-700"
                title={t("settings.pref.theme.airport")}
                onClick={() => update({ theme: "airport" })}
                trailing={
                  <ThemeCheck active={settings.theme === "airport"} />
                }
              />
              <ListRow
                icon={<Moon className="h-4 w-4" />}
                iconBg="bg-slate-700 text-white"
                title={t("settings.pref.theme.dark")}
                onClick={() => update({ theme: "dark" })}
                trailing={<ThemeCheck active={settings.theme === "dark"} />}
              />
            </ListSection>

            <ListSection
              header={t("settings.section.boarding")}
              caption="Jendela waktu menentukan kapan boarding pass dianggap valid relatif ke jadwal departure."
            >
              <ListRow
                icon={<CalendarCheck className="h-4 w-4" />}
                iconBg="bg-emerald-100 text-emerald-700"
                title={t("settings.pref.flightOnlyToday")}
                subtitle={t("settings.pref.flightOnlyToday.desc")}
                trailing={
                  <ListSwitch
                    checked={settings.flightListShowOnlyToday}
                    onChange={(v) => update({ flightListShowOnlyToday: v })}
                  />
                }
              />
              <ListRow
                icon={<Timer className="h-4 w-4" />}
                iconBg="bg-amber-100 text-amber-700"
                title={t("settings.pref.autoClose")}
                subtitle={t("settings.pref.autoClose.desc")}
                trailing={
                  <ListSwitch
                    checked={settings.autoClosePastDayFlights}
                    onChange={(v) => update({ autoClosePastDayFlights: v })}
                  />
                }
              />
              <ListRow
                icon={<DoorOpen className="h-4 w-4" />}
                iconBg="bg-cyan-100 text-cyan-700"
                title={t("settings.pref.openWindow")}
                subtitle={t("settings.pref.openWindow.desc")}
                trailing={
                  <ListSwitch
                    checked={settings.boardingOpenEnabled}
                    onChange={(v) => update({ boardingOpenEnabled: v })}
                    ariaLabel="Aktifkan buka boarding otomatis"
                  />
                }
              />
              {settings.boardingOpenEnabled && (
                <ListRow
                  icon={<DoorOpen className="h-4 w-4" />}
                  iconBg="bg-cyan-50 text-cyan-600"
                  title="Menit sebelum STD"
                  subtitle="Berapa lama sebelum STD status berubah jadi OPEN."
                  trailing={
                    <ListStepper
                      value={settings.boardingOpenMinutesBefore}
                      min={0}
                      max={240}
                      suffix="m"
                      onChange={(v) => update({ boardingOpenMinutesBefore: v })}
                    />
                  }
                />
              )}
              <ListRow
                icon={<AlarmClockCheck className="h-4 w-4" />}
                iconBg="bg-sky-100 text-sky-700"
                title={t("settings.pref.activeWindow")}
                subtitle={t("settings.pref.activeWindow.desc")}
                trailing={
                  <ListSwitch
                    checked={settings.boardingActiveEnabled}
                    onChange={(v) => update({ boardingActiveEnabled: v })}
                    ariaLabel="Aktifkan final call otomatis"
                  />
                }
              />
              {settings.boardingActiveEnabled && (
                <ListRow
                  icon={<AlarmClockCheck className="h-4 w-4" />}
                  iconBg="bg-sky-50 text-sky-600"
                  title="Menit sebelum STD"
                  subtitle="Berapa lama sebelum STD status berubah jadi ACTIVE (final call)."
                  trailing={
                    <ListStepper
                      value={settings.boardingActiveMinutesBefore}
                      min={0}
                      max={Math.max(0, settings.boardingOpenMinutesBefore)}
                      suffix="m"
                      onChange={(v) =>
                        update({ boardingActiveMinutesBefore: v })
                      }
                    />
                  }
                />
              )}
              <ListRow
                icon={<DoorClosed className="h-4 w-4" />}
                iconBg="bg-rose-100 text-rose-700"
                title={t("settings.pref.closeWindow")}
                subtitle={t("settings.pref.closeWindow.desc")}
                trailing={
                  <ListSwitch
                    checked={settings.boardingCloseEnabled}
                    onChange={(v) => update({ boardingCloseEnabled: v })}
                    ariaLabel="Aktifkan tutup boarding otomatis"
                  />
                }
              />
              {settings.boardingCloseEnabled && (
                <ListRow
                  icon={<DoorClosed className="h-4 w-4" />}
                  iconBg="bg-rose-50 text-rose-600"
                  title="Menit setelah STD"
                  subtitle="Berapa lama setelah STD status berubah jadi CLOSED."
                  trailing={
                    <ListStepper
                      value={settings.boardingCloseMinutesAfter}
                      min={0}
                      max={120}
                      suffix="m"
                      onChange={(v) =>
                        update({ boardingCloseMinutesAfter: v })
                      }
                    />
                  }
                />
              )}
            </ListSection>

            <BoardingFlowPreview settings={settings} onReset={onResetBoarding} />

            <ListSection
              header="Mode Kiosk & Capture Wajah"
              caption="Mode Kiosk fullscreen untuk monitor gate dengan scanner USB. Capture wajah disimpan lokal di IndexedDB perangkat."
            >
              <ListRow
                icon={<Camera className="h-4 w-4" />}
                iconBg="bg-emerald-100 text-emerald-700"
                title="Capture wajah saat scan"
                subtitle="Foto webcam diambil otomatis tiap boarding pass di-scan."
                trailing={
                  <ListSwitch
                    checked={settings.faceCaptureEnabled}
                    onChange={(v) => update({ faceCaptureEnabled: v })}
                    ariaLabel="Capture wajah"
                  />
                }
              />
              <ListRow
                icon={<Monitor className="h-4 w-4" />}
                iconBg="bg-blue-100 text-blue-700"
                title="Auto-enter kiosk saat login"
                subtitle="Buka /scan/kiosk langsung setelah login."
                trailing={
                  <ListSwitch
                    checked={settings.kioskAutoEnter}
                    onChange={(v) => update({ kioskAutoEnter: v })}
                    ariaLabel="Auto-enter kiosk"
                  />
                }
              />
              <ListRow
                icon={<Timer className="h-4 w-4" />}
                iconBg="bg-amber-100 text-amber-700"
                title="Lama tampil data penumpang"
                subtitle="Durasi card hasil scan di kiosk sebelum tertutup otomatis."
                trailing={
                  <KioskResultDurationSelect
                    value={settings.kioskResultDurationSec}
                    onChange={(v) => update({ kioskResultDurationSec: v })}
                  />
                }
              />
              <ListRow
                icon={<ScanFace className="h-4 w-4" />}
                iconBg="bg-cyan-100 text-cyan-700"
                title="Validasi wajah sebelum scan"
                subtitle="Wajah penumpang harus terdeteksi & menghadap kamera. Scan ditolak kalau belum siap."
                trailing={
                  <ListSwitch
                    checked={settings.requireFaceForScan}
                    onChange={(v) => update({ requireFaceForScan: v })}
                    ariaLabel="Validasi wajah"
                  />
                }
              />
              <ListRow
                icon={<ImageIcon className="h-4 w-4" />}
                iconBg="bg-violet-100 text-violet-700"
                title="Foto wajah tersimpan"
                subtitle={`${faceUsage.count} foto · ${formatBytes(faceUsage.bytes)}`}
                value={faceUsage.count > 0 ? "Hapus" : undefined}
                onClick={faceUsage.count > 0 ? onClearFaces : undefined}
                showChevron={faceUsage.count > 0}
              />
            </ListSection>

            <ListSection
              header="Verifikasi KTP"
              caption="OCR berjalan offline di perangkat ini. Cocokan hanya untuk nama; NIK/alamat tidak diekstrak."
            >
              <ListRow
                icon={<IdCard className="h-4 w-4" />}
                iconBg="bg-amber-100 text-amber-700"
                title="Verifikasi nama dengan KTP"
                subtitle="Tampilkan prompt OCR KTP setiap scan VALID."
                trailing={
                  <ListSwitch
                    checked={settings.ktpVerifyEnabled}
                    onChange={(v) => update({ ktpVerifyEnabled: v })}
                    ariaLabel="Verifikasi KTP"
                  />
                }
              />
              {settings.ktpVerifyEnabled && (
                <>
                  <ListRow
                    icon={<CheckCircle2 className="h-4 w-4" />}
                    iconBg="bg-emerald-100 text-emerald-700"
                    title="Ambang auto-pass"
                    subtitle={`Otomatis lolos kalau kemiripan ≥ ${(settings.ktpAutoPassThreshold * 100).toFixed(0)}%`}
                    trailing={
                      <input
                        type="number"
                        min={50}
                        max={100}
                        step={1}
                        value={Math.round(settings.ktpAutoPassThreshold * 100)}
                        onChange={(e) => {
                          const n = Math.min(100, Math.max(50, Number(e.target.value) || 85));
                          update({ ktpAutoPassThreshold: n / 100 });
                        }}
                        className="h-9 w-16 rounded-xl border border-slate-200 bg-white px-2 text-right text-[14px] font-bold tabular-nums dark:border-hairline dark:bg-surface dark:text-ink"
                      />
                    }
                  />
                  <ListRow
                    icon={<AlertTriangle className="h-4 w-4" />}
                    iconBg="bg-amber-100 text-amber-700"
                    title="Ambang konfirmasi manual"
                    subtitle={`Tampilkan prompt operator kalau kemiripan di antara ${(settings.ktpManualThreshold * 100).toFixed(0)}%–${(settings.ktpAutoPassThreshold * 100).toFixed(0)}%`}
                    trailing={
                      <input
                        type="number"
                        min={30}
                        max={95}
                        step={1}
                        value={Math.round(settings.ktpManualThreshold * 100)}
                        onChange={(e) => {
                          const n = Math.min(95, Math.max(30, Number(e.target.value) || 60));
                          update({ ktpManualThreshold: n / 100 });
                        }}
                        className="h-9 w-16 rounded-xl border border-slate-200 bg-white px-2 text-right text-[14px] font-bold tabular-nums dark:border-hairline dark:bg-surface dark:text-ink"
                      />
                    }
                  />
                  <ListRow
                    icon={<ScanFace className="h-4 w-4" />}
                    iconBg="bg-rose-100 text-rose-700"
                    title="Wajibkan KTP cocok untuk status VALID"
                    subtitle="Kalau aktif, scan otomatis DITOLAK (status KTP tidak cocok) bila nama KTP tidak cocok dengan boarding pass. Operator tidak bisa override."
                    trailing={
                      <ListSwitch
                        checked={settings.ktpRequireForValid}
                        onChange={(v) => update({ ktpRequireForValid: v })}
                        ariaLabel="Wajibkan KTP"
                      />
                    }
                  />
                </>
              )}
            </ListSection>
          </div>
        )}

        {tab === "data" && (
          <div className="space-y-5">
            <ListSection
              header="Backup & Arsip"
              caption="Backup berisi semua flight, scan event, audit log, dan pengaturan dalam satu file JSON."
            >
              <ListRow
                icon={<Download className="h-4 w-4" />}
                iconBg="bg-blue-100 text-blue-700"
                title={t("settings.data.export")}
                subtitle="Backup semua data ke JSON"
                onClick={onExportAll}
                showChevron
              />
              <ListRow
                icon={<Archive className="h-4 w-4" />}
                iconBg="bg-violet-100 text-violet-700"
                title={t("settings.data.archiveExport")}
                subtitle="Scan event yang sudah diarsipkan"
                value={archiveCount > 0 ? String(archiveCount) : "Kosong"}
                onClick={onExportArchive}
                showChevron
              />
              {archiveCount > 0 && (
                <ListRow
                  icon={<Trash2 className="h-4 w-4" />}
                  tone="danger"
                  title="Hapus Arsip"
                  subtitle={`${archiveCount} event akan dihapus permanen`}
                  onClick={onPurgeArchive}
                  showChevron
                />
              )}
            </ListSection>

            <ListSection
              header="Reset"
              caption="Mulai shift/hari baru tanpa menghapus jadwal & pengaturan."
            >
              <ListRow
                icon={<RefreshCw className="h-4 w-4" />}
                tone="warning"
                title="Reset statistik & scan"
                subtitle="Hapus scan, jadwal & setting tetap"
                onClick={onResetScans}
                showChevron
              />
            </ListSection>

            <ListSection
              header="Berbahaya"
              caption="Menghapus SEMUA data lokal (jadwal, scan, setting) & logout. Data server aman — tarik ulang via /connect atau /jadwal."
            >
              <ListRow
                icon={<Trash2 className="h-4 w-4" />}
                tone="danger"
                title="Hapus semua data lokal"
                subtitle="Kosongkan perangkat ini"
                onClick={onReset}
                showChevron
              />
            </ListSection>
          </div>
        )}
      </div>

      {/* ============ DESKTOP — original layout ============ */}
      <div className="hidden lg:block space-y-6">
        <PageHero
          tone="slate"
          eyebrow={t("settings.title")}
          eyebrowIcon={<SettingsIcon className="h-3.5 w-3.5" />}
          ghostIcon={
            <SettingsIcon className="h-full w-full" strokeWidth={1.5} />
          }
          title={t("settings.title")}
          description={t("settings.subtitle")}
          meta={
            <>
              <HeroChip label="User" value={session.name} />
              <HeroChip label="Role" value={session.role} />
            </>
          }
        />

        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          <Card className="animate-fade-up stagger-1 lift">
            <CardBody className="p-2">
              <nav className="space-y-1">
                {TABS.map(({ id, icon: Icon, key }) => {
                  const active = tab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTab(id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition",
                        active
                          ? "bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-sm"
                          : "text-slate-600 hover:bg-blue-50 hover:text-blue-700",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {t(key)}
                    </button>
                  );
                })}
              </nav>
            </CardBody>
          </Card>

          <Card className="animate-fade-up stagger-2 lift">
            <div className="deco-blob -right-12 -top-12 h-40 w-40 bg-blue-200" />
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700 ring-1 ring-blue-200">
                    {tab === "profile" ? (
                      <UserIcon className="h-3.5 w-3.5" />
                    ) : tab === "preferences" ? (
                      <Sliders className="h-3.5 w-3.5" />
                    ) : (
                      <Database className="h-3.5 w-3.5" />
                    )}
                  </span>
                  {t(`settings.tab.${tab}` as const)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardBody>
              {tab === "profile" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <ReadOnly label={t("settings.profile.name")} value={session.name} />
                  <ReadOnly label={t("settings.profile.email")} value={session.email} />
                  <ReadOnly
                    label={t("settings.profile.role")}
                    value={ROLE_LABEL[session.role]}
                  />
                </div>
              )}

              {tab === "preferences" && (
                <div className="space-y-5">
                  <div className="space-y-3">
                  <ToggleRow
                    icon={
                      settings.soundOn ? (
                        <Volume2 className="h-4 w-4" />
                      ) : (
                        <VolumeX className="h-4 w-4" />
                      )
                    }
                    title={t("settings.pref.sound")}
                    description="Beep saat scan valid / duplicate / invalid."
                    checked={settings.soundOn}
                    onChange={(v) => update({ soundOn: v })}
                  />
                  <ToggleRow
                    icon={<Vibrate className="h-4 w-4" />}
                    title={t("settings.pref.haptic")}
                    description="Getaran pendek saat scan diterima / ditolak."
                    checked={settings.hapticOn}
                    onChange={(v) => update({ hapticOn: v })}
                  />
                  <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100 dark:bg-white/5 dark:ring-hairline">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl bg-white text-slate-600 ring-1 ring-slate-200 dark:bg-surface dark:text-ink-muted dark:ring-hairline">
                        <Languages className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800 dark:text-ink">
                          {t("settings.pref.locale")}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-ink-muted">
                          Bahasa untuk navigasi & label utama.
                        </p>
                      </div>
                    </div>
                    <div className="inline-flex overflow-hidden rounded-xl ring-1 ring-slate-200 dark:ring-hairline">
                      {(["id", "en"] as Locale[]).map((loc) => (
                        <button
                          key={loc}
                          type="button"
                          onClick={() => update({ locale: loc })}
                          className={cn(
                            "px-3 py-1.5 text-xs font-semibold transition",
                            settings.locale === loc
                              ? "bg-blue-600 text-white dark:bg-sky-600"
                              : "bg-white text-slate-600 hover:bg-blue-50 dark:bg-surface dark:text-ink-muted dark:hover:bg-sky-500/10 dark:hover:text-sky-300",
                          )}
                        >
                          {loc.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                  </div>

                  <SectionDivider
                    icon={<Palette className="h-3.5 w-3.5" />}
                    label={t("settings.section.appearance")}
                  />

                  <div className="space-y-3">
                    <ThemeRow
                      value={settings.theme}
                      onChange={(v) => update({ theme: v })}
                      airportLabel={t("settings.pref.theme.airport")}
                      darkLabel={t("settings.pref.theme.dark")}
                      title={t("settings.pref.theme")}
                      description={t("settings.pref.theme.desc")}
                    />
                  </div>

                  <SectionDivider
                    icon={<CalendarCheck className="h-3.5 w-3.5" />}
                    label={t("settings.section.boarding")}
                  />

                  <div className="space-y-3">
                    <ToggleRow
                      icon={<CalendarCheck className="h-4 w-4" />}
                      title={t("settings.pref.flightOnlyToday")}
                      description={t("settings.pref.flightOnlyToday.desc")}
                      checked={settings.flightListShowOnlyToday}
                      onChange={(v) => update({ flightListShowOnlyToday: v })}
                    />
                    <ToggleRow
                      icon={<Timer className="h-4 w-4" />}
                      title={t("settings.pref.autoClose")}
                      description={t("settings.pref.autoClose.desc")}
                      checked={settings.autoClosePastDayFlights}
                      onChange={(v) => update({ autoClosePastDayFlights: v })}
                    />
                    <ToggleRow
                      icon={<RefreshCw className="h-4 w-4" />}
                      title="Auto-sync jadwal FIDS"
                      description="Tarik keberangkatan dari FIDS bandara otomatis tiap 3 menit & merge ke Jadwal Penerbangan (status manual & pax tetap aman)."
                      checked={settings.fidsAutoSync}
                      onChange={(v) => update({ fidsAutoSync: v })}
                    />
                    <ToggleRow
                      icon={<DoorOpen className="h-4 w-4" />}
                      title="Aktifkan buka boarding otomatis"
                      description="Jika dimatikan, flight harus diubah ke OPEN manual oleh supervisor."
                      checked={settings.boardingOpenEnabled}
                      onChange={(v) => update({ boardingOpenEnabled: v })}
                    />
                    <NumberRow
                      icon={<DoorOpen className="h-4 w-4" />}
                      title={t("settings.pref.openWindow")}
                      description={t("settings.pref.openWindow.desc")}
                      value={settings.boardingOpenMinutesBefore}
                      min={0}
                      max={240}
                      suffix="menit"
                      disabled={!settings.boardingOpenEnabled}
                      onChange={(v) =>
                        update({ boardingOpenMinutesBefore: v })
                      }
                    />
                    <ToggleRow
                      icon={<AlarmClockCheck className="h-4 w-4" />}
                      title="Aktifkan final call otomatis"
                      description="Jika dimatikan, status ACTIVE tidak akan dipicu otomatis menjelang STD."
                      checked={settings.boardingActiveEnabled}
                      onChange={(v) => update({ boardingActiveEnabled: v })}
                    />
                    <NumberRow
                      icon={<AlarmClockCheck className="h-4 w-4" />}
                      title={t("settings.pref.activeWindow")}
                      description={t("settings.pref.activeWindow.desc")}
                      value={settings.boardingActiveMinutesBefore}
                      min={0}
                      max={Math.max(0, settings.boardingOpenMinutesBefore)}
                      suffix="menit"
                      disabled={!settings.boardingActiveEnabled}
                      onChange={(v) =>
                        update({ boardingActiveMinutesBefore: v })
                      }
                    />
                    <ToggleRow
                      icon={<DoorClosed className="h-4 w-4" />}
                      title="Aktifkan tutup boarding otomatis"
                      description="Jika dimatikan, flight tetap ACTIVE setelah STD sampai ditutup manual."
                      checked={settings.boardingCloseEnabled}
                      onChange={(v) => update({ boardingCloseEnabled: v })}
                    />
                    <NumberRow
                      icon={<DoorClosed className="h-4 w-4" />}
                      title={t("settings.pref.closeWindow")}
                      description={t("settings.pref.closeWindow.desc")}
                      value={settings.boardingCloseMinutesAfter}
                      min={0}
                      max={120}
                      suffix="menit"
                      disabled={!settings.boardingCloseEnabled}
                      onChange={(v) =>
                        update({ boardingCloseMinutesAfter: v })
                      }
                    />
                    <BoardingFlowPreview settings={settings} onReset={onResetBoarding} />
                  </div>

                  <SectionDivider
                    icon={<Monitor className="h-3.5 w-3.5" />}
                    label="Mode Kiosk & Capture Wajah"
                  />

                  <div className="space-y-3">
                    <ToggleRow
                      icon={<Camera className="h-4 w-4" />}
                      title="Capture wajah saat scan"
                      description="Snapshot webcam pada setiap scan boarding pass di mode kiosk. Foto disimpan lokal."
                      checked={settings.faceCaptureEnabled}
                      onChange={(v) => update({ faceCaptureEnabled: v })}
                    />
                    <ToggleRow
                      icon={<Monitor className="h-4 w-4" />}
                      title="Auto-submit scanner USB"
                      description="Setelah scanner mengirim string, langsung proses tanpa menunggu tombol Enter."
                      checked={settings.kioskAutoEnter}
                      onChange={(v) => update({ kioskAutoEnter: v })}
                    />
                    <DataRow
                      icon={<Timer className="h-4 w-4" />}
                      title="Lama tampil data penumpang"
                      description="Berapa lama card data penumpang tampil setelah boarding pass di-scan. Pilih “Tanpa batas waktu” agar card tetap tampil sampai ditutup petugas atau diganti scan berikutnya."
                      action={
                        <KioskResultDurationSelect
                          value={settings.kioskResultDurationSec}
                          onChange={(v) => update({ kioskResultDurationSec: v })}
                        />
                      }
                    />
                    <ToggleRow
                      icon={<ScanFace className="h-4 w-4" />}
                      title="Validasi wajah sebelum scan"
                      description="Mode kiosk memblok scan sampai wajah penumpang terdeteksi & menghadap kamera. Matikan kalau setup webcam tidak konsisten."
                      checked={settings.requireFaceForScan}
                      onChange={(v) => update({ requireFaceForScan: v })}
                    />
                    <DataRow
                      icon={<ImageIcon className="h-4 w-4" />}
                      title="Foto wajah tersimpan"
                      description={`${faceUsage.count} foto · ${formatBytes(faceUsage.bytes)} di IndexedDB. Catatan scan tetap aman ketika foto dihapus.`}
                      action={
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={onClearFaces}
                          disabled={faceUsage.count === 0}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                          Hapus semua
                        </Button>
                      }
                    />
                  </div>

                  <SectionDivider
                    icon={<IdCard className="h-3.5 w-3.5" />}
                    label="Verifikasi KTP"
                  />

                  <div className="space-y-3">
                    <ToggleRow
                      icon={<IdCard className="h-4 w-4" />}
                      title="Verifikasi nama dengan KTP"
                      description="Setelah scan VALID, tampilkan prompt OCR untuk mencocokkan nama di KTP dengan nama di boarding pass. OCR berjalan offline."
                      checked={settings.ktpVerifyEnabled}
                      onChange={(v) => update({ ktpVerifyEnabled: v })}
                    />
                    <NumberRow
                      icon={<CheckCircle2 className="h-4 w-4" />}
                      title="Ambang auto-pass (%)"
                      description="Otomatis lolos kalau kemiripan nama ≥ ambang ini."
                      value={Math.round(settings.ktpAutoPassThreshold * 100)}
                      min={50}
                      max={100}
                      suffix="%"
                      disabled={!settings.ktpVerifyEnabled}
                      onChange={(v) => update({ ktpAutoPassThreshold: v / 100 })}
                    />
                    <NumberRow
                      icon={<AlertTriangle className="h-4 w-4" />}
                      title="Ambang konfirmasi manual (%)"
                      description="Di bawah ambang ini, operator diminta konfirmasi manual. Lebih kecil dari ini langsung dianggap tidak cocok."
                      value={Math.round(settings.ktpManualThreshold * 100)}
                      min={30}
                      max={95}
                      suffix="%"
                      disabled={!settings.ktpVerifyEnabled}
                      onChange={(v) => update({ ktpManualThreshold: v / 100 })}
                    />
                    <ToggleRow
                      icon={<ScanFace className="h-4 w-4" />}
                      title="Wajibkan KTP cocok untuk status VALID"
                      description="Kalau aktif, scan otomatis DITOLAK (status KTP tidak cocok) bila nama KTP tidak cocok dengan boarding pass. Operator tidak bisa override."
                      checked={settings.ktpRequireForValid}
                      onChange={(v) => update({ ktpRequireForValid: v })}
                    />
                    <ToggleRow
                      icon={<UserX className="h-4 w-4" />}
                      title='Izinkan jalur "Tanpa KTP"'
                      description="Tampilkan tombol di kiosk (mode KTP-first) untuk melewati pencocokan KTP bagi penumpang tanpa KTP. Petugas mengonfirmasi identitas secara visual/dokumen pendukung; setiap pengecualian tercatat (audit)."
                      checked={settings.allowNoKtpExemption}
                      onChange={(v) => update({ allowNoKtpExemption: v })}
                    />
                  </div>
                </div>
              )}

              {tab === "data" && (
                <div className="space-y-3">
                  <DataRow
                    icon={<Download className="h-4 w-4" />}
                    title={t("settings.data.export")}
                    description="Unduh semua flight, scan, audit, dan pengaturan dalam satu file JSON."
                    action={
                      <Button size="sm" variant="outline" onClick={onExportAll}>
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </Button>
                    }
                  />
                  <DataRow
                    icon={<Archive className="h-4 w-4" />}
                    title={`${t("settings.data.archiveExport")} (${archiveCount})`}
                    description="Scan event hari kemarin & sebelumnya yang sudah dipindahkan ke arsip."
                    action={
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={onExportArchive}
                        >
                          <Download className="h-3.5 w-3.5" />
                          Export
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={onPurgeArchive}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                          Purge
                        </Button>
                      </div>
                    }
                  />
                  <DataRow
                    icon={<RefreshCw className="h-4 w-4" />}
                    title="Reset statistik & scan"
                    description="Hapus semua scan + arsip (statistik ke 0). Jadwal, pengaturan & sesi TETAP. Untuk mulai shift/hari baru."
                    action={
                      <Button size="sm" variant="outline" onClick={onResetScans}>
                        <RefreshCw className="h-3.5 w-3.5 text-amber-600" />
                        Reset Scan
                      </Button>
                    }
                  />
                  <DataRow
                    icon={<Trash2 className="h-4 w-4" />}
                    title="Hapus semua data lokal"
                    description="Hapus SEMUA data lokal (jadwal, scan, setting) & logout. Data server AMAN — tarik ulang jadwal via /connect atau /jadwal setelahnya."
                    danger
                    action={
                      <Button size="sm" variant="danger" onClick={onReset}>
                        <Trash2 className="h-3.5 w-3.5" />
                        Hapus Semua
                      </Button>
                    }
                  />

                  <SectionDivider
                    icon={<Plug className="h-3.5 w-3.5" />}
                    label="Integrasi Sikeren"
                  />

                  <SikerenIntegrationCard
                    settings={settings}
                    outbox={outbox}
                    pinging={pinging}
                    flushing={flushing}
                    onChange={update}
                    onTest={onTestSikeren}
                    onFlush={onForceFlush}
                    onRetry={onRetryFailed}
                    onClear={onClearOutbox}
                  />
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function ThemeCheck({ active }: { active: boolean }) {
  if (!active) {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full ring-1 ring-hairline" />
    );
  }
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        className="h-3 w-3"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </span>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}

function ThemeRow({
  value,
  onChange,
  airportLabel,
  darkLabel,
  title,
  description,
}: {
  value: ThemeMode;
  onChange: (v: ThemeMode) => void;
  airportLabel: string;
  darkLabel: string;
  title: string;
  description?: string;
}) {
  const opts: { id: ThemeMode; icon: React.ReactNode; label: string; accent: string }[] = [
    {
      id: "airport",
      icon: <Plane className="h-4 w-4" />,
      label: airportLabel,
      accent: "from-blue-600 to-cyan-500",
    },
    {
      id: "dark",
      icon: <Moon className="h-4 w-4" />,
      label: darkLabel,
      accent: "from-slate-700 to-slate-900",
    },
  ];
  return (
    <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100 dark:bg-surface-2 dark:ring-hairline">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl bg-white text-slate-600 ring-1 ring-slate-200 dark:bg-surface dark:text-ink-muted dark:ring-hairline">
          <Palette className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 dark:text-ink">
            {title}
          </p>
          {description && (
            <p className="text-xs text-slate-500 dark:text-ink-muted">
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {opts.map((o) => {
          const active = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              className={cn(
                "group relative flex items-center gap-2.5 overflow-hidden rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition",
                active
                  ? "border-transparent bg-gradient-to-br text-white shadow-lift ring-2 ring-white/50 " +
                      o.accent
                  : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50 dark:border-hairline dark:bg-surface dark:text-ink dark:hover:border-sky-400/40",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg transition",
                  active
                    ? "bg-white/15 text-white ring-1 ring-white/30"
                    : "bg-slate-100 text-slate-600 ring-1 ring-slate-200 dark:bg-surface-2 dark:text-ink-muted dark:ring-hairline",
                )}
              >
                {o.icon}
              </span>
              <span className="truncate">{o.label}</span>
              {active && (
                <span
                  aria-hidden
                  className="ml-auto inline-flex h-2 w-2 rounded-full bg-white/95 shadow-[0_0_8px_rgba(255,255,255,0.8)]"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ToggleRow({
  icon,
  title,
  description,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl bg-white text-slate-600 ring-1 ring-slate-200">
          {icon}
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          {description && (
            <p className="text-xs text-slate-500">{description}</p>
          )}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 items-center rounded-full transition",
          checked ? "bg-emerald-500" : "bg-slate-300",
        )}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 transform rounded-full bg-white shadow transition",
            checked ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

function NumberRow({
  icon,
  title,
  description,
  value,
  min,
  max,
  suffix,
  onChange,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100",
        disabled && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl bg-white text-slate-600 ring-1 ring-slate-200">
          {icon}
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          {description && (
            <p className="text-xs text-slate-500">{description}</p>
          )}
        </div>
      </div>
      <div className="inline-flex items-center gap-1 rounded-xl bg-white ring-1 ring-slate-200">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(clamp(value - 5))}
          className="h-8 w-8 rounded-l-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          aria-label="kurang"
        >
          −
        </button>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(clamp(parseInt(e.target.value, 10) || 0))}
          className="w-12 border-0 bg-transparent text-center text-sm font-bold tabular-nums text-slate-800 outline-none focus:ring-0 disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(clamp(value + 5))}
          className="h-8 w-8 rounded-r-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          aria-label="tambah"
        >
          +
        </button>
        {suffix && (
          <span className="pr-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function KioskResultDurationSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const options: readonly number[] = KIOSK_RESULT_DURATION_OPTIONS;
  // Nilai lama di luar daftar (mis. diubah manual) tetap ditampilkan.
  const all = options.includes(value) ? options : [value, ...options];
  return (
    <select
      value={value}
      onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
      aria-label="Lama tampil data penumpang"
      className="h-8 shrink-0 rounded-xl border-0 bg-white px-2.5 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 focus:ring-2 focus:ring-blue-400"
    >
      {all.map((sec) => (
        <option key={sec} value={sec}>
          {sec === 0 ? "Tanpa batas waktu" : `${sec} detik`}
        </option>
      ))}
    </select>
  );
}

function SectionDivider({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-blue-200">
        {icon}
      </span>
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <span className="h-px flex-1 bg-gradient-to-r from-slate-200 to-transparent" />
    </div>
  );
}

function DataRow({
  icon,
  title,
  description,
  action,
  danger,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start justify-between gap-3 rounded-2xl px-4 py-3 ring-1 sm:flex-row sm:items-center",
        danger
          ? "bg-rose-50/60 ring-rose-100"
          : "bg-slate-50 ring-slate-100",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl bg-white ring-1",
            danger ? "text-rose-600 ring-rose-200" : "text-slate-600 ring-slate-200",
          )}
        >
          {icon}
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          {description && (
            <p className="text-xs text-slate-500">{description}</p>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate(),
  ).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

function SikerenIntegrationCard({
  settings,
  outbox,
  pinging,
  flushing,
  onChange,
  onTest,
  onFlush,
  onRetry,
  onClear,
}: {
  settings: AppSettings;
  outbox: OutboxSummary;
  pinging: boolean;
  flushing: boolean;
  onChange: (patch: Partial<AppSettings>) => void;
  onTest: () => void;
  onFlush: () => void;
  onRetry: () => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl bg-slate-50 px-4 py-4 ring-1 ring-slate-100 dark:bg-white/5 dark:ring-hairline">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow">
            <Send className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-ink">
              Kirim ke Sikeren (billing)
            </p>
            <p className="text-xs text-slate-500 dark:text-ink-muted">
              Setiap scan VALID dikirim ke endpoint Sikeren untuk dijadikan tagihan per maskapai. Offline-safe — disimpan di outbox kalau koneksi putus.
            </p>
          </div>
        </div>
        <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-xs font-semibold">
          <input
            type="checkbox"
            checked={settings.sikerenEnabled}
            onChange={(e) => onChange({ sikerenEnabled: e.target.checked })}
            className="h-4 w-4 rounded text-blue-600"
          />
          Aktif
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FieldRow
          label="Endpoint URL"
          placeholder="https://sikeren.example.com/api/passenger-billing"
          value={settings.sikerenEndpoint}
          onChange={(v) => onChange({ sikerenEndpoint: v })}
        />
        <FieldRow
          label="API Key (Bearer)"
          placeholder="Opsional — kalau Sikeren butuh auth"
          value={settings.sikerenApiKey}
          onChange={(v) => onChange({ sikerenApiKey: v })}
          type="password"
        />
        <FieldRow
          label="Station ID"
          placeholder="mis. CGK-GATE-A1"
          value={settings.sikerenStation}
          onChange={(v) => onChange({ sikerenStation: v })}
        />
        <div className="flex flex-col gap-1">
          <label className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-ink-subtle">
            Mode sinkronisasi
          </label>
          <div className="inline-flex overflow-hidden rounded-xl ring-1 ring-slate-200 dark:ring-hairline">
            {(["auto", "manual"] as SikerenSyncMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChange({ sikerenSyncMode: m })}
                className={cn(
                  "flex-1 px-3 py-2 text-xs font-semibold transition",
                  settings.sikerenSyncMode === m
                    ? "bg-blue-600 text-white dark:bg-sky-600"
                    : "bg-white text-slate-600 hover:bg-blue-50 dark:bg-surface dark:text-ink-muted dark:hover:bg-sky-500/10",
                )}
              >
                {m === "auto" ? "Auto (langsung)" : "Manual (sync sendiri)"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <SikerenStatusPanel outbox={outbox} />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={onTest} disabled={pinging}>
          {pinging ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plug className="h-3.5 w-3.5" />
          )}
          Test koneksi
        </Button>
        <Button size="sm" variant="primary" onClick={onFlush} disabled={flushing}>
          {flushing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Sync sekarang
        </Button>
        <Button size="sm" variant="ghost" onClick={onRetry} disabled={outbox.failed === 0}>
          <RefreshCw className="h-3.5 w-3.5" />
          Retry failed ({outbox.failed})
        </Button>
        <Button size="sm" variant="ghost" onClick={onClear} disabled={outbox.total === 0}>
          <Trash2 className="h-3.5 w-3.5 text-rose-600" />
          Kosongkan outbox
        </Button>
      </div>
    </div>
  );
}

function SikerenStatusPanel({ outbox }: { outbox: OutboxSummary }) {
  const lastSyncLabel = outbox.lastSyncedAt
    ? new Date(outbox.lastSyncedAt).toLocaleString("id-ID")
    : "Belum pernah";
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <StatusTile
        icon={outbox.online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
        label="Status"
        value={outbox.online ? "Online" : "Offline"}
        tone={outbox.online ? "success" : "danger"}
      />
      <StatusTile
        icon={<Loader2 className="h-3.5 w-3.5" />}
        label="Pending"
        value={String(outbox.pending)}
        tone={outbox.pending > 0 ? "info" : "neutral"}
      />
      <StatusTile
        icon={<AlertTriangle className="h-3.5 w-3.5" />}
        label="Failed"
        value={String(outbox.failed)}
        tone={outbox.failed > 0 ? "danger" : "neutral"}
      />
      <StatusTile
        icon={<CheckCircle2 className="h-3.5 w-3.5" />}
        label="Last sync"
        value={lastSyncLabel}
        tone="neutral"
      />
    </div>
  );
}

function StatusTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
}) {
  const toneCls: Record<typeof tone, string> = {
    neutral: "bg-white text-slate-700 ring-slate-200 dark:bg-surface dark:text-ink dark:ring-hairline",
    info: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30",
    success: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
    warning: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
    danger: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30",
  };
  return (
    <div className={cn("rounded-xl px-3 py-2 ring-1", toneCls[tone])}>
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="text-[9.5px] font-bold uppercase tracking-wider opacity-80">{label}</p>
      </div>
      <p className="mt-0.5 truncate text-xs font-bold tabular-nums">{value}</p>
    </div>
  );
}

function FieldRow({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-ink-subtle">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-surface dark:text-ink dark:ring-hairline"
        spellCheck={false}
        autoComplete="off"
      />
    </div>
  );
}
