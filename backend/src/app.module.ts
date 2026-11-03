import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AppSettingsModule } from "./app-settings/app-settings.module";
import { AuthModule } from "./auth/auth.module";
import { FacePhotosModule } from "./face-photos/face-photos.module";
import { FlightsModule } from "./flights/flights.module";
import { OperatorsModule } from "./operators/operators.module";
import { HealthController } from "./health.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { RetentionService } from "./retention/retention.service";
import { ScanEventsModule } from "./scan-events/scan-events.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuthModule,
    FlightsModule,
    OperatorsModule,
    ScanEventsModule,
    AppSettingsModule,
    FacePhotosModule,
  ],
  controllers: [HealthController],
  // F-02: aktifkan ThrottlerGuard secara GLOBAL (sebelumnya ThrottlerModule
  // diimpor tapi tak pernah dipasang → rate-limit tidak berlaku sama sekali).
  // F-06: RetentionService menjadwalkan pemusnahan foto wajah lama (PDP).
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    RetentionService,
  ],
})
export class AppModule {}
