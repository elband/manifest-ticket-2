import { describe, it, expect } from "vitest";
import { parseBarcode, parseIataBcbp } from "../barcode";

describe("parseBarcode — format pipe (MVP)", () => {
  it("parse 4 field (tanpa nama)", () => {
    const r = parseBarcode("GA123|AB12CD|990001|12A");
    expect(r).toEqual({
      flightNumber: "GA123",
      pnr: "AB12CD",
      ticketNumber: "990001",
      seatNumber: "12A",
      passengerName: null,
      flightDate: null,
    });
  });

  it("parse 5 field (dengan nama)", () => {
    const r = parseBarcode("GA123|AB12CD|990001|12A|BUDI SANTOSO");
    expect(r?.passengerName).toBe("BUDI SANTOSO");
    expect(r?.flightNumber).toBe("GA123");
    expect(r?.flightDate).toBeNull(); // tanpa field ke-6 → tanggal null
  });

  it("parse 6 field (dengan tanggal) → flightDate terisi", () => {
    const r = parseBarcode("GA123|AB12CD|990001|12A|BUDI SANTOSO|2026-07-06");
    expect(r?.flightDate).toBe("2026-07-06");
    expect(r?.passengerName).toBe("BUDI SANTOSO");
  });

  it("trim spasi di tiap field", () => {
    const r = parseBarcode("  GA123 | AB12CD | 990001 | 12A ");
    expect(r?.flightNumber).toBe("GA123");
    expect(r?.seatNumber).toBe("12A");
  });

  it("tolak field kurang / kosong", () => {
    expect(parseBarcode("")).toBeNull();
    expect(parseBarcode("GA123|AB12CD|990001")).toBeNull(); // 3 field
    expect(parseBarcode("GA123||990001|12A")).toBeNull(); // pnr kosong
  });
});

describe("parseIataBcbp — format BCBP IATA 792", () => {
  // Susun string BCBP presisi sesuai posisi parser.
  const bcbp =
    "M1" +
    "YUSUF/AJIE MUH      " + // name (20)
    "E" + // pos22
    "UHXURZ " + // pnr (7)
    "AAP" + // origin
    "BEJ" + // dest
    "IW " + // airline (3)
    "01484" + // flight (5)
    "153" + // julian
    "Y" + // class
    "001C" + // seat (4)
    "0035 " + // seq (5)
    "1"; // status

  it("panjang string benar (58)", () => {
    expect(bcbp.length).toBe(58);
  });

  it("ekstrak field utama dengan benar", () => {
    const r = parseIataBcbp(bcbp);
    expect(r).not.toBeNull();
    expect(r?.flightNumber).toBe("IW1484"); // airline + flight, leading 0 dibuang
    expect(r?.pnr).toBe("UHXURZ");
    expect(r?.seatNumber).toBe("1C"); // 001C → 1C
    expect(r?.ticketNumber).toBe("35"); // 0035 → 35
    expect(r?.passengerName).toBe("AJIE MUH YUSUF"); // first + last
  });

  it("nama pendek (field ber-pad spasi) → tidak terpotong", () => {
    expect(parseIataBcbp(bcbp)?.passengerNameTruncated).toBe(false);
  });

  it("field nama 20 char penuh → ditandai terpotong", () => {
    const full = bcbp.slice(0, 2) + "HASYIM/MUHAMMAD ABDU" + bcbp.slice(22);
    const r = parseIataBcbp(full);
    expect(r?.passengerName).toBe("MUHAMMAD ABDU HASYIM");
    expect(r?.passengerNameTruncated).toBe(true);
  });

  it("parseBarcode mendeteksi BCBP otomatis", () => {
    const r = parseBarcode(bcbp);
    expect(r?.flightNumber).toBe("IW1484");
  });

  it("tolak string non-BCBP / terlalu pendek", () => {
    expect(parseIataBcbp("X1ABC")).toBeNull();
    expect(parseIataBcbp("M1SHORT")).toBeNull();
  });
});

describe("parseIataBcbp — awal barcode hilang saat scan", () => {
  // Kasus nyata SCP 2: "M1" + nama + "E" tidak terbaca scanner.
  const truncated =
    "LHLEGJX AAPSUBQG 0461 318Y029C0060 147>7181 6317BQG 0000000000002900000000000000 0";

  it("field penerbangan tetap terbaca, nama null & ditandai", () => {
    const r = parseBarcode(truncated);
    expect(r).not.toBeNull();
    expect(r?.flightNumber).toBe("QG461");
    expect(r?.originAirport).toBe("AAP");
    expect(r?.destinationAirport).toBe("SUB");
    expect(r?.seatNumber).toBe("29C");
    expect(r?.ticketNumber).toBe("60");
    expect(r?.passengerName).toBeNull();
    expect(r?.bcbpHeaderMissing).toBe(true);
  });

  it("PNR = 7 karakter sebelum origin (sama dengan parser utuh)", () => {
    const full = "M1" + "YUSUF/AJIE MUH      " + "E" + "HLEGJX " + truncated.slice(8);
    expect(parseBarcode(full)?.pnr).toBe("HLEGJX");
    expect(parseBarcode(truncated)?.pnr).toBe("HLEGJX");
    expect(parseBarcode(full)?.bcbpHeaderMissing).toBeUndefined();
  });

  it("tetap kenali bila sebagian nama masih ikut", () => {
    const r = parseBarcode("AJIE MUH      EUHXURZ AAPBEJIW 1484 153Y001C0035 100");
    expect(r?.flightNumber).toBe("IW1484");
    expect(r?.pnr).toBe("UHXURZ");
    expect(r?.bcbpHeaderMissing).toBe(true);
  });

  it("tolak teks acak / tanpa sisa PNR", () => {
    expect(parseBarcode("HELLO WORLD 12345")).toBeNull();
    expect(parseBarcode("AAPSUBQG 0461 318Y029C0060 1")).toBeNull();
  });
});

describe("parseIataBcbp — rute & maskapai", () => {
  it("ekstrak airline, origin, destination dari boarding pass asli", () => {
    const r = parseIataBcbp(
      "M1RACHMI/DHEA ANGGRAENEINBTXL AAPSUBIU 0653 157Y018F0020 100",
    );
    expect(r?.flightNumber).toBe("IU653");
    expect(r?.airlineCode).toBe("IU");
    expect(r?.originAirport).toBe("AAP");
    expect(r?.destinationAirport).toBe("SUB");
    expect(r?.seatNumber).toBe("18F");
  });
});
