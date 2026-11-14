import { describe, it, expect } from "vitest";
import { mapRemarkStatus, nextStatus } from "../jadwal/flightSync";

describe("nextStatus — merge status lokal dengan FIDS", () => {
  it("CLOSED hasil FIDS dibuka lagi saat FIDS aktif", () => {
    expect(nextStatus("CLOSED", "OPEN", false)).toBe("OPEN");
  });
  it("CLOSED manual tetap tertutup", () => {
    expect(nextStatus("CLOSED", "OPEN", true)).toBe("CLOSED");
  });
  it("FIDS berangkat/batal selalu menutup", () => {
    expect(nextStatus("OPEN", "CLOSED", true)).toBe("CLOSED");
    expect(nextStatus("OPEN", "CANCELLED")).toBe("CANCELLED");
  });
  it("CANCELLED & ACTIVE lokal dipertahankan", () => {
    expect(nextStatus("CANCELLED", "OPEN")).toBe("CANCELLED");
    expect(nextStatus("ACTIVE", "OPEN")).toBe("ACTIVE");
  });
});

describe("mapRemarkStatus — remark FIDS → status flight", () => {
  it("Check-in Closed TIDAK menutup flight (penumpang masih lewat SCP)", () => {
    expect(mapRemarkStatus("Check-in Closed")).toBe("OPEN");
    expect(mapRemarkStatus("Check In Closed")).toBe("OPEN");
    expect(mapRemarkStatus("CHECKIN TUTUP")).toBe("OPEN");
    expect(mapRemarkStatus("Check-in Open")).toBe("OPEN");
  });

  it("berangkat / gate tutup → CLOSED", () => {
    expect(mapRemarkStatus("Departed")).toBe("CLOSED");
    expect(mapRemarkStatus("Gate Closed")).toBe("CLOSED");
    expect(mapRemarkStatus("Sudah Berangkat")).toBe("CLOSED");
  });

  it("batal → CANCELLED, lainnya → OPEN", () => {
    expect(mapRemarkStatus("Cancelled")).toBe("CANCELLED");
    expect(mapRemarkStatus("Scheduled")).toBe("OPEN");
    expect(mapRemarkStatus(null)).toBe("OPEN");
  });
});
