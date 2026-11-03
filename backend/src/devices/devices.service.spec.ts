import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { DevicesService, hashSecret } from "./devices.service";

const SECRET = "s".repeat(43);
const meta = { ip: "192.168.50.1", userAgent: "SIPANDAI-Desktop/1.0" };

function makePrisma() {
  return {
    device: {
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(({ data }) => ({ id: "dev1", status: "pending", ...data })),
      update: jest.fn().mockImplementation(({ data }) => ({ id: "dev1", ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    scanEvent: { count: jest.fn().mockResolvedValue(0) },
    pasScan: { count: jest.fn().mockResolvedValue(0) },
  };
}

const device = (over: Record<string, unknown> = {}) => ({
  id: "dev1",
  name: "Kiosk SCP 1",
  station: "SCP1",
  status: "approved",
  code: "ABC-DEF",
  userAgent: null,
  ...over,
});

describe("DevicesService", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let jwt: JwtService;
  let svc: DevicesService;

  beforeEach(() => {
    prisma = makePrisma();
    jwt = new JwtService({ secret: "x".repeat(40) });
    const cfg = { get: () => undefined };
    svc = new DevicesService(prisma as never, jwt, cfg as never);
  });

  describe("register", () => {
    it("secret baru → perangkat pending dgn kode XXX-XXX, secret hanya disimpan sbg hash", async () => {
      const res = await svc.register({ secret: SECRET }, meta);
      expect(res.status).toBe("pending");
      expect(res.code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
      const data = prisma.device.create.mock.calls[0][0].data;
      expect(data.secretHash).toBe(hashSecret(SECRET));
      expect(JSON.stringify(data)).not.toContain(SECRET);
    });

    it("secret yang sama → idempoten, tak membuat entri baru", async () => {
      prisma.device.findUnique.mockResolvedValueOnce(device({ status: "pending" }));
      const res = await svc.register({ secret: SECRET }, meta);
      expect(res).toEqual({ id: "dev1", code: "ABC-DEF", status: "pending" });
      expect(prisma.device.create).not.toHaveBeenCalled();
    });

    it("permintaan pending yang terbengkalai dibersihkan sebelum menghitung kuota", async () => {
      await svc.register({ secret: SECRET }, meta);
      const where = prisma.device.deleteMany.mock.calls[0][0].where;
      expect(where.status).toBe("pending");
      expect(where.lastSeenAt.lt.getTime()).toBeLessThan(Date.now() - 6 * 24 * 3600_000);
    });

    it("antrean pending penuh → 429", async () => {
      prisma.device.count.mockResolvedValueOnce(50);
      await expect(svc.register({ secret: SECRET }, meta)).rejects.toBeInstanceOf(HttpException);
    });
  });

  describe("token", () => {
    it("belum terdaftar → 404 (perangkat daftar ulang)", async () => {
      await expect(svc.token(SECRET, meta)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("masih pending → status saja, tanpa token", async () => {
      prisma.device.findUnique.mockResolvedValueOnce(device({ status: "pending" }));
      const res = await svc.token(SECRET, meta);
      expect(res).toMatchObject({ status: "pending" });
      expect(res).not.toHaveProperty("token");
    });

    it("dicabut → 403", async () => {
      prisma.device.findUnique.mockResolvedValueOnce(device({ status: "revoked" }));
      await expect(svc.token(SECRET, meta)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("diizinkan → token perangkat berisi kind/station, role setara operator", async () => {
      prisma.device.findUnique.mockResolvedValueOnce(device());
      const res = await svc.token(SECRET, meta);
      expect(res.status).toBe("approved");
      const payload = jwt.verify((res as { token: string }).token);
      expect(payload).toMatchObject({
        sub: "dev1",
        kind: "device",
        role: "operator",
        station: "SCP1",
        name: "Kiosk SCP 1",
      });
      expect(prisma.device.update).toHaveBeenCalled(); // lastSeenAt/IP diperbarui
    });
  });

  it("approve menyimpan station, nama & admin penyetuju", async () => {
    prisma.device.findUnique.mockResolvedValueOnce({ id: "dev1" });
    await svc.approve("dev1", { station: " SCP2 ", name: "Kiosk 2" }, "admin1");
    expect(prisma.device.update.mock.calls[0][0].data).toMatchObject({
      status: "approved",
      station: "SCP2",
      name: "Kiosk 2",
      approvedById: "admin1",
    });
  });

  it("hapus ditolak bila perangkat sudah mengirim scan", async () => {
    prisma.device.findUnique.mockResolvedValueOnce({ id: "dev1" });
    prisma.scanEvent.count.mockResolvedValueOnce(3);
    await expect(svc.remove("dev1")).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.device.delete).not.toHaveBeenCalled();
  });

  it("list: menunggu izin di atas, secretHash tak pernah ikut", async () => {
    prisma.device.findMany.mockResolvedValueOnce([
      { ...device({ id: "a", status: "revoked" }), _count: { scanEvents: 0 } },
      { ...device({ id: "b", status: "pending" }), _count: { scanEvents: 0 } },
      { ...device({ id: "c" }), _count: { scanEvents: 4 } },
    ]);
    const { items } = await svc.list();
    expect(items.map((d) => d.id)).toEqual(["b", "c", "a"]);
    expect(items[1].scanCount).toBe(4);
    const select = prisma.device.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty("secretHash");
  });
});
