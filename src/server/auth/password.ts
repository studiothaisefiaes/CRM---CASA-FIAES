import { hash, verify } from "@node-rs/argon2";

// Argon2id com parâmetros recomendados pela OWASP (19 MiB, 2 iterações).
const OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(plain: string) {
  return hash(plain, OPTS);
}

export async function verifyPassword(hashed: string | null | undefined, plain: string) {
  if (!hashed) return false;
  try { return await verify(hashed, plain); } catch { return false; }
}

export const PASSWORD_RULE = "A senha precisa ter pelo menos 8 caracteres.";
export function isValidPassword(p: string) { return typeof p === "string" && p.length >= 8 && p.length <= 200; }
