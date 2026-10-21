import { createHash, randomBytes } from "node:crypto";

/** Token aleatório (vai para o cookie/link). No banco guardamos só o hash. */
export function newToken() { return randomBytes(32).toString("base64url"); }
export function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }

/** Letras e números sem os que se confundem lendo (0/O, 1/l/I): 57 símbolos. */
export const SHORT_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const SHORT_LEN = 8;

/**
 * Código curto do link da cliente: 8 símbolos de 57 = 57^8 ≈ 1,1·10^14 (46,6 bits), sorteados com crypto e sem viés
 * (descarta o byte que cairia fora do último múltiplo de 57). Adivinhar fica inviável com o limite de tentativas por IP da rota /c.
 */
export function newShortToken(len = SHORT_LEN): string {
  const n = SHORT_ALPHABET.length;
  const max = 256 - (256 % n);
  let out = "";
  while (out.length < len) {
    for (const b of randomBytes(len * 2)) {
      if (b >= max) continue;
      out += SHORT_ALPHABET[b % n];
      if (out.length === len) break;
    }
  }
  return out;
}
