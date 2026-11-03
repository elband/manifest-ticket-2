import { JwtService } from "@nestjs/jwt";
import { UserThrottlerGuard } from "./user-throttler.guard";

const SECRET = "x".repeat(40);

describe("UserThrottlerGuard.getTracker", () => {
  const guard = new UserThrottlerGuard({ throttlers: [] }, {} as never, {} as never);
  const track = (headers: Record<string, string>) =>
    (guard as unknown as { getTracker(r: unknown): Promise<string> }).getTracker({
      ip: "192.168.50.1",
      headers,
    });

  beforeAll(() => {
    process.env.JWT_SECRET = SECRET;
  });

  it("token sah → dihitung per petugas, bukan per IP gateway", async () => {
    const token = new JwtService({ secret: SECRET }).sign({ sub: "op_1" });
    await expect(track({ authorization: `Bearer ${token}` })).resolves.toBe("user:op_1");
  });

  it("tanpa token → per IP", async () => {
    await expect(track({})).resolves.toBe("ip:192.168.50.1");
  });

  it("token palsu (secret lain) → per IP, tak bisa mengakali throttle login", async () => {
    const forged = new JwtService({ secret: "y".repeat(40) }).sign({ sub: "op_1" });
    await expect(track({ authorization: `Bearer ${forged}` })).resolves.toBe("ip:192.168.50.1");
  });
});
