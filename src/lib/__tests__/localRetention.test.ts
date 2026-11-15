import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ScanEvent } from "../types";

// Foto wajah (IndexedDB) diganti peta di memori.
const photos = new Map<string, string>();
vi.mock("../facePhotoStore", () => ({
  facePhotoStore: {
    keys: async () => [...photos.keys()],
    delete: async (id: string) => void photos.delete(id),
    get: async () => null,
  },
}));

// Push ke backend dikendalikan tes.
const pushMock = vi.fn();
vi.mock("../api/client", () => ({
  apiPushScan: (...args: unknown[]) => pushMock(...args),
  apiDecideIdentity: vi.fn(),
  getToken: () => "tok",
  isAuthed: () => true,
  getApiUser: () => null,
  getDeviceState: () => ({ status: "unregistered" }),
}));

function installWindow() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  vi.stubGlobal("window", {
    localStorage,
    sessionStorage: localStorage,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  });
  vi.stubGlobal("navigator", { onLine: true });
  localStorage.setItem("afvs.settings", JSON.stringify({ apiSyncEnabled: true }));
  return store;
}

const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();

function ev(id: string, daysAgo: number, extra: Partial<ScanEvent> = {}): ScanEvent {
  return {
    id,
    rawBarcode: "GA123|AB12CD|990001|12A",
    parsedFlightNumber: "GA123",
    parsedPnr: "AB12CD",
    parsedTicketNumber: "990001",
    parsedSeatNumber: "12A",
    parsedPassengerName: null,
    resultStatus: "VALID_FLIGHT",
    message: "OK",
    flightId: null,
    scannedBy: "petugas@bandara",
    scannedAt: iso(daysAgo),
    faceCaptureId: id,
    ...extra,
  };
}

describe("pembersihan data lokal yang sudah terkirim", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    vi.resetModules();
    photos.clear();
    pushMock.mockReset();
    store = installWindow();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hanya scan terkirim & > 7 hari yang dibuang, beserta fotonya", async () => {
    store.set(
      "afvs.scanEvents",
      JSON.stringify([
        ev("baru-terkirim", 1, { syncedAt: iso(1) }),
        ev("lama-belum-terkirim", 10), // dibuat saat sinkron mati → JANGAN dibuang
      ]),
    );
    store.set(
      "afvs.scanEventsArchive",
      JSON.stringify([
        ev("lama-terkirim", 10, { syncedAt: iso(9) }),
        ev("lama-uji", 10, { isTest: true }),
      ]),
    );
    for (const id of ["baru-terkirim", "lama-belum-terkirim", "lama-terkirim", "lama-uji", "yatim"]) {
      photos.set(id, "jpg");
    }
    const { pruneSyncedLocalData } = await import("../localRetention");
    const { getScanEvents, getScanEventsArchive } = await import("../storage");

    const r = await pruneSyncedLocalData();

    expect(r).toEqual({ ran: true, scans: 2, photos: 3 });
    expect(getScanEvents().map((e) => e.id)).toEqual(["baru-terkirim", "lama-belum-terkirim"]);
    expect(getScanEventsArchive()).toEqual([]);
    expect([...photos.keys()].sort()).toEqual(["baru-terkirim", "lama-belum-terkirim"]);
  });

  it("scan yang masih di antrean kirim tidak pernah dibuang (termasuk fotonya)", async () => {
    const { enqueueScanPush } = await import("../api/outbox");
    const old = ev("antre", 10, { syncedAt: iso(9) });
    store.set("afvs.scanEventsArchive", JSON.stringify([old]));
    enqueueScanPush(old);
    photos.set("antre", "jpg");
    const { pruneSyncedLocalData } = await import("../localRetention");

    const r = await pruneSyncedLocalData();

    expect(r.scans).toBe(0);
    expect(photos.has("antre")).toBe(true);
  });

  it("hanya sekali sehari kecuali dipaksa", async () => {
    const { pruneSyncedLocalData } = await import("../localRetention");
    expect((await pruneSyncedLocalData()).ran).toBe(true);
    expect((await pruneSyncedLocalData()).ran).toBe(false);
    expect((await pruneSyncedLocalData({ force: true })).ran).toBe(true);
  });

  it("antrean menandai syncedAt saat server menerima scan — juga yang sudah diarsipkan", async () => {
    const { enqueueScanPush, flushApiOutbox } = await import("../api/outbox");
    const { getScanEvents, getScanEventsArchive, setSession } = await import("../storage");
    setSession({ id: "op1", email: "a@b", name: "Andi", role: "security" });
    const today = ev("hari-ini", 0);
    const archived = ev("diarsip", 3);
    store.set("afvs.scanEvents", JSON.stringify([today]));
    store.set("afvs.scanEventsArchive", JSON.stringify([archived]));
    enqueueScanPush(today);
    enqueueScanPush(archived);
    pushMock.mockImplementation(async (fields: { eventId: string }) =>
      fields.eventId === "hari-ini"
        ? { ok: true, status: 201, data: {} }
        : { ok: false, status: 503, error: "down" },
    );

    await flushApiOutbox();

    expect(getScanEvents()[0].syncedAt).toBeTruthy();
    expect(getScanEventsArchive()[0].syncedAt).toBeFalsy(); // belum diterima server

    pushMock.mockResolvedValue({ ok: true, status: 201, data: {} });
    await flushApiOutbox();
    expect(getScanEventsArchive()[0].syncedAt).toBeTruthy();
  });
});
