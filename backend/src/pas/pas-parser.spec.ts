import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseIndonesianDate, parsePasHtml } from "./pas-parser";

// Fixture = HTML asli situs PAS dengan data pemegang disamarkan.
const fixture = (name: string) => readFileSync(join(__dirname, "__fixtures__", name), "utf8");

describe("parsePasHtml", () => {
  it("mengurai semua field kartu yang valid", () => {
    const r = parsePasHtml(fixture("valid.html"));
    expect(r.kind).toBe("found");
    if (r.kind !== "found") return;
    expect(r.card).toEqual({
      name: "BUDI SANTOSO",
      position: "IT",
      company: "PT CONTOH JAYA",
      category: "PENUNJANG",
      categoryNote: expect.stringContaining("kegiatan usaha penunjang"),
      pasNumber: "P.XYZ.07.AAP.000123",
      cardColor: "MERAH",
      cardColorCss: "red",
      passType: "TAHUNAN",
      issuedAt: "2026-01-14",
      validUntil: "2027-01-14",
      areaCodes: ["A", "B", "P", "V"],
      photoUrl:
        "https://pas.aptpairport.id/resource/doc/temp/0123456789abcdef01234567/2025/pas_orang/foto/POB250000001.png",
    });
  });

  it("mengenali halaman 'data tidak ditemukan'", () => {
    expect(parsePasHtml(fixture("not-found.html"))).toEqual({ kind: "not_found" });
  });

  it("HTML asing → unrecognized (bukan crash)", () => {
    expect(parsePasHtml("<html><body>Maintenance</body></html>")).toEqual({
      kind: "unrecognized",
    });
  });
});

describe("parseIndonesianDate", () => {
  it.each([
    ["14 JANUARI 2027", "2027-01-14"],
    ["1 Desember 2025", "2025-12-01"],
    ["31 AGUSTUS 2026", "2026-08-31"],
  ])("%s → %s", (input, out) => {
    expect(parseIndonesianDate(input)).toBe(out);
  });

  it("format tak dikenal → null", () => {
    expect(parseIndonesianDate("2027-01-14")).toBeNull();
    expect(parseIndonesianDate("14 JANUARY 2027")).toBeNull();
    expect(parseIndonesianDate(null)).toBeNull();
  });
});
