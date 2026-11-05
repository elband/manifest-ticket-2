import { BadRequestException, NotFoundException } from "@nestjs/common";
import { OperatorsService } from "./operators.service";

function makePrisma() {
  return {
    operator: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };
}

describe("OperatorsService — guard PIN lemah (setPin)", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: OperatorsService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new OperatorsService(prisma as never);
  });

  it.each(["1234", "123456", "4321", "0000", "000000", "111111"])(
    "menolak PIN lemah %s",
    async (pin) => {
      prisma.operator.findUnique.mockResolvedValue({ id: "op1" });
      await expect(svc.setPin("op1", { pin })).rejects.toThrow(
        BadRequestException,
      );
    },
  );

  it("menerima PIN kuat & mengembalikannya", async () => {
    prisma.operator.findUnique.mockResolvedValue({ id: "op1" });
    prisma.operator.findFirst.mockResolvedValue(null); // tak ada bentrok
    prisma.operator.findMany.mockResolvedValue([]); // tak ada legacy
    prisma.operator.update.mockResolvedValue({});
    await expect(svc.setPin("op1", { pin: "825193" })).resolves.toEqual({
      pin: "825193",
    });
    expect(prisma.operator.update).toHaveBeenCalledTimes(1);
  });

  it("gagal bila operator tidak ditemukan", async () => {
    prisma.operator.findUnique.mockResolvedValue(null);
    await expect(svc.setPin("nope", { pin: "825193" })).rejects.toThrow(
      NotFoundException,
    );
  });

  it("create menolak PIN lemah pilihan sendiri", async () => {
    prisma.operator.findUnique.mockResolvedValue(null); // email bebas
    await expect(
      svc.create({ name: "Tes Petugas", pin: "123456" } as never),
    ).rejects.toThrow(BadRequestException);
  });
});

describe("OperatorsService — petugas mengganti PIN sendiri (changeOwnPin)", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: OperatorsService;
  let pinHash: string;

  beforeAll(async () => {
    const bcrypt = await import("bcryptjs");
    pinHash = await bcrypt.hash("482915", 4);
  });

  beforeEach(() => {
    prisma = makePrisma();
    svc = new OperatorsService(prisma as never);
    prisma.operator.findUnique.mockResolvedValue({ id: "op1", pinHash });
    prisma.operator.findFirst.mockResolvedValue(null);
    prisma.operator.findMany.mockResolvedValue([]);
    prisma.operator.update.mockResolvedValue({});
  });

  it("menolak bila PIN lama salah", async () => {
    await expect(svc.changeOwnPin("op1", "000111", "739215")).rejects.toThrow(
      "PIN lama salah.",
    );
    expect(prisma.operator.update).not.toHaveBeenCalled();
  });

  it("menolak PIN baru yang sama dengan PIN lama", async () => {
    await expect(svc.changeOwnPin("op1", "482915", "482915")).rejects.toThrow(
      BadRequestException,
    );
  });

  it("menolak PIN baru yang lemah", async () => {
    await expect(svc.changeOwnPin("op1", "482915", "123456")).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.operator.update).not.toHaveBeenCalled();
  });

  it("menyimpan PIN baru bila PIN lama benar", async () => {
    await expect(svc.changeOwnPin("op1", "482915", "739215")).resolves.toEqual({ ok: true });
    expect(prisma.operator.update).toHaveBeenCalledTimes(1);
  });
});
