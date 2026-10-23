import { stripCompleteProfile } from "./complete-profile";
/**
 * O nome como a tela mostra. Nome que chegou todo em MAIÚSCULAS ("CARLA HENRIQUES", comum em contato salvo no celular) vira Título
 * ("Carla Henriques"), com as partículas em minúsculas ("Carla Gomes dos Henriques"). Misturado ou em minúsculas fica como veio:
 * pode ser de propósito. Só desenho: o banco guarda o nome original.
 */
const PARTICLES = new Set(["da", "de", "do", "das", "dos", "e", "d'"]);
const LOCALE = "pt-BR";

const cap = (s: string) => (s ? s[0].toLocaleUpperCase(LOCALE) + s.slice(1) : s);
/** "ana-maria" → "Ana-Maria"; "d'ávila" → "d'Ávila" (a partícula d' fica minúscula, o resto ganha a inicial). */
function word(w: string, first: boolean): string {
  if (!first && PARTICLES.has(w)) return w;
  return w.split("-").map((part) => {
    const m = /^(d')(.+)$/.exec(part);
    if (m) return (first ? cap(m[1]) : m[1]) + cap(m[2]);
    return cap(part);
  }).join("-");
}

export function displayName(raw: string): string {
  const name = stripCompleteProfile(raw).name; // "(completar cadastro)" do Avec nunca aparece na tela (17/10)
  const letters = name.replace(/[^\p{L}]/gu, "");
  if (letters.length < 2 || letters !== letters.toLocaleUpperCase(LOCALE) || letters === letters.toLocaleLowerCase(LOCALE)) return name;
  return name.trim().split(/\s+/).map((w, i) => word(w.toLocaleLowerCase(LOCALE), i === 0)).join(" ");
}
