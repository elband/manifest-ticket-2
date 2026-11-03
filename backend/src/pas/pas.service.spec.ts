import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JwtPayload } from "../auth/auth.service";
import { PasService, extractPasId, statusFor, todayWita } from "./pas.service";
import { PasCard } from "./pas-parser";
import { getHtml } from "./pas-http";

jest.mock("./pas-http", () => ({ getHtml: jest.fn() }));

const fixture = (name: string) => readFileSync(join(__dirname, "__fixtures__", name), "utf8");
const ID = "0123456789abcdef01234567";

describe("extractPasId", () => {
  it.each([
    [`https://pas.aptpairport.id/vp/v/${ID}`, ID],
    [`https;??pas.aptpairport.id?vp?v?${ID}`, ID], // layout keyboard scanner salah
    [`HTTPS://PAS.APTPAIRPORT.ID/VP/V/${ID.toUpperCase()}`, ID],
    [`  ${ID}  `, ID],
  ])("%s", (raw, id) => {
    expect(extractPasId(raw)).toBe(id);
  });

  it("menolak boarding pass & teks lain", () => {
    expect(extractPasId("M1DOE/JOHN            EABC123 CGKBPNGA 0123 165Y012A0001 100")).toBeNull();
    expect(extractPasId("GA123|ABC123|1262100000123|12A")).toBeNull();
    expect(extractPasId("https://example.com/vp/x/123")).toBeNull();
  });
});

describe("statusFor / todayWita", () => {
  const card = { validUntil: "2027-01-14" } as PasCard;
  it("masih berlaku pada hari terakhir", () => {
    expect(statusFor(card, "2027-01-14")).toBe("VALID");
  });
  it("kedaluwarsa sehari setelahnya", () => {
    expect(statusFor(card, "2027-01-15")).toBe("EXPIRED");
  });
  it("tanggal mengikuti WITA (UTC+8)", () => {
    expect(todayWita(new Date("2027-01-14T16:30:00Z"))).toBe("2027-01-15");
    expect(todayWita(new Date("2027-01-14T15:30:00Z"))).toBe("2027-01-14");
  });
});

describe("PasService.verify", () => {
  const user: JwtPayload = { sub: "op1", email: "a@b.c", role: "operator", station: "SCP1" };
  let prisma: {
    pasScan: { create: jest.Mock };
    operator: { findUnique: jest.Mock };
  };
  let svc: PasService;
  const fetchMock = getHtml as jest.Mock;

  beforeEach(() => {
    prisma = {
      pasScan: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: "ps1",
          createdAt: new Date("2026-11-03T01:00:00Z"),
          ...data,
        })),
      },
      operator: { findUnique: jest.fn().mockResolvedValue({ id: "op9" }) },
    };
    svc = new PasService(prisma as never, new ConfigService({}));
    fetchMock.mockReset();
  });

  const html = (body: string) => fetchMock.mockResolvedValue({ status: 200, body });

  it("kartu valid → VALID, disimpan tanpa foto", async () => {
    html(fixture("valid.html"));
    const r = await svc.verify(user, { raw: `https://pas.aptpairport.id/vp/v/${ID}` });
    expect(fetchMock.mock.calls[0][0]).toBe(`https://pas.aptpairport.id/vp/v/${ID}`);
    expect(r.status).toBe(todayWita() > "2027-01-14" ? "EXPIRED" : "VALID");
    expect(r.card?.name).toBe("BUDI SANTOSO");
    expect(r.card?.photoUrl).toMatch(/^https:\/\/pas\.aptpairport\.id\//);
    const data = prisma.pasScan.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      pasId: ID,
      name: "BUDI SANTOSO",
      areaCodes: "A B P V",
      station: "SCP1",
      operatorId: "op1",
      deviceId: null,
    });
    expect(data).not.toHaveProperty("photoUrl");
  });

  it("data tidak ditemukan → NOT_FOUND", async () => {
    html(fixture("not-found.html"));
    const r = await svc.verify(user, { raw: ID });
    expect(r.status).toBe("NOT_FOUND");
    expect(r.card).toBeNull();
  });

  it("jaringan gagal → ERROR (tetap tercatat)", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const r = await svc.verify(user, { raw: ID });
    expect(r.status).toBe("ERROR");
    expect(prisma.pasScan.create).toHaveBeenCalled();
  });

  it("foto dari host lain dibuang", async () => {
    html(fixture("valid.html").replace(/https:\/\/pas\.aptpairport\.id\/resource\/doc\/temp/, "https://evil.example/x"));
    const r = await svc.verify(user, { raw: ID });
    expect(r.card?.photoUrl).toBeNull();
  });

  it("token perangkat wajib menyertakan operatorId", async () => {
    const device: JwtPayload = { sub: "dev1", email: "", role: "operator", station: "SCP2", kind: "device" };
    await expect(svc.verify(device, { raw: ID })).rejects.toBeInstanceOf(BadRequestException);

    html(fixture("not-found.html"));
    await svc.verify(device, { raw: ID, operatorId: "op9" });
    expect(prisma.pasScan.create.mock.calls[0][0].data).toMatchObject({
      operatorId: "op9",
      deviceId: "dev1",
      station: "SCP2",
    });
  });

  it("QR bukan kartu PAS → 400", async () => {
    await expect(svc.verify(user, { raw: "GA123|ABC|1|1A" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
