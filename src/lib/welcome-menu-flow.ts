/**
 * Menu de boas-vindas (item 9): o formato da configuração e o passo a passo da escolha. Puro (sem banco): usado pelo servidor
 * (`maybeWelcomeChoice`) e pela tela ("Testar como cliente"), então é seguro para componente de cliente.
 */

export type MenuReply = { text?: string | null; fileId?: string | null };
export type MenuPassTo = { team: string } | { user: string };
/** Uma opção do menu. O formato antigo `{ label, tag }` continua valendo: é uma opção sem o resto. Submenu só no 1º nível. */
export type MenuOption = {
  label: string;
  tag?: string | null;
  reply?: MenuReply | null;
  passTo?: MenuPassTo | null;
  submenu?: { intro: string; options: MenuOption[] } | null;
};
export type WelcomeConfig = { enabled: boolean; intro: string; options: MenuOption[] };

export const WELCOME_SOURCE = "menu_boas_vindas";
/** Resposta de uma opção (texto ou arquivo): continuação do menu, sai mesmo depois de o menu ter saído. */
export const WELCOME_REPLY_SOURCE = `${WELCOME_SOURCE}:resposta`;
/** Submenu da opção `i` (0-based) do menu de cima. */
export const welcomeSubmenuSource = (i: number) => `${WELCOME_SOURCE}:${i}`;
/** O caminho do menu que saiu com esse `source`: [] = menu de cima, [i] = submenu da opção i; null = não é um menu (resposta ou outro). */
export function welcomePathOf(source: string | null | undefined): number[] | null {
  if (source === WELCOME_SOURCE) return [];
  const m = source?.match(/^menu_boas_vindas:(\d+)$/);
  return m ? [Number(m[1])] : null;
}

/** No máximo 2 níveis e 2 a 6 opções por nível (forma da tela, não regra de negócio). */
export const WELCOME_MIN_OPTIONS = 2;
export const WELCOME_MAX_OPTIONS = 6;
export const WELCOME_SUGGESTED_INTRO = "Olá! Bem-vinda à Casa Fiaes 💛 Para eu te ajudar mais rápido, responda com o número da opção:";
export const WELCOME_SUGGESTED_SUBMENU_INTRO = "Certo! Agora responda com o número:";

/** Sem acento, sem símbolo (o ® some), minúsculo e com um espaço só. */
export const menuNorm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/**
 * A cliente escolheu uma opção? "2", " 2 ", "2.", "2️⃣", "opção 2" ou o nome da opção (sem acento nem ®). Qualquer outra coisa
 * ("tenho 2 filhas", "dois horários") não é escolha: a equipe atende. Devolve o índice 0-based.
 */
export function parseMenuChoice(text: string, options: { label: string }[]): number | null {
  const t = text.normalize("NFC").replace(/⃣|️/g, "");
  const m = t.match(/^\s*(?:op(?:ç|c)[aã]o\s*)?(\d)\s*[.)-]?\s*$/i);
  if (m) {
    const i = Number(m[1]) - 1;
    return i >= 0 && i < options.length ? i : null;
  }
  const n = menuNorm(t);
  if (!n) return null;
  const i = options.findIndex((o) => menuNorm(o.label) === n);
  return i >= 0 ? i : null;
}

/** O texto que a cliente recebe: a saudação e as opções numeradas. */
export function welcomeText(c: { intro: string; options: { label: string }[] }): string {
  return [c.intro.trim(), "", ...c.options.map((o, i) => `${i + 1}. ${o.label.trim()}`)].join("\n");
}

/** O nível do menu nesse caminho: [] = menu de cima, [i] = submenu da opção i. */
export function menuLevel(cfg: Pick<WelcomeConfig, "intro" | "options">, path: number[]): { intro: string; options: MenuOption[] } | null {
  if (path.length === 0) return cfg;
  if (path.length === 1) {
    const sub = cfg.options[path[0]]?.submenu;
    return sub && sub.options.length >= WELCOME_MIN_OPTIONS ? sub : null;
  }
  return null;
}

export type MenuStep =
  | { kind: "escolheu"; path: number[]; option: MenuOption }
  | { kind: "submenu"; path: number[]; text: string }
  | { kind: "nao_entendi" };

/** Um passo: a cliente está no nível `path` e escreveu `input`. Opção com submenu (só no 1º nível) devolve o texto do submenu. */
export function menuStep(cfg: Pick<WelcomeConfig, "intro" | "options">, path: number[], input: string): MenuStep {
  const level = menuLevel(cfg, path);
  if (!level) return { kind: "nao_entendi" };
  const i = parseMenuChoice(input, level.options);
  if (i === null) return { kind: "nao_entendi" };
  const option = level.options[i];
  const next = [...path, i];
  const sub = path.length === 0 ? menuLevel(cfg, next) : null;
  if (sub) return { kind: "submenu", path: next, text: welcomeText(sub) };
  return { kind: "escolheu", path: next, option };
}

/** As opções no caminho (para a nota: "2. Método Fiaes® › 1. Primeira avaliação"). */
export function menuTrail(cfg: Pick<WelcomeConfig, "intro" | "options">, path: number[]): { n: number; label: string }[] {
  const out: { n: number; label: string }[] = [];
  let level: { options: MenuOption[] } | null | undefined = cfg;
  for (const i of path) {
    const o: MenuOption | undefined = level?.options[i];
    if (!o) break;
    out.push({ n: i + 1, label: o.label.trim() });
    level = o.submenu;
  }
  return out;
}
