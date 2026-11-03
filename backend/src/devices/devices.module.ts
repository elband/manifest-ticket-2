import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DevicesController } from "./devices.controller";
import { DevicesService } from "./devices.service";

@Module({
  imports: [AuthModule], // JwtService (token perangkat ditandatangani secret yang sama)
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
