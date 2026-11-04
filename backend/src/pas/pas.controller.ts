import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { ListPasScansQuery, VerifyPasDto } from "./dto";
import { PasService } from "./pas.service";

@ApiTags("pas")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("pas")
export class PasController {
  constructor(private svc: PasService) {}

  /** Cek kartu Pas Bandara karyawan dari isi QR-nya (scan di kiosk). */
  @Post("verify")
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  verify(@Req() req: { user: JwtPayload }, @Body() dto: VerifyPasDto) {
    return this.svc.verify(req.user, dto);
  }

  @Get("scans")
  list(@Req() req: { user: JwtPayload }, @Query() q: ListPasScansQuery) {
    return this.svc.list(q, req.user);
  }

  /** Detail riwayat cek + data kartu terkini (foto) dari server PAS. */
  @Get("scans/:id")
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  detail(@Req() req: { user: JwtPayload }, @Param("id") id: string) {
    return this.svc.detail(id, req.user);
  }
}
