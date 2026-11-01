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

init();
