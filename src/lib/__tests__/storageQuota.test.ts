import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ScanEvent } from "../types";

/** localStorage palsu dengan kuota (jumlah karakter total), seperti Chromium. */
function installQuotaStorage(limit: number) {
  const store = new Map<string, string>();
  const size = () => [...store.entries()].reduce((n, [k, v]) => n + k.length + v.length, 0);
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const prev = store.get(k);
      const next = size() - (prev ? k.length + prev.length : 0) + k.length + v.length;
      if (next > limit) throw new DOMException("quota", "QuotaExceededError");
      store.set(k, String(v));
    },
    removeItem: (k: string) => void store.delete(k),
  };
  vi.stubGlobal("window", {
    localStorage,
    sessionStorage: localStorage,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  });
  return store;
}

function ev(id: string, scannedAt: string, pad = 0): ScanEvent {
  return {
    id,
    rawBarcode: "M1TEST" + "x".repeat(pad),
    resultStatus: "VALID_FLIGHT",
    message: "OK",
    scannedAt,
  } as unknown as ScanEvent;
}

const now = new Date().toISOString();
const old = new Date(Date.now() - 10 * 86_400_000).toISOString();

describe("penyimpanan browser penuh", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("arsip scan dibuang otomatis supaya scan baru tetap tersimpan", async () => {
    const store = installQuotaStorage(20_000);
    store.set(
      "afvs.scanEventsArchive",
      JSON.stringify(Array.from({ length: 40 }, (_, i) => ev(`a${i}`, old, 300))),
    );
    const { addScanEvent, getScanEvents } = await import("../storage");

    addScanEvent(ev("baru", now, 6_000));

    expect(store.has("afvs.scanEventsArchive")).toBe(false);
    expect(getScanEvents().map((e) => e.id)).toEqual(["baru"]);
  });

  it("scan lama (> 2 hari) ikut dipangkas bila arsip saja belum cukup", async () => {
    const store = installQuotaStorage(9_000);
    store.set("afvs.scanEvents", JSON.stringify([ev("lama1", old, 4_000), ev("lama2", old, 4_000)]));
    const { addScanEvent, getScanEvents } = await import("../storage");

    addScanEvent(ev("baru", now, 2_000));

    expect(getScanEvents().map((e) => e.id)).toEqual(["baru"]);
  });

  it("tetap tak muat → StorageFullError dengan pesan jelas (bukan error diam)", async () => {
    installQuotaStorage(1_000);
    const { addScanEvent, StorageFullError } = await import("../storage");

    expect(() => addScanEvent(ev("besar", now, 5_000))).toThrow(StorageFullError);
    expect(() => addScanEvent(ev("besar", now, 5_000))).toThrow(/penuh/);
  });
});
