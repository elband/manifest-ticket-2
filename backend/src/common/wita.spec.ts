import { naiveDayRange, witaDateKey, witaDayRange } from "./wita";

describe("wita", () => {
  it("tanggal scan mengikuti WITA, bukan UTC", () => {
    // 05.30 WITA tgl 28 = 21.30 UTC tgl 27.
    expect(witaDateKey("2026-09-27T21:30:00.000Z")).toBe("2026-09-28");
    // 07.59 WITA masih tgl 28; 00.00 WITA tgl 29 sudah berganti.
    expect(witaDateKey("2026-09-27T23:59:00.000Z")).toBe("2026-09-28");
    expect(witaDateKey("2026-09-28T16:00:00.000Z")).toBe("2026-09-29");
  });

  it("rentang scannedAt satu hari = 00.00–23.59 WITA", () => {
    const r = witaDayRange("2026-09-28");
    expect(r.gte.toISOString()).toBe("2026-09-27T16:00:00.000Z");
    expect(r.lte.toISOString()).toBe("2026-09-28T15:59:59.999Z");
  });

  it("rentang std (jam lokal naif) tetap memakai suffix Z", () => {
    const r = naiveDayRange("2026-09-28");
    expect(r.gte.toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(r.lte.toISOString()).toBe("2026-09-28T23:59:59.999Z");
  });
});
