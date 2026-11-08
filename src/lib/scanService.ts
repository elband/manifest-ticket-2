"use client";

import {
  Flight,
  ParsedBarcode,
  ScanEvent,
  ScanResultStatus,
} from "./types";
import {
  addScanEvent,
  getFlights,
  getScanEvents,
  updateScanEvent,
  upsertManifestPax,
} from "./storage";
import { localDateKey, todayDateString, uid } from "./utils";
import { getSettings } from "./settings";
import { getEffectiveFlightStatus } from "./flightStatus";
import { activeTestFlight } from "./dummyFlight";
import { facePhotoStore } from "./facePhotoStore";
import { enqueueValidScan, flushOutbox } from "./sikerenOutbox";
import {
  attachFaceToQueued,
  enqueueScanPush,
  flushApiOutbox,
} from "./api/outbox";

// Parser barcode dipindah ke ./barcode (modul murni, dapat di-unit-test).
// Re-export agar API publik scanService.parseBarcode tetap kompatibel.
import { parseBarcode } from "./barcode";
export { parseBarcode };

export interface ValidationOutcome {
  status: ScanResultStatus;
  message: string;
  flight: Flight | null;
  parsed: ParsedBarcode | null;
}

const PREVIOUS_SCAN_STATUS_LABEL: Record<ScanResultStatus, string> = {
  VALID_FLIGHT: "valid",
  DUPLICATE_SCAN: "duplicate",
  FLIGHT_NOT_TODAY: "ditolak karena bukan hari ini",
  FLIGHT_NOT_ACTIVE: "ditolak karena flight tidak aktif",
  UNKNOWN_FLIGHT: "ditolak karena flight tidak dikenal",
  INVALID_BARCODE: "ditolak karena barcode invalid",
  KTP_MISMATCH: "ditolak karena KTP tidak cocok",
};

function previousScanNote(rawBarcode: string, events: ScanEvent[]): string {
  const previous = events.find((e) => e.rawBarcode === rawBarcode);
  if (!previous) return "";

  const scannedAt = new Date(previous.scannedAt);
  const date = scannedAt.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const time = scannedAt.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return ` Barcode ini juga pernah di-scan (${PREVIOUS_SCAN_STATUS_LABEL[previous.resultStatus]}) pada ${date} pukul ${time}.`;
}

export function validateBarcode(raw: string): ValidationOutcome {
  const cleaned = (raw ?? "").trim();
  if (!cleaned) {
    return {
      status: "INVALID_BARCODE",
      message: "Barcode kosong. Silakan scan ulang.",
      flight: null,
      parsed: null,
    };
  }

  const parsed = parseBarcode(cleaned);
  if (!parsed) {
    const previousNote = previousScanNote(cleaned, getScanEvents());
    return {
      status: "INVALID_BARCODE",
      message:
        `Ditolak: format barcode tidak valid. Format harus: FLIGHT|PNR|TICKET|SEAT.${previousNote}`,
      flight: null,
      parsed: null,
    };
  }

  const today = todayDateString();
  const flights = getFlights();
  const events = getScanEvents();
  const previousNote = previousScanNote(cleaned, events);

  // Penerbangan UJI hanya dipertimbangkan bila berlaku (fitur aktif & tak ada
  // flight terjadwal bernomor sama hari ini) — selain itu dianggap tak ada.
  const testFlight = activeTestFlight(flights, parsed.flightNumber, today);
  const matches = flights.filter(
    (f) =>
      f.flightNumber.toUpperCase() === parsed.flightNumber.toUpperCase() &&
      (!f.isTest || f === testFlight),
  );

  if (matches.length === 0) {
    return {
      status: "UNKNOWN_FLIGHT",
      message: `Ditolak: flight ${parsed.flightNumber} tidak terdaftar.${previousNote}`,
      flight: null,
      parsed,
    };
  }

  // Pilih flight yang cocok:
  // - Bila barcode MEMUAT tanggal (flightDate), utamakan flight pada tanggal itu
  //   → boarding pass tanggal lampau akan nyangkut ke flight lampau lalu ditolak
  //   "BUKAN HARI INI" (tidak lolos ke flight hari ini yang nomornya kebetulan sama).
  // - Bila tanpa tanggal (barcode lama), pakai preferensi HARI INI & boardable.
  // - Penerbangan UJI yang berlaku (lihat activeTestFlight) menang: boarding
  //   pass asli bertanggal lampau tetap bisa dites tanpa mengubah barcode-nya.
  const flight =
    testFlight ??
    (parsed.flightDate
      ? (matches.find((f) => f.departureDate === parsed.flightDate) ??
        matches[0])
      : (matches.find(
          (f) =>
            f.departureDate === today &&
            (f.status === "OPEN" || f.status === "ACTIVE"),
        ) ??
        matches.find((f) => f.departureDate === today) ??
        matches[0]));

  // Tanggal OTORITATIF = dari barcode bila ada (mis. seeder/BCBP), else tanggal
  // flight. Boarding pass untuk tanggal selain HARI INI langsung ditolak — cegah
  // boarding pass tanggal lampau lolos ke flight hari ini yang nomornya sama.
  // Pengecualian: penerbangan UJI (tanggal barcode diabaikan).
  const passDate = testFlight
    ? today
    : (parsed.flightDate ?? flight.departureDate);
  if (passDate !== today) {
    return {
      status: "FLIGHT_NOT_TODAY",
      message: `Ditolak: ${flight.flightNumber} bukan penerbangan hari ini (jadwal boarding pass: ${passDate}).${previousNote}`,
      flight,
      parsed,
    };
  }

  // Penerbangan UJI: jendela boarding diabaikan (bisa dites kapan saja hari
  // itu) — status manual (DRAFT/CLOSED/CANCELLED) tetap dihormati.
  const effective = testFlight
    ? { status: flight.status, description: `Status ${flight.status}` }
    : getEffectiveFlightStatus(flight, new Date(), getSettings());
  if (effective.status !== "OPEN" && effective.status !== "ACTIVE") {
    return {
      status: "FLIGHT_NOT_ACTIVE",
      message: `Ditolak: flight ${flight.flightNumber} belum bisa divalidasi. ${effective.description}.${previousNote}`,
      flight,
      parsed,
    };
  }

  // Duplicate check: same raw barcode scanned today AGAINST THE CURRENT flight.
  // Match on flight.id supaya flight yang dihapus lalu dibuat ulang
  // (id berbeda) tidak ikut menghitung scan lama sebagai duplicate.
  const dup = events.find(
    (e) =>
      e.rawBarcode === cleaned &&
      e.resultStatus === "VALID_FLIGHT" &&
      e.flightId === flight.id &&
      localDateKey(e.scannedAt) === today,
  );
  if (dup) {
    const scannedAt = new Date(dup.scannedAt).toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    return {
      status: "DUPLICATE_SCAN",
      message: `Duplicate scan: boarding pass ini valid untuk flight ${flight.flightNumber} hari ini (${flight.originAirport} -> ${flight.destinationAirport}, ${flight.gateOrCheckpoint}, seat ${parsed.seatNumber}), tetapi sudah pernah di-scan pukul ${scannedAt}.`,
      flight,
      parsed,
    };
  }

  return {
    status: "VALID_FLIGHT",
    message: testFlight
      ? `[PENERBANGAN UJI] Boarding pass valid untuk ${flight.flightNumber} → ${flight.destinationAirport} — bukan data operasional, tidak dikirim ke server.${
          parsed.flightDate && parsed.flightDate !== today
            ? ` Tanggal di barcode ${parsed.flightDate} diabaikan.`
            : ""
        }`
      : `Boarding pass valid untuk ${flight.flightNumber} → ${flight.destinationAirport}.`,
    flight,
    parsed,
  };
}

export function processScan(
  raw: string,
  scannedBy: string,
  opts?: { enqueueApiPush?: boolean },
): { outcome: ValidationOutcome; event: ScanEvent } {
  const outcome = validateBarcode(raw);
  // Scan pada penerbangan UJI: dicatat lokal saja — tidak ke Sikeren (billable)
  // maupun backend AFVS, agar data uji tak mencemari data operasional.
  const isTest = outcome.flight?.isTest === true;
  const event: ScanEvent = {
    id: uid("scn"),
    rawBarcode: (raw ?? "").trim(),
    parsedFlightNumber: outcome.parsed?.flightNumber ?? null,
    parsedPnr: outcome.parsed?.pnr ?? null,
    parsedTicketNumber: outcome.parsed?.ticketNumber ?? null,
    parsedSeatNumber: outcome.parsed?.seatNumber ?? null,
    parsedPassengerName: outcome.parsed?.passengerName ?? null,
    resultStatus: outcome.status,
    message: outcome.message,
    flightId: outcome.flight?.id ?? null,
    scannedBy,
    scannedAt: new Date().toISOString(),
    ...(isTest ? { isTest: true } : {}),
  };
  addScanEvent(event);

  // Manifest penumpang per-flight (lokal, offline-first): catat hanya scan VALID.
  // Backend juga meng-upsert manifest saat push (idempotent) — ini menjaga
  // hitungan tersedia walau offline. Lihat docs/RANCANGAN-MANIFEST-PAX.md.
  if (
    outcome.status === "VALID_FLIGHT" &&
    outcome.flight &&
    outcome.parsed
  ) {
    try {
      upsertManifestPax(outcome.flight.id, {
        passengerName: outcome.parsed.passengerName ?? null,
        pnr: outcome.parsed.pnr ?? null,
        ticketNumber: outcome.parsed.ticketNumber ?? null,
        seatNumber: outcome.parsed.seatNumber ?? null,
        scannedAt: event.scannedAt,
        flightNumber: outcome.flight.flightNumber,
      });
    } catch {
      /* manifest lokal tidak boleh mengganggu hasil scan */
    }
  }

  // Sikeren integration: enqueue only on VALID outcome (billable scan).
  if (
    !isTest &&
    outcome.status === "VALID_FLIGHT" &&
    outcome.flight &&
    outcome.parsed
  ) {
    try {
      enqueueValidScan(event, outcome.flight, outcome.parsed);
      const s = getSettings();
      if (s.sikerenEnabled && s.sikerenSyncMode === "auto") {
        // fire-and-forget: jangan blok hasil scan
        flushOutbox().catch(() => {});
      }
    } catch {
      /* tidak boleh mengganggu hasil scan */
    }
  }

  // Backend AFVS: enqueue semua scan tercatat (audit log) ke outbox.
  // Saat dipanggil dari processScanWithFace, enqueue ditunda sampai foto siap.
  if (!isTest && opts?.enqueueApiPush !== false) {
    try {
      enqueueScanPush(event);
      flushApiOutbox().catch(() => {});
    } catch {
      /* sync backend tidak boleh mengganggu hasil scan */
    }
  }

  return { outcome, event };
}

/**
 * Sama dengan processScan, plus attach foto wajah dari callback getFaceBlob.
 * Capture berjalan paralel & punya timeout pendek — jika gagal, ScanEvent
 * tetap tersimpan tanpa foto (capture tidak boleh memblok validasi scan).
 */
export async function processScanWithFace(
  raw: string,
  scannedBy: string,
  getFaceBlob: () => Promise<Blob | null>,
  options?: { timeoutMs?: number },
): Promise<{ outcome: ValidationOutcome; event: ScanEvent }> {
  const timeoutMs = options?.timeoutMs ?? 300;
  // Tunda enqueue backend sampai foto wajah tersimpan (agar foto ikut ter-push).
  const { outcome, event } = processScan(raw, scannedBy, {
    enqueueApiPush: false,
  });
  try {
    const blob = await Promise.race([
      getFaceBlob(),
      new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
    ]);
    if (blob) {
      await facePhotoStore.save(event.id, blob);
      updateScanEvent(event.id, { faceCaptureId: event.id });
      event.faceCaptureId = event.id;
    }
  } catch {
    /* capture gagal — scan tetap valid */
  }
  // Sekarang foto (kalau ada) sudah siap → enqueue ke backend & flush.
  // Scan penerbangan UJI tidak dikirim (lihat processScan).
  if (event.isTest) return { outcome, event };
  try {
    enqueueScanPush(event);
    if (event.faceCaptureId) attachFaceToQueued(event.id, event.faceCaptureId);
    flushApiOutbox().catch(() => {});
  } catch {
    /* sync backend tidak boleh mengganggu hasil scan */
  }
  return { outcome, event };
}

/* Text-to-speech — suara manusia mengucapkan hasil scan (Bahasa Indonesia). */
export function speakFeedback(text: string, volume = 1) {
  if (typeof window === "undefined") return;
  const synth = window.speechSynthesis;
  if (!synth) return;
  try {
    synth.cancel(); // hentikan ucapan sebelumnya agar tidak menumpuk
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "id-ID";
    utter.rate = 1.05;
    utter.pitch = 1.05;
    utter.volume = volume;
    // Pilih voice Bahasa Indonesia bila tersedia di perangkat.
    const voices = synth.getVoices();
    const idVoice =
      voices.find((v) => v.lang?.toLowerCase().startsWith("id")) ?? null;
    if (idVoice) utter.voice = idVoice;
    synth.speak(utter);
  } catch {
    /* ignore */
  }
}

/* ───────────────────── Audio feedback hasil scan ─────────────────────
 * Suara = nada pendek (Web Audio) + rekaman suara manusia di /public/sounds.
 * Rekaman dipakai, bukan speechSynthesis, karena Chromium/Electron di Linux
 * (kiosk Lubuntu) umumnya tidak punya suara TTS Bahasa Indonesia. TTS hanya
 * cadangan bila file rekaman gagal dimuat.
 *
 * Kebijakan autoplay Chromium: AudioContext baru boleh berbunyi setelah ada
 * interaksi pengguna. Satu AudioContext dipakai bersama dan di-resume pada
 * klik/sentuh/tombol pertama (primeFeedbackAudio), jadi scan via kamera
 * setelahnya tetap berbunyi. Kiosk tanpa interaksi sama sekali butuh kebijakan
 * Chromium AutoplayAllowlist / switch autoplay-policy (lihat kiosk-agent).
 */

type VoiceClip = "berhasil" | "duplikat" | "gagal";

const VOICE_TEXT: Record<VoiceClip, string> = {
  berhasil: "Berhasil",
  duplikat: "Tiket sudah dipakai",
  gagal: "Gagal",
};

let audioCtx: AudioContext | null = null;
const clipCache = new Map<VoiceClip, Promise<AudioBuffer | null>>();
let primed = false;

function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (audioCtx && audioCtx.state !== "closed") return audioCtx;
  const Ctor =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioCtx = new Ctor();
  } catch {
    audioCtx = null;
  }
  return audioCtx;
}

function loadClip(name: VoiceClip): Promise<AudioBuffer | null> {
  const cached = clipCache.get(name);
  if (cached) return cached;
  const p = (async () => {
    const ctx = getAudioCtx();
    if (!ctx) return null;
    try {
      const res = await fetch(`/sounds/scan-${name}.mp3`);
      if (!res.ok) return null;
      const data = await res.arrayBuffer();
      return await ctx.decodeAudioData(data);
    } catch {
      return null;
    }
  })();
  // Gagal (mis. offline sebelum ter-cache) → boleh dicoba lagi nanti.
  p.then((b) => {
    if (!b) clipCache.delete(name);
  });
  clipCache.set(name, p);
  return p;
}

/** Coba hidupkan AudioContext; true bila sudah boleh berbunyi. */
async function ensureRunning(ctx: AudioContext): Promise<boolean> {
  if (ctx.state === "running") return true;
  try {
    await Promise.race([
      ctx.resume(),
      new Promise((r) => setTimeout(r, 300)),
    ]);
  } catch {
    /* ignore */
  }
  return (ctx.state as string) === "running";
}

/**
 * Siapkan audio feedback: muat rekaman & buka kunci autoplay pada interaksi
 * pertama. Panggil sekali saat halaman scan dibuka (aman dipanggil berulang).
 */
export function primeFeedbackAudio() {
  if (typeof window === "undefined" || primed) return;
  primed = true;
  (Object.keys(VOICE_TEXT) as VoiceClip[]).forEach((c) => void loadClip(c));
  const unlock = () => {
    const ctx = getAudioCtx();
    if (!ctx) return;
    ctx.resume().catch(() => {});
    if (ctx.state === "running") {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      window.removeEventListener("touchstart", unlock, true);
    }
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
  window.addEventListener("touchstart", unlock, true);
  unlock(); // langsung jalan bila kebijakan autoplay sudah mengizinkan
}

function clipFor(status: ScanResultStatus): VoiceClip {
  if (status === "VALID_FLIGHT") return "berhasil";
  if (status === "DUPLICATE_SCAN") return "duplikat";
  return "gagal";
}

/** Putar contoh suara dari halaman pengaturan (tetap berbunyi walau suara dimatikan). */
export function previewFeedbackSound(status: ScanResultStatus) {
  if (typeof window === "undefined") return;
  primeFeedbackAudio();
  void playFeedbackSoundAsync(status);
}

/* Web Audio feedback — nada + suara "Berhasil"/"Tiket sudah dipakai"/"Gagal". */
export function playFeedbackSound(status: ScanResultStatus) {
  if (typeof window === "undefined") return;
  if (!getSettings().soundOn) return;
  void playFeedbackSoundAsync(status);
}

async function playFeedbackSoundAsync(status: ScanResultStatus) {
  const clip = clipFor(status);
  const volume = Math.min(1, Math.max(0, (getSettings().soundVolume ?? 100) / 100));
  if (volume <= 0) return;
  const ctx = getAudioCtx();
  if (!ctx || !(await ensureRunning(ctx))) {
    // Web Audio tak tersedia / masih dikunci autoplay — coba TTS saja.
    speakFeedback(VOICE_TEXT[clip], volume);
    return;
  }

  try {
    // Satu master gain untuk nada & rekaman → volume per perangkat.
    const master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    setTimeout(() => master.disconnect(), 10_000);
    /** Mainkan satu nada pada offset waktu tertentu. */
    const note = (
      freq: number,
      start: number,
      dur: number,
      type: OscillatorType = "sine",
      peak = 0.25,
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(master);
      osc.type = type;
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + start;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    };

    let toneLen: number;
    if (status === "VALID_FLIGHT") {
      // "Ding" pendek sebagai pembuka sebelum suara "Berhasil".
      note(880, 0.0, 0.1, "sine", 0.18);
      note(1318.5, 0.08, 0.14, "sine", 0.18);
      toneLen = 0.25;
    } else if (status === "DUPLICATE_SCAN") {
      // Dua nada datar — peringatan duplikat.
      note(660, 0.0, 0.16, "square", 0.2);
      note(660, 0.2, 0.2, "square", 0.2);
      toneLen = 0.45;
    } else {
      // Buzz turun — gagal / ditolak.
      note(320, 0.0, 0.18, "square", 0.22);
      note(180, 0.16, 0.34, "square", 0.22);
      toneLen = 0.55;
    }
    const startAt = ctx.currentTime + toneLen;

    const buf = await loadClip(clip);
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(master);
      src.start(Math.max(startAt, ctx.currentTime));
    } else {
      setTimeout(() => speakFeedback(VOICE_TEXT[clip], volume), toneLen * 1000);
    }
  } catch {
    /* ignore */
  }
}

/* Haptic feedback (mobile) — gated by user settings */
export function playFeedbackHaptic(status: ScanResultStatus) {
  if (typeof window === "undefined") return;
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  try {
    const { getSettings } = require("./settings") as typeof import("./settings");
    if (!getSettings().hapticOn) return;
  } catch {
    /* allow vibrate if settings unavailable */
  }
  try {
    if (status === "VALID_FLIGHT") navigator.vibrate(40);
    else if (status === "DUPLICATE_SCAN") navigator.vibrate([30, 60, 30]);
    else navigator.vibrate([80, 40, 80]);
  } catch {
    /* ignore */
  }
}
