import { Flight, User } from "./types";
import { todayDateString, tomorrowDateString, uid } from "./utils";

/**
 * Akun demo untuk login lokal (offline, tanpa backend). Hanya aktif di dev:
 * di build produksi daftarnya kosong, jadi login wajib lewat backend.
 *
 * Kode yang menyembunyikan STRING kredensial harus menulis
 * `process.env.NODE_ENV !== "production"` secara literal di tempatnya: Next
 * meng-inline nilainya sehingga cabang demo terbuang dari bundle. Konstanta
 * hasil impor antar-modul tidak ikut dilipat oleh minifier.
 */
export const DEMO_USERS_ENABLED = process.env.NODE_ENV !== "production";

/** ID akun demo, untuk membuang sesi demo lama di build produksi. */
export const DEMO_USER_IDS: ReadonlySet<string> = new Set([
  "u_admin",
  "u_supervisor",
  "u_security",
  "u_security_a",
  "u_security_b",
]);

export const DUMMY_USERS: User[] =
  process.env.NODE_ENV !== "production"
    ? [
        {
          id: "u_admin",
          email: "admin@airport.test",
          password: "password",
          name: "Admin Operator",
          role: "admin",
        },
        {
          id: "u_supervisor",
          email: "supervisor@airport.test",
          password: "password",
          name: "Supervisor Bandara",
          role: "supervisor",
        },
        {
          id: "u_security",
          email: "security@airport.test",
          password: "password",
          pin: "1234",
          name: "Petugas Security",
          role: "security",
        },
        {
          id: "u_security_a",
          email: "petugas.a@airport.test",
          password: "password",
          pin: "2345",
          name: "Petugas A",
          role: "security",
        },
        {
          id: "u_security_b",
          email: "petugas.b@airport.test",
          password: "password",
          pin: "3456",
          name: "Petugas B",
          role: "security",
        },
      ]
    : [];

export function buildSeedFlights(): Flight[] {
  const today = todayDateString();
  const tomorrow = tomorrowDateString();
  const now = new Date().toISOString();

  return [
    {
      id: uid("flt"),
      flightNumber: "GA123",
      airlineCode: "GA",
      originAirport: "CGK",
      destinationAirport: "DPS",
      departureDate: today,
      departureTime: "08:30",
      gateOrCheckpoint: "Gate A1",
      status: "OPEN",
      expectedPax: 180,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid("flt"),
      flightNumber: "JT902",
      airlineCode: "JT",
      originAirport: "CGK",
      destinationAirport: "SUB",
      departureDate: today,
      departureTime: "10:15",
      gateOrCheckpoint: "Gate B3",
      status: "ACTIVE",
      expectedPax: 220,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid("flt"),
      flightNumber: "QZ501",
      airlineCode: "QZ",
      originAirport: "CGK",
      destinationAirport: "KNO",
      departureDate: today,
      departureTime: "13:40",
      gateOrCheckpoint: "Gate C2",
      status: "OPEN",
      expectedPax: 160,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid("flt"),
      flightNumber: "SJ250",
      airlineCode: "SJ",
      originAirport: "CGK",
      destinationAirport: "UPG",
      departureDate: today,
      departureTime: "17:05",
      gateOrCheckpoint: "Gate D5",
      status: "DRAFT",
      expectedPax: 200,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid("flt"),
      flightNumber: "ID777",
      airlineCode: "ID",
      originAirport: "CGK",
      destinationAirport: "BPN",
      departureDate: today,
      departureTime: "19:20",
      gateOrCheckpoint: "Gate A4",
      status: "CANCELLED",
      expectedPax: 195,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid("flt"),
      flightNumber: "GA800",
      airlineCode: "GA",
      originAirport: "CGK",
      destinationAirport: "SIN",
      departureDate: tomorrow,
      departureTime: "07:00",
      gateOrCheckpoint: "Gate E1",
      status: "OPEN",
      expectedPax: 280,
      createdAt: now,
      updatedAt: now,
    },
  ];
}
