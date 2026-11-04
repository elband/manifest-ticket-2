import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { JwtPayload } from "../auth/auth.service";
import { ListPasScansQuery, VerifyPasDto } from "./dto";
import { getHtml } from "./pas-http";
import { PasCard, parsePasHtml } from "./pas-parser";

export type PasStatus = "VALID" | "EXPIRED" | "NOT_FOUND" | "ERROR";

export interface PasVerifyResult {
  id: string;
  pasId: string;
  status: PasStatus;
  message: string;
  card: PasCard | null;
  checkedAt: string;
}

const DEFAULT_BASE = "https://pas.aptpairport.id/vp/v/";
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Ambil ID pas dari isi QR. QR resmi: https://pas.aptpairport.id/vp/v/<hex>.
 * Toleran terhadap ":"/"/" yang tertukar oleh layout keyboard scanner, dan
 * menerima ID hex polos (input manual).
 */
export function extractPasId(raw: string): string | null {
  const s = raw.trim();
  const m =
    /vp[\/\\?]v[\/\\?]([0-9a-f]{16,64})/i.exec(s) ??
    /aptpairport[\s\S]*?([0-9a-f]{16,64})(?![0-9a-z])/i.exec(s) ??
    /^([0-9a-f]{16,64})$/i.exec(s);
  return m ? m[1].toLowerCase() : null;
}

/** Tanggal hari ini (YYYY-MM-DD) di zona WITA — bandara APT Pranoto. */
export function todayWita(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Makassar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function statusFor(card: PasCard, today: string): PasStatus {
  if (card.validUntil && card.validUntil < today) return "EXPIRED";
  return "VALID";
}

function isPrivileged(role: string): boolean {
  return role === "admin" || role === "supervisor";
}

@Injectable()
export class PasService {
  private readonly log = new Logger(PasService.name);
  private readonly base: string;

  constructor(
    private prisma: PrismaService,
    cfg: ConfigService,
  ) {
    const b = cfg.get<string>("PAS_VERIFY_BASE") ?? DEFAULT_BASE;
    this.base = b.endsWith("/") ? b : `${b}/`;
  }

  async verify(user: JwtPayload, dto: VerifyPasDto): Promise<PasVerifyResult> {
    const pasId = extractPasId(dto.raw);
    if (!pasId) throw new BadRequestException("QR bukan kartu Pas Bandara.");

    // Token perangkat: pelakunya petugas yang login PIN di kiosk (sama seperti
    // ScanEventsService.pushFromDevice).
    let operatorId = user.sub;
    let deviceId: string | null = null;
    if (user.kind === "device") {
      if (!dto.operatorId) {
        throw new BadRequestException("Scan dari perangkat wajib menyertakan petugas (operatorId).");
      }
      const op = await this.prisma.operator.findUnique({
        where: { id: dto.operatorId },
        select: { id: true },
      });
      if (!op) throw new BadRequestException("Petugas pada scan ini tidak dikenal server.");
      operatorId = op.id;
      deviceId = user.sub;
    }
    const station = user.station ?? dto.station ?? "UNKNOWN";

    const { status, message, card } = await this.lookup(pasId);

    const row = await this.prisma.pasScan.create({
      data: {
        pasId,
        status,
        pasNumber: card?.pasNumber ?? null,
        name: card?.name ?? null,
        position: card?.position ?? null,
        company: card?.company ?? null,
        category: card?.category ?? null,
        cardColor: card?.cardColor ?? null,
        passType: card?.passType ?? null,
        issuedAt: card?.issuedAt ?? null,
        validUntil: card?.validUntil ?? null,
        areaCodes: card?.areaCodes.join(" ") || null,
        station,
        operatorId,
        deviceId,
      },
    });

    return {
      id: row.id,
      pasId,
      status,
      message,
      card,
      checkedAt: row.createdAt.toISOString(),
    };
  }

  private async lookup(
    pasId: string,
  ): Promise<{ status: PasStatus; message: string; card: PasCard | null }> {
    let html: string;
    try {
      const res = await getHtml(this.base + pasId, FETCH_TIMEOUT_MS);
      if (res.status < 200 || res.status >= 300) {
        return { status: "ERROR", message: `Server PAS membalas HTTP ${res.status}.`, card: null };
      }
      html = res.body;
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      const code = (e as { code?: string }).code;
      this.log.warn(`Cek PAS ${pasId} gagal: ${(e as Error).message}${code ? ` (${code})` : ""}`);
      return {
        status: "ERROR",
        message: aborted
          ? "Server PAS tidak merespons. Periksa kartu secara manual."
          : "Gagal menghubungi server PAS. Periksa kartu secara manual.",
        card: null,
      };
    }

    const parsed = parsePasHtml(html);
    if (parsed.kind === "not_found") {
      return { status: "NOT_FOUND", message: "Data pas tidak ditemukan / tidak aktif.", card: null };
    }
    if (parsed.kind === "unrecognized") {
      this.log.error(`Format halaman PAS tidak dikenali (id ${pasId}).`);
      return {
        status: "ERROR",
        message: "Format halaman PAS berubah. Periksa kartu secara manual.",
        card: null,
      };
    }

    const card = parsed.card;
    // Foto hanya dari host server PAS sendiri — jangan teruskan URL lain ke kiosk.
    const host = new URL(this.base).origin;
    if (card.photoUrl && !card.photoUrl.startsWith(`${host}/`)) card.photoUrl = null;

    const status = statusFor(card, todayWita());
    return {
      status,
      message:
        status === "EXPIRED"
          ? `Masa berlaku pas habis (${card.validUntil}).`
          : "Pas bandara terdaftar & masih berlaku.",
      card,
    };
  }

  /**
   * Detail satu riwayat cek PAS + data kartu TERKINI dari server PAS (termasuk
   * foto, yang tidak disimpan di DB). Tidak mencatat scan baru.
   */
  async detail(id: string, user: JwtPayload) {
    const scan = await this.prisma.pasScan.findUnique({
      where: { id },
      include: {
        operator: { select: { name: true } },
        device: { select: { name: true } },
      },
    });
    // Operator hanya station-nya sendiri; 404 agar tak bisa dienumerasi.
    if (!scan) throw new NotFoundException();
    if (!isPrivileged(user.role) && scan.station !== user.station) {
      throw new NotFoundException();
    }
    const live = await this.lookup(scan.pasId);
    return {
      scan,
      sourceUrl: this.base + scan.pasId,
      live: { ...live, checkedAt: new Date().toISOString() },
    };
  }

  async list(q: ListPasScansQuery, user: JwtPayload) {
    const where: Record<string, unknown> = {};
    // Sama seperti scan boarding: operator hanya station-nya sendiri.
    if (isPrivileged(user.role)) {
      if (q.station) where.station = q.station;
    } else {
      where.station = user.station ?? "__no_station__";
    }
    if (q.status) where.status = q.status;
    if (q.date) {
      // Tanggal kalender WITA (UTC+8).
      const start = new Date(`${q.date}T00:00:00+08:00`);
      const end = new Date(`${q.date}T23:59:59.999+08:00`);
      where.createdAt = { gte: start, lte: end };
    }
    const page = Math.max(1, q.page ?? 1);
    const perPage = Math.min(200, Math.max(1, q.perPage ?? 50));
    const [items, total] = await Promise.all([
      this.prisma.pasScan.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        include: { operator: { select: { name: true } } },
      }),
      this.prisma.pasScan.count({ where }),
    ]);
    return { items, page, perPage, total };
  }
}
