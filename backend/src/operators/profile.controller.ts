import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { diskStorage } from "multer";
import { existsSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { ChangeOwnPinDto, UpdateProfileDto } from "./dto";
import { OperatorsService } from "./operators.service";

type AuthedReq = { user: JwtPayload };

/** Hanya token petugas — token perangkat (kiosk) tidak punya profil. */
function operatorId(req: AuthedReq): string {
  if (req.user.kind === "device") {
    throw new ForbiddenException("Masuk sebagai petugas untuk membuka profil.");
  }
  return req.user.sub;
}

// Sama dengan foto dari menu admin: UPLOAD_DIR/operators/<operatorId><ext>.
// Guard berjalan sebelum interceptor, jadi req.user sudah terisi di sini.
const ownPhotoStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const root = process.env.UPLOAD_DIR ?? "./uploads";
    const dir = join(root, "operators");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const sub = (req as unknown as Partial<AuthedReq>).user?.sub ?? `unknown-${Date.now()}`;
    cb(null, `${sub}${extname(file.originalname) || ".jpg"}`);
  },
});

/**
 * Profil petugas yang sedang login. Terpisah dari OperatorsController karena
 * yang itu khusus admin; di sini setiap petugas hanya bisa mengubah dirinya.
 */
@ApiTags("profile")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("profile")
export class ProfileController {
  constructor(private svc: OperatorsService) {}

  @Get()
  get(@Req() req: AuthedReq) {
    return this.svc.getProfile(operatorId(req));
  }

  @Patch()
  update(@Req() req: AuthedReq, @Body() dto: UpdateProfileDto) {
    return this.svc.updateProfile(operatorId(req), dto);
  }

  /** Anti tebak PIN lama: 10 percobaan/menit. */
  @Post("pin")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  changePin(@Req() req: AuthedReq, @Body() dto: ChangeOwnPinDto) {
    return this.svc.changeOwnPin(operatorId(req), dto.currentPin, dto.newPin);
  }

  @Get("photo")
  async photo(@Req() req: AuthedReq, @Res() res: Response) {
    const path = await this.svc.getPhotoPath(operatorId(req));
    if (!path) throw new NotFoundException();
    return res.sendFile(path, { root: "." });
  }

  @Post("photo")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("photo", {
      storage: ownPhotoStorage,
      limits: { fileSize: Number(process.env.OPERATOR_PHOTO_MAX_SIZE ?? 2_097_152) }, // 2MB
      fileFilter: (req, file, cb) => {
        if ((req as unknown as Partial<AuthedReq>).user?.kind === "device") {
          return cb(new ForbiddenException("Masuk sebagai petugas untuk mengubah foto."), false);
        }
        if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
          return cb(new Error("Format foto harus JPEG/PNG/WebP"), false);
        }
        cb(null, true);
      },
    }),
  )
  setPhoto(@Req() req: AuthedReq, @UploadedFile() photo?: Express.Multer.File) {
    const id = operatorId(req);
    if (!photo) throw new NotFoundException("File foto tidak ditemukan.");
    return this.svc.setPhoto(id, photo);
  }

  @Delete("photo")
  clearPhoto(@Req() req: AuthedReq) {
    return this.svc.clearPhoto(operatorId(req));
  }
}
