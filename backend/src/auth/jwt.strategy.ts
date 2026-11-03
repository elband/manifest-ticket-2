import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../prisma/prisma.service";
import { JwtPayload } from "./auth.service";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    cfg: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    // F-01: gagal-cepat bila JWT_SECRET tidak di-set / lemah. TANPA fallback
    // "dev-secret" (yang publik & bisa dipakai memalsukan token admin).
    const secret = cfg.get<string>("JWT_SECRET");
    if (!secret || secret.length < 32) {
      throw new Error(
        "JWT_SECRET wajib di-set & minimal 32 karakter acak (lihat AUDIT-KEAMANAN F-01).",
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  // F-11: cek status akun tiap request — operator yang dinonaktifkan/dihapus
  // langsung kehilangan akses (tanpa harus menunggu token kedaluwarsa).
  async validate(payload: JwtPayload) {
    if (payload.kind === "device") return this.validateDevice(payload);
    const op = await this.prisma.operator.findUnique({
      where: { id: payload.sub },
      select: { active: true },
    });
    if (!op || !op.active) {
      throw new UnauthorizedException("Akun nonaktif atau tidak ditemukan.");
    }
    return payload; // attached as req.user
  }

  // Token perangkat: izin yang dicabut admin langsung berlaku. Station & nama
  // diambil dari DB supaya perubahan admin terasa tanpa menunggu token baru.
  private async validateDevice(payload: JwtPayload): Promise<JwtPayload> {
    const device = await this.prisma.device.findUnique({
      where: { id: payload.sub },
      select: { status: true, station: true, name: true, lastSeenAt: true },
    });
    if (!device || device.status !== "approved") {
      throw new UnauthorizedException("Izin perangkat dicabut atau perangkat tidak dikenal.");
    }
    // "Terakhir aktif" cukup diperbarui maksimal 1x/menit (hemat tulis DB).
    if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > 60_000) {
      void this.prisma.device
        .update({ where: { id: payload.sub }, data: { lastSeenAt: new Date() } })
        .catch(() => {});
    }
    return { ...payload, station: device.station, name: device.name };
  }
}
