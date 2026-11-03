import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtPayload } from "../auth/auth.service";
import { manifestDedupKey } from "../common/manifest";
import {
  CreateFlightDto,
  ListFlightsQuery,
  SyncFlightsDto,
  UpdateFlightDto,
} from "./dto";

// F-05: supervisor/admin lintas-station; operator hanya station-nya.
function isPrivileged(role: string): boolean {
  return role === "admin" || role === "supervisor";
}

@Injectable()
export class FlightsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Manifest penumpang sebuah flight (diisi dari scan VALID_FLIGHT). Urut seat.
   * F-05: operator hanya boleh melihat flight di station-nya (balas 404 bila
   * beda station agar keberadaan record tak bisa dienumerasi lintas-station).
   */
  async listPassengers(id: string, user: JwtPayload) {
    const flight = await this.prisma.flight.findUnique({
      where: { id },
      select: { id: true, station: true },
    });
    if (!flight) throw new NotFoundException("Flight not found");
    if (!isPrivileged(user.role) && flight.station !== user.station) {
      throw new NotFoundException("Flight not found");
    }
    const items = await this.prisma.flightPassenger.findMany({
      where: { flightId: id },
      orderBy: [{ seat: "asc" }, { lastScannedAt: "asc" }],
    });
    return { items, count: items.length };
  }

  /**
   * Rekap penumpang per maskapai untuk rentang tanggal. `date` = 1 hari; atau
   * `from`+`to` inklusif. Agregasi FlightPassenger (boarded) di-kelompokkan per
   * airlineCode via Flight. F-05: operator hanya station-nya.
   * Lihat docs/RANCANGAN-PAX-PER-MASKAPAI.md.
   */
  async manifestByAirline(
    q: { date?: string; from?: string; to?: string; detail?: string },
    user: JwtPayload,
  ) {
    const from = q.from ?? q.date;
    const to = q.to ?? q.date;
    if (!from || !to) {
      throw new BadRequestException("Wajib isi `date` atau `from`+`to`.");
    }
    const withDetail = q.detail === "1" || q.detail === "true";
    const std = {
      gte: new Date(`${from}T00:00:00Z`),
      lte: new Date(`${to}T23:59:59.999Z`),
    };
    const where: Record<string, unknown> = { std };
    // Keberangkatan saja: origin = bandara home (single-airport, mis. AAP).
    where.origin = process.env.HOME_IATA ?? "AAP";
    if (!isPrivileged(user.role)) {
      where.station = user.station ?? "__no_station__";
    }

    const flights = await this.prisma.flight.findMany({
      where,
      select: { id: true, flightNumber: true, airlineCode: true, std: true },
      orderBy: { std: "asc" },
    });
    const flightIds = flights.map((f) => f.id);
    const grouped = flightIds.length
      ? await this.prisma.flightPassenger.groupBy({
          by: ["flightId"],
          where: { flightId: { in: flightIds } },
          _count: { _all: true },
        })
      : [];
    const paxByFlight = new Map(
      grouped.map((g) => [g.flightId, g._count._all]),
    );

    type Rollup = {
      airlineCode: string;
      passengers: number;
      flights: number;
      flightsDetail: Array<{
        flightId: string;
        flightNumber: string;
        std: string;
        passengers: number;
      }>;
    };
    const byAirline = new Map<string, Rollup>();
    let totalPassengers = 0;
    for (const f of flights) {
      const code = (f.airlineCode || "??").toUpperCase();
      const pax = paxByFlight.get(f.id) ?? 0;
      let g = byAirline.get(code);
      if (!g) {
        g = { airlineCode: code, passengers: 0, flights: 0, flightsDetail: [] };
        byAirline.set(code, g);
      }
      g.passengers += pax;
      g.flights += 1;
      if (withDetail) {
        g.flightsDetail.push({
          flightId: f.id,
          flightNumber: f.flightNumber,
          std: f.std.toISOString(),
          passengers: pax,
        });
      }
      totalPassengers += pax;
    }

    const airlines = Array.from(byAirline.values()).sort(
      (a, b) =>
        b.passengers - a.passengers ||
        a.airlineCode.localeCompare(b.airlineCode),
    );

    return {
      range: { from, to },
      totals: {
        passengers: totalPassengers,
        flights: flights.length,
        airlines: airlines.length,
      },
      airlines,
    };
  }

  async list(q: ListFlightsQuery) {
    const where: Record<string, unknown> = {};
    if (q.station) where.station = q.station;
    if (q.status) where.status = q.status;
    if (q.date) {
      const start = new Date(`${q.date}T00:00:00Z`);
      const end = new Date(`${q.date}T23:59:59.999Z`);
      where.std = { gte: start, lte: end };
    }
    const page = Math.max(1, q.page ?? 1);
    const perPage = Math.min(200, Math.max(1, q.perPage ?? 50));
    const [items, total] = await Promise.all([
      this.prisma.flight.findMany({
        where,
        orderBy: { std: "asc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.flight.count({ where }),
    ]);
    return { items, page, perPage, total };
  }

  async create(dto: CreateFlightDto) {
    return this.prisma.flight.create({
      data: { ...dto, std: new Date(dto.std) },
    });
  }

  /**
   * Snapshot jadwal harian (mis. tarik FIDS): upsert massal per penerbangan.
   *
   * Kunci pencocokan = [station, flightNumber, TANGGAL] (bukan std jam persis).
   * Alasan: FIDS sering mengubah jam beberapa menit saat delay/berangkat/tutup;
   * kalau dicocokkan by `std` (yang memuat jam), perubahan jam bikin baris BARU
   * (duplikat OPEN + CLOSED). Dengan mencocokkan per-tanggal, retiming & penutupan
   * hanya MENG-UPDATE baris yang sama (std & status diperbarui). Idempotent, tak
   * menghapus jadwal tanggal lampau.
   */
  async bulkUpsert(dto: SyncFlightsDto) {
    const dayKey = (isoOrDate: string | Date) =>
      new Date(isoOrDate).toISOString().slice(0, 10);

    // Dedupe input per (station, flightNumber, tanggal) — ambil yang terakhir.
    const byKey = new Map<string, CreateFlightDto>();
    for (const f of dto.flights) {
      byKey.set(`${f.station}__${f.flightNumber}__${dayKey(f.std)}`, f);
    }
    const unique = Array.from(byKey.values());

    let created = 0;
    let updated = 0;
    for (const f of unique) {
      const std = new Date(f.std);
      const date = dayKey(std);
      const dayStart = new Date(`${date}T00:00:00.000Z`);
      const dayEnd = new Date(`${date}T23:59:59.999Z`);
      const existing = await this.prisma.flight.findFirst({
        where: {
          station: f.station,
          flightNumber: f.flightNumber,
          std: { gte: dayStart, lte: dayEnd },
        },
        select: {
          id: true,
          airlineCode: true,
          origin: true,
          destination: true,
          status: true,
          std: true,
        },
      });
      if (existing) {
        // Tiap perangkat menarik FIDS tiap 3 menit → mayoritas baris identik.
        // Lewati UPDATE bila tak ada yang berubah (hemat tulis ke MySQL).
        if (
          existing.airlineCode === f.airlineCode &&
          existing.origin === f.origin &&
          existing.destination === f.destination &&
          existing.status === f.status &&
          existing.std.getTime() === std.getTime()
        ) {
          continue;
        }
        await this.prisma.flight.update({
          where: { id: existing.id },
          data: {
            airlineCode: f.airlineCode,
            origin: f.origin,
            destination: f.destination,
            status: f.status,
            std, // perbarui jam papan terbaru pada baris yang sama
          },
        });
        updated += 1;
      } else {
        await this.prisma.flight.create({ data: { ...f, std } });
        created += 1;
      }
    }
    return { ok: true, synced: unique.length, created, updated };
  }

  async update(id: string, dto: UpdateFlightDto) {
    const exists = await this.prisma.flight.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException("Flight not found");
    return this.prisma.flight.update({
      where: { id },
      data: {
        ...(dto.status && { status: dto.status }),
        ...(dto.std && { std: new Date(dto.std) }),
      },
    });
  }

  async remove(id: string) {
    const exists = await this.prisma.flight.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException("Flight not found");
    await this.prisma.flight.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Backfill/rebuild manifest dari ScanEvent historis (VALID_FLIGHT + flightId).
   * Idempoten: untuk tiap flight yang tersentuh, hapus manifest lama lalu bangun
   * ulang dari agregasi scan. Aman dipanggil berulang. Filter tanggal opsional.
   */
  async rebuildManifests(date?: string) {
    const where: Record<string, unknown> = {
      resultStatus: "VALID_FLIGHT",
    };
    if (date) {
      where.scannedAt = {
        gte: new Date(`${date}T00:00:00Z`),
        lte: new Date(`${date}T23:59:59.999Z`),
      };
    }
    const rawEvents = await this.prisma.scanEvent.findMany({
      where,
      select: {
        flightId: true,
        flightNumber: true,
        pnr: true,
        ticketNumber: true,
        seat: true,
        passengerName: true,
        scannedAt: true,
      },
      orderBy: { scannedAt: "asc" },
    });

    // Re-resolve flightId untuk scan yang flightId-nya null (mis. station scan
    // = SCP2/UNKNOWN sedangkan flight level bandara AAP). Cocokkan flightNumber
    // + tanggal via index in-memory agar tak query per-event.
    const allFlights = await this.prisma.flight.findMany({
      select: { id: true, flightNumber: true, std: true },
    });
    const flightIndex = new Map<string, string>();
    for (const f of allFlights) {
      const key = `${f.flightNumber.toUpperCase()}__${f.std.toISOString().slice(0, 10)}`;
      if (!flightIndex.has(key)) flightIndex.set(key, f.id);
    }
    const events = rawEvents.map((e) => {
      if (e.flightId) return e;
      if (!e.flightNumber) return e;
      const key = `${e.flightNumber.toUpperCase()}__${e.scannedAt.toISOString().slice(0, 10)}`;
      return { ...e, flightId: flightIndex.get(key) ?? null };
    });

    // Agregasi: flightId → dedupKey → record.
    type Agg = {
      flightId: string;
      dedupKey: string;
      pnr: string | null;
      ticketNumber: string | null;
      seat: string | null;
      passengerName: string | null;
      firstScannedAt: Date;
      lastScannedAt: Date;
      scanCount: number;
    };
    const byFlight = new Map<string, Map<string, Agg>>();
    for (const e of events) {
      if (!e.flightId) continue;
      const dedupKey = manifestDedupKey(e.ticketNumber, e.pnr);
      if (!dedupKey) continue;
      let m = byFlight.get(e.flightId);
      if (!m) {
        m = new Map();
        byFlight.set(e.flightId, m);
      }
      const cur = m.get(dedupKey);
      if (!cur) {
        m.set(dedupKey, {
          flightId: e.flightId,
          dedupKey,
          pnr: e.pnr,
          ticketNumber: e.ticketNumber,
          seat: e.seat,
          passengerName: e.passengerName,
          firstScannedAt: e.scannedAt,
          lastScannedAt: e.scannedAt,
          scanCount: 1,
        });
      } else {
        cur.scanCount += 1;
        if (e.scannedAt < cur.firstScannedAt) cur.firstScannedAt = e.scannedAt;
        if (e.scannedAt > cur.lastScannedAt) cur.lastScannedAt = e.scannedAt;
        if (!cur.passengerName && e.passengerName) cur.passengerName = e.passengerName;
        if (!cur.seat && e.seat) cur.seat = e.seat;
      }
    }

    let flights = 0;
    let passengers = 0;
    for (const [flightId, m] of byFlight) {
      const rows = Array.from(m.values());
      await this.prisma.$transaction([
        this.prisma.flightPassenger.deleteMany({ where: { flightId } }),
        this.prisma.flightPassenger.createMany({
          data: rows.map((r) => ({
            flightId: r.flightId,
            dedupKey: r.dedupKey,
            pnr: r.pnr,
            ticketNumber: r.ticketNumber,
            seat: r.seat,
            passengerName: r.passengerName,
            firstScannedAt: r.firstScannedAt,
            lastScannedAt: r.lastScannedAt,
            scanCount: r.scanCount,
            boarded: true,
          })),
        }),
      ]);
      flights += 1;
      passengers += rows.length;
    }
    return { ok: true, flights, passengers };
  }
}
