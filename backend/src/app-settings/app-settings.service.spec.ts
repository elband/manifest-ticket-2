import { BadRequestException } from "@nestjs/common";
import { AppSettingsService } from "./app-settings.service";

function makePrisma() {
  return {
    appSetting: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };
}

const updatedAt = new Date("2026-11-03T04:00:00.000Z");

describe("AppSettingsService", () => {
  it("get → data null bila belum pernah disimpan", async () => {
    const prisma = makePrisma();
    prisma.appSetting.findUnique.mockResolvedValue(null);
    const svc = new AppSettingsService(prisma as never);
    await expect(svc.get()).resolves.toEqual({ data: null, updatedAt: null });
  });

  it("put → upsert baris global & kembalikan updatedAt ISO", async () => {
    const prisma = makePrisma();
    const data = { kioskResultDurationSec: 0 };
    prisma.appSetting.upsert.mockResolvedValue({ id: "global", data, updatedAt });
    const svc = new AppSettingsService(prisma as never);
    await expect(svc.put(data, "op1")).resolves.toEqual({
      data,
      updatedAt: updatedAt.toISOString(),
    });
    expect(prisma.appSetting.upsert).toHaveBeenCalledWith({
      where: { id: "global" },
      create: { id: "global", data, updatedById: "op1" },
      update: { data, updatedById: "op1" },
    });
  });

  it("put → tolak data terlalu besar", async () => {
    const svc = new AppSettingsService(makePrisma() as never);
    await expect(svc.put({ x: "a".repeat(40_000) }, "op1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
