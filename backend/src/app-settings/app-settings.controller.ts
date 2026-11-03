import { Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../common/roles.decorator";
import { AppSettingsService } from "./app-settings.service";
import { UpdateAppSettingsDto } from "./dto";

@ApiTags("settings")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("settings")
export class AppSettingsController {
  constructor(private svc: AppSettingsService) {}

  /** Semua perangkat yang login (termasuk kiosk petugas) menarik pengaturan global. */
  @Get()
  get() {
    return this.svc.get();
  }

  /** Mengubah pengaturan global hanya untuk supervisor/admin. */
  @Put()
  @Roles("supervisor", "admin")
  put(@Body() dto: UpdateAppSettingsDto, @Req() req: { user: JwtPayload }) {
    return this.svc.put(dto.data, req.user.sub);
  }
}
