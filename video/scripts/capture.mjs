// Rekam UI ASLI SIPANDAI (localhost) jadi klip MP4 untuk video panduan.
//
// Prasyarat: aplikasi jalan di APP_URL (default http://localhost:3000) dan
// webcam palsu sudah dibuat (`npm run cams`). Output:
//   public/clips/<nama>.mp4   — klip 1920×1080 @30fps (H.264)
//   src/clips.json            — durasi & penanda waktu (detik) tiap aksi di klip
//
// Data yang dipakai: PIN petugas seed (1234), akun demo admin README, dan
// penerbangan/boarding pass contoh fiktif yang disuntikkan ke localStorage.
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const FFMPEG = path.resolve("node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe");
const PROFILE = path.resolve("out/chrome-profile");
const FPS = 30;
mkdirSync("public/clips", { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clipsMeta = {};

/** Perekam berbasis CDP screencast → frame dikonversi ke 30 fps konstan → H.264. */
class Recorder {
  constructor(page) {
    this.page = page;
  }
  async start(name) {
    this.name = name;
    this.frames = [];
    this.marks = {};
    this.client = await this.page.createCDPSession();
    this.client.on("Page.screencastFrame", (e) => {
      this.frames.push({ t: e.metadata.timestamp, buf: Buffer.from(e.data, "base64") });
      this.client.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {});
    });
    await this.client.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    this.t0 = Date.now() / 1000;
    console.log(`● rekam ${name}`);
  }
  mark(label) {
    this.marks[label] = +(Date.now() / 1000 - this.t0).toFixed(3);
  }
  async stop() {
    const tEnd = Date.now() / 1000;
    await this.client.send("Page.stopScreencast");
    await this.client.detach();
    const frames = this.frames;
    if (!frames.length) throw new Error(`Tidak ada frame untuk ${this.name}`);
    const duration = tEnd - this.t0;
    const n = Math.round(duration * FPS);
    const out = `public/clips/${this.name}.mp4`;
    const ff = spawn(FFMPEG, ["-v", "error", "-y", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", `${FPS}`, "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    let k = 0;
    for (let i = 0; i < n; i++) {
      const t = this.t0 + i / FPS;
      while (k + 1 < frames.length && frames[k + 1].t <= t) k++;
      if (!ff.stdin.write(frames[k].buf)) await new Promise((r) => ff.stdin.once("drain", r));
    }
    ff.stdin.end();
    await new Promise((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)))));
    clipsMeta[this.name] = { duration: +duration.toFixed(3), marks: this.marks };
    console.log(`  ✓ ${out} (${duration.toFixed(1)} dtk, ${frames.length} frame asli)`, this.marks);
  }
}

const launch = (cam) =>
  puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: PROFILE,
    defaultViewport: { width: 1920, height: 1080 },
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-video-capture=${path.resolve(cam)}`,
      "--autoplay-policy=no-user-gesture-required",
      "--window-size=1920,1080",
      "--hide-scrollbars",
    ],
  });

const preparePage = async (browser) => {
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await page.emulateTimezone("Asia/Makassar"); // WITA — Samarinda
  return page;
};

const clickText = (page, text, { exact = true } = {}) =>
  page.evaluate(
    (text, exact) => {
      const els = [...document.querySelectorAll("button, a, [role=button]")];
      const el = els.find((x) => (exact ? x.textContent.trim() === text : x.textContent.includes(text)));
      if (!el) return false;
      el.click();
      return true;
    },
    text,
    exact,
  );

const waitText = (page, text, timeout = 30000) =>
  // innerText ikut text-transform CSS (mis. "SIAP SCAN") → bandingkan tanpa peduli kapital.
  page.waitForFunction((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), { timeout, polling: 100 }, text);

const pad = (n) => String(n).padStart(2, "0");
const localDate = (offsetDays = 0) => {
  // Tanggal WITA (UTC+8) agar sama dengan zona yang diemulasikan di browser.
  const d = new Date(Date.now() + 8 * 3600e3 + offsetDays * 86400e3);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const localTime = (offsetMin = 0) => {
  const d = new Date(Date.now() + 8 * 3600e3 + offsetMin * 60e3);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

const TODAY = localDate(0);
const RUN = String(Date.now() % 100000).padStart(5, "0");
const YESTERDAY = localDate(-1);
/** Payload barcode seeder: FLIGHT|PNR|TICKET|SEAT|NAMA|TANGGAL */
const bp = (flight, pnr, ticket, seat, name, date = TODAY) => `${flight}|${pnr}|${ticket}|${seat}|${name}|${date}`;
const PASS = {
  valid: bp("ID6273", "K7XQ2M", "9902412345", "12A", "RINA LESTARI"),
  manual: bp("ID6273", "P3LM8Z", "9902412346", "12B", "BUDI SANTOSO"),
  notToday: bp("ID6273", "W9TR4N", "9902410001", "8C", "AGUS PRATAMA", YESTERDAY),
  notActive: bp("IW1484", "H2KD7V", "9902419876", "4D", "SITI AMINAH"),
  unknown: bp("JT999", "Q8ZP1C", "9902415555", "20F", "DEDI KURNIAWAN"),
  invalid: "BOARDING-PASS-RUSAK-0042",
  child: bp("ID6273", "R5NB2X", `991${RUN}2`, "14B", "ALYA PUTRI"),
  ktpMismatch: bp("ID6273", "T6YC3W", `991${RUN}3`, "15C", "HENDRA SAPUTRA"),
};

const flightsFor = () => {
  const now = new Date().toISOString();
  const f = (flightNumber, airlineCode, dest, depOffsetMin, status, date = TODAY) => ({
    id: `flt-video-${flightNumber}-${date}`,
    flightNumber,
    airlineCode,
    originAirport: "AAP",
    destinationAirport: dest,
    departureDate: date,
    departureTime: localTime(depOffsetMin),
    gateOrCheckpoint: "Gate 2",
    status,
    expectedPax: 150,
    createdAt: now,
    updatedAt: now,
  });
  return [
    f("ID6273", "ID", "CGK", 55, "ACTIVE"),
    f("ID6273", "ID", "CGK", 55, "CLOSED", YESTERDAY),
    f("QG431", "QG", "SUB", 80, "OPEN"),
    f("IU801", "IU", "UPG", 95, "OPEN"),
    f("IW1484", "IW", "BEJ", -90, "CLOSED"),
  ];
};

/** Kosongkan data lalu isi penerbangan contoh & setelan rekaman. */
const resetApp = async (page) => {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2", timeout: 180000 });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(1200); // ensureSeed jalan
  await page.evaluate((flights) => {
    localStorage.setItem("afvs.flights", JSON.stringify(flights));
    localStorage.setItem("afvs.scanEvents", "[]");
    const s = JSON.parse(localStorage.getItem("afvs.settings") || "{}");
    localStorage.setItem(
      "afvs.settings",
      JSON.stringify({ ...s, apiSyncEnabled: false, fidsAutoSync: false, sikerenEnabled: false, ktpScanFirst: false, soundOn: false }),
    );
  }, flightsFor());
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(1500);
};

const setSettings = (page, patch) =>
  page.evaluate((patch) => {
    const s = JSON.parse(localStorage.getItem("afvs.settings") || "{}");
    localStorage.setItem("afvs.settings", JSON.stringify({ ...s, ...patch }));
  }, patch);

/** Ketik barcode seperti scanner USB (cepat) atau petugas (pelan) lalu Enter. */
const scan = async (page, raw, delay = 6) => {
  await page.keyboard.type(raw, { delay });
  await page.keyboard.press("Enter");
};
const closeModal = (page) => page.keyboard.press("Escape");
/** Tunggu heuristik wajah aplikasi menyatakan "Siap scan" (gerbang validasi wajah). */
const faceReady = (page) => waitText(page, "Siap scan", 30000).catch(() => console.log("  ! wajah belum 'Siap scan'"));

const ONLY_KTP = process.env.ONLY_KTP === "1"; // rekam ulang sesi KTP + supervisor saja
if (ONLY_KTP) Object.assign(clipsMeta, JSON.parse(readFileSync("src/clips.json", "utf8")));

// ───────────────────────── Sesi 1: webcam wajah ─────────────────────────
if (!ONLY_KTP) {
  const browser = await launch("out/cams/face.y4m");
  const page = await preparePage(browser);
  const rec = new Recorder(page);
  await resetApp(page);

  // Login PIN → otomatis ke kiosk.
  await rec.start("login");
  await sleep(1500);
  for (const d of ["1", "2", "3", "4"]) {
    rec.mark(`key${d}`);
    await clickText(page, d);
    await sleep(450);
  }
  await sleep(400);
  rec.mark("submit");
  await clickText(page, "Masuk Petugas");
  await page.waitForFunction(() => location.pathname.includes("/scan/kiosk"), { timeout: 60000 });
  rec.mark("kiosk");
  await sleep(5000);
  await rec.stop();

  // Kiosk & deteksi wajah.
  await rec.start("face");
  await faceReady(page);
  rec.mark("ready");
  await sleep(9000);
  await rec.stop();
  await page.screenshot({ path: "out/probe/kiosk-idle.png" });

  // Scan VALID via scanner USB (ketikan cepat) — modal tutup otomatis 6 dtk.
  await rec.start("valid");
  await faceReady(page);
  await sleep(1200);
  rec.mark("scan");
  await scan(page, PASS.valid);
  await sleep(7600);
  await rec.stop();

  // Ketik manual (pelan) — badge mode input berubah ke Manual.
  await rec.start("manual");
  await faceReady(page);
  await sleep(800);
  rec.mark("type");
  await scan(page, PASS.manual, 70);
  rec.mark("enter");
  await sleep(3500);
  await closeModal(page);
  await sleep(1200);
  await rec.stop();

  // Duplikat + ditolak.
  await rec.start("rejects");
  const steps = [
    ["dup", PASS.valid],
    ["notToday", PASS.notToday],
    ["notActive", PASS.notActive],
    ["unknown", PASS.unknown],
    ["invalid", PASS.invalid],
  ];
  for (const [label, raw] of steps) {
    await faceReady(page);
    await sleep(900);
    rec.mark(label);
    await scan(page, raw);
    await sleep(3200);
    await page.screenshot({ path: `out/probe/reject-${label}.png` });
    await closeModal(page);
  }
  await sleep(800);
  await rec.stop();

  // Kiosk diam setelah beberapa scan — panel "Flight aktif" menampilkan jumlah pax.
  await sleep(1500);
  await rec.start("board");
  await sleep(7000);
  await rec.stop();

  // Demo scan + statistik header.
  await rec.start("demo");
  await faceReady(page);
  await sleep(1200);
  rec.mark("click");
  await clickText(page, "DEMO SCAN", { exact: false });
  await sleep(9000); // modal tutup otomatis (jangan Escape: tanpa modal, Escape keluar dari kiosk)
  await rec.stop();
  await page.screenshot({ path: "out/probe/kiosk-after.png" });
  await browser.close();
}

// ───────────────────────── Sesi 2: webcam KTP ─────────────────────────
{
  const browser = await launch("out/cams/ktp.y4m");
  const page = await preparePage(browser);
  const rec = new Recorder(page);
  // Pastikan masuk sebagai petugas (PIN) — profil bisa menyimpan sesi supervisor.
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2", timeout: 180000 });
  await page.evaluate(() => localStorage.removeItem("afvs.session"));
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(1000);
  for (const d of ["1", "2", "3", "4"]) await clickText(page, d);
  await clickText(page, "Masuk Petugas");
  await page.waitForFunction(() => location.pathname.includes("/scan/kiosk"), { timeout: 60000 });
  await sleep(2500);

  // Nyalakan mode KTP-first saat merekam → KTP dibaca OCR → scan boarding pass
  // bernama sama → VALID (KTP cocok).
  await rec.start("ktp");
  await sleep(800);
  rec.mark("start");
  // Mode KTP-first butuh muat ulang kiosk (kamera & OCR disiapkan saat mount);
  // screencast tetap berjalan melewati reload.
  await setSettings(page, { ktpScanFirst: true, allowNoKtpExemption: true });
  await page.reload({ waitUntil: "networkidle2" });
  await waitText(page, "Nama terbaca", 90000).catch(() => console.log("  ! OCR belum membaca nama KTP"));
  rec.mark("ktpRead");
  await sleep(1800);
  rec.mark("scan");
  await scan(page, PASS.ktpMismatch); // nama beda dari KTP → KTP TIDAK COCOK
  await sleep(4500);
  await page.screenshot({ path: "out/probe/ktp-mismatch.png" });
  await closeModal(page);
  await sleep(1500);
  await rec.stop();

  // Jalur "Tanpa KTP" (anak/bayi).
  await rec.start("exempt");
  await sleep(1000);
  rec.mark("tap");
  const ok = await clickText(page, "Tanpa KTP", { exact: false });
  if (!ok) console.log("  ! tombol Tanpa KTP tidak ditemukan");
  await sleep(1800);
  rec.mark("scan");
  await scan(page, PASS.child);
  await sleep(4000);
  await page.screenshot({ path: "out/probe/ktp-exempt.png" });
  await closeModal(page);
  await sleep(1000);
  await rec.stop();

  // ───────────── Supervisor: riwayat scan (akun demo supervisor) ─────────────
  await page.evaluate(() => localStorage.removeItem("afvs.session"));
  await setSettings(page, { ktpScanFirst: false });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await sleep(1200);
  await clickText(page, "Admin/Supervisor", { exact: false });
  await sleep(500);
  // Form terisi otomatis akun demo admin → kosongkan dulu, isi akun supervisor.
  for (const [sel, val] of [["input[type=email]", "supervisor@airport.test"], ["input[type=password]", "password"]]) {
    await page.click(sel, { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.type(sel, val, { delay: 10 });
  }
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => location.pathname.includes("/dashboard"), { timeout: 60000 }).catch(() => {});
  // Riwayat Scan: data lokal pos ini lengkap dengan foto (Monitor Server butuh backend).
  await page.goto(`${BASE}/scan-events`, { waitUntil: "networkidle2" });
  await sleep(2500);
  await rec.start("supervisor");
  await sleep(4000);
  await page.mouse.wheel({ deltaY: 400 });
  await sleep(3000);
  await rec.stop();
  await page.screenshot({ path: "out/probe/supervisor.png" });
  await browser.close();
}

writeFileSync("src/clips.json", JSON.stringify(clipsMeta, null, 2) + "\n");
console.log("selesai →", Object.keys(clipsMeta).join(", "));
