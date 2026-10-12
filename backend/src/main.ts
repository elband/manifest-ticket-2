// WAJIB paling awal: inisialisasi Sentry sebelum modul lain di-load.
import "./instrument";

import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: false });
  const config = app.get(ConfigService);

  // Di belakang Nginx semua request datang dari 127.0.0.1. Percayai X-Forwarded-For
  // HANYA dari loopback agar req.ip = IP klien asli — ThrottlerGuard (F-02) menghitung
  // per IP; tanpa ini seluruh kiosk berbagi satu kuota 120 req/menit.
  app.set("trust proxy", "loopback");

  // F-03: di produksi, tolak boot bila konfigurasi tidak aman (gagal-cepat).
  if (process.env.NODE_ENV === "production") {
    const problems: string[] = [];
    const cors = config.get<string>("CORS_ORIGIN") ?? "";
    if (!cors || cors.includes("localhost")) {
      problems.push("CORS_ORIGIN harus domain produksi (bukan localhost/kosong)");
    }
    const db = config.get<string>("DATABASE_URL") ?? "";
    if (/\/\/root[:@]/.test(db)) {
      problems.push("DATABASE_URL jangan pakai user 'root' (buat user khusus berhak minimal)");
    }
    if (problems.length > 0) {
      throw new Error("Konfigurasi produksi tidak aman (F-03): " + problems.join("; "));
    }
  }

  app.use(helmet());
  app.enableCors({
    origin: (config.get<string>("CORS_ORIGIN") ?? "").split(",").map((s) => s.trim()),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix("api");

  // F-12: jangan ekspos Swagger di produksi (membuka peta serangan).
  if (process.env.NODE_ENV !== "production") {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("AFVS API")
      .setDescription("Airport Flight Validation System backend")
      .setVersion("0.1.0")
      .addBearerAuth()
      .build();
    const doc = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup("docs", app, doc);
  }

  const port = Number(config.get<string>("PORT") ?? 3001);
  await app.listen(port);
  console.log(`AFVS backend listening on :${port} (docs: /docs)`);
}
bootstrap();
