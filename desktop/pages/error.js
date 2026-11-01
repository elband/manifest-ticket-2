"use strict";

const desktop = window.sipandaiDesktop;
const $ = (id) => document.getElementById(id);

// Sambung ulang otomatis (kiosk sering menyala sebelum Wi-Fi siap), kecuali
// masalah sertifikat yang butuh keputusan manusia.
const AUTO_RETRY_SECONDS = 15;

async function init() {
  const s = await desktop.getSetup();
  const f = s.failure ?? {};
  $("server").textContent = s.serverUrl;
  $("code").textContent = `${f.code ?? "?"} ${f.description ?? ""}`.trim();

  if (s.cert) {
    $("title").textContent = "Sertifikat server tidak dikenal";
    $("message").textContent =
      "Koneksi ditolak karena sertifikat HTTPS server tidak ditandatangani CA yang dikenal perangkat ini.";
    $("cert").hidden = false;
    $("fingerprint").textContent = s.cert.fingerprint ?? "-";
    $("issuer").textContent = s.cert.issuer ?? "-";
    $("trust").hidden = false;
    return;
  }

  let left = AUTO_RETRY_SECONDS;
  const tick = () => {
    $("auto").textContent = `Mencoba lagi otomatis dalam ${left} detik…`;
    if (left-- <= 0) desktop.retry();
    else setTimeout(tick, 1000);
  };
  tick();
}

$("retry").addEventListener("click", () => desktop.retry());
$("trust").addEventListener("click", () => desktop.trustCert());
$("setup").addEventListener("click", () => desktop.openSetup());
$("quit").addEventListener("click", () => desktop.quit());

init();
