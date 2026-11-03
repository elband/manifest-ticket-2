import { describe, expect, it } from "vitest";
import { getSettings, getSharedSettings, pickSharedSettings } from "../settings";

describe("pengaturan global", () => {
  it("getSharedSettings membuang setelan khusus perangkat", () => {
    const shared = getSharedSettings({
      ...getSettings(),
      faceCameraDeviceId: "cam-1",
      scannerCameraDeviceId: "cam-2",
      apiSyncEnabled: true,
      theme: "dark",
      soundOn: false,
      kioskResultDurationSec: 0,
    });
    expect(shared).not.toHaveProperty("theme");
    expect(shared).not.toHaveProperty("soundOn");
    expect(shared).not.toHaveProperty("faceCameraDeviceId");
    expect(shared).not.toHaveProperty("scannerCameraDeviceId");
    expect(shared).not.toHaveProperty("apiSyncEnabled");
    expect(shared.kioskResultDurationSec).toBe(0);
  });

  it("pickSharedSettings hanya mengambil kunci global yang dikenal", () => {
    const picked = pickSharedSettings({
      kioskResultDurationSec: 0,
      hapticOn: false,
      soundOn: false,
      theme: "dark",
      scannerCameraDeviceId: "cam-dari-perangkat-lain",
      apiSyncEnabled: false,
      kunciAsing: 123,
    });
    // Tema & suara milik tiap perangkat — nilai dari server diabaikan.
    expect(picked).toEqual({ kioskResultDurationSec: 0, hapticOn: false });
  });
});
