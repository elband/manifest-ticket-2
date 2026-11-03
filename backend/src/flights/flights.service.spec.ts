import { FlightsService } from "./flights.service";

function makePrisma() {
  return {
    flight: {
      findFirst: jest.fn().mockResolvedValue(null), // default: belum ada → create
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

const flight = (over: Record<string, unknown> = {}) => ({
  flightNumber: "GA1",
  airlineCode: "GA",
  origin: "AAP",
  destination: "CGK",
  std: "2026-06-25T08:00:00.000Z",
  status: "OPEN",
  station: "AAP",
  ...over,
});

describe("FlightsService.bulkUpsert (snapshot FIDS)", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: FlightsService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new FlightsService(prisma as never);
  });

  it("dedup input berdasarkan station+flightNumber+TANGGAL (idempotent)", async () => {
    // 2 entri GA1 tgl sama (jam beda) harus jadi 1; JT2 terpisah → total 2.
    const dto = {
      flights: [
        flight(),
        flight({ std: "2026-06-25T09:30:00.000Z" }), // jam beda, tgl sama → di-dedup
        flight({ flightNumber: "JT2" }),
      ],
    };
    const res = await svc.bulkUpsert(dto as never);
    expect(res).toMatchObject({ ok: true, synced: 2, created: 2, updated: 0 });
    expect(prisma.flight.create).toHaveBeenCalledTimes(2);
  });

  it("array kosong → synced 0, tanpa create/update", async () => {
    const res = await svc.bulkUpsert({ flights: [] } as never);
    expect(res).toMatchObject({ ok: true, synced: 0 });
    expect(prisma.flight.create).not.toHaveBeenCalled();
    expect(prisma.flight.update).not.toHaveBeenCalled();
  });

  it("cocok by (station, flightNumber, rentang tanggal) — bila ada → UPDATE baris sama (bukan baris baru)", async () => {
    prisma.flight.findFirst.mockResolvedValueOnce({
      ...flight(),
      id: "flt_existing",
      std: new Date("2026-06-25T08:00:00.000Z"),
    });
    const res = await svc.bulkUpsert({
      flights: [flight({ std: "2026-06-25T08:47:00.000Z", status: "CLOSED" })],
    } as never);
    expect(res).toMatchObject({ ok: true, synced: 1, created: 0, updated: 1 });
    expect(prisma.flight.create).not.toHaveBeenCalled();
    // update dipanggil pada id yang ditemukan, std jadi Date, status ikut diperbarui
    const arg = prisma.flight.update.mock.calls[0][0] as {
      where: { id: string };
      data: { std: unknown; status: string };
    };
    expect(arg.where.id).toBe("flt_existing");
    expect(arg.data.std).toBeInstanceOf(Date);
    expect(arg.data.status).toBe("CLOSED");
    // cocok per-hari: findFirst pakai rentang std gte/lte, bukan jam persis
    const where = prisma.flight.findFirst.mock.calls[0][0].where;
    expect(where.station).toBe("AAP");
    expect(where.flightNumber).toBe("GA1");
    expect(where.std).toHaveProperty("gte");
    expect(where.std).toHaveProperty("lte");
  });

  it("baris sudah ada & identik → tidak di-UPDATE (sync berulang tiap 3 menit)", async () => {
    prisma.flight.findFirst.mockResolvedValueOnce({
      ...flight(),
      id: "flt_existing",
      std: new Date("2026-06-25T08:00:00.000Z"),
    });
    const res = await svc.bulkUpsert({ flights: [flight()] } as never);
    expect(res).toMatchObject({ ok: true, synced: 1, created: 0, updated: 0 });
    expect(prisma.flight.update).not.toHaveBeenCalled();
    expect(prisma.flight.create).not.toHaveBeenCalled();
  });
});
