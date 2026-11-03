"use client";

import { Locale } from "./settings";

type Dict = Record<string, string>;

const ID: Dict = {
  "nav.dashboard": "Dashboard",
  "nav.flights": "Jadwal Penerbangan",
  "nav.scan": "Scan Boarding Pass",
  "nav.scanEvents": "Riwayat Scan",
  "nav.passengers": "Cari Penumpang",
  "nav.radar": "Radar Pesawat",
  "nav.jadwalFids": "Jadwal (FIDS)",
  "nav.analytics": "Statistik",
  "nav.rekapMaskapai": "Rekap Maskapai",
  "nav.insights": "AI Insight",
  "nav.settings": "Pengaturan",
  "nav.boardingPassSeeder": "Seeder Boarding Pass",
  "nav.connect": "Koneksi Backend",
  "nav.adminScans": "Monitor Scan (Server)",
  "nav.adminOfficers": "Kelola Petugas",
  "nav.adminDevices": "Perangkat",
  "nav.activityLog": "Log Aktivitas",
  "nav.section.operations": "Operasional",
  "nav.section.data": "Data",
  "nav.section.system": "Sistem",
  "common.logout": "Keluar",
  "common.search": "Cari",
  "common.save": "Simpan",
  "common.cancel": "Batal",
  "common.delete": "Hapus",
  "common.back": "Kembali",
  "common.today": "Hari ini",
  "common.tomorrow": "Besok",
  "common.all": "Semua",
  "common.loading": "Memuat…",
  "common.empty": "Tidak ada data",
  "common.print": "Print",
  "common.export": "Export",
  "settings.title": "Pengaturan",
  "settings.subtitle":
    "Atur preferensi pribadi dan kelola data lokal aplikasi.",
  "settings.tab.profile": "Profil",
  "settings.tab.preferences": "Preferensi",
  "settings.tab.data": "Data",
  "settings.profile.name": "Nama",
  "settings.profile.email": "Email",
  "settings.profile.role": "Peran",
  "settings.pref.sound": "Suara feedback scan",
  "settings.pref.haptic": "Getaran (mobile)",
  "settings.pref.locale": "Bahasa",
  "settings.section.appearance": "Tampilan",
  "settings.pref.theme": "Tema aplikasi",
  "settings.pref.theme.desc":
    "Airport Brand untuk operasional siang; Dark untuk pos malam atau pencahayaan rendah.",
  "settings.pref.theme.airport": "Airport Brand",
  "settings.pref.theme.dark": "Dark",
  "settings.section.boarding": "Jadwal & Boarding",
  "settings.pref.flightOnlyToday": "Tampilkan hanya jadwal hari ini",
  "settings.pref.flightOnlyToday.desc":
    "Default filter pada daftar penerbangan. Bisa dilewati lewat opsi \"Semua tanggal\".",
  "settings.pref.autoClose": "Auto-close jadwal hari lalu",
  "settings.pref.autoClose.desc":
    "Set status OPEN/ACTIVE jadwal hari kemarin menjadi CLOSED saat aplikasi dibuka.",
  "settings.pref.openWindow": "Buka boarding (menit sebelum)",
  "settings.pref.openWindow.desc":
    "Berapa menit sebelum STD status efektif berubah jadi OPEN.",
  "settings.pref.activeWindow": "Final call (menit sebelum)",
  "settings.pref.activeWindow.desc":
    "Berapa menit sebelum STD status efektif berubah jadi ACTIVE.",
  "settings.pref.closeWindow": "Tutup boarding (menit setelah)",
  "settings.pref.closeWindow.desc":
    "Berapa menit setelah STD status efektif berubah jadi CLOSED.",
  "settings.data.export": "Export semua data (JSON)",
  "settings.data.archiveExport": "Export arsip scan",
  "settings.data.archivePurge": "Hapus arsip",
  "settings.data.reset": "Reset semua data",
  "settings.data.resetConfirm":
    "Yakin reset semua data? Flight, scan event, dan pengaturan akan dikembalikan ke seed awal.",
  "topbar.operational": "Operasional Bandara",
};

const EN: Dict = {
  "nav.dashboard": "Dashboard",
  "nav.flights": "Flights Schedule",
  "nav.scan": "Scan Boarding Pass",
  "nav.scanEvents": "Scan History",
  "nav.passengers": "Find Passenger",
  "nav.radar": "Flight Radar",
  "nav.jadwalFids": "Schedule (FIDS)",
  "nav.analytics": "Analytics",
  "nav.rekapMaskapai": "Airline Recap",
  "nav.insights": "AI Insight",
  "nav.settings": "Settings",
  "nav.boardingPassSeeder": "Boarding Pass Seeder",
  "nav.connect": "Backend Connection",
  "nav.adminScans": "Scan Monitor (Server)",
  "nav.adminOfficers": "Manage Officers",
  "nav.adminDevices": "Devices",
  "nav.activityLog": "Activity Log",
  "nav.section.operations": "Operations",
  "nav.section.data": "Data",
  "nav.section.system": "System",
  "common.logout": "Logout",
  "common.search": "Search",
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.back": "Back",
  "common.today": "Today",
  "common.tomorrow": "Tomorrow",
  "common.all": "All",
  "common.loading": "Loading…",
  "common.empty": "No data",
  "common.print": "Print",
  "common.export": "Export",
  "settings.title": "Settings",
  "settings.subtitle":
    "Manage personal preferences and local application data.",
  "settings.tab.profile": "Profile",
  "settings.tab.preferences": "Preferences",
  "settings.tab.data": "Data",
  "settings.profile.name": "Name",
  "settings.profile.email": "Email",
  "settings.profile.role": "Role",
  "settings.pref.sound": "Scan feedback sound",
  "settings.pref.haptic": "Haptic feedback (mobile)",
  "settings.pref.locale": "Language",
  "settings.section.appearance": "Appearance",
  "settings.pref.theme": "App theme",
  "settings.pref.theme.desc":
    "Airport Brand for daytime operations; Dark for night-shift posts or low-light environments.",
  "settings.pref.theme.airport": "Airport Brand",
  "settings.pref.theme.dark": "Dark",
  "settings.section.boarding": "Schedule & Boarding",
  "settings.pref.flightOnlyToday": "Show only today's flights",
  "settings.pref.flightOnlyToday.desc":
    "Default filter on the flight list. Can be overridden with \"All dates\".",
  "settings.pref.autoClose": "Auto-close past-day flights",
  "settings.pref.autoClose.desc":
    "Set OPEN/ACTIVE flights from previous days to CLOSED when the app loads.",
  "settings.pref.openWindow": "Open boarding (minutes before)",
  "settings.pref.openWindow.desc":
    "How many minutes before STD the effective status becomes OPEN.",
  "settings.pref.activeWindow": "Final call (minutes before)",
  "settings.pref.activeWindow.desc":
    "How many minutes before STD the effective status becomes ACTIVE.",
  "settings.pref.closeWindow": "Close boarding (minutes after)",
  "settings.pref.closeWindow.desc":
    "How many minutes after STD the effective status becomes CLOSED.",
  "settings.data.export": "Export all data (JSON)",
  "settings.data.archiveExport": "Export scan archive",
  "settings.data.archivePurge": "Purge archive",
  "settings.data.reset": "Reset all data",
  "settings.data.resetConfirm":
    "Reset all data? Flights, scan events, and settings will return to initial seed.",
  "topbar.operational": "Airport Operations",
};

const DICTS: Record<Locale, Dict> = { id: ID, en: EN };

export function t(key: string, locale: Locale = "id"): string {
  return DICTS[locale][key] ?? DICTS.id[key] ?? key;
}
