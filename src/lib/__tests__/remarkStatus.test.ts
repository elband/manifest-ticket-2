import { describe, it, expect } from "vitest";
import { mapRemarkStatus } from "../jadwal/flightSync";

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
