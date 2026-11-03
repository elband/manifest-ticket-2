import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Push ke backend & token dikendalikan dari tes; modul lain memakai aslinya.
const pushMock = vi.fn();
const decideMock = vi.fn();
vi.mock("../api/client", () => ({
  apiPushScan: (...args: unknown[]) => pushMock(...args),
  apiDecideIdentity: (...args: unknown[]) => decideMock(...args),
  getToken: () => tokenRef.value,
  isAuthed: () => Boolean(tokenRef.value || deviceRef.value.token),
  getApiUser: () => null,
  getDeviceState: () => deviceRef.value,
}));
const tokenRef: { value: string | null } = { value: "tok" };
const deviceRef: { value: { status: string; station?: string; token?: string } } = {
  value: { status: "unregistered" },
};

import {
  classifyPushError,
  recoverOutboxItems,
  enqueueScanPush,
  enqueueIdentityDecision,
  flushApiOutbox,
  getApiOutboxSummary,
  type ApiOutboxItem,
} from "../api/outbox";
import { setSession } from "../storage";
import type { ScanEvent } from "../types";

function installFakeWindow() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  vi.stubGlobal("window", {
    localStorage,
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  // Node < 21 (mis. CI Node 20) tidak punya global `navigator`.
  vi.stubGlobal("navigator", { onLine: true });
  // Aktifkan sinkron backend (setting dibaca dari localStorage).
  localStorage.setItem("afvs.settings", JSON.stringify({ apiSyncEnabled: true }));
  return store;
}

function scan(id: string): ScanEvent {
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
    scannedAt: "2026-11-01T08:00:00.000Z",
  } as unknown as ScanEvent;
}

function item(over: Partial<ApiOutboxItem>): ApiOutboxItem {
  return {
    id: "scn_1",
    fields: {} as ApiOutboxItem["fields"],
    faceCaptureId: null,
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    enqueuedAt: "2026-11-01T08:00:00.000Z",
    status: "pending",
    ...over,
  };
}

describe("classifyPushError", () => {
  it("jaringan putus / timeout (tanpa status) → transient", () => {
    expect(classifyPushError(undefined)).toBe("transient");
    expect(classifyPushError(null)).toBe("transient");
  });
  it("server error, throttle, request timeout → transient", () => {
    for (const s of [500, 502, 503, 429, 408]) {
      expect(classifyPushError(s)).toBe("transient");
    }
  });
  it("401 → auth (perlu login ulang)", () => {
    expect(classifyPushError(401)).toBe("auth");
  });
  it("data ditolak (4xx lain) → permanent", () => {
    for (const s of [400, 403, 404, 413, 422]) {
      expect(classifyPushError(s)).toBe("permanent");
    }
  });
});

describe("recoverOutboxItems", () => {
  it("syncing yang tersangkut → pending", () => {
    const [r] = recoverOutboxItems([item({ status: "syncing" })]);
    expect(r.status).toBe("pending");
  });
  it("failed lama tanpa status / karena gangguan → pending, jatah direset", () => {
    const r = recoverOutboxItems([
      item({ id: "a", status: "failed", attempts: 5 }),
      item({ id: "b", status: "failed", attempts: 5, lastStatus: 503 }),
    ]);
    expect(r.map((q) => [q.status, q.attempts])).toEqual([
      ["pending", 0],
      ["pending", 0],
    ]);
  });
  it("failed karena data ditolak tetap failed; pending tidak berubah", () => {
    const failed = item({ id: "a", status: "failed", attempts: 5, lastStatus: 400 });
    const pending = item({ id: "b" });
    const r = recoverOutboxItems([failed, pending]);
    expect(r[0]).toBe(failed);
    expect(r[1]).toBe(pending);
  });
});

describe("flushApiOutbox saat jaringan terganggu", () => {
  beforeEach(() => {
    installFakeWindow();
    tokenRef.value = "tok";
    deviceRef.value = { status: "unregistered" };
    pushMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("server mati berkali-kali → item tetap pending, lalu terkirim saat pulih", async () => {
    enqueueScanPush(scan("scn_a"));
    enqueueScanPush(scan("scn_b"));
    pushMock.mockResolvedValue({
      ok: false,
      error: "Tidak bisa terhubung ke backend (offline / backend mati?).",
    });

    for (let i = 0; i < 10; i++) await flushApiOutbox();

    let s = getApiOutboxSummary();
    expect(s.pending).toBe(2);
    expect(s.failed).toBe(0);
    expect(s.online).toBe(false);
    // Batch berhenti di item pertama tiap tick, tidak membanjiri server.
    expect(pushMock).toHaveBeenCalledTimes(10);

    pushMock.mockResolvedValue({ ok: true, status: 201, data: {} });
    await flushApiOutbox();

    s = getApiOutboxSummary();
    expect(s.total).toBe(0);
    expect(s.online).toBe(true);
  });

  it("throttle (429) → tetap pending tapi status tetap online (server hidup)", async () => {
    enqueueScanPush(scan("scn_a"));
    pushMock.mockResolvedValue({ ok: false, status: 429, error: "Too Many Requests" });

    await flushApiOutbox();

    const s = getApiOutboxSummary();
    expect(s.pending).toBe(1);
    expect(s.failed).toBe(0);
    expect(s.online).toBe(true);
    expect(s.lastError).toBe("Too Many Requests");
  });

  it("backend mati di balik Nginx (502) → status offline", async () => {
    enqueueScanPush(scan("scn_a"));
    pushMock.mockResolvedValue({ ok: false, status: 502, error: "HTTP 502" });

    await flushApiOutbox();

    expect(getApiOutboxSummary().online).toBe(false);
  });

  it("tanpa token petugas tapi perangkat diizinkan → tetap terkirim atas nama petugas sesi", async () => {
    tokenRef.value = null;
    deviceRef.value = { status: "approved", station: "SCP1", token: "dev-tok" };
    setSession({ id: "op1", email: "a@b", name: "Andi", role: "security" });
    enqueueScanPush(scan("scn_a"));
    pushMock.mockResolvedValue({ ok: true, status: 201, data: {} });

    expect(getApiOutboxSummary().needsLogin).toBe(false);
    await flushApiOutbox();

    const fields = pushMock.mock.calls[0][0] as { operatorId: string; station: string };
    expect(fields.operatorId).toBe("op1");
    expect(fields.station).toBe("SCP1");
    expect(getApiOutboxSummary().total).toBe(0);
  });

  it("token kedaluwarsa (401) → menunggu login ulang tanpa menghabiskan jatah", async () => {
    enqueueScanPush(scan("scn_a"));
    pushMock.mockResolvedValue({ ok: false, status: 401, error: "Sesi habis" });

    await flushApiOutbox();
    tokenRef.value = null; // authedFetch menghapus token pada 401

    const s = getApiOutboxSummary();
    expect(s.pending).toBe(1);
    expect(s.failed).toBe(0);
    expect(s.needsLogin).toBe(true);
  });

  it("data ditolak backend (400) → failed setelah 5 percobaan", async () => {
    enqueueScanPush(scan("scn_a"));
    pushMock.mockResolvedValue({ ok: false, status: 400, error: "resultStatus invalid" });

    for (let i = 0; i < 5; i++) await flushApiOutbox();

    const s = getApiOutboxSummary();
    expect(s.failed).toBe(1);
    expect(s.pending).toBe(0);
  });
});

describe("enqueueIdentityDecision (cek KTP/SIM petugas)", () => {
  const decidedAt = "2026-11-01T08:00:10.000Z";
  const rejected = (id: string): ScanEvent => ({
    ...scan(id),
    resultStatus: "KTP_MISMATCH",
    ktpVerification: { status: "manual_reject", ocrName: null, capturedAt: decidedAt },
  });

  beforeEach(() => {
    installFakeWindow();
    tokenRef.value = "tok";
    pushMock.mockReset();
    decideMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("push scan masih antre → field-nya ditimpa, tak ada PATCH terpisah", async () => {
    enqueueScanPush(scan("scn_a"));
    enqueueIdentityDecision(rejected("scn_a"), false, decidedAt);
    expect(getApiOutboxSummary().total).toBe(1);

    pushMock.mockResolvedValue({ ok: true, status: 201, data: {} });
    await flushApiOutbox();
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0][0]).toMatchObject({
      resultStatus: "KTP_MISMATCH",
      ktpStatus: "manual_reject",
    });
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("scan sudah terkirim → antre PATCH keputusan", async () => {
    enqueueScanPush(scan("scn_a"));
    pushMock.mockResolvedValue({ ok: true, status: 201, data: {} });
    await flushApiOutbox();

    enqueueIdentityDecision(rejected("scn_a"), false, decidedAt);
    decideMock.mockResolvedValue({ ok: true, status: 200, data: {} });
    await flushApiOutbox();

    expect(decideMock).toHaveBeenCalledWith("scn_a", { match: false, decidedAt });
    expect(getApiOutboxSummary().total).toBe(0);
  });

  it("scan penerbangan uji → tidak dikirim", () => {
    enqueueIdentityDecision({ ...rejected("scn_t"), isTest: true }, false, decidedAt);
    expect(getApiOutboxSummary().total).toBe(0);
  });
});
