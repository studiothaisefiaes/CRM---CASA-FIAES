/**
 * Junta as anotações que estavam presas nos leads ao campo único do contato (Lote 2). Idempotente: texto que já está lá não entra
 * de novo. Cada uma entra com o dia da conversa, da mais antiga para a mais nova, depois do que o contato já tinha.
 */
export function mergeNotes(current: string | null, items: { at: string; text: string }[]): { text: string | null; added: number } {
  let text = current?.trim() ?? "";
  let added = 0;
  for (const it of [...items].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const body = it.text.trim();
    if (!body || text.includes(body)) continue;
    const day = new Date(it.at).toLocaleDateString("pt-BR", { timeZone: "America/Bahia" });
    text = `${text}${text ? "\n\n" : ""}— Anotação da conversa de ${day} —\n${body}`;
    added++;
  }
  return { text: text || null, added };
}
