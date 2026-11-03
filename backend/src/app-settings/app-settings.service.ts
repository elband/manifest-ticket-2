import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const GLOBAL_ID = "global";
/** Batas kasar ukuran JSON pengaturan supaya tabel tidak dijadikan tempat sampah. */
const MAX_BYTES = 32_768;

export interface AppSettingsView {
  data: Record<string, unknown> | null;
  updatedAt: string | null;
}

@Injectable()
export class AppSettingsService {
  constructor(private prisma: PrismaService) {}

  async get(): Promise<AppSettingsView> {
    const row = await this.prisma.appSetting.findUnique({ where: { id: GLOBAL_ID } });
    if (!row) return { data: null, updatedAt: null };
    return {
      data: row.data as Record<string, unknown>,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Ganti seluruh pengaturan global (last-write-wins). */
  async put(data: Record<string, unknown>, operatorId: string): Promise<AppSettingsView> {
    if (JSON.stringify(data).length > MAX_BYTES) {
      throw new BadRequestException("Data pengaturan terlalu besar.");
    }
    const json = data as Prisma.InputJsonObject;
    const row = await this.prisma.appSetting.upsert({
      where: { id: GLOBAL_ID },
      create: { id: GLOBAL_ID, data: json, updatedById: operatorId },
      update: { data: json, updatedById: operatorId },
    });
    return {
      data: row.data as Record<string, unknown>,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
