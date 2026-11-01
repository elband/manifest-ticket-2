import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { pinLookupHash } from "../src/common/pin-lookup";

const prisma = new PrismaClient();

async function ensureOperator(data: {
  email: string;
  password: string;
  name: string;
  role: string;
  station?: string | null;
  pin?: string;
}) {
  const existing = await prisma.operator.findUnique({
    where: { email: data.email },
  });
  if (existing) {
    console.log(`[seed] sudah ada: ${data.email}`);
    return;
  }
  await prisma.operator.create({
    data: {
      email: data.email,
      passwordHash: await bcrypt.hash(data.password, 10),
      pinHash: data.pin ? await bcrypt.hash(data.pin, 10) : null,
      pinLookup: data.pin ? pinLookupHash(data.pin) : null,
      name: data.name,
      role: data.role,
      station: data.station ?? null,
      active: true,
    },
  });
  console.log(
    `[seed] dibuat: ${data.email}${data.pin ? ` (PIN ${data.pin}, ${data.station})` : ""}`,
  );
}

// Password contoh dari .env.example / .env.production.example — tidak boleh
// dipakai untuk admin produksi.
const PLACEHOLDER_ADMIN_PASSWORDS = ["ChangeMe!2026", "GANTI_PASSWORD_ADMIN_KUAT"];
const MIN_PROD_ADMIN_PASSWORD = 12;

async function main() {
  const isProd = process.env.NODE_ENV === "production";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe!2026";

  // F-04: admin awal tetap dibuat di produksi, tapi wajib password sendiri.
  if (
    isProd &&
    (adminPassword.length < MIN_PROD_ADMIN_PASSWORD ||
      PLACEHOLDER_ADMIN_PASSWORDS.includes(adminPassword))
  ) {
    throw new Error(
      `[seed] NODE_ENV=production: SEED_ADMIN_PASSWORD wajib diisi password sendiri ` +
        `(min ${MIN_PROD_ADMIN_PASSWORD} karakter, bukan nilai contoh).`,
    );
  }

  await ensureOperator({
    email: process.env.SEED_ADMIN_EMAIL ?? "admin@afvs.local",
    password: adminPassword,
    name: process.env.SEED_ADMIN_NAME ?? "Admin",
    role: "admin",
  });

  // F-04: jangan seed akun/PIN demo yang dapat ditebak di produksi.
  if (isProd && process.env.SEED_ALLOW_DEMO !== "true") {
    console.log(
      "[seed] NODE_ENV=production → lewati seed akun demo (set SEED_ALLOW_DEMO=true untuk memaksa).",
    );
    return;
  }

  // Operator demo
  await ensureOperator({
    email: "operator@afvs.local",
    password: "operator123",
    name: "Operator Demo",
    role: "operator",
    station: "CGK-T3",
  });

  // Petugas AVSEC per titik pemeriksaan — login cepat via PIN.
  // 2 titik: SCP 2 (sebelum X-ray) & Lounge Bluesky.
  const avsecs = [
    { email: "avsec1@afvs.local", name: "Andi Saputra", station: "SCP2", pin: "1234" },
    { email: "avsec2@afvs.local", name: "Budi Santoso", station: "SCP2", pin: "2345" },
    { email: "avsec3@afvs.local", name: "Citra Lestari", station: "SCP2", pin: "3456" },
    { email: "avsec4@afvs.local", name: "Dewi Anggraini", station: "BLUESKY", pin: "4567" },
    { email: "avsec5@afvs.local", name: "Eko Prasetyo", station: "BLUESKY", pin: "5678" },
  ];
  for (const a of avsecs) {
    await ensureOperator({
      email: a.email,
      password: `pwd-${a.pin}-${a.station}`, // password panjang (login utama via PIN)
      name: a.name,
      role: "operator",
      station: a.station,
      pin: a.pin,
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
