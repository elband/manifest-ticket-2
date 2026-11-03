import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AuthService, JwtPayload } from "./auth.service";
import { LoginDto, LoginPinDto } from "./dto";
import { JwtAuthGuard } from "./jwt-auth.guard";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // F-02: throttle khusus endpoint login (anti brute-force) — 20/menit/IP.
  // Bukan 5: semua perangkat bandara ter-NAT ke satu IP, jadi kuota ini
  // dipakai bersama saat pergantian shift.
  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Post("login-pin")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  loginPin(@Body() dto: LoginPinDto) {
    return this.auth.loginPin(dto.pin);
  }

  @Get("me")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  me(@Req() req: { user: JwtPayload }) {
    return this.auth.me(req.user.sub);
  }
}
