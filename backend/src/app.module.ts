import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { ActivityLogsModule } from "./activity-logs/activity-logs.module";
import { AppSettingsModule } from "./app-settings/app-settings.module";
import { AuthModule } from "./auth/auth.module";
import { DevicesModule } from "./devices/devices.module";
import { UserThrottlerGuard } from "./common/user-throttler.guard";
import { FacePhotosModule } from "./face-photos/face-photos.module";
import { FlightsModule } from "./flights/flights.module";
import { OperatorsModule } from "./operators/operators.module";
import { PasModule } from "./pas/pas.module";
import { HealthController } from "./health.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { RetentionService } from "./retention/retention.service";
import { ScanEventsModule } from "./scan-events/scan-events.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Dihitung per petugas (lihat UserThrottlerGuard) — bukan per IP, karena
    // semua perangkat di Wi-Fi bandara tampil sebagai satu IP gateway.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    AuthModule,
    FlightsModule,
    OperatorsModule,
    ScanEventsModule,
    AppSettingsModule,
    FacePhotosModule,
    ActivityLogsModule,
    DevicesModule,
    PasModule,
  ],
  controllers: [HealthController],
  // F-02: aktifkan ThrottlerGuard secara GLOBAL (sebelumnya ThrottlerModule
  // diimpor tapi tak pernah dipasang → rate-limit tidak berlaku sama sekali).
  // F-06: RetentionService menjadwalkan pemusnahan foto wajah lama (PDP).
  providers: [
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
    RetentionService,
  ],
})
export class AppModule {}
