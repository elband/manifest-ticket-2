import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtPayload } from "../auth/auth.service";
import { IdentityDecisionDto, ListScansQuery, PushScanDto } from "./dto";
import { manifestDedupKey } from "../common/manifest";

// F-05: supervisor/admin boleh lintas-station; operator hanya station-nya.
function isPrivileged(role: string): boolean {
  return role === "admin" || role === "supervisor";
}

@Injectable()
export class ScanEventsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Idempotent push. Kalau eventId sudah ada, return existing (HTTP 200) supaya
   * outbox client bisa hapus item dari queue tanpa duplikasi.
   */
  /**
   * Scan yang dikirim dengan token PERANGKAT: pelakunya petugas yang login PIN
   * di perangkat itu (`dto.operatorId`), station mengikuti penetapan admin.
   */
  async pushFromDevice(device: JwtPayload, dto: PushScanDto, facePhotoPath: string | null) {
    if (!dto.operatorId) {
      throw new BadRequestException("Scan dari perangkat wajib menyertakan petugas (operatorId).");
    }
    const op = await this.prisma.operator.findUnique({
      where: { id: dto.operatorId },
      select: { id: true },
    });
    if (!op) throw new BadRequestException("Petugas pada scan ini tidak dikenal server.");
    const station = device.station ?? dto.station;
    return this.push(op.id, { ...dto, station }, facePhotoPath, device.sub);
  }

  async push(
    operatorId: string,
    dto: PushScanDto,
    facePhotoPath: string | null,
    deviceId: string | null = null,
  ) {
    const existing = await this.prisma.scanEvent.findUnique({
      where: { eventId: dto.eventId },
    });
    if (existing) return existing;

    // Resolve flight relation by flightNumber + tanggal (best-effort).
    // Prioritaskan station yang cocok; kalau tak ada, fallback tanpa station —
    // karena flight disimpan level bandara (mis. AAP) sedangkan scan bisa
    // ber-station pos (SCP2/BLUESKY) atau UNKNOWN (scan admin). Di bandara
    // tunggal, flightNumber+tanggal sudah unik.
    let flightId: string | null = null;
    if (dto.flightNumber) {
      const date = new Date(dto.scannedAt);
      const dayStart = new Date(date);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setUTCHours(23, 59, 59, 999);
      const std = { gte: dayStart, lte: dayEnd };
      const byStation = await this.prisma.flight.findFirst({
        where: { station: dto.station, flightNumber: dto.flightNumber, std },
        select: { id: true },
      });
      const flight =
        byStation ??
        (await this.prisma.flight.findFirst({
          where: { flightNumber: dto.flightNumber, std },
          select: { id: true },
        }));
      flightId = flight?.id ?? null;
    }

    const scannedAt = new Date(dto.scannedAt);
    let created;
    try {
      created = await this.prisma.scanEvent.create({
        data: {
          eventId: dto.eventId,
          rawBarcode: dto.rawBarcode,
          flightNumber: dto.flightNumber ?? null,
          pnr: dto.pnr ?? null,
          ticketNumber: dto.ticketNumber ?? null,
          seat: dto.seat ?? null,
          passengerName: dto.passengerName ?? null,
          resultStatus: dto.resultStatus,
          message: dto.message ?? null,
          scannedAt,
          station: dto.station,
          facePhotoPath,
          ktpStatus: dto.ktpStatus ?? null,
          ktpName: dto.ktpName ?? null,
          ktpSimilarity: dto.ktpSimilarity ?? null,
          ktpCapturedAt: dto.ktpCapturedAt ? new Date(dto.ktpCapturedAt) : null,
          flightId,
          operatorId,
          deviceId,
        },
      });
    } catch (e) {
      // Dua kiriman eventId yang sama berbarengan (mis. outbox dikirim ulang
      // setelah koneksi pulih): yang kalah balapan → kembalikan baris pemenang,
      // bukan 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const winner = await this.prisma.scanEvent.findUnique({
          where: { eventId: dto.eventId },
        });
        if (winner) return winner;
      }
      throw e;
    }

    // Manifest penumpang: hanya scan VALID_FLIGHT & flight yang ter-resolve.
    // Idempoten — eventId duplikat sudah di-skip di atas, jadi tak double-count.
    // Gagal di sini tak boleh membatalkan pencatatan scan (best-effort).
    if (dto.resultStatus === "VALID_FLIGHT" && flightId) {
      try {
        await this.upsertManifestPassenger(flightId, {
          pnr: dto.pnr ?? null,
          ticketNumber: dto.ticketNumber ?? null,
          seat: dto.seat ?? null,
          passengerName: dto.passengerName ?? null,
          scannedAt,
        });
      } catch {
        /* manifest tidak boleh mengganggu push scan */
      }
    }

    return created;
  }

  /**
   * Upsert satu penumpang ke manifest flight. Kunci dedup = tiket→PNR
   * (lihat common/manifest.ts). Scan berikutnya untuk penumpang yang sama →
   * increment scanCount + majukan lastScannedAt, dan isi nama/seat bila
   * sebelumnya kosong.
   */
  private async upsertManifestPassenger(
    flightId: string,
    p: {
      pnr: string | null;
      ticketNumber: string | null;
      seat: string | null;
      passengerName: string | null;
      scannedAt: Date;
    },
  ) {
    const dedupKey = manifestDedupKey(p.ticketNumber, p.pnr);
    if (!dedupKey) return; // tak ada tiket/PNR → tak bisa didedup

    const existing = await this.prisma.flightPassenger.findUnique({
      where: { flightId_dedupKey: { flightId, dedupKey } },
      select: { id: true, lastScannedAt: true, passengerName: true, seat: true },
    });

    if (!existing) {
      await this.prisma.flightPassenger.create({
        data: {
          flightId,
          dedupKey,
          pnr: p.pnr,
          ticketNumber: p.ticketNumber,
          seat: p.seat,
          passengerName: p.passengerName,
          firstScannedAt: p.scannedAt,
          lastScannedAt: p.scannedAt,
          scanCount: 1,
          boarded: true,
        },
      });
      return;
    }

    await this.prisma.flightPassenger.update({
      where: { flightId_dedupKey: { flightId, dedupKey } },
      data: {
        scanCount: { increment: 1 },
        boarded: true,
        // Majukan lastScannedAt hanya bila scan ini lebih baru (aman utk push out-of-order).
        ...(p.scannedAt > existing.lastScannedAt
          ? { lastScannedAt: p.scannedAt }
          : {}),
        // Perkaya field yang sebelumnya kosong tanpa menimpa data yang sudah ada.
        ...(existing.passengerName ? {} : { passengerName: p.passengerName }),
        ...(existing.seat ? {} : { seat: p.seat }),
      },
    });
  }

  /**
   * Catat keputusan petugas setelah mencocokkan nama dengan KTP/SIM.
   * "Tidak sesuai" menurunkan scan VALID jadi KTP_MISMATCH dan menarik
   * penumpang dari manifest. Idempoten — aman dikirim ulang oleh outbox.
   */
  async decideIdentity(
    eventId: string,
    dto: IdentityDecisionDto,
    user: JwtPayload,
  ) {
    const ev = await this.findByEventId(eventId, user);
    const decidedAt = new Date(dto.decidedAt);

    if (dto.match) {
      // Sesuai otomatis tak boleh menimpa keputusan/hasil cek KTP yang sudah ada.
      if (dto.auto && ev.ktpStatus) return ev;
      return this.prisma.scanEvent.update({
        where: { eventId },
        data: {
          ktpStatus: dto.auto ? "auto_pass" : "manual_pass",
          ktpCapturedAt: decidedAt,
        },
      });
    }

    const wasValid = ev.resultStatus === "VALID_FLIGHT";
    const updated = await this.prisma.scanEvent.update({
      where: { eventId },
      data: {
        ktpStatus: "manual_reject",
        ktpCapturedAt: decidedAt,
        ...(wasValid
          ? {
              resultStatus: "KTP_MISMATCH",
              message:
                "Ditolak petugas: identitas penumpang tidak sesuai dengan boarding pass.",
            }
          : {}),
      },
    });
    if (wasValid && ev.flightId) {
      await this.recomputeManifestPassenger(ev.flightId, ev.ticketNumber, ev.pnr);
    }
    return updated;
  }

  /**
   * Hitung ulang satu baris manifest dari scan VALID_FLIGHT yang tersisa
   * (sama dengan aturan rebuildManifests). Tak ada lagi → baris dihapus.
   */
  private async recomputeManifestPassenger(
    flightId: string,
    ticketNumber: string | null,
    pnr: string | null,
  ) {
    const dedupKey = manifestDedupKey(ticketNumber, pnr);
    if (!dedupKey) return;

    const valid = (
      await this.prisma.scanEvent.findMany({
        where: { flightId, resultStatus: "VALID_FLIGHT" },
        select: { ticketNumber: true, pnr: true, scannedAt: true },
        orderBy: { scannedAt: "asc" },
      })
    ).filter((e) => manifestDedupKey(e.ticketNumber, e.pnr) === dedupKey);

    if (valid.length === 0) {
      await this.prisma.flightPassenger.deleteMany({ where: { flightId, dedupKey } });
      return;
    }
    await this.prisma.flightPassenger.updateMany({
      where: { flightId, dedupKey },
      data: {
        scanCount: valid.length,
        firstScannedAt: valid[0].scannedAt,
        lastScannedAt: valid[valid.length - 1].scannedAt,
      },
    });
  }

  async findByEventId(eventId: string, user: JwtPayload) {
    const ev = await this.prisma.scanEvent.findUnique({ where: { eventId } });
    // F-05: operator tak boleh mengakses scan station lain. Balas 404 (bukan 403)
    // agar keberadaan record tidak bisa dienumerasi lintas-station.
    if (!ev) throw new NotFoundException();
    if (!isPrivileged(user.role) && ev.station !== user.station) {
      throw new NotFoundException();
    }
    return ev;
  }

  async list(q: ListScansQuery, user: JwtPayload) {
    const where: Record<string, unknown> = {};
    // F-05: operator dikunci ke station-nya sendiri; filter station dari klien
    // diabaikan untuk operator. Supervisor/admin bebas memilih station.
    if (isPrivileged(user.role)) {
      if (q.station) where.station = q.station;
    } else {
      where.station = user.station ?? "__no_station__";
    }
    if (q.flightNumber) where.flightNumber = q.flightNumber;
    if (q.resultStatus) where.resultStatus = q.resultStatus;
    if (q.date) {
      const start = new Date(`${q.date}T00:00:00Z`);
      const end = new Date(`${q.date}T23:59:59.999Z`);
      where.scannedAt = { gte: start, lte: end };
    }
    const page = Math.max(1, q.page ?? 1);
    const perPage = Math.min(200, Math.max(1, q.perPage ?? 50));
    const [items, total] = await Promise.all([
      this.prisma.scanEvent.findMany({
        where,
        orderBy: { scannedAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.scanEvent.count({ where }),
    ]);
    return { items, page, perPage, total };
  }
}
