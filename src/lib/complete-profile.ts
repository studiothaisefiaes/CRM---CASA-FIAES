/**
 * "(completar cadastro)" do Avec (17/10, análise de dados §4.3): 52 contatos com o lembrete da recepção no nome ("(COMPLETAR CADASTRO)",
 * "(COMPLETAR)", "NOME COMPLETAR", sem o parêntese de fechar, com recado "(MÃE AMIGA … - COMPLETAR CADASTRO)"). O sufixo sai do nome e
 * vira a etiqueta "Completar cadastro"; o recado vai para a observação. Mesma regra do script 02 do coordenador. Função pura (tela e
 * servidor). "completar" no meio do nome ou nome que ficaria vazio: não muda (à mão).
 */
export const COMPLETE_PROFILE_TAG = "Completar cadastro";

const PAREN = /\s*\(([^()]*completar[^()]*)\)?\s*$/i;
const LOOSE = /\s*[-–:]?\s*completar(\s+cadastr\w*)?(\s+online)?\s*$/i;
const NOTE_TAIL = /[\s\-–:]*completar(\s+cadastr\w*)?(\s+online)?\s*$/i;

export function stripCompleteProfile(raw: string): { name: string; note: string | null; hit: boolean } {
  const same = { name: raw, note: null, hit: false };
  if (!/completar/i.test(raw)) return same;
  const paren = PAREN.exec(raw);
  const note = paren ? paren[1].replace(NOTE_TAIL, "").trim() || null : null;
  const name = raw.replace(PAREN, "").replace(LOOSE, "").replace(/\s+/g, " ").trim();
  if (!name || /complet/i.test(name)) return same;
  return { name, note, hit: true };
}
