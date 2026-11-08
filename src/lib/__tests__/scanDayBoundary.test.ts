// Batas hari scan harus mengikuti jam lokal (WITA), bukan tanggal UTC —
// dulu "hari" baru berganti pukul 08.00 pagi karena `scannedAt.slice(0, 10)`.
process.env.TZ = "Asia/Makassar";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Flight, ScanEvent } from "../types";

let flights: Flight[] = [];
let events: ScanEvent[] = [];
vi.mock("../storage", () => ({
  getFlights: () => flights,
  getScanEvents: () => events,
  addScanEvent: vi.fn(),
  updateScanEvent: vi.fn(),
  upsertManifestPax: vi.fn(),
}));
vi.mock("../sikerenOutbox", () => ({
  enqueueValidScan: vi.fn(),
  flushOutbox: vi.fn(() => Promise.resolve()),
}));
vi.mock("../api/outbox", () => ({
  enqueueScanPush: vi.fn(),
  attachFaceToQueued: vi.fn(),
  flushApiOutbox: vi.fn(() => Promise.resolve()),
}));

import { validateBarcode } from "../scanService";
import { localDateKey } from "../utils";

const BP = "M1RACHMI/DHEA ANGGRAENEINBTXL AAPSUBIU 0653 157Y018F0020 100";

const flight: Flight = {
  id: "f1",
  flightNumber: "IU653",
  airlineCode: "IU",
  originAirport: "AAP",
  destinationAirport: "SUB",
  departureDate: "2026-09-28",
  departureTime: "07:00",
  gateOrCheckpoint: "TEST",
  status: "OPEN",
  isTest: true,
  createdAt: "",
  updatedAt: "",
};

function scanAt(at: Date): ScanEvent {
  return {
    id: "e1",
    rawBarcode: BP,
    resultStatus: "VALID_FLIGHT",
    flightId: "f1",
    scannedAt: at.toISOString(),
  } as ScanEvent;
}

describe("localDateKey", () => {
  it("memakai tanggal lokal, bukan tanggal UTC", () => {
    // 05.30 WITA = 21.30 UTC hari sebelumnya.
    expect(localDateKey("2026-09-27T21:30:00.000Z")).toBe("2026-09-28");
    expect(localDateKey(new Date(2026, 8, 28, 0, 5))).toBe("2026-09-28");
    expect(localDateKey("bukan tanggal")).toBe("");
  });
});

describe("cek duplikat dini hari (sebelum 08.00 WITA)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 28, 6, 0)); // 06.00 WITA
    flights = [flight];
  });
  afterEach(() => {
    vi.useRealTimers();
    events = [];
  });

  it("scan 05.30 lalu scan ulang 06.00 → DUPLICATE_SCAN", () => {
    events = [scanAt(new Date(2026, 8, 28, 5, 30))];
    expect(validateBarcode(BP).status).toBe("DUPLICATE_SCAN");
  });

  it("scan kemarin malam (23.50) tidak dihitung duplikat hari ini", () => {
    events = [scanAt(new Date(2026, 8, 27, 23, 50))];
    expect(validateBarcode(BP).status).toBe("VALID_FLIGHT");
  });
});
