import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { Role } from "../common/roles";
import { pinLookupHash } from "../common/pin-lookup";
import { PrismaService } from "../prisma/prisma.service";

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  station: string | null;
  /**
   * "device" = token perangkat yang diizinkan admin (lihat DevicesService):
   * `sub` = id Device (BUKAN operator), `role` = "operator", `name` = nama
   * perangkat. Tanpa `kind` = token petugas biasa.
   */
  kind?: "device";
  name?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.operator.findUnique({ where: { email } });
    if (!user || !user.active) throw new UnauthorizedException("Invalid credentials");
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException("Invalid credentials");
    return this.issue(user);
  }

  /** Bangun payload JWT + token + user publik (dipakai login & loginPin). */
  private async issue(user: {
    id: string;
    email: string;
    name: string;
    role: string;
    station: string | null;
  }) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role as Role,
      station: user.station,
    };
    const token = await this.jwt.signAsync(payload);
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        station: user.station,
      },
    };
  }

  /**
   * Login cepat via PIN (petugas AVSEC). P-05/P-06: lookup **O(1)** lewat kolom
   * ber-index `pinLookup` (HMAC PIN), lalu verifikasi bcrypt `pinHash`. PIN lama
   * (belum punya `pinLookup`) ditangani jalur legacy bcrypt + di-backfill otomatis
   * (migrate-on-login) supaya login berikutnya ikut O(1).
   */
  async loginPin(pin: string) {
    const lookup = pinLookupHash(pin);

    // Fast path O(1): satu lookup ber-index + satu bcrypt verifikasi.
    const fast = await this.prisma.operator.findFirst({
      where: { active: true, pinLookup: lookup },
    });
    if (fast?.pinHash && (await bcrypt.compare(pin, fast.pinHash))) {
      return this.issue(fast);
    }

    // Legacy / stale fallback: operator yang belum ter-migrasi ATAU pinLookup-nya
    // dibuat dengan secret berbeda (mis. PIN_LOOKUP_SECRET dirotasi). Hanya
    // tercapai bila fast-path meleset → scan bcrypt lalu backfill pinLookup baru
    // (self-healing). Tidak memfilter `pinLookup: null` agar yang stale ikut.
    const legacy = await this.prisma.operator.findMany({
      where: { active: true, pinHash: { not: null } },
    });
    for (const user of legacy) {
      if (user.pinHash && (await bcrypt.compare(pin, user.pinHash))) {
        await this.prisma.operator.update({
          where: { id: user.id },
          data: { pinLookup: lookup },
        });
        return this.issue(user);
      }
    }
    throw new UnauthorizedException("PIN tidak valid");
  }

  async me(userId: string) {
    const user = await this.prisma.operator.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, station: true },
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
