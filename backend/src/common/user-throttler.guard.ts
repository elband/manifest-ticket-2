import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { JwtPayload } from "../auth/auth.service";

/**
 * Rate-limit per PETUGAS, bukan per IP.
 *
 * Wi-Fi bandara me-NAT semua perangkat ke satu IP gateway (192.168.50.1),
 * jadi kuota per-IP dipakai bersama seluruh kiosk → "Too Many Requests"
 * padahal beban server rendah. Request dengan JWT yang SAH dihitung per
 * operator (`sub`); tanpa token / token palsu / kedaluwarsa tetap per IP,
 * sehingga throttle login (anti brute-force) tidak bisa diakali dengan
 * token karangan.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  private jwt: JwtService | null = null;

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const header: unknown = req.headers?.authorization;
    if (typeof header === "string" && header.startsWith("Bearer ")) {
      const secret = process.env.JWT_SECRET;
      if (secret) {
        this.jwt ??= new JwtService({ secret });
        try {
          const payload = this.jwt.verify<JwtPayload>(header.slice(7));
          if (payload?.sub) return `user:${payload.sub}`;
        } catch {
          /* token tidak sah → hitung per IP */
        }
      }
    }
    return `ip:${req.ip}`;
  }
}
