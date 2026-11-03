import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import { Observable, from, throwError } from "rxjs";
import { catchError, switchMap, tap } from "rxjs/operators";
import { JwtPayload } from "../auth/auth.service";
import { ACTIVITY_CATALOG, SKIPPED, changedFields } from "./activity-catalog";
import { ActivityLogsService } from "./activity-logs.service";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PREFIX = "/api";

/**
 * Mencatat setiap request yang mengubah data ke tabel ActivityLog — berhasil
 * maupun gagal — beserta pelaku, IP, perangkat & durasinya. Dipasang global
 * (APP_INTERCEPTOR), jadi endpoint baru otomatis ikut tercatat.
 *
 * Catatan: interceptor jalan SETELAH guard, sehingga request yang ditolak
 * JwtAuthGuard/RolesGuard (401/403) tidak sampai ke sini.
 */
@Injectable()
export class ActivityLogInterceptor implements NestInterceptor {
  constructor(private logs: ActivityLogsService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== "http") return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    if (!MUTATING.has(req.method)) return next.handle();

    const routePath = String(req.route?.path ?? req.path);
    const pattern = routePath.startsWith(PREFIX) ? routePath.slice(PREFIX.length) : routePath;
    const key = `${req.method} ${pattern}`;
    if (SKIPPED.has(key)) return next.handle();

    const def = ACTIVITY_CATALOG[key];
    const started = Date.now();
    const body = isObject(req.body) ? req.body : {};
    const targetId = (req.params?.id as string | undefined) ?? null;

    // Label target diambil SEBELUM handler (setelah DELETE datanya sudah hilang).
    let target: string | null = null;
    const prefetch =
      def?.lookup && targetId
        ? this.logs.targetLabel(def.lookup, targetId).then((l) => (target = l))
        : Promise.resolve(null);

    const write = (statusCode: number, response: unknown, error: string | null) => {
      void (async () => {
        const actor = this.actorOf(req, def?.category === "auth" ? response : null, body);
        const success = statusCode < 400;
        let base = def ? def.describe({ target, body }) : `${req.method} ${pattern}`;
        if (!success && def?.category === "auth") {
          base = `Gagal ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
        }
        await this.logs.record({
          ...actor,
          action: def ? (success ? def.action : `${def.action}_failed`) : "system.request",
          category: def?.category ?? "system",
          description: base,
          method: req.method,
          path: req.originalUrl.split("?")[0],
          statusCode,
          success,
          targetId,
          ip: req.ip ?? null,
          userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
          durationMs: Date.now() - started,
          meta: buildMeta(def?.category === "auth" ? {} : body, error),
        });
      })();
    };

    return from(prefetch).pipe(
      switchMap(() => next.handle()),
      tap((response) => {
        const res = ctx.switchToHttp().getResponse<{ statusCode?: number }>();
        write(res.statusCode ?? 200, response, null);
      }),
      catchError((err: unknown) => {
        const status = err instanceof HttpException ? err.getStatus() : 500;
        write(status, null, errorMessage(err));
        return throwError(() => err);
      }),
    );
  }

  /** Pelaku: dari JWT; untuk login dari respons (berhasil) / body (gagal). */
  private actorOf(
    req: Request & { user?: JwtPayload },
    loginResponse: unknown,
    body: Record<string, unknown>,
  ) {
    if (req.user?.kind === "device") {
      return {
        operatorId: null,
        operatorName: `Perangkat ${req.user.name ?? req.user.sub}`,
        operatorEmail: null,
        operatorRole: "device",
      };
    }
    if (req.user) {
      return {
        operatorId: req.user.sub,
        operatorEmail: req.user.email,
        operatorRole: req.user.role,
      };
    }
    const u = (loginResponse as { user?: { id: string; email: string; role: string } } | null)
      ?.user;
    if (u) return { operatorId: u.id, operatorEmail: u.email, operatorRole: u.role };
    const email = typeof body.email === "string" ? body.email.slice(0, 190) : null;
    return { operatorId: null, operatorEmail: email, operatorRole: null };
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function errorMessage(err: unknown): string {
  if (err instanceof HttpException) {
    const r = err.getResponse() as { message?: unknown } | string;
    const m = typeof r === "string" ? r : r?.message;
    return (Array.isArray(m) ? m.join(", ") : String(m ?? err.message)).slice(0, 300);
  }
  return "Kesalahan server";
}

function buildMeta(body: Record<string, unknown>, error: string | null) {
  const fields = changedFields(body);
  const meta: Record<string, unknown> = {};
  if (fields.length) meta.fields = fields;
  if (error) meta.error = error;
  return Object.keys(meta).length ? meta : null;
}
