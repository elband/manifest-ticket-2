import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../common/roles.decorator";
import { ClientMeta, DevicesService } from "./devices.service";
import {
  ApproveDeviceDto,
  DeviceSecretDto,
  RegisterDeviceDto,
  UpdateDeviceDto,
} from "./dto";

function metaOf(req: Request): ClientMeta {
  return {
    ip: req.ip ?? null,
    userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
  };
}

@ApiTags("devices")
@Controller("devices")
export class DevicesController {
  constructor(private svc: DevicesService) {}

  // Publik: perangkat belum punya token. Throttle per IP — semua perangkat
  // bandara ter-NAT ke satu IP, jadi batasnya dibuat cukup longgar.
  @Post("register")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  register(@Body() dto: RegisterDeviceDto, @Req() req: Request) {
    return this.svc.register(dto, metaOf(req));
  }

  // Dipoll perangkat (tiap 30 dtk selama menunggu izin, lalu saat token hampir habis).
  @Post("token")
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  token(@Body() dto: DeviceSecretDto, @Req() req: Request) {
    return this.svc.token(dto.secret, metaOf(req));
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  list() {
    return this.svc.list();
  }

  @Post(":id/approve")
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  approve(
    @Param("id") id: string,
    @Body() dto: ApproveDeviceDto,
    @Req() req: { user: JwtPayload },
  ) {
    return this.svc.approve(id, dto, req.user.sub);
  }

  @Patch(":id")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  update(@Param("id") id: string, @Body() dto: UpdateDeviceDto) {
    return this.svc.update(id, dto);
  }

  @Post(":id/revoke")
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  revoke(@Param("id") id: string) {
    return this.svc.revoke(id);
  }

  @Delete(":id")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  remove(@Param("id") id: string) {
    return this.svc.remove(id);
  }
}
