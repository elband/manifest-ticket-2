"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Users,
  Pencil,
  Plane,
  MapPin,
  Trash2,
  CheckCircle2,
  Gauge,
  PowerOff,
  PlayCircle,
  Ban,
  Printer,
  History,
  Download,
} from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FlightStatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/ui/Table";
import {
  BoardingProgress,
  Flight,
  FlightAuditEvent,
  PassengerRecord,
  ScanEvent,
  SessionUser,
} from "@/lib/types";
import {
  deleteFlight,
  getFlights,
  getScanEvents,
  getSession,
  updateFlight,
} from "@/lib/storage";
import { canDeleteFlights, canManageFlights } from "@/lib/auth";
import { cn, formatDateTime } from "@/lib/utils";
import { manifestDedupKey } from "@/lib/manifest";
import { getBoardingProgress, boardingProgressFromCount } from "@/lib/boarding";
import { apiFlightPassengers, apiListAllFlights, isAuthed } from "@/lib/api/client";
import { getAuditForFlight, recordAudit } from "@/lib/audit";
import { getSettings, subscribeSettings } from "@/lib/settings";
import { getEffectiveFlightStatus } from "@/lib/flightStatus";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { AirlineLogo } from "@/components/ui/AirlineLogo";
import { getAirlineMeta } from "@/lib/airlines";
import { LargeTitle } from "@/components/mobile/LargeTitle";
import { ListSection, ListRow } from "@/components/mobile/GroupedList";
import { StickyActionBar } from "@/components/mobile/StickyActionBar";
import { downloadXlsx } from "@/lib/xlsxExport";
import { PrintManifest } from "@/components/print/PrintManifest";
import { SeatMap } from "@/components/flights/SeatMap";
import { PassengerDetailModal } from "@/components/flights/PassengerDetailModal";

export default function FlightDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const toast = useToast();
  const confirm = useConfirm();

  const [flight, setFlight] = useState<Flight | null>(null);
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [auditEvents, setAuditEvents] = useState<FlightAuditEvent[]>([]);
  const [session, setSession] = useState<SessionUser | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [showAudit, setShowAudit] = useState(false);
  const [settings, setSettings] = useState(() => getSettings());
  const [now, setNow] = useState(() => new Date());
  const [activePassenger, setActivePassenger] =
    useState<PassengerRecord | null>(null);
  // Hitungan manifest dari backend (sumber kebenaran lintas-device). null = belum
  // /tidak tersedia (offline / belum login / flight tak ketemu di server).
  const [serverPax, setServerPax] = useState<number | null>(null);
  // Daftar pax dari backend (agar scan petugas di perangkat LAIN tetap muncul di
  // sini). null = pakai daftar lokal (derivasi dari scan perangkat ini).
  const [serverPassengers, setServerPassengers] = useState<
    PassengerRecord[] | null
  >(null);

  useEffect(() => {
    if (!id) return;
    const s = getSession();
    setSession(s);
    setCanManage(canManageFlights(s?.role));
    refreshAll(id);
    setSettings(getSettings());
    const unsub = subscribeSettings(setSettings);
    const tick = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      setNow(new Date());
    }, 30_000);
    return () => {
      unsub();
      clearInterval(tick);
    };
  }, [id]);

  const effective = flight
    ? getEffectiveFlightStatus(flight, now, settings)
    : null;

  const refreshAll = (flightId: string) => {
    const f = getFlights().find((x) => x.id === flightId) ?? null;
    setFlight(f);
    setEvents(getScanEvents());
    setAuditEvents(getAuditForFlight(flightId));
  };

  const localPassengers: PassengerRecord[] = useMemo(() => {
    if (!flight) return [];
    const map = new Map<string, PassengerRecord>();
    for (const e of events) {
      if (e.resultStatus !== "VALID_FLIGHT") continue;
      if (e.flightId !== flight.id) continue;
      // Dedup tiket→PNR (sama dengan manifest & backend) supaya hitungan konsisten.
      const key =
        manifestDedupKey(e.parsedTicketNumber, e.parsedPnr) ??
        `${e.parsedSeatNumber ?? ""}-${e.parsedTicketNumber ?? ""}-${e.parsedPnr ?? ""}`;
      const existing = map.get(key);
      if (existing) {
        existing.lastScannedAt = e.scannedAt;
        existing.scanCount += 1;
      } else {
        map.set(key, {
          passengerName: e.parsedPassengerName,
          pnr: e.parsedPnr ?? "—",
          ticketNumber: e.parsedTicketNumber ?? "—",
          seatNumber: e.parsedSeatNumber ?? "—",
          flightId: flight.id,
          flightNumber: flight.flightNumber,
          firstScannedAt: e.scannedAt,
          lastScannedAt: e.scannedAt,
          scanCount: 1,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.seatNumber.localeCompare(b.seatNumber, undefined, { numeric: true }),
    );
  }, [events, flight]);

  // Sumber manifest yang ditampilkan: server (kalau tersedia) > lokal. Server
  // memuat scan dari SEMUA pos/perangkat, jadi scan petugas di device lain ikut
  // tampil di sini — bukan cuma scan perangkat ini.
  const passengers = serverPassengers ?? localPassengers;

  const progress: BoardingProgress | null = flight
    ? serverPassengers
      ? boardingProgressFromCount(flight, passengers.length)
      : getBoardingProgress(flight, events)
    : null;

  // Cross-check ke manifest server (best-effort). Flight lokal & backend punya id
  // berbeda, jadi resolve dulu flight backend by flightNumber + tanggal, lalu
  // ambil jumlah pax-nya. Gagal/offline → serverPax tetap null (badge disembunyikan).
  useEffect(() => {
    if (!flight || !settings.apiSyncEnabled || !isAuthed()) {
      setServerPax(null);
      setServerPassengers(null);
      return;
    }
    const flightRef = flight;
    let cancelled = false;
    (async () => {
      try {
        const list = await apiListAllFlights({ date: flightRef.departureDate });
        if (!list.ok || !list.data) return;
        const match = list.data.items.find(
          (f) =>
            f.flightNumber.toUpperCase() ===
            flightRef.flightNumber.toUpperCase(),
        );
        if (!match) return;
        const res = await apiFlightPassengers(match.id);
        if (cancelled || !res.ok || !res.data) return;
        setServerPax(res.data.count);
        // Petakan pax server → PassengerRecord agar tampil di daftar & seat map.
        setServerPassengers(
          res.data.items
            .map((fp) => ({
              passengerName: fp.passengerName,
              pnr: fp.pnr ?? "—",
              ticketNumber: fp.ticketNumber ?? "—",
              seatNumber: fp.seat ?? "—",
              flightId: flightRef.id,
              flightNumber: flightRef.flightNumber,
              firstScannedAt: fp.firstScannedAt,
              lastScannedAt: fp.lastScannedAt,
              scanCount: fp.scanCount,
            }))
            .sort((a, b) =>
              a.seatNumber.localeCompare(b.seatNumber, undefined, {
                numeric: true,
              }),
            ),
        );
      } catch {
        /* biarkan null — fallback ke daftar lokal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flight, settings.apiSyncEnabled]);

  if (!flight) {
    return (
      <>
        <div className="max-w-xl">
          <Link
            href="/flights"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Kembali
          </Link>
          <Card className="mt-3 animate-fade-up">
            <CardBody className="py-12 text-center text-sm text-slate-500">
              Flight tidak ditemukan.
            </CardBody>
          </Card>
        </div>
      </>
    );
  }

  const canDelete = canDeleteFlights(session?.role);

  const onDelete = async () => {
    if (!canDelete) return;
    const res = await confirm({
      title: `Hapus flight ${flight.flightNumber}?`,
      description:
        "Jadwal ini akan dihapus permanen. Riwayat scan terkait tetap tersimpan di arsip.",
      tone: "danger",
      destructive: true,
      confirmLabel: "Hapus Flight",
      cancelLabel: "Batal",
    });
    if (!res.confirmed) return;
    deleteFlight(flight.id);
    toast.success("Flight dihapus.");
    router.replace("/flights");
  };

  const canCloseBoarding =
    canManage && (flight.status === "OPEN" || flight.status === "ACTIVE");
  const canReopenBoarding = canManage && flight.status === "CLOSED";
  const canCancel = canManage && flight.status !== "CANCELLED";

  const onCloseBoarding = async () => {
    const p = progress;
    const remainingMsg =
      p && p.expected !== null && p.remaining !== null && p.remaining > 0
        ? ` Masih ada ${p.remaining} dari ${p.expected} penumpang yang belum scan.`
        : "";
    const res = await confirm({
      title: `Tutup boarding ${flight.flightNumber}?`,
      description: `Status akan diubah menjadi CLOSED dan scan boarding pass tidak akan diterima lagi.${remainingMsg}`,
      tone: "warning",
      confirmLabel: "Tutup Boarding",
      cancelLabel: "Batal",
    });
    if (!res.confirmed) return;
    updateFlight(flight.id, { status: "CLOSED" });
    recordAudit({
      flightId: flight.id,
      flightNumber: flight.flightNumber,
      action: "CLOSE_BOARDING",
      fromStatus: flight.status,
      toStatus: "CLOSED",
      session,
    });
    toast.success(`Boarding ${flight.flightNumber} ditutup.`);
    refreshAll(flight.id);
  };

  const onReopenBoarding = async () => {
    const res = await confirm({
      title: `Buka kembali boarding ${flight.flightNumber}?`,
      description:
        "Boarding sudah ditutup. Status akan diubah menjadi OPEN dan scan boarding pass kembali diterima.",
      tone: "info",
      confirmLabel: "Buka Kembali",
      cancelLabel: "Batal",
    });
    if (!res.confirmed) return;
    updateFlight(flight.id, { status: "OPEN" });
    recordAudit({
      flightId: flight.id,
      flightNumber: flight.flightNumber,
      action: "REOPEN_BOARDING",
      fromStatus: flight.status,
      toStatus: "OPEN",
      session,
    });
    toast.success(`Boarding ${flight.flightNumber} dibuka kembali.`);
    refreshAll(flight.id);
  };

  const onSubmitCancel = () => {
    const reason = cancelReason.trim();
    if (!reason) {
      toast.error("Alasan pembatalan wajib diisi.");
      return;
    }
    updateFlight(flight.id, {
      status: "CANCELLED",
      cancellationReason: reason,
    });
    recordAudit({
      flightId: flight.id,
      flightNumber: flight.flightNumber,
      action: "CANCEL_FLIGHT",
      fromStatus: flight.status,
      toStatus: "CANCELLED",
      session,
      note: reason,
    });
    toast.warning(`Flight ${flight.flightNumber} dibatalkan.`);
    setCancelOpen(false);
    setCancelReason("");
    refreshAll(flight.id);
  };

  const onExportCsv = async () => {
    if (!flight) return;
    const airline = getAirlineMeta(flight.airlineCode);
    const operator = session?.name ?? session?.email ?? "—";
    const expectedPax = flight.expectedPax ?? null;
    const boardedCount = passengers.length;
    const printedAt = formatDateTime(new Date().toISOString());

    try {
      await downloadXlsx({
        filename: `Manifest_${flight.flightNumber}_${flight.departureDate}.xlsx`,
        sheetName: `Manifest ${flight.flightNumber}`,
        title: `MANIFEST PENUMPANG · ${flight.flightNumber}`,
        subtitle: `${airline.name} · ${flight.originAirport} → ${flight.destinationAirport} · ${flight.departureDate} ${flight.departureTime}`,
        meta: [
          { label: "Flight", value: flight.flightNumber },
          { label: "Maskapai", value: `${airline.name} (${flight.airlineCode})` },
          {
            label: "Rute",
            value: `${flight.originAirport} → ${flight.destinationAirport}`,
          },
          { label: "Tanggal", value: flight.departureDate },
          { label: "Jam keberangkatan", value: flight.departureTime },
          { label: "Gate / Pos", value: flight.gateOrCheckpoint },
          { label: "Status", value: flight.status },
          {
            label: "Kapasitas",
            value:
              expectedPax !== null
                ? `${boardedCount} / ${expectedPax} (${Math.round((boardedCount / Math.max(1, expectedPax)) * 100)}%)`
                : `${boardedCount} penumpang`,
          },
          ...(flight.cancellationReason
            ? [{ label: "Alasan pembatalan", value: flight.cancellationReason }]
            : []),
          { label: "Dicetak", value: printedAt },
          { label: "Petugas", value: operator },
        ],
        columns: [
          { header: "No.", width: 6, align: "center" },
          { header: "Seat", width: 8, align: "center" },
          { header: "Nama Penumpang", width: 28, align: "left" },
          { header: "PNR", width: 12, align: "center" },
          { header: "Tiket / SEQ", width: 16, align: "center" },
          { header: "Pertama Scan", width: 20, align: "left" },
          { header: "Terakhir Scan", width: 20, align: "left" },
          { header: "Jumlah Scan", width: 12, align: "center" },
        ],
        rows: passengers.map((p, i) => [
          i + 1,
          { value: p.seatNumber, tone: "info" as const },
          p.passengerName ?? { value: "(nama tidak tersedia)", tone: "muted" as const },
          { value: p.pnr, tone: "mono" as const },
          { value: p.ticketNumber, tone: "mono" as const },
          formatDateTime(p.firstScannedAt),
          formatDateTime(p.lastScannedAt),
          { value: p.scanCount, tone: p.scanCount > 1 ? ("warning" as const) : undefined },
        ]),
        totals: [
          "TOTAL",
          "",
          `${passengers.length} penumpang`,
          "",
          "",
          "",
          "",
          passengers.reduce((sum, p) => sum + p.scanCount, 0),
        ],
      });
      toast.success(`Manifest ${flight.flightNumber} (${boardedCount} pax) di-export.`);
    } catch (err) {
      toast.error("Gagal export Excel — coba lagi.");
      console.error(err);
    }
  };

  const onPrint = () => {
    window.print();
  };

  const airlineMeta = getAirlineMeta(flight.airlineCode);
  const statusEff = effective?.status ?? flight.status;

  return (
    <>
      {/* ============ PRINT — dedicated manifest document ============ */}
      <PrintManifest flight={flight} passengers={passengers} session={session} />

      {/* ============ MOBILE — iOS-native detail ============ */}
      <div
        className="space-y-4 lg:hidden print-hide"
        style={{ paddingBottom: "5rem" }}
      >
        {/* Hero card */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 via-blue-500 to-cyan-500 px-4 py-4 text-white shadow-lift">
          <div className="deco-blob -right-8 -top-10 h-32 w-32 bg-white/25" />
          <div className="deco-blob -bottom-8 -left-6 h-32 w-32 bg-cyan-300/30" />
          <div className="relative">
            <div className="flex items-center justify-between gap-2">
              <Link
                href="/flights"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/25 backdrop-blur active:scale-95"
                aria-label="Kembali"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <FlightStatusBadge status={statusEff} />
            </div>

            <div className="mt-3 flex items-center gap-3">
              <div className="rounded-xl bg-white/90 p-1.5 ring-1 ring-white/40">
                <AirlineLogo code={flight.airlineCode} size="md" />
              </div>
              <div className="min-w-0">
                <h2 className="text-2xl font-extrabold tracking-tight">
                  {flight.flightNumber}
                </h2>
                <p className="truncate text-[12px] text-white/85">
                  {airlineMeta.name}
                </p>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2 text-[14px] font-bold">
              <span>{flight.originAirport}</span>
              <Plane className="h-3.5 w-3.5 rotate-90 text-white/70" />
              <span>{flight.destinationAirport}</span>
              <span className="ml-auto rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ring-white/25">
                {flight.gateOrCheckpoint}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-dashed border-white/25 pt-3 text-[11px]">
              <HeroCell label="Tanggal" value={flight.departureDate} />
              <HeroCell label="Waktu" value={flight.departureTime} />
              <HeroCell
                label="PAX"
                value={
                  flight.expectedPax ? String(flight.expectedPax) : "—"
                }
              />
            </div>

            {effective && effective.status !== flight.status && (
              <p className="mt-2 rounded-lg bg-white/15 px-2 py-1 text-[11px] text-white/90 ring-1 ring-white/25">
                Auto: {effective.description} · Manual: {flight.status}
              </p>
            )}
          </div>
        </div>

        {/* Cancellation banner */}
        {flight.status === "CANCELLED" && flight.cancellationReason && (
          <div className="flex items-start gap-2 rounded-2xl bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-800 ring-1 ring-amber-200">
            <Ban className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold uppercase tracking-wider text-[10px]">
                Penerbangan Dibatalkan
              </p>
              <p>{flight.cancellationReason}</p>
            </div>
          </div>
        )}

        {/* Boarding progress */}
        {progress && (
          <BoardingMobileCard progress={progress} />
        )}

        {/* Seat map */}
        {passengers.length > 0 && (
          <div className="px-1">
            <SeatMap
              passengers={passengers}
              expectedPax={flight.expectedPax ?? null}
              onSeatClick={(p) => setActivePassenger(p)}
            />
          </div>
        )}

        {/* Passengers list */}
        <ListSection
          header={`Penumpang (${passengers.length})`}
          caption={
            serverPax !== null
              ? `Diisi otomatis dari boarding pass yang scan valid. Server: ${serverPax} pax.`
              : "Diisi otomatis dari boarding pass yang sudah scan valid."
          }
        >
          {passengers.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-ink-muted">
              Belum ada penumpang tercatat.
            </div>
          ) : (
            passengers.map((p) => (
              <button
                type="button"
                key={`${p.pnr}-${p.seatNumber}-${p.ticketNumber}`}
                onClick={() => setActivePassenger(p)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition active:bg-blue-50/60"
              >
                <span className="flex h-9 min-w-[2.75rem] items-center justify-center rounded-lg bg-blue-50 px-2 text-[12px] font-bold tabular-nums text-blue-700 ring-1 ring-blue-200">
                  {p.seatNumber}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-ink">
                    {p.passengerName ?? (
                      <span className="italic text-ink-subtle">
                        (tanpa nama)
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[11.5px] text-ink-muted">
                    PNR {p.pnr} · {p.ticketNumber}
                  </p>
                  <p className="text-[10.5px] text-ink-subtle">
                    Scan: {formatDateTime(p.lastScannedAt)}
                  </p>
                </div>
                {p.scanCount > 1 && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
                    {p.scanCount}×
                  </span>
                )}
              </button>
            ))
          )}
        </ListSection>

        {/* Audit trail */}
        <ListSection header={`Riwayat (${auditEvents.length})`}>
          {auditEvents.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-ink-muted">
              Belum ada perubahan status.
            </div>
          ) : (
            auditEvents.map((a) => (
              <div
                key={a.id}
                className="flex items-start gap-3 px-4 py-3"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                  <History className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold text-ink">
                    {ACTION_LABEL[a.action] ?? a.action}
                    {a.fromStatus && a.toStatus && (
                      <span className="ml-1.5 text-[11.5px] font-normal text-ink-muted">
                        {a.fromStatus} → {a.toStatus}
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-ink-subtle">
                    oleh {a.userName} · {formatDateTime(a.at)}
                  </p>
                  {a.note && (
                    <p className="mt-1 rounded-lg bg-surface-2 px-2 py-1 text-[11.5px] text-ink-muted ring-1 ring-hairline">
                      {a.note}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </ListSection>

        {/* Secondary actions */}
        <ListSection>
          <ListRow
            icon={<Download className="h-4 w-4" />}
            title="Export Excel manifest"
            onClick={onExportCsv}
            showChevron
          />
          <ListRow
            icon={<Printer className="h-4 w-4" />}
            title="Print manifest"
            onClick={onPrint}
            showChevron
          />
          {canManage && (
            <>
              <ListRow
                icon={<Pencil className="h-4 w-4" />}
                title="Edit penerbangan"
                onClick={() => router.push(`/flights/${flight.id}/edit`)}
                showChevron
              />
              {canDelete && (
                <ListRow
                  icon={<Trash2 className="h-4 w-4" />}
                  title="Hapus penerbangan"
                  tone="danger"
                  onClick={onDelete}
                  showChevron
                />
              )}
            </>
          )}
        </ListSection>

        {/* Sticky primary action */}
        {canManage && (canCloseBoarding || canReopenBoarding || canCancel) && (
          <StickyActionBar>
            {canCloseBoarding && (
              <button
                type="button"
                onClick={onCloseBoarding}
                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-amber-500 text-[14px] font-semibold text-white shadow-lift active:scale-[0.98]"
              >
                <PowerOff className="h-4 w-4" />
                Tutup Boarding
              </button>
            )}
            {canReopenBoarding && (
              <button
                type="button"
                onClick={onReopenBoarding}
                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 text-[14px] font-semibold text-white shadow-lift active:scale-[0.98]"
              >
                <PlayCircle className="h-4 w-4" />
                Buka Kembali
              </button>
            )}
            {canCancel && !canCloseBoarding && !canReopenBoarding && (
              <button
                type="button"
                onClick={() => setCancelOpen(true)}
                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-rose-600 text-[14px] font-semibold text-white shadow-lift active:scale-[0.98]"
              >
                <Ban className="h-4 w-4" />
                Batalkan
              </button>
            )}
            {canCancel && (canCloseBoarding || canReopenBoarding) && (
              <button
                type="button"
                onClick={() => setCancelOpen(true)}
                className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 ring-1 ring-hairline active:scale-[0.98]"
                aria-label="Batalkan penerbangan"
              >
                <Ban className="h-4 w-4 text-rose-600" />
              </button>
            )}
          </StickyActionBar>
        )}
      </div>

      {/* ============ DESKTOP — original layout ============ */}
      <div className="hidden lg:block space-y-6 print-hide">
        <div className="flex flex-col items-stretch gap-3 animate-fade-up sm:flex-row sm:items-center sm:justify-between print-hide">
          <Link
            href="/flights"
            className="inline-flex items-center gap-1.5 self-start rounded-full bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 backdrop-blur transition hover:text-blue-700 hover:ring-blue-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Kembali ke daftar
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={onExportCsv}>
              <Download className="h-3.5 w-3.5" />
              Export Excel
            </Button>
            <Button size="sm" variant="outline" onClick={onPrint}>
              <Printer className="h-3.5 w-3.5" />
              Print
            </Button>
            {canManage && (
              <>
                {canCloseBoarding && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onCloseBoarding}
                  >
                    <PowerOff className="h-3.5 w-3.5" />
                    Tutup Boarding
                  </Button>
                )}
                {canReopenBoarding && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onReopenBoarding}
                  >
                    <PlayCircle className="h-3.5 w-3.5 text-emerald-600" />
                    Buka Kembali
                  </Button>
                )}
                {canCancel && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCancelOpen(true)}
                  >
                    <Ban className="h-3.5 w-3.5 text-amber-700" />
                    Batalkan
                  </Button>
                )}
                <Link href={`/flights/${flight.id}/edit`}>
                  <Button size="sm" variant="outline">
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                </Link>
                {canDelete && (
                  <Button size="sm" variant="danger" onClick={onDelete}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Hapus
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Flight summary hero */}
        <div className="relative overflow-hidden rounded-3xl border border-blue-200/60 bg-gradient-to-br from-blue-600 via-blue-500 to-cyan-500 p-6 text-white shadow-lift animate-fade-up stagger-1 print-hide">
          <div className="deco-blob -right-10 -top-10 h-40 w-40 bg-white/30" />
          <div className="deco-blob -bottom-12 -left-8 h-44 w-44 bg-cyan-200/40 opacity-40" />
          <div className="relative z-[1] flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="animate-float">
                <AirlineLogo code={flight.airlineCode} size="lg" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-3xl font-bold tracking-tight">
                    {flight.flightNumber}
                  </h2>
                  <FlightStatusBadge status={effective?.status ?? flight.status} />
                  {effective && effective.status !== flight.status && (
                    <span
                      title={`Status manual: ${flight.status}`}
                      className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/90 ring-1 ring-white/25"
                    >
                      Manual: {flight.status}
                    </span>
                  )}
                </div>
                <p className="text-sm text-white/85">
                  {getAirlineMeta(flight.airlineCode).name}{" "}
                  <span className="text-white/60">
                    · {flight.airlineCode}
                  </span>
                </p>
                {effective && (
                  <p className="mt-1.5 text-xs text-white/75">
                    {effective.description}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center sm:gap-3">
              <Info icon={<MapPin className="h-4 w-4" />} label="Rute">
                <span className="font-semibold">{flight.originAirport}</span>{" "}
                <span className="opacity-60">→</span>{" "}
                <span className="font-semibold">
                  {flight.destinationAirport}
                </span>
              </Info>
              <Info icon={<Calendar className="h-4 w-4" />} label="Tanggal">
                {flight.departureDate}
              </Info>
              <Info icon={<Clock className="h-4 w-4" />} label="Waktu">
                {flight.departureTime}
              </Info>
              <Info icon={<Plane className="h-4 w-4" />} label="Gate">
                {flight.gateOrCheckpoint}
              </Info>
            </div>
          </div>
        </div>

        {/* Cancellation banner (if any) */}
        {flight.status === "CANCELLED" && flight.cancellationReason && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-800 shadow-sm animate-fade-up">
            <Ban className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold uppercase tracking-wider text-[11px]">
                Penerbangan Dibatalkan
              </p>
              <p className="mt-0.5">Alasan: {flight.cancellationReason}</p>
            </div>
          </div>
        )}

        {/* Cancel modal */}
        {cancelOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 backdrop-blur-sm print-hide">
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-lift animate-fade-up">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-700 ring-1 ring-amber-200">
                  <Ban className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-800">
                    Batalkan Flight {flight.flightNumber}?
                  </h4>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Status akan diubah menjadi CANCELLED. Scan boarding pass
                    akan ditolak.
                  </p>
                </div>
              </div>
              <label className="mt-4 block">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                  Alasan pembatalan
                  <span className="text-rose-500"> *</span>
                </span>
                <Input
                  className="mt-1.5"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="mis. cuaca buruk, kerusakan pesawat, …"
                  autoFocus
                />
              </label>
              <div className="mt-4 flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCancelOpen(false);
                    setCancelReason("");
                  }}
                >
                  Batal
                </Button>
                <Button variant="danger" size="sm" onClick={onSubmitCancel}>
                  <Ban className="h-3.5 w-3.5" />
                  Batalkan Penerbangan
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Boarding progress */}
        {progress && <BoardingCard progress={progress} />}

        {/* Passengers */}
        <Card className="animate-fade-up stagger-3 lift">
          <div className="deco-blob -right-12 -top-12 h-40 w-40 bg-emerald-200" />
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200">
                  <Users className="h-3.5 w-3.5" />
                </span>
                Penumpang Tercatat
                <span className="ml-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                  {passengers.length}
                </span>
                <ManifestSourceBadge
                  local={passengers.length}
                  server={serverPax}
                />
              </span>
            </CardTitle>
            <span className="text-xs text-slate-500 print-hide">
              Daftar dibangun otomatis dari boarding pass yang sudah di-scan
              valid.
            </span>
          </CardHeader>
          <CardBody className="p-0">
            {passengers.length === 0 ? (
              <EmptyState
                tone="info"
                icon={<Users className="h-6 w-6" />}
                title="Belum ada penumpang tercatat"
                description={
                  <>
                    Lakukan scan boarding pass di halaman{" "}
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                      /scan
                    </code>
                    .
                  </>
                }
              />
            ) : (
              <>
                <div className="px-5 py-4 print-hide">
                  <SeatMap
                    passengers={passengers}
                    expectedPax={flight.expectedPax ?? null}
                    onSeatClick={(p) => setActivePassenger(p)}
                  />
                </div>
                <Table>
                <THead>
                  <Tr>
                    <Th>Seat</Th>
                    <Th>Nama Penumpang</Th>
                    <Th>PNR</Th>
                    <Th>Tiket / SEQ</Th>
                    <Th>Pertama scan</Th>
                    <Th>Terakhir scan</Th>
                    <Th>Scan</Th>
                  </Tr>
                </THead>
                <TBody>
                  {passengers.map((p, idx) => (
                    <Tr
                      key={`${p.pnr}-${p.seatNumber}-${p.ticketNumber}`}
                      className="animate-fade-up cursor-pointer transition hover:bg-emerald-50/40"
                      style={{ animationDelay: `${idx * 30}ms` }}
                      onClick={() => setActivePassenger(p)}
                    >
                      <Td>
                        <span className="inline-flex items-center justify-center rounded-lg bg-blue-50 px-2 py-0.5 font-semibold text-blue-700 ring-1 ring-blue-200">
                          {p.seatNumber}
                        </span>
                      </Td>
                      <Td className="text-slate-700">
                        {p.passengerName ?? (
                          <span className="italic text-slate-400">
                            (tidak ada dalam barcode)
                          </span>
                        )}
                      </Td>
                      <Td className="text-slate-600">{p.pnr}</Td>
                      <Td className="text-slate-600">{p.ticketNumber}</Td>
                      <Td className="whitespace-nowrap text-slate-600">
                        {formatDateTime(p.firstScannedAt)}
                      </Td>
                      <Td className="whitespace-nowrap text-slate-600">
                        {formatDateTime(p.lastScannedAt)}
                      </Td>
                      <Td>
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                          {p.scanCount}×
                        </span>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              </>
            )}
          </CardBody>
        </Card>

        {/* Audit trail */}
        <Card className="animate-fade-up stagger-4 lift print-hide">
          <div className="deco-blob -right-12 -top-12 h-36 w-36 bg-violet-200" />
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 text-violet-700 ring-1 ring-violet-200">
                  <History className="h-3.5 w-3.5" />
                </span>
                Riwayat Status
                <span className="ml-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-200">
                  {auditEvents.length}
                </span>
              </span>
            </CardTitle>
            <button
              type="button"
              onClick={() => setShowAudit((v) => !v)}
              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-200"
            >
              {showAudit ? "Sembunyikan" : "Tampilkan"}
            </button>
          </CardHeader>
          {showAudit && (
            <CardBody className="p-0">
              {auditEvents.length === 0 ? (
                <EmptyState
                  tone="neutral"
                  icon={<History className="h-6 w-6" />}
                  title="Belum ada perubahan status tercatat"
                  description="Aksi tutup, buka kembali, dan batalkan akan muncul di sini."
                />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {auditEvents.map((a, idx) => (
                    <li
                      key={a.id}
                      className="animate-fade-up px-5 py-3"
                      style={{ animationDelay: `${idx * 30}ms` }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-800">
                          {ACTION_LABEL[a.action] ?? a.action}
                          {a.fromStatus && a.toStatus && (
                            <span className="ml-2 font-normal text-slate-500">
                              {a.fromStatus} → {a.toStatus}
                            </span>
                          )}
                        </p>
                        <span className="text-xs text-slate-500">
                          {formatDateTime(a.at)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        oleh <span className="font-medium">{a.userName}</span>
                      </p>
                      {a.note && (
                        <p className="mt-1 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-600 ring-1 ring-slate-100">
                          {a.note}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          )}
        </Card>
      </div>
      <PassengerDetailModal
        open={!!activePassenger}
        passenger={activePassenger}
        flight={flight}
        onClose={() => setActivePassenger(null)}
      />
    </>
  );
}

const ACTION_LABEL: Record<string, string> = {
  STATUS_CHANGE: "Status diubah",
  CLOSE_BOARDING: "Boarding ditutup",
  REOPEN_BOARDING: "Boarding dibuka kembali",
  CANCEL_FLIGHT: "Penerbangan dibatalkan",
};

/**
 * Badge kecil yang menandakan manifest juga tercatat di server (backend), plus
 * cross-check jumlah lokal vs server. Null = server tak tersedia (offline / belum
 * login / flight tak ketemu) → tidak dirender.
 */
function ManifestSourceBadge({
  local,
  server,
}: {
  local: number;
  server: number | null;
}) {
  if (server === null) return null;
  const synced = server === local;
  return (
    <span
      title={
        synced
          ? "Manifest juga tersimpan di server (jumlah cocok)."
          : `Server mencatat ${server} pax, perangkat ini ${local}. Selisih bisa karena scan dari pos/perangkat lain atau antrian sync.`
      }
      className={cn(
        "ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1",
        synced
          ? "bg-sky-50 text-sky-700 ring-sky-200"
          : "bg-amber-50 text-amber-700 ring-amber-200",
      )}
    >
      Server {server}
    </span>
  );
}

function HeroCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9.5px] font-semibold uppercase tracking-wider text-white/60">
        {label}
      </p>
      <p className="mt-0.5 text-[13px] font-bold tabular-nums">{value}</p>
    </div>
  );
}

const MOBILE_TONE: Record<
  BoardingProgress["tone"],
  { bar: string; text: string; bg: string; ring: string }
> = {
  neutral: {
    bar: "bg-slate-400",
    text: "text-slate-700",
    bg: "bg-slate-50",
    ring: "ring-slate-200",
  },
  info: {
    bar: "bg-blue-500",
    text: "text-blue-700",
    bg: "bg-blue-50",
    ring: "ring-blue-200",
  },
  warning: {
    bar: "bg-amber-500",
    text: "text-amber-700",
    bg: "bg-amber-50",
    ring: "ring-amber-200",
  },
  success: {
    bar: "bg-emerald-500",
    text: "text-emerald-700",
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
  },
  danger: {
    bar: "bg-rose-500",
    text: "text-rose-700",
    bg: "bg-rose-50",
    ring: "ring-rose-200",
  },
};

function BoardingMobileCard({ progress }: { progress: BoardingProgress }) {
  const t = MOBILE_TONE[progress.tone];
  const expected = progress.expected;
  const percent = progress.percent ?? 0;
  return (
    <div className="rounded-2xl bg-surface px-4 py-3.5 ring-1 ring-hairline shadow-card">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-ink-muted">
            Boarding Progress
          </p>
          <p className="mt-0.5 flex items-baseline gap-1">
            <span className={cn("text-2xl font-extrabold", t.text)}>
              {progress.boarded}
            </span>
            <span className="text-[14px] text-ink-subtle">
              / {expected ?? "—"}
            </span>
          </p>
        </div>
        {expected !== null && (
          <div
            className={cn(
              "rounded-xl px-2.5 py-1.5 text-center ring-1",
              t.bg,
              t.ring,
            )}
          >
            <p
              className={cn(
                "text-[10px] font-bold uppercase tracking-wider",
                t.text,
              )}
            >
              {percent}%
            </p>
            <p className="text-[10.5px] text-ink-muted">
              sisa {progress.remaining}
            </p>
          </div>
        )}
      </div>
      {expected !== null ? (
        <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface-2 ring-1 ring-hairline">
          <div
            className={cn("h-full rounded-full transition-all", t.bar)}
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : (
        <p className="mt-2 rounded-lg bg-surface-2 px-2 py-1.5 text-[11.5px] text-ink-muted ring-1 ring-hairline">
          Expected PAX belum diset.
        </p>
      )}
    </div>
  );
}

function Info({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-[120px] rounded-xl bg-white/15 px-3 py-2 ring-1 ring-white/25 backdrop-blur">
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-white/80">
        {icon}
        {label}
      </p>
      <p className="mt-0.5 text-sm font-medium text-white">{children}</p>
    </div>
  );
}

const TONE_STYLES: Record<
  BoardingProgress["tone"],
  {
    blob: string;
    iconBg: string;
    iconText: string;
    iconRing: string;
    bar: string;
    valueText: string;
    chipBg: string;
    chipText: string;
    chipRing: string;
  }
> = {
  neutral: {
    blob: "bg-slate-200",
    iconBg: "bg-slate-100",
    iconText: "text-slate-700",
    iconRing: "ring-slate-200",
    bar: "bg-gradient-to-r from-slate-400 to-slate-500",
    valueText: "text-slate-800",
    chipBg: "bg-slate-50",
    chipText: "text-slate-700",
    chipRing: "ring-slate-200",
  },
  info: {
    blob: "bg-blue-200",
    iconBg: "bg-blue-100",
    iconText: "text-blue-700",
    iconRing: "ring-blue-200",
    bar: "bg-gradient-to-r from-blue-500 to-cyan-500",
    valueText: "text-blue-700",
    chipBg: "bg-blue-50",
    chipText: "text-blue-700",
    chipRing: "ring-blue-200",
  },
  warning: {
    blob: "bg-amber-200",
    iconBg: "bg-amber-100",
    iconText: "text-amber-700",
    iconRing: "ring-amber-200",
    bar: "bg-gradient-to-r from-amber-500 to-orange-500",
    valueText: "text-amber-700",
    chipBg: "bg-amber-50",
    chipText: "text-amber-700",
    chipRing: "ring-amber-200",
  },
  success: {
    blob: "bg-emerald-200",
    iconBg: "bg-emerald-100",
    iconText: "text-emerald-700",
    iconRing: "ring-emerald-200",
    bar: "bg-gradient-to-r from-emerald-500 to-teal-500",
    valueText: "text-emerald-700",
    chipBg: "bg-emerald-50",
    chipText: "text-emerald-700",
    chipRing: "ring-emerald-200",
  },
  danger: {
    blob: "bg-rose-200",
    iconBg: "bg-rose-100",
    iconText: "text-rose-700",
    iconRing: "ring-rose-200",
    bar: "bg-gradient-to-r from-rose-500 to-pink-500",
    valueText: "text-rose-700",
    chipBg: "bg-rose-50",
    chipText: "text-rose-700",
    chipRing: "ring-rose-200",
  },
};

function BoardingCard({ progress }: { progress: BoardingProgress }) {
  const t = TONE_STYLES[progress.tone];
  const expectedKnown = progress.expected !== null;
  const percent = progress.percent ?? 0;

  return (
    <Card className="animate-fade-up stagger-2 lift">
      <div className={cn("deco-blob -right-12 -top-12 h-40 w-40", t.blob)} />
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            <span
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-lg ring-1",
                t.iconBg,
                t.iconText,
                t.iconRing,
              )}
            >
              <Gauge className="h-3.5 w-3.5" />
            </span>
            Progres Boarding
            {expectedKnown && (
              <span
                className={cn(
                  "ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1",
                  t.chipBg,
                  t.chipText,
                  t.chipRing,
                )}
              >
                {percent}%
              </span>
            )}
          </span>
        </CardTitle>
        <span className="text-xs text-slate-500 print-hide">
          Dihitung dari boarding pass unik (PNR + Seat + Tiket) yang sudah scan
          valid.
        </span>
      </CardHeader>
      <CardBody>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Sudah boarding
            </p>
            <p className="mt-1 flex items-baseline gap-1">
              <span className={cn("text-4xl font-bold", t.valueText)}>
                {progress.boarded}
              </span>
              <span className="text-base text-slate-400">
                {expectedKnown ? `/ ${progress.expected}` : "/ —"}
              </span>
            </p>
          </div>
          {expectedKnown && (
            <div className="flex gap-2">
              <div
                className={cn(
                  "rounded-xl px-3 py-2 ring-1",
                  t.chipBg,
                  t.chipRing,
                )}
              >
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Sisa
                </p>
                <p className={cn("text-lg font-bold", t.chipText)}>
                  {progress.remaining}
                </p>
              </div>
              {progress.tone === "success" && (
                <div className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                  <CheckCircle2 className="h-4 w-4" />
                  Lengkap
                </div>
              )}
            </div>
          )}
        </div>

        {expectedKnown ? (
          <div className="mt-4">
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
              <div
                className={cn("h-full rounded-full transition-all", t.bar)}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        ) : (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-200 print-hide">
            Expected PAX belum diset untuk flight ini. Edit penerbangan dan isi
            kapasitas penumpang untuk melihat progres lengkap.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
