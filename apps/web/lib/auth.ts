import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { mockMode } from "./store";
export const authKey = () => {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 32) return new TextEncoder().encode(s);
  if (mockMode())
    return new TextEncoder().encode(
      "local-demo-only-not-for-production-0123456789",
    );
  throw new Error("AUTH_SECRET must have at least 32 characters");
};
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function verifyPassword(password: string, hash: string) {
  const [salt, key] = hash.split(":");
  const expected = Buffer.from(key, "hex");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export async function token(id: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(id)
    .setIssuedAt()
    .setExpirationTime("8h")
    .setIssuer("framecraft")
    .setAudience("session")
    .sign(authKey());
}
export async function identity(request: Request) {
  try {
    const cookie = request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("fc_session="))
      ?.slice(11);
    if (!cookie) return null;
    return (
      (
        await jwtVerify(cookie, authKey(), {
          algorithms: ["HS256"],
          issuer: "framecraft",
          audience: "session",
        })
      ).payload.sub ?? null
    );
  } catch {
    return null;
  }
}
