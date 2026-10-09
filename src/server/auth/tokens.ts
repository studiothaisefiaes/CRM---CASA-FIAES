import { createHash, randomBytes } from "node:crypto";

/** Token aleatório (vai para o cookie/link). No banco guardamos só o hash. */
export function newToken() { return randomBytes(32).toString("base64url"); }
export function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
