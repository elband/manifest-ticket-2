import { NotFoundException } from "@nestjs/common";
import { ScanEventsService } from "./scan-events.service";

function makePrisma() {
  return {
    scanEvent: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    flightPassenger: {
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };
}

const operator = { sub: "op1", role: "operator", station: "AAP" } as never;
const decidedAt = "2026-11-03T04:30:10.000Z";

function validEvent(over: Record<string, unknown> = {}) {
  return {
    eventId: "ev1",
    station: "AAP",
    resultStatus: "VALID_FLIGHT",
    flightId: "f1",
    ticketNumber: "990023",
    pnr: "LM78NO",
    ...over,
  };
}

describe("ScanEventsService.decideIdentity", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: ScanEventsService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new ScanEventsService(prisma as never);
  });

  it("sesuai → hanya catat ktpStatus manual_pass, manifest tak disentuh", async () => {
    prisma.scanEvent.findUnique.mockResolvedValue(validEvent());
    await svc.decideIdentity("ev1", { match: true, decidedAt }, operator);
    expect(prisma.scanEvent.update).toHaveBeenCalledWith({
      where: { eventId: "ev1" },
      data: { ktpStatus: "manual_pass", ktpCapturedAt: new Date(decidedAt) },
    });
    expect(prisma.flightPassenger.deleteMany).not.toHaveBeenCalled();
    expect(prisma.flightPassenger.updateMany).not.toHaveBeenCalled();
  });

  it("sesuai otomatis (card tertimpa) → catat ktpStatus auto_pass", async () => {
    prisma.scanEvent.findUnique.mockResolvedValue(validEvent());
    await svc.decideIdentity("ev1", { match: true, decidedAt, auto: true }, operator);
    expect(prisma.scanEvent.update).toHaveBeenCalledWith({
      where: { eventId: "ev1" },
      data: { ktpStatus: "auto_pass", ktpCapturedAt: new Date(decidedAt) },
    });
  });

  it("sesuai otomatis tak menimpa status KTP yang sudah ada", async () => {
    prisma.scanEvent.findUnique.mockResolvedValue({ ...validEvent(), ktpStatus: "manual_reject" });
    await svc.decideIdentity("ev1", { match: true, decidedAt, auto: true }, operator);
    expect(prisma.scanEvent.update).not.toHaveBeenCalled();
  });

  it("tidak sesuai → turunkan jadi KTP_MISMATCH & hapus penumpang dari manifest", async () => {
    prisma.scanEvent.findUnique.mockResolvedValue(validEvent());
    prisma.scanEvent.findMany.mockResolvedValue([]); // tak ada scan valid lain
    await svc.decideIdentity("ev1", { match: false, decidedAt }, operator);
    const data = prisma.scanEvent.update.mock.calls[0][0].data;
    expect(data.resultStatus).toBe("KTP_MISMATCH");
    expect(data.ktpStatus).toBe("manual_reject");
    expect(prisma.flightPassenger.deleteMany).toHaveBeenCalledWith({
      where: { flightId: "f1", dedupKey: "990023" },
    });
  });

  it("tidak sesuai tapi masih ada scan valid lain → hitung ulang, bukan hapus", async () => {
    prisma.scanEvent.findUnique.mockResolvedValue(validEvent());
    const t1 = new Date("2026-11-03T03:00:00Z");
    prisma.scanEvent.findMany.mockResolvedValue([
      { ticketNumber: "990023", pnr: "LM78NO", scannedAt: t1 },
      { ticketNumber: "111111", pnr: "ZZZZZZ", scannedAt: t1 }, // penumpang lain
    ]);
    await svc.decideIdentity("ev1", { match: false, decidedAt }, operator);
    expect(prisma.flightPassenger.deleteMany).not.toHaveBeenCalled();
    expect(prisma.flightPassenger.updateMany).toHaveBeenCalledWith({
      where: { flightId: "f1", dedupKey: "990023" },
      data: { scanCount: 1, firstScannedAt: t1, lastScannedAt: t1 },
    });
  });

  it("tidak sesuai pada scan yang bukan VALID → status tetap, manifest tak disentuh", async () => {
    prisma.scanEvent.findUnique.mockResolvedValue(
      validEvent({ resultStatus: "DUPLICATE_SCAN" }),
    );
    await svc.decideIdentity("ev1", { match: false, decidedAt }, operator);
    const data = prisma.scanEvent.update.mock.calls[0][0].data;
    expect(data.resultStatus).toBeUndefined();
    expect(prisma.flightPassenger.deleteMany).not.toHaveBeenCalled();
  });

  it("operator station lain → 404", async () => {
    prisma.scanEvent.findUnique.mockResolvedValue(validEvent({ station: "CGK" }));
    await expect(
      svc.decideIdentity("ev1", { match: false, decidedAt }, operator),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.scanEvent.update).not.toHaveBeenCalled();
  });
});

describe("ScanEventsService.pushFromDevice (token perangkat)", () => {
  const device = { sub: "dev1", kind: "device", role: "operator", station: "SCP1" } as never;
  const dto = (over: Record<string, unknown> = {}) =>
    ({
      eventId: "ev9",
      rawBarcode: "M1X",
      resultStatus: "INVALID_BARCODE",
      scannedAt: "2026-11-03T04:30:00.000Z",
      station: "UNKNOWN",
      operatorId: "op1",
      ...over,
    }) as never;

  function setup() {
    const prisma = {
      operator: { findUnique: jest.fn().mockResolvedValue({ id: "op1" }) },
      scanEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => data),
      },
    };
    return { prisma, svc: new ScanEventsService(prisma as never) };
  }

  it("petugas dari body, station & deviceId dari perangkat", async () => {
    const { prisma, svc } = setup();
    await svc.pushFromDevice(device, dto(), null);
    expect(prisma.scanEvent.create.mock.calls[0][0].data).toMatchObject({
      operatorId: "op1",
      station: "SCP1",
      deviceId: "dev1",
    });
  });

  it("tanpa operatorId → 400", async () => {
    const { svc } = setup();
    await expect(svc.pushFromDevice(device, dto({ operatorId: undefined }), null)).rejects.toThrow(
      "wajib menyertakan petugas",
    );
  });

  it("operatorId tak dikenal → 400, tidak disimpan", async () => {
    const { prisma, svc } = setup();
    prisma.operator.findUnique.mockResolvedValueOnce(null);
    await expect(svc.pushFromDevice(device, dto(), null)).rejects.toThrow("tidak dikenal");
    expect(prisma.scanEvent.create).not.toHaveBeenCalled();
  });
});
