import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomInt } from "crypto";
import { JwtPayload } from "../auth/auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { ApproveDeviceDto, RegisterDeviceDto, UpdateDeviceDto } from "./dto";

export type DeviceStatus = "pending" | "approved" | "revoked";

/** Batas perangkat berstatus "pending" — cegah tabel dibanjiri pendaftaran palsu. */
const MAX_PENDING = 50;
/**
 * Permintaan izin yang tak pernah aktif lagi selama ini dibuang otomatis
 * (mis. HP yang sekali membuka aplikasi). Perangkat yang masih terbuka
 * memperbarui lastSeenAt tiap 30 dtk, jadi tak ikut terhapus.
 */
const STALE_PENDING_MS = 7 * 24 * 60 * 60 * 1000;
/** Tanpa huruf/angka yang mudah tertukar (O/0, I/1/L) saat dicocokkan admin. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// Field publik — JANGAN pernah ekspos secretHash.
const PUBLIC_SELECT = {
  id: true,
  name: true,
  station: true,
  status: true,
  code: true,
  userAgent: true,
  lastIp: true,
  lastSeenAt: true,
  approvedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { scanEvents: true } },
} as const;

export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function generateCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

@Injectable()
export class DevicesService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private cfg: ConfigService,
  ) {}

  /** Perangkat minta izin. Idempoten: secret yang sama → entri yang sama. */
  async register(dto: RegisterDeviceDto, meta: ClientMeta) {
    const secretHash = hashSecret(dto.secret);
    const existing = await this.prisma.device.findUnique({ where: { secretHash } });
    if (existing) {
      return { id: existing.id, code: existing.code, status: existing.status as DeviceStatus };
    }
    await this.prisma.device.deleteMany({
      where: { status: "pending", lastSeenAt: { lt: new Date(Date.now() - STALE_PENDING_MS) } },
    });
    const pending = await this.prisma.device.count({ where: { status: "pending" } });
    if (pending >= MAX_PENDING) {
      throw new HttpException(
        "Terlalu banyak perangkat menunggu izin — minta admin merapikan daftar perangkat.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const code = generateCode();
    const created = await this.prisma.device.create({
      data: {
        name: dto.name?.trim() || `Perangkat ${code}`,
        code,
        secretHash,
        userAgent: meta.userAgent?.slice(0, 255) ?? null,
        lastIp: meta.ip,
        lastSeenAt: new Date(),
      },
    });
    return { id: created.id, code: created.code, status: created.status as DeviceStatus };
  }

  /**
   * Tukar secret dengan token JWT perangkat. Dipanggil berkala oleh perangkat:
   * selama "pending" hanya mengembalikan status; "approved" → token baru.
   */
  async token(secret: string, meta: ClientMeta) {
    const device = await this.prisma.device.findUnique({
      where: { secretHash: hashSecret(secret) },
    });
    if (!device) throw new NotFoundException("Perangkat belum terdaftar.");
    await this.prisma.device.update({
      where: { id: device.id },
      data: {
        lastSeenAt: new Date(),
        lastIp: meta.ip,
        userAgent: meta.userAgent?.slice(0, 255) ?? device.userAgent,
      },
    });
    if (device.status === "revoked") {
      throw new ForbiddenException("Izin perangkat ini telah dicabut admin.");
    }
    const info = { id: device.id, name: device.name, station: device.station, code: device.code };
    if (device.status !== "approved") {
      return { status: "pending" as const, device: info };
    }
    const payload: JwtPayload = {
      sub: device.id,
      email: "",
      role: "operator",
      station: device.station,
      kind: "device",
      name: device.name,
    };
    const token = await this.jwt.signAsync(payload, {
      expiresIn: this.cfg.get<string>("DEVICE_TOKEN_EXPIRES_IN") ?? "12h",
    });
    const { exp } = this.jwt.decode(token) as { exp: number };
    return {
      status: "approved" as const,
      token,
      expiresAt: new Date(exp * 1000).toISOString(),
      device: info,
    };
  }

  async list() {
    const rows = await this.prisma.device.findMany({
      orderBy: [{ createdAt: "desc" }],
      select: PUBLIC_SELECT,
    });
    const rank: Record<string, number> = { pending: 0, approved: 1, revoked: 2 };
    const items = rows
      .map(({ _count, ...d }) => ({ ...d, scanCount: _count.scanEvents }))
      .sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3));
    return { items };
  }

  async approve(id: string, dto: ApproveDeviceDto, adminId: string) {
    await this.mustExist(id);
    return this.prisma.device.update({
      where: { id },
      data: {
        status: "approved",
        station: dto.station.trim(),
        ...(dto.name ? { name: dto.name.trim() } : {}),
        approvedAt: new Date(),
        approvedById: adminId,
      },
      select: PUBLIC_SELECT,
    });
  }

  async update(id: string, dto: UpdateDeviceDto) {
    await this.mustExist(id);
    return this.prisma.device.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.station !== undefined ? { station: dto.station.trim() } : {}),
      },
      select: PUBLIC_SELECT,
    });
  }

  /** Cabut izin — berlaku seketika (JwtStrategy cek status tiap request). */
  async revoke(id: string) {
    await this.mustExist(id);
    return this.prisma.device.update({
      where: { id },
      data: { status: "revoked" },
      select: PUBLIC_SELECT,
    });
  }

  async remove(id: string) {
    await this.mustExist(id);
    const [boarding, pas] = await Promise.all([
      this.prisma.scanEvent.count({ where: { deviceId: id } }),
      this.prisma.pasScan.count({ where: { deviceId: id } }),
    ]);
    if (boarding + pas > 0) {
      throw new BadRequestException(
        "Perangkat ini sudah mengirim data scan — cabut izinnya saja agar jejaknya tetap ada.",
      );
    }
    await this.prisma.device.delete({ where: { id } });
    return { ok: true };
  }

  private async mustExist(id: string) {
    const d = await this.prisma.device.findUnique({ where: { id }, select: { id: true } });
    if (!d) throw new NotFoundException("Perangkat tidak ditemukan.");
  }
}
