import { describe, expect, it } from "vitest";
import { daysUntil, formatPasDate, isPasQr } from "../pas";
import { parseBarcode } from "../barcode";

describe("isPasQr", () => {
  it("mengenali URL QR kartu PAS", () => {
    expect(isPasQr("https://pas.aptpairport.id/vp/v/025ae001032b7f59045cbd5f")).toBe(true);
    expect(isPasQr("HTTPS://PAS.APTPAIRPORT.ID/VP/V/025AE001032B7F59045CBD5F")).toBe(true);
    // ":" & "/" tertukar oleh layout keyboard scanner
    expect(isPasQr("https;??pas.aptpairport.id?vp?v?025ae001032b7f59045cbd5f")).toBe(true);
  });

  it("tidak menganggap boarding pass sebagai kartu PAS", () => {
    const bcbp = "M1DOE/JOHN            EABC123 CGKBPNGA 0123 165Y012A0001 100";
    const pipe = "GA123|ABC123|1262100000123|12A|JOHN DOE";
    expect(isPasQr(bcbp)).toBe(false);
    expect(isPasQr(pipe)).toBe(false);
    expect(parseBarcode(pipe)).not.toBeNull();
  });
});

describe("format", () => {
  it("formatPasDate", () => {
    expect(formatPasDate("2027-01-14")).toBe("14 Jan 2027");
    expect(formatPasDate(null)).toBe("—");
  });

  it("daysUntil", () => {
    expect(daysUntil("2027-01-14", "2027-01-14")).toBe(0);
    expect(daysUntil("2027-01-14", "2027-01-04")).toBe(10);
    expect(daysUntil("2027-01-14", "2027-01-15")).toBe(-1);
  });
});
