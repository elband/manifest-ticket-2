import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { diskStorage } from "multer";
import { existsSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { IdentityDecisionDto, ListScansQuery, PushScanDto } from "./dto";
import { ScanEventsService } from "./scan-events.service";

@ApiTags("scan-events")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("scan-events")
export class ScanEventsController {
  constructor(
    private svc: ScanEventsService,
    private cfg: ConfigService,
  ) {}

  @Post()
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("facePhoto", {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const root = process.env.UPLOAD_DIR ?? "./uploads";
          const today = new Date().toISOString().slice(0, 10);
          const dir = join(root, today);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (req, file, cb) => {
          const eventId =
            (req.body as Record<string, string>).eventId ??
            `unknown-${Date.now()}`;
          cb(null, `${eventId}${extname(file.originalname) || ".jpg"}`);
        },
      }),
      limits: {
        fileSize: Number(process.env.UPLOAD_MAX_SIZE ?? 1_048_576),
      },
      fileFilter: (_req, file, cb) => {
        if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
          return cb(new Error("Unsupported image type"), false);
        }
        cb(null, true);
      },
    }),
  )
  push(
    @Req() req: { user: JwtPayload },
    @Body() dto: PushScanDto,
    @UploadedFile() facePhoto?: Express.Multer.File,
  ) {
    const path = facePhoto ? facePhoto.path : null;
    return this.svc.push(req.user.sub, dto, path);
  }

  @Get()
  list(@Req() req: { user: JwtPayload }, @Query() q: ListScansQuery) {
    return this.svc.list(q, req.user); // F-05: scoping per-station/role
  }

  /** Keputusan petugas "Sesuai"/"Tidak sesuai" (cek KTP/SIM) setelah scan. */
  @Patch(":eventId/identity")
  decideIdentity(
    @Req() req: { user: JwtPayload },
    @Param("eventId") eventId: string,
    @Body() dto: IdentityDecisionDto,
  ) {
    return this.svc.decideIdentity(eventId, dto, req.user); // F-05
  }

  @Get(":eventId")
  findOne(
    @Req() req: { user: JwtPayload },
    @Param("eventId") eventId: string,
  ) {
    return this.svc.findByEventId(eventId, req.user); // F-05
  }
}
