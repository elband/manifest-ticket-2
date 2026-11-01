"use strict";

const desktop = window.sipandaiDesktop;
const $ = (id) => document.getElementById(id);

async function init() {
  const s = await desktop.getSetup();
  $("version").textContent = `Versi ${s.version}${s.kiosk ? " · mode kiosk" : ""}`;
  $("server").value = s.serverUrl;
  if (s.locked) {
    $("server").disabled = true;
    $("save").hidden = true;
    $("server-hint").textContent = "Alamat server dikunci oleh administrator.";
  }
  // Ada server tersimpan → halaman ini dibuka dari menu, boleh kembali.
  if (s.serverUrl) {
    $("cancel").hidden = false;
    $("cancel").textContent = s.locked ? "Kembali" : "Batal";
  }

  if (s.shortcuts.supported) {
    $("shortcuts").hidden = false;
    $("sc-launcher").checked = s.shortcuts.launcher;
    $("sc-autostart").checked = s.shortcuts.autostart;
  }
  if (!s.locked) $("server").focus();
}

$("server-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("server-error").textContent = "";
  const res = await desktop.saveServer($("server").value);
  if (!res.ok) $("server-error").textContent = res.error;
});

$("cancel").addEventListener("click", () => desktop.cancel());

for (const [id, kind] of [
  ["sc-launcher", "launcher"],
  ["sc-autostart", "autostart"],
]) {
  $(id).addEventListener("change", async (e) => {
    const status = await desktop.setShortcut(kind, e.target.checked);
    $("sc-launcher").checked = status.launcher;
    $("sc-autostart").checked = status.autostart;
  });
}

function updateText(u) {
  const time = (iso) =>
    iso ? new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "";
  switch (u.status) {
    case "unsupported":
      return "Pembaruan otomatis hanya aktif di aplikasi yang terpasang di Lubuntu.";
    case "idle":
      return `Versi ${u.currentVersion}. Pembaruan akan dicek otomatis.`;
    case "checking":
      return "Memeriksa pembaruan…";
    case "latest":
      return `Versi ${u.currentVersion} sudah yang terbaru (dicek ${time(u.checkedAt)}).`;
    case "downloading":
      return `Mengunduh versi ${u.version}… ${u.percent ?? 0}%`;
    case "ready":
      return `Versi ${u.version} siap dipasang (sekarang ${u.currentVersion}).`;
    case "installing":
      return "Memasang pembaruan… masukkan password admin bila diminta.";
    case "error":
      return `Versi ${u.currentVersion}. Pemeriksaan pembaruan gagal.`;
    default:
      return "";
  }
}

async function refreshUpdate() {
  const { update: u } = await desktop.getSetup();
  $("update-status").textContent = updateText(u);
  $("update-error").textContent = u.error ?? "";
  $("update-install").hidden = u.status !== "ready";
  $("update-note").hidden = u.status !== "ready";
  $("update-check").hidden = !["idle", "latest", "error"].includes(u.status);
}

$("update-check").addEventListener("click", async () => {
  await desktop.checkUpdate();
  refreshUpdate();
});
$("update-install").addEventListener("click", async () => {
  await desktop.installUpdate();
  refreshUpdate();
});

init();
refreshUpdate();
// Status unduhan berubah di latar belakang → segarkan berkala.
setInterval(refreshUpdate, 1500);
