/**
 * "É a mesma pessoa?" pelo nome (várias pessoas no mesmo número, 17/10). Usado na importação do Avec e no script
 * `scripts/pessoas-mesmo-numero.ts` para separar a mãe da filha sem quebrar a mesma cliente escrita de outro jeito.
 *
 * Na dúvida, é a MESMA pessoa (criar uma pessoa a mais por engano divide o histórico da cliente; não criar só mantém como está).
 * Mesma pessoa quando o primeiro nome de uma:
 * - é igual, começa ou termina o primeiro nome da outra, ou está dentro dele ("Lu"/"Luciana", "Neide"/"Marineide", "Isa"/"Adalgisa");
 * - difere por 1 letra (2 em nomes de 5+ letras) ou letras trocadas: erro de digitação ("Maiana"/"Mariana", "Ari"/"Air");
 * - é o começo dele com 1 letra diferente ("Jacy"/"Jacineide", "Gaby"/"Gabriela", "Mary"/"Marilucia");
 * - é um apelido conhecido ("Bia"/"Beatriz", "Bela"/"Isabela", "Malu"/"Carla Igarashi") ou o apelido entre parênteses ("(LOLI) Maria Iolanda");
 * - aparece entre os nomes da outra ("Clara"/"Carla Barros Vidal", "Cristiane Atualizar"/"Linda Cristiane").
 * "Maria"/"Ana" + outro nome: vale o segundo ("Carla Werneck" não é "Carla Ingrid").
 * Sobrenome igual NÃO faz ser a mesma pessoa: mãe e filha costumam ter ("Wanda Rezende"/"Helena Rezende").
 */

const CONNECTORS = new Set(["de", "da", "do", "das", "dos", "e", "d"]);
const TITLES = new Set(["dra", "dr", "sra", "sr", "srta", "prof", "profa"]);
/** Primeiro nome comum que costuma vir com um segundo ("Carla Barros", "Ana Luisa"): quem decide é o segundo. */
const COMPOUND = new Set(["maria", "ana", "anna"]);
/** Parêntese que diz quem ela é para outra pessoa ("(mãe de Aline)") não é apelido. */
const RELATION_WORDS = /\b(mae|filha|filho|pai|irma|irmao|esposa|marido|avo|neta|tia|sobrinha|cliente|amiga)\b/;
const NICKNAMES: Record<string, string[]> = {
  bia: ["beatriz"], bela: ["isabel", "isabela", "isabella", "isabelle"], bella: ["isabel", "isabela", "isabella", "isabelle"], bel: ["isabel", "isabela", "isabella"],
  gabi: ["gabriela", "gabriella", "gabrielle", "gabriele"], gaby: ["gabriela", "gabriella", "gabrielle", "gabriele"], duda: ["eduarda"],
  gal: ["graca", "gracas", "graziela", "grazielle"], aninha: ["ana", "anna"], guta: ["augusta"], cacau: ["claudia"], tata: ["tatiana", "tatiane"], dri: ["adriana"], drika: ["adriana"],
};

const plain = (raw: string | null | undefined) => String(raw ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const words = (s: string) => s.split(/[^a-z]+/).filter((w) => w && !CONNECTORS.has(w));

/** Palavras do nome, sem acento, sem parênteses ("(mãe de Neila)"), sem número nem símbolo, sem "de/da" e sem título. */
export function nameTokens(raw: string | null | undefined): string[] {
  return words(plain(raw).replace(/\([^)]*\)?/g, " ")).filter((w, i, all) => !(i === 0 && TITLES.has(w) && all.length > 1));
}

/** Apelido escrito entre parênteses no nome ("(LOLI)Maria Iolanda"): até 2 palavras, sem relação ("mãe de…"). */
function aliases(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of plain(raw).matchAll(/\(([^)]*)\)?/g)) {
    const w = words(m[1]);
    if (w.length >= 1 && w.length <= 2 && !RELATION_WORDS.test(m[1])) out.push(w[0]);
  }
  return out;
}

/** Distância de edição com troca de letras vizinhas ("ari"/"air" = 1). */
function dist(a: string, b: string): number {
  if (a === b) return 0;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

const nick = (a: string, b: string) => !!NICKNAMES[a]?.some((n) => b === n || b.startsWith(n)) || !!NICKNAMES[b]?.some((n) => a === n || a.startsWith(n));

/** Primeiros nomes parecidos (apelido, diminutivo ou erro de digitação). */
function firstNamesMatch(a: string, b: string): boolean {
  if (a === b || nick(a, b)) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 2 && long.startsWith(short)) return true;
  if (short.length >= 3 && long.includes(short)) return true;
  if (short.length >= 4 && dist(short, long.slice(0, short.length)) <= 1) return true;
  const min = short.length;
  const max = min >= 5 ? 2 : min >= 4 ? 1 : 0;
  if (max > 0 && dist(a, b) <= max) return true;
  return min === 3 && a.length === b.length && dist(a, b) === 1 && [...a].sort().join("") === [...b].sort().join("");
}

/** Um nome aparece entre os nomes da outra: igual, com 1 letra de diferença (5+ letras) ou como começo dela ("Nanci"/"Nancyedna"). */
const inOther = (w: string, others: string[]) => others.some((o) => o === w || (w.length >= 5 && o.length >= 5 && dist(w, o) <= 1)
  || (w.length >= 4 && o.length > w.length && dist(w, o.slice(0, w.length)) <= 1));

/** "Malu" = Carla Igarashi/Luisa (as duas primeiras letras de cada nome). */
const maluLike = (w: string, t: string[]) => w.length === 4 && t.length >= 2 && t[0].startsWith(w.slice(0, 2)) && t[1].startsWith(w.slice(2));

/** Os dois nomes são da mesma pessoa? Nome vazio (ou sem letras) nunca separa ninguém: conta como a mesma. */
export function samePerson(a: string | null | undefined, b: string | null | undefined): boolean {
  let ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.length || !tb.length) return true;
  const alA = aliases(a), alB = aliases(b);
  if (alA.some((x) => firstNamesMatch(x, tb[0])) || alB.some((x) => firstNamesMatch(x, ta[0]))) return true;
  if (maluLike(ta[0], tb) || maluLike(tb[0], ta)) return true;
  // "Carla Werneck" × "Carla Ingrid": o primeiro nome comum não decide, vale o segundo.
  if (ta.length >= 2 && tb.length >= 2 && ta[0] === tb[0] && COMPOUND.has(ta[0])) { ta = ta.slice(1); tb = tb.slice(1); }
  // "Ana Carolina" × "Anna Carolina": primeiro nome curto quase igual e o segundo igual.
  if (ta.length >= 2 && tb.length >= 2 && ta[1] === tb[1] && ta[1].length >= 4 && dist(ta[0], tb[0]) <= 1) return true;
  if (firstNamesMatch(ta[0], tb[0])) return true;
  return inOther(ta[0], tb.slice(1)) || inOther(tb[0], ta.slice(1));
}

/** Nome que dá para usar como ficha (tem ao menos uma palavra de 2+ letras). */
export const isUsableName = (raw: string | null | undefined) => nameTokens(raw).some((w) => w.length >= 2);

/** Agrupa nomes da mesma pessoa (se A~B e B~C, os três ficam juntos), na ordem em que o primeiro nome de cada grupo apareceu. */
export function groupNames<T extends { name: string }>(items: T[]): T[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    if (samePerson(items[i].name, items[j].name)) parent[find(j)] = find(i);
  }
  const groups = new Map<number, T[]>();
  items.forEach((it, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), it]); });
  return [...groups.values()];
}
