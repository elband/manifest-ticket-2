"use client";

import { SessionUser, UserRole } from "./types";
import { getSession, getUsers, setSession } from "./storage";

function toSessionUser(user: {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

export function login(
  email: string,
  password: string,
): { ok: true; user: SessionUser } | { ok: false; error: string } {
  const user = getUsers().find(
    (u) => u.email.toLowerCase() === email.trim().toLowerCase(),
  );
  if (!user) return { ok: false, error: "Email tidak ditemukan." };
  if (user.role === "security") {
    return {
      ok: false,
      error: "Petugas security masuk menggunakan PIN.",
    };
  }
  if (user.password !== password)
    return { ok: false, error: "Password salah." };

  const session = toSessionUser(user);
  setSession(session);
  return { ok: true, user: session };
}

export function loginWithPin(
  pin: string,
): { ok: true; user: SessionUser } | { ok: false; error: string } {
  const cleaned = pin.trim();
  if (!/^\d{4,6}$/.test(cleaned)) {
    return { ok: false, error: "PIN harus 4-6 digit." };
  }

  const user = getUsers().find(
    (u) => u.role === "security" && u.pin === cleaned,
  );
  if (!user) return { ok: false, error: "PIN petugas tidak ditemukan." };

  const session = toSessionUser(user);
  setSession(session);
  return { ok: true, user: session };
}

export function logout() {
  setSession(null);
}

export function currentUser(): SessionUser | null {
  return getSession();
}

export function canManageFlights(role: UserRole | undefined): boolean {
  return role === "admin" || role === "supervisor";
}

// Hapus flight khusus admin — selaras dengan @Roles("admin") di DELETE /flights/:id.
export function canDeleteFlights(role: UserRole | undefined): boolean {
  return role === "admin";
}

export function canScan(role: UserRole | undefined): boolean {
  return (
    role === "security" || role === "admin" || role === "supervisor"
  );
}
