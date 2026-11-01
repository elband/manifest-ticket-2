import { describe, it, expect, vi, afterEach } from "vitest";
import { demoScanEnabled } from "../seedBoardingPasses";

describe("demoScanEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("default: nyala di luar produksi", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_SCAN", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(demoScanEnabled()).toBe(true);
  });
  it("default: MATI di produksi", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_SCAN", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(demoScanEnabled()).toBe(false);
  });
  it("flag env memaksa nyala/mati", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_SCAN", "true");
    expect(demoScanEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_DEMO_SCAN", "false");
    expect(demoScanEnabled()).toBe(false);
  });
});
