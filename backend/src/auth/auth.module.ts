import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        // F-01: gagal-cepat bila secret kosong/lemah (jangan menandatangani
        // token dengan secret default yang dapat ditebak).
        const secret = cfg.get<string>("JWT_SECRET");
        if (!secret || secret.length < 32) {
          throw new Error(
            "JWT_SECRET wajib di-set & minimal 32 karakter acak (lihat AUDIT-KEAMANAN F-01).",
          );
        }
        return {
          secret,
          signOptions: { expiresIn: cfg.get<string>("JWT_EXPIRES_IN") ?? "12h" },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
