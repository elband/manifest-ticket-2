"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  Plane,
  Radar,
  ScanLine,
  Server,
  History,
  LogOut,
  Menu,
  X,
  ShieldCheck,
  CalendarDays,
  Users,
  Database,
  BarChart3,
  Building2,
  BrainCircuit,
  CalendarClock,
  Settings as SettingsIcon,
  ChevronRight,
  ChevronLeft,
  Wifi,
  WifiOff,
  Clock as ClockIcon,
  PanelLeftClose,
  PanelLeft,
  Ticket,
  UserCog,
  ScrollText,
  MonitorSmartphone,
} from "lucide-react";
import { SessionUser, UserRole } from "@/lib/types";
import { archiveOldScanEvents, ensureSeed, getSession } from "@/lib/storage";
import { sweepPastDayFlights } from "@/lib/flightSweeper";
import { logout } from "@/lib/auth";
import { cn, todayDateString } from "@/lib/utils";
import { getSettings } from "@/lib/settings";
import {
  getApiOutboxSummary,
  subscribeApiOutbox,
  type ApiOutboxSummary,
} from "@/lib/api/outbox";
import { pullFidsKeberangkatan } from "@/lib/jadwal/flightSync";
import { useT, useLocale } from "@/lib/useT";
import { BottomNav } from "./BottomNav";
import { ThemeSwitch } from "@/components/ui/ThemeSwitch";
import { InstallPrompt } from "@/components/InstallPrompt";
import { InsightBubble } from "@/components/insights/InsightBubble";

interface NavItem {
  href: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: UserRole[];
}

interface NavSection {
  labelKey: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    labelKey: "nav.section.operations",
    items: [
      {
        href: "/dashboard",
        labelKey: "nav.dashboard",
        icon: LayoutDashboard,
        roles: ["admin", "supervisor"],
      },
      {
        href: "/scan",
        labelKey: "nav.scan",
        icon: ScanLine,
        roles: ["admin", "supervisor", "security"],
      },
      {
        href: "/passengers",
        labelKey: "nav.passengers",
        icon: Users,
        roles: ["admin", "supervisor"],
      },
      {
        href: "/radar",
        labelKey: "nav.radar",
        icon: Radar,
        roles: ["admin", "supervisor"],
      },
    ],
  },
  {
    labelKey: "nav.section.data",
    items: [
      {
        href: "/flights",
        labelKey: "nav.flights",
        icon: Plane,
        roles: ["admin", "supervisor"],
      },
      {
        href: "/jadwal",
        labelKey: "nav.jadwalFids",
        icon: CalendarClock,
        roles: ["admin", "supervisor"],
      },
      {
        href: "/scan-events",
        labelKey: "nav.scanEvents",
        icon: History,
        roles: ["admin", "supervisor"],
      },
      {
        href: "/analytics",
        labelKey: "nav.analytics",
        icon: BarChart3,
        roles: ["admin", "supervisor"],
      },
      {
        href: "/rekap-maskapai",
        labelKey: "nav.rekapMaskapai",
        icon: Building2,
        roles: ["admin", "supervisor"],
      },
      {
        href: "/insights",
        labelKey: "nav.insights",
        icon: BrainCircuit,
        roles: ["admin", "supervisor"],
      },
      {
        href: "/admin/scans",
        labelKey: "nav.adminScans",
        icon: Database,
        roles: ["admin", "supervisor"],
      },
      {
        href: "/admin/officers",
        labelKey: "nav.adminOfficers",
        icon: UserCog,
        roles: ["admin"],
      },
      {
        href: "/admin/devices",
        labelKey: "nav.adminDevices",
        icon: MonitorSmartphone,
        roles: ["admin"],
      },
    ],
  },
  {
    labelKey: "nav.section.system",
    items: [
      {
        href: "/seeders/boarding-pass",
        labelKey: "nav.boardingPassSeeder",
        icon: Ticket,
        roles: ["admin"],
      },
      {
        href: "/admin/activity-log",
        labelKey: "nav.activityLog",
        icon: ScrollText,
        roles: ["admin"],
      },
      {
        href: "/connect",
        labelKey: "nav.connect",
        icon: Server,
        roles: ["admin"],
      },
      {
        href: "/settings",
        labelKey: "nav.settings",
        icon: SettingsIcon,
        roles: ["admin", "supervisor"],
      },
    ],
  },
];

// Rute yang terdaftar di menu hanya boleh dibuka role yang tercantum —
// menyembunyikan menu saja tidak cukup karena URL bisa diketik langsung.
function isRouteAllowed(pathname: string, role: UserRole): boolean {
  for (const sec of NAV_SECTIONS) {
    for (const item of sec.items) {
      if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
        return item.roles.includes(role);
      }
    }
  }
  return true;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return <AppShellInner>{children}</AppShellInner>;
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();
  const locale = useLocale();
  const [session, setSession] = useState<SessionUser | null>(null);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);
  const [sync, setSync] = useState<ApiOutboxSummary | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("afvs.sidebar.collapsed");
    if (stored === "1") setCollapsed(true);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          "afvs.sidebar.collapsed",
          next ? "1" : "0",
        );
      }
      return next;
    });
  };

  useEffect(() => {
    ensureSeed();
    archiveOldScanEvents(1);
    sweepPastDayFlights();
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    if (s.role === "security" && !pathname.startsWith("/scan")) {
      router.replace("/scan/kiosk");
      return;
    }
    if (!isRouteAllowed(pathname, s.role)) {
      setReady(false);
      router.replace("/dashboard");
      return;
    }
    setSession(s);
    setReady(true);
  }, [pathname, router]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // P-15: jam dipindah ke komponen <LiveClock/> sendiri agar update tiap detik
  // tidak me-render ulang seluruh shell.

  // Online = jaringan hidup DAN server SIPANDAI terjangkau (dari outbox, yang
  // juga melacak berapa scan belum terkirim).
  useEffect(() => {
    const refresh = () => setSync(getApiOutboxSummary());
    refresh();
    return subscribeApiOutbox(refresh);
  }, []);
  const online = sync?.online ?? true;
  const waiting = sync?.pending ?? 0;

  // Auto-sync FIDS → data flight tiap 3 menit (silent, fire-and-forget).
  // Saklar di Pengaturan (fidsAutoSync); dicek tiap tick agar bisa di-on/off
  // tanpa reload. Pull memancarkan event "afvs:flights-updated" → UI refresh.
  useEffect(() => {
    const run = () => {
      if (!getSettings().fidsAutoSync) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      pullFidsKeberangkatan(todayDateString()).catch(() => {});
    };
    const first = setTimeout(run, 5000); // beri jeda setelah first paint
    const id = setInterval(run, 180_000); // 3 menit
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  if (!ready || !session) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl bg-surface/90 px-5 py-3 text-sm text-ink-muted shadow-card ring-1 ring-hairline backdrop-blur">
          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
          {t("common.loading")}
        </div>
      </div>
    );
  }

  const visibleSections = NAV_SECTIONS.map((sec) => ({
    ...sec,
    items: sec.items.filter((n) => n.roles.includes(session.role)),
  })).filter((sec) => sec.items.length > 0);
  const roleLabel: Record<UserRole, string> = {
    admin: "Administrator",
    supervisor: "Supervisor",
    security: "Security",
  };
  const roleTone: Record<UserRole, string> = {
    admin: "bg-blue-100 text-blue-700 ring-blue-200",
    supervisor: "bg-violet-100 text-violet-700 ring-violet-200",
    security: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  };

  const handleLogout = () => {
    logout();
    router.replace("/login");
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex transform flex-col border-r border-slate-200/60 bg-white shadow-soft transition-all duration-300 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 print:hidden",
          "dark:border-hairline dark:bg-surface",
          collapsed ? "w-[76px]" : "w-72",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div
          className={cn(
            "relative flex h-16 items-center border-b border-slate-100",
            collapsed ? "justify-center px-2" : "justify-between px-5",
          )}
        >
          <Link
            href="/dashboard"
            className={cn(
              "flex items-center gap-2.5 transition",
              collapsed && "justify-center",
            )}
            title="SIPANDAI"
          >
            <div className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-lift">
              <ShieldCheck className="h-5 w-5" />
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-white" />
            </div>
            {!collapsed && (
              <div className="leading-tight">
                <p className="text-sm font-bold tracking-tight text-slate-800">
                  SIPANDAI
                </p>
                <p className="text-[11px] text-slate-500">Validasi Boarding Pass</p>
              </div>
            )}
          </Link>
          {!collapsed && (
            <button
              className="text-slate-500 lg:hidden"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          )}
          {/* Desktop collapse toggle — sits on the right edge */}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Buka sidebar" : "Ciutkan sidebar"}
            title={collapsed ? "Buka sidebar" : "Ciutkan sidebar"}
            className="absolute -right-3 top-1/2 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-blue-50 hover:text-blue-700 hover:shadow-md lg:flex"
          >
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronLeft className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        <nav
          className={cn(
            "overflow-y-auto py-4",
            collapsed ? "px-2" : "px-3",
          )}
        >
          {visibleSections.map((section, sIdx) => (
            <div
              key={section.labelKey}
              className={cn(sIdx > 0 && "mt-5")}
            >
              {!collapsed && (
                <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  {t(section.labelKey)}
                </p>
              )}
              {collapsed && sIdx > 0 && (
                <div className="my-2 mx-auto h-px w-8 bg-slate-200/70" />
              )}
              <div className="space-y-0.5">
                {section.items.map((item, idx) => {
                  const Icon = item.icon;
                  const active =
                    pathname === item.href ||
                    pathname.startsWith(item.href + "/");
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? t(item.labelKey) : undefined}
                      className={cn(
                        "group relative flex items-center rounded-xl text-[13px] font-semibold transition-all duration-200 animate-fade-up",
                        collapsed
                          ? "justify-center px-1.5 py-2"
                          : "gap-3 px-3 py-2",
                        active
                          ? "bg-blue-50 text-blue-700 ring-1 ring-blue-100 shadow-[0_4px_12px_-4px_rgba(37,99,235,0.25)] dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-500/25"
                          : "text-slate-600 hover:bg-slate-50 hover:text-blue-700 dark:text-ink-muted dark:hover:bg-surface-elev dark:hover:text-sky-300",
                      )}
                      style={{ animationDelay: `${(sIdx * 3 + idx) * 30}ms` }}
                    >
                      <span
                        className={cn(
                          "flex items-center justify-center rounded-lg transition",
                          collapsed ? "h-9 w-9" : "h-7 w-7",
                          active
                            ? "bg-white text-blue-700 ring-1 ring-blue-200 shadow-sm dark:bg-sky-500/20 dark:text-sky-200 dark:ring-sky-400/40"
                            : "bg-slate-100 text-slate-600 ring-1 ring-slate-200 group-hover:bg-white group-hover:text-blue-700 group-hover:ring-blue-200 dark:bg-surface-2 dark:text-ink-muted dark:ring-hairline dark:group-hover:bg-surface-elev dark:group-hover:text-sky-300 dark:group-hover:ring-sky-800",
                        )}
                      >
                        <Icon
                          className={cn(collapsed ? "h-4 w-4" : "h-3.5 w-3.5")}
                        />
                      </span>
                      {!collapsed && (
                        <span className="truncate">{t(item.labelKey)}</span>
                      )}
                      {active && !collapsed && (
                        <span className="absolute right-3 hidden h-1.5 w-1.5 rounded-full bg-sky-300 shadow-[0_0_10px_rgba(125,211,252,0.95)] dark:block" />
                      )}
                      {active && collapsed && (
                        <span className="absolute right-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-l-full bg-blue-500 shadow-[0_0_8px_rgba(37,99,235,0.6)] dark:bg-sky-300 dark:shadow-[0_0_10px_rgba(125,211,252,0.85)]" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>


        <div className={cn("mt-auto p-3 pt-6", !collapsed && "p-4 pt-8")}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 text-sm font-bold text-white shadow-sm ring-2 ring-white"
                title={`${session.name} · ${roleLabel[session.role]}`}
              >
                {session.name.charAt(0).toUpperCase()}
              </div>
              <button
                onClick={handleLogout}
                title={t("common.logout")}
                aria-label={t("common.logout")}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-white ring-1 ring-slate-200 text-slate-600 transition hover:bg-rose-50 hover:text-rose-700 hover:ring-rose-200"
              >
                <LogOut className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={toggleCollapsed}
                title="Buka sidebar"
                aria-label="Buka sidebar"
                className="hidden h-9 w-9 items-center justify-center rounded-xl bg-white ring-1 ring-slate-200 text-slate-600 transition hover:bg-blue-50 hover:text-blue-700 hover:ring-blue-200 lg:flex"
              >
                <PanelLeft className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-[0_4px_16px_-6px_rgba(15,42,98,0.18)] dark:border-hairline dark:bg-surface">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 text-sm font-bold text-white shadow-[0_4px_10px_-2px_rgba(37,99,235,0.5)] ring-2 ring-white dark:ring-surface-elev">
                  {session.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-ink">
                    {session.name}
                  </p>
                  <span
                    className={cn(
                      "mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
                      roleTone[session.role],
                    )}
                  >
                    {roleLabel[session.role]}
                  </span>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleLogout}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 dark:border-hairline dark:bg-surface-2 dark:text-ink-muted dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  {t("common.logout")}
                </button>
                <button
                  type="button"
                  onClick={toggleCollapsed}
                  title="Ciutkan sidebar"
                  aria-label="Ciutkan sidebar"
                  className="hidden h-[34px] w-[34px] items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:border-hairline dark:bg-surface-2 dark:text-ink-muted dark:hover:bg-sky-500/10 dark:hover:text-sky-300 lg:flex"
                >
                  <PanelLeftClose className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm lg:hidden print:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header
          className="sticky top-0 z-20 border-b border-slate-200/60 bg-gradient-to-r from-white/85 via-white/75 to-blue-50/70 backdrop-blur-md print:hidden dark:border-hairline dark:bg-none dark:bg-surface/95"
          style={{
            paddingTop: "env(safe-area-inset-top)",
            paddingLeft: "env(safe-area-inset-left)",
            paddingRight: "env(safe-area-inset-right)",
          }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-400/60 to-transparent"
          />
          <div className="flex h-14 items-center justify-between gap-3 px-3 sm:h-16 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                className="rounded-lg p-2 text-slate-600 transition hover:bg-blue-50 hover:text-blue-700 lg:hidden"
                onClick={() => setOpen(true)}
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-brandvar">
                  <span className="inline-flex items-center gap-1">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    </span>
                    {t("topbar.operational")}
                  </span>
                  <ChevronRight className="h-3 w-3 text-ink-subtle" />
                  <span className="truncate text-ink-muted">
                    {breadcrumbTail(pathname, t)}
                  </span>
                </div>
                <h1 className="truncate text-base font-bold tracking-tight text-ink sm:text-lg">
                  {currentTitle(pathname, t)}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Online indicator */}
              <div
                className={cn(
                  "hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 backdrop-blur sm:inline-flex",
                  online
                    ? "bg-emerald-50/80 text-emerald-700 ring-emerald-200"
                    : "bg-rose-50/80 text-rose-700 ring-rose-200",
                )}
                title={
                  online
                    ? "Online"
                    : "Server tidak terjangkau. Data tersimpan di perangkat dan dikirim otomatis saat koneksi pulih."
                }
              >
                {online ? (
                  <Wifi className="h-3 w-3" />
                ) : (
                  <WifiOff className="h-3 w-3" />
                )}
                {online ? "Online" : "Offline"}
                {waiting > 0 && ` · ${waiting} menunggu`}
              </div>

              {/* Live clock + date — P-15: komponen sendiri (re-render terisolasi). */}
              <LiveClock locale={locale} />

              {/* Theme switch — visible mobile + desktop */}
              <ThemeSwitch />

              {/* User chip */}
              <div className="hidden items-center gap-2 rounded-xl bg-white/80 px-2 py-1 ring-1 ring-slate-200 backdrop-blur sm:inline-flex dark:bg-surface-2/90 dark:ring-hairline">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 text-[11px] font-bold text-white ring-2 ring-white">
                  {session.name.charAt(0).toUpperCase()}
                </div>
                <div className="hidden pr-1 leading-tight md:block">
                  <p className="text-[11px] font-semibold text-slate-800">
                    {session.name}
                  </p>
                  <p className="text-[10px] capitalize text-slate-500">
                    {session.role}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleLogout}
                title="Ganti petugas"
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-rose-50 px-2.5 text-xs font-bold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 hover:ring-rose-300 sm:px-3"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Ganti Petugas</span>
              </button>
            </div>
          </div>
        </header>

        <main
          className="flex-1 px-4 pt-4 sm:px-6 sm:pt-6 print:p-0 pb-[calc(env(safe-area-inset-bottom)+6rem)] lg:pb-6"
          style={{
            paddingLeft: "max(1rem, env(safe-area-inset-left))",
            paddingRight: "max(1rem, env(safe-area-inset-right))",
          }}
        >
          {children}
        </main>
      </div>

      <InstallPrompt />
      <InsightBubble />
      {session.role !== "security" && (
        <BottomNav onMoreClick={() => setOpen(true)} />
      )}
    </div>
  );
}

// P-15: jam terisolasi. State `now` di sini → hanya komponen ini yang re-render
// tiap detik, bukan seluruh AppShell. Berhenti saat tab tidak terlihat.
function LiveClock({ locale }: { locale: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      setNow(new Date());
    }, 1000);
    const onVis = () => {
      if (document.visibilityState === "visible") setNow(new Date());
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return (
    <>
      <div className="hidden items-center gap-2 rounded-xl bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 backdrop-blur md:inline-flex">
        <ClockIcon className="h-3.5 w-3.5 text-blue-600" />
        <span className="font-mono tabular-nums tracking-tight text-slate-800">
          {now
            ? now.toLocaleTimeString(locale === "id" ? "id-ID" : "en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })
            : "--:--:--"}
        </span>
      </div>

      <div className="hidden items-center gap-2 rounded-xl bg-white/80 px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 backdrop-blur lg:inline-flex">
        <CalendarDays className="h-3.5 w-3.5 text-blue-600" />
        {(now ?? new Date()).toLocaleDateString(locale === "id" ? "id-ID" : "en-US", {
          weekday: "short",
          day: "2-digit",
          month: "short",
          year: "numeric",
        })}
      </div>
    </>
  );
}

function breadcrumbTail(pathname: string, t: (k: string) => string) {
  if (pathname.startsWith("/dashboard")) return t("nav.dashboard");
  if (pathname.startsWith("/flights/create")) return "Tambah";
  if (pathname.startsWith("/flights/") && pathname.endsWith("/edit"))
    return "Edit";
  if (pathname.startsWith("/flights/")) return "Detail";
  if (pathname === "/flights") return t("nav.flights");
  if (pathname.startsWith("/jadwal")) return t("nav.jadwalFids");
  if (pathname.startsWith("/scan-events")) return t("nav.scanEvents");
  if (pathname.startsWith("/scan")) return t("nav.scan");
  if (pathname.startsWith("/passengers")) return t("nav.passengers");
  if (pathname.startsWith("/radar")) return t("nav.radar");
  if (pathname.startsWith("/connect")) return t("nav.connect");
  if (pathname.startsWith("/admin/officers")) return t("nav.adminOfficers");
  if (pathname.startsWith("/admin/devices")) return t("nav.adminDevices");
  if (pathname.startsWith("/admin/activity-log")) return t("nav.activityLog");
  if (pathname.startsWith("/admin/scans")) return t("nav.adminScans");
  if (pathname.startsWith("/analytics")) return t("nav.analytics");
  if (pathname.startsWith("/insights")) return t("nav.insights");
  if (pathname.startsWith("/settings")) return t("nav.settings");
  return "Home";
}

function currentTitle(pathname: string, t: (k: string) => string) {
  if (pathname.startsWith("/dashboard")) return t("nav.dashboard");
  if (pathname === "/flights") return t("nav.flights");
  if (pathname.startsWith("/flights/create")) return "Tambah Penerbangan";
  if (pathname.startsWith("/flights/")) return "Detail Penerbangan";
  if (pathname.startsWith("/jadwal")) return t("nav.jadwalFids");
  if (pathname.startsWith("/scan-events")) return t("nav.scanEvents");
  if (pathname.startsWith("/scan")) return t("nav.scan");
  if (pathname.startsWith("/passengers")) return t("nav.passengers");
  if (pathname.startsWith("/radar")) return t("nav.radar");
  if (pathname.startsWith("/connect")) return t("nav.connect");
  if (pathname.startsWith("/admin/officers")) return t("nav.adminOfficers");
  if (pathname.startsWith("/admin/devices")) return t("nav.adminDevices");
  if (pathname.startsWith("/admin/activity-log")) return t("nav.activityLog");
  if (pathname.startsWith("/admin/scans")) return t("nav.adminScans");
  if (pathname.startsWith("/analytics")) return t("nav.analytics");
  if (pathname.startsWith("/insights")) return t("nav.insights");
  if (pathname.startsWith("/settings")) return t("nav.settings");
  return "SIPANDAI";
}
