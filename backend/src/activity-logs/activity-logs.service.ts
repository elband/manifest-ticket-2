import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ListActivityQuery, SummaryActivityQuery } from "./dto";

export interface ActivityInput {
  operatorId: string | null;
  /** Diisi langsung bila pelaku bukan petugas (mis. perangkat); selain itu dari DB. */
  operatorName?: string | null;
  operatorEmail: string | null;
  operatorRole: string | null;
  action: string;
  category: string;
  description: string;
  method: string;
  path: string;
  statusCode: number;
  success: boolean;
  targetId: string | null;
  ip: string | null;
  userAgent: string | null;
  durationMs: number;
  meta: Record<string, unknown> | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ActivityLogsService {
  private readonly logger = new Logger(ActivityLogsService.name);
  // Nama petugas tidak ada di JWT; cache singkat agar tiap log tak selalu query.
  private readonly names = new Map<string, { name: string; at: number }>();

  constructor(private prisma: PrismaService) {}

  /** Simpan satu entri. Tidak pernah melempar — log gagal ≠ request gagal. */
  async record(input: ActivityInput): Promise<void> {
    try {
      const operatorName =
        input.operatorName ?? (input.operatorId ? await this.nameOf(input.operatorId) : null);
      await this.prisma.activityLog.create({
        data: {
          ...input,
          operatorName,
          description: input.description.slice(0, 500),
          path: input.path.slice(0, 255),
          userAgent: input.userAgent?.slice(0, 255) ?? null,
          meta: (input.meta ?? undefined) as Prisma.InputJsonObject | undefined,
        },
      });
    } catch (e) {
      this.logger.warn(`Gagal mencatat aktivitas ${input.action}: ${(e as Error).message}`);
    }
  }

  /** Label objek target (nama petugas / nomor penerbangan) untuk deskripsi log. */
  async targetLabel(
    kind: "operator" | "flight" | "device",
    id: string,
  ): Promise<string | null> {
    try {
      if (kind === "device") {
        const d = await this.prisma.device.findUnique({
          where: { id },
          select: { name: true, code: true },
        });
        return d ? `${d.name} (${d.code})` : null;
      }
      if (kind === "operator") {
        const op = await this.prisma.operator.findUnique({
          where: { id },
          select: { name: true },
        });
        return op?.name ?? null;
      }
      const f = await this.prisma.flight.findUnique({
        where: { id },
        select: { flightNumber: true },
      });
      return f?.flightNumber ?? null;
    } catch {
      return null;
    }
  }

  private async nameOf(operatorId: string): Promise<string | null> {
    const hit = this.names.get(operatorId);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.name;
    const op = await this.prisma.operator.findUnique({
      where: { id: operatorId },
      select: { name: true },
    });
    if (op) this.names.set(operatorId, { name: op.name, at: Date.now() });
    return op?.name ?? null;
  }

  async list(q: ListActivityQuery) {
    const where = this.buildWhere(q);
    const page = Math.max(1, q.page ?? 1);
    const perPage = Math.min(100, Math.max(1, q.perPage ?? 30));
    const [items, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        orderBy: { at: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.activityLog.count({ where }),
    ]);
    return { items, page, perPage, total };
  }

  /**
   * Ringkasan untuk kartu statistik & grafik. `todayStart` dikirim klien (awal
   * hari di zona waktu perangkat) karena server berjalan di UTC.
   */
  async summary(q: SummaryActivityQuery) {
    const now = Date.now();
    const todayStart = q.todayStart ? new Date(q.todayStart) : new Date(now - DAY_MS);
    const last24h = new Date(now - DAY_MS);
    const last7d = new Date(now - 7 * DAY_MS);

    const [today, failedToday, failedLogins24h, activeToday, byCategory, topActors, hourly] =
      await Promise.all([
        this.prisma.activityLog.count({ where: { at: { gte: todayStart } } }),
        this.prisma.activityLog.count({ where: { at: { gte: todayStart }, success: false } }),
        this.prisma.activityLog.count({
          where: { at: { gte: last24h }, category: "auth", success: false },
        }),
        this.prisma.activityLog.groupBy({
          by: ["operatorId"],
          where: { at: { gte: todayStart }, operatorId: { not: null } },
        }),
        this.prisma.activityLog.groupBy({
          by: ["category"],
          where: { at: { gte: last7d } },
          _count: { _all: true },
        }),
        this.prisma.activityLog.groupBy({
          by: ["operatorId", "operatorName", "operatorRole"],
          where: { at: { gte: last7d }, operatorId: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { operatorId: "desc" } },
          take: 5,
        }),
        // Bucket per jam (epoch-jam) → zona waktu Indonesia (offset jam bulat)
        // tetap selaras saat dipetakan di klien. Bukan UNIX_TIMESTAMP(): kolom
        // DATETIME berisi UTC, sedangkan UNIX_TIMESTAMP membacanya memakai zona
        // waktu sesi MySQL (mis. +08:00) sehingga jamnya bergeser.
        this.prisma.$queryRaw<{ h: bigint | number; c: bigint | number }[]>`
          SELECT TIMESTAMPDIFF(HOUR, '1970-01-01 00:00:00', \`at\`) AS h, COUNT(*) AS c
          FROM ActivityLog
          WHERE \`at\` >= ${last24h}
          GROUP BY h
          ORDER BY h`,
      ]);

    return {
      today,
      failedToday,
      failedLogins24h,
      activeUsersToday: activeToday.length,
      byCategory: byCategory.map((r) => ({ category: r.category, count: r._count._all })),
      topActors: topActors.map((r) => ({
        operatorId: r.operatorId,
        name: r.operatorName,
        role: r.operatorRole,
        count: r._count._all,
      })),
      hourly: hourly.map((r) => ({ hour: Number(r.h), count: Number(r.c) })),
    };
  }

  /** Daftar pelaku yang pernah tercatat — untuk dropdown filter. */
  async actors() {
    const rows = await this.prisma.activityLog.groupBy({
      by: ["operatorId", "operatorName"],
      where: { operatorId: { not: null } },
      _max: { at: true },
      orderBy: { _max: { at: "desc" } },
      take: 100,
    });
    return {
      items: rows.map((r) => ({ operatorId: r.operatorId, name: r.operatorName })),
    };
  }

  /** Hapus log lebih tua dari `days` hari (dipanggil RetentionService). */
  async purgeOlderThan(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * DAY_MS);
    const res = await this.prisma.activityLog.deleteMany({ where: { at: { lt: cutoff } } });
    return res.count;
  }

  private buildWhere(q: ListActivityQuery): Prisma.ActivityLogWhereInput {
    const where: Prisma.ActivityLogWhereInput = {};
    if (q.category) where.category = q.category;
    if (q.operatorId) where.operatorId = q.operatorId;
    if (q.status === "success") where.success = true;
    if (q.status === "failed") where.success = false;
    if (q.from || q.to) {
      where.at = {
        ...(q.from ? { gte: new Date(q.from) } : {}),
        ...(q.to ? { lte: new Date(q.to) } : {}),
      };
    }
    const term = q.q?.trim();
    if (term) {
      where.OR = [
        { description: { contains: term } },
        { operatorName: { contains: term } },
        { operatorEmail: { contains: term } },
        { action: { contains: term } },
        { ip: { contains: term } },
      ];
    }
    return where;
  }
}
