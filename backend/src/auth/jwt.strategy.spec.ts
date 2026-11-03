import { UnauthorizedException } from "@nestjs/common";
import { JwtStrategy } from "./jwt.strategy";

function setup(device: Record<string, unknown> | null) {
  const prisma = {
    operator: { findUnique: jest.fn().mockResolvedValue({ active: true }) },
    device: {
      findUnique: jest.fn().mockResolvedValue(device),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const cfg = { get: () => "x".repeat(40) };
  return { prisma, strategy: new JwtStrategy(cfg as never, prisma as never) };
}

const devicePayload = {
  sub: "dev1",
  email: "",
  role: "operator",
  station: "LAMA",
  kind: "device",
  name: "Kiosk",
} as const;

describe("JwtStrategy.validate — token perangkat", () => {
  it("perangkat diizinkan → lolos, station/nama terbaru dari DB", async () => {
    const { strategy, prisma } = setup({
      status: "approved",
      station: "SCP2",
      name: "Kiosk 2",
      lastSeenAt: new Date(),
    });
    await expect(strategy.validate(devicePayload)).resolves.toMatchObject({
      sub: "dev1",
      station: "SCP2",
      name: "Kiosk 2",
    });
    expect(prisma.operator.findUnique).not.toHaveBeenCalled();
    expect(prisma.device.update).not.toHaveBeenCalled(); // lastSeenAt masih segar
  });

  it.each([null, { status: "revoked" }, { status: "pending" }])(
    "dicabut / belum diizinkan / tak dikenal → 401 seketika (%p)",
    async (device) => {
      const { strategy } = setup(device);
      await expect(strategy.validate(devicePayload)).rejects.toBeInstanceOf(UnauthorizedException);
    },
  );

  it("token petugas (tanpa kind) tetap dicek ke tabel Operator", async () => {
    const { strategy, prisma } = setup(null);
    await strategy.validate({ sub: "op1", email: "a@b", role: "operator", station: null });
    expect(prisma.operator.findUnique).toHaveBeenCalled();
    expect(prisma.device.findUnique).not.toHaveBeenCalled();
  });
});
