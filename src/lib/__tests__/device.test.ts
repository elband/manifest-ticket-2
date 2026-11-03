import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { webcrypto } from "node:crypto";
import { authedFetch, getApiUser, getDeviceState, getDeviceToken, isAuthed } from "../api/client";
import { syncDeviceAccess } from "../api/device";
import { getSettings } from "../settings";

const fetchMock = vi.fn();

function installFakeWindow() {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    },
    crypto: webcrypto,
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.stubGlobal("navigator", { onLine: true, userAgent: "Mozilla/5.0 SIPANDAI-Desktop/1.2" });
  vi.stubGlobal("fetch", fetchMock);
  return store;
}

const json = (status: number, body: unknown) =>
  ({ status, ok: status < 400, json: async () => body }) as unknown as Response;

const later = (ms: number) => new Date(Date.now() + ms).toISOString();
const deviceInfo = { id: "dev1", name: "Kiosk 1", station: "SCP1", code: "ABC-DEF" };

describe("syncDeviceAccess", () => {
  beforeEach(() => {
    installFakeWindow();
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("perangkat baru → daftar sekali, lalu menunggu izin dgn kode", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { id: "dev1", code: "ABC-DEF", status: "pending" }))
      .mockResolvedValueOnce(json(200, { status: "pending", device: deviceInfo }));

    const s = await syncDeviceAccess();

    expect(s).toMatchObject({ status: "pending", code: "ABC-DEF" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/devices\/register$/);
    const body = JSON.parse(init.body as string);
    expect(body.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.name).toBe("Aplikasi desktop");
    expect(isAuthed()).toBe(false);
  });

  it("diizinkan admin → token perangkat dipakai & sinkron backend otomatis aktif", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { id: "dev1", code: "ABC-DEF", status: "pending" }))
      .mockResolvedValueOnce(
        json(200, {
          status: "approved",
          token: "dev-tok",
          expiresAt: later(12 * 3600_000),
          device: deviceInfo,
        }),
      );

    await syncDeviceAccess();

    expect(getDeviceToken()).toBe("dev-tok");
    expect(isAuthed()).toBe(true);
    expect(getApiUser()).toMatchObject({ id: "dev1", role: "operator", station: "SCP1" });
    expect(getSettings().apiSyncEnabled).toBe(true);

    // Token masih lama berlaku → tidak menghubungi server lagi.
    fetchMock.mockClear();
    await syncDeviceAccess();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("izin dicabut (403) → token dibuang", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { id: "dev1", code: "ABC-DEF", status: "pending" }))
      .mockResolvedValueOnce(json(403, { message: "dicabut" }));

    const s = await syncDeviceAccess();

    expect(s.status).toBe("revoked");
    expect(getDeviceToken()).toBeNull();
  });

  it("dihapus admin (404) → kembali belum terdaftar agar mendaftar ulang", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { id: "dev1", code: "ABC-DEF", status: "pending" }))
      .mockResolvedValueOnce(json(404, {}));

    expect((await syncDeviceAccess()).status).toBe("unregistered");
    expect(getDeviceState().status).toBe("unregistered");
  });

  it("server tak terjangkau → status lama dipertahankan", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect((await syncDeviceAccess()).status).toBe("unregistered");
  });
});

describe("authedFetch dengan token perangkat", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installFakeWindow();
    fetchMock.mockReset();
    store.set(
      "afvs.device.state",
      JSON.stringify({ status: "approved", id: "dev1", token: "dev-tok", expiresAt: later(3600_000) }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const authOf = (call: unknown[]) =>
    (call[1] as RequestInit & { headers: Headers }).headers.get("Authorization");

  it("tanpa petugas login → memakai token perangkat", async () => {
    fetchMock.mockResolvedValueOnce(json(200, {}));
    await authedFetch("/flights");
    expect(authOf(fetchMock.mock.calls[0])).toBe("Bearer dev-tok");
  });

  it("token petugas kedaluwarsa (401) → dikeluarkan & diulang atas nama perangkat", async () => {
    store.set("afvs.api.token", "op-tok");
    store.set("afvs.api.user", JSON.stringify({ id: "op1" }));
    fetchMock.mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(json(201, {}));

    const res = await authedFetch("/scan-events", { method: "POST", body: "x" });

    expect(res.status).toBe(201);
    expect(authOf(fetchMock.mock.calls[0])).toBe("Bearer op-tok");
    expect(authOf(fetchMock.mock.calls[1])).toBe("Bearer dev-tok");
    expect(store.has("afvs.api.token")).toBe(false);
  });

  it("token perangkat sudah lewat masa berlaku → tidak dipakai", () => {
    store.set(
      "afvs.device.state",
      JSON.stringify({ status: "approved", token: "dev-tok", expiresAt: later(-1000) }),
    );
    expect(getDeviceToken()).toBeNull();
    expect(isAuthed()).toBe(false);
  });
});
