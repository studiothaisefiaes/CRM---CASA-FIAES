/** @ nas notas internas: funções puras (o campo da conversa usa; os testes também). */
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const firstOf = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** O que a pessoa digita logo depois de um @ no fim do texto ("@ca" → "ca"); null = não está chamando ninguém. */
export function mentionQuery(text: string): string | null {
  const m = text.match(/(?:^|\s)@([\p{L}]*)$/u);
  return m ? m[1] : null;
}

/** Quem aparece na lista do @: começa com o que foi digitado (primeiro nome, sem acento nem maiúscula). No máximo 6. */
export function mentionOptions<T extends { id: string; name: string }>(team: T[], query: string): T[] {
  const q = norm(query);
  return team.filter((p) => norm(firstOf(p.name)).startsWith(q)).slice(0, 6);
}

/** Troca o "@ca" do fim pelo "@Catarina " escolhido. */
export const insertMention = (text: string, name: string) => text.replace(/@([\p{L}]*)$/u, `@${firstOf(name)} `);

/** Ids de quem continua chamado no texto final (o @Nome está lá, sem acento nem maiúscula importando). */
export function mentionsIn(text: string, team: { id: string; name: string }[]): string[] {
  const words = new Set([...norm(text).matchAll(/@([a-z0-9]+)/g)].map((m) => m[1]));
  return team.filter((p) => words.has(norm(firstOf(p.name)))).map((p) => p.id);
}
