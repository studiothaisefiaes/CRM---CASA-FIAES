import { eq } from "drizzle-orm";
import { db, type Tx } from "../db";
import { auditLog, settings } from "../db/schema";
import { FUNCOES, FUNCOES_FASE_C, FuncaoInvalidaError, resolveFuncao, validateFuncaoPatch, type Funcao, type FuncaoDef, type Funcoes, type FuncoesState } from "@/lib/funcoes";
import { UserFacingError } from "./errors";

/** `settings.funcoes` = FuncoesState. O último parâmetro `defs` existe para os testes injetarem um registro próprio; o padrão é FUNCOES. */
const KEY = "funcoes";

/**
 * Só entram chaves que parecem função (letras minúsculas, números e _; até 64). Em produção havia uma chave de 316
 * caracteres ("setores consentimento … unir") com {on: true}, gravada por script (QA r66, M-2): é ignorada na leitura e some na próxima gravação.
 */
const KEY_SHAPE = /^[a-z][a-z0-9_]{0,63}$/;
const parseState = (v: unknown): FuncoesState => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v).filter(([k]) => KEY_SHAPE.test(k))) as FuncoesState;
};

export async function getFuncoesState(q: Tx | typeof db = db): Promise<FuncoesState> {
  const [r] = await q.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY));
  return parseState(r?.value);
}

function defOf(key: string, defs: FuncaoDef[]): FuncaoDef {
  const d = defs.find((x) => x.key === key);
  if (!d) throw new UserFacingError("Função desconhecida.");
  return d;
}

export async function funcaoLigada(key: string, defs: FuncaoDef[] = FUNCOES): Promise<boolean> {
  const d = defOf(key, defs);
  return resolveFuncao(d, await getFuncoesState()).on;
}

export async function assertFuncaoLigada(key: string, defs: FuncaoDef[] = FUNCOES): Promise<void> {
  const d = defOf(key, defs);
  if (!resolveFuncao(d, await getFuncoesState()).on) throw new UserFacingError(`${d.label} está desligada em Configurações › Recursos.`);
}

export async function funcaoParam(key: string, param: string, defs: FuncaoDef[] = FUNCOES): Promise<number> {
  const d = defOf(key, defs);
  const v = resolveFuncao(d, await getFuncoesState()).params[param];
  if (v === undefined) throw new UserFacingError("Número desconhecido.");
  return v;
}

export async function funcaoTexto(key: string, texto: string, defs: FuncaoDef[] = FUNCOES): Promise<string> {
  const d = defOf(key, defs);
  const v = resolveFuncao(d, await getFuncoesState()).textos[texto];
  if (v === undefined) throw new UserFacingError("Texto desconhecido.");
  return v;
}

/** Valida, grava (merge) e audita com de/para. Quem envia para a cliente só liga com a confirmação de envio real vinda da tela. */
export async function saveFuncao(key: string, patch: unknown, userId: string, opts?: { confirmouEnvio?: boolean }, defs: FuncaoDef[] = FUNCOES): Promise<void> {
  const d = defOf(key, defs);
  let p: ReturnType<typeof validateFuncaoPatch>;
  try { p = validateFuncaoPatch(d, patch); } catch (e) { throw e instanceof FuncaoInvalidaError ? new UserFacingError(e.message) : e; }
  if (p.on !== undefined && d.ligaEm) throw new UserFacingError(`Ligue em ${d.ligaEm}.`);
  if (p.on === true && d.enviaParaCliente && opts?.confirmouEnvio !== true) throw new UserFacingError("Confirme o envio real para ligar.");
  await db.transaction(async (tx) => {
    // Garante a linha e a trava: duas gravações ao mesmo tempo esperam uma pela outra e cada uma parte do que a anterior gravou.
    await tx.insert(settings).values({ key: KEY, value: {} }).onConflictDoNothing({ target: settings.key });
    const [row] = await tx.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY)).for("update");
    const state = parseState(row?.value);
    const before = resolveFuncao(d, state);
    const cur = state[key] ?? {};
    const next: NonNullable<FuncoesState[string]> = { ...cur };
    if (p.on !== undefined) next.on = p.on;
    if (p.params) next.params = { ...cur.params, ...p.params };
    if (p.textos) {
      const t = { ...cur.textos };
      for (const [k, v] of Object.entries(p.textos)) { if (v === null) delete t[k]; else t[k] = v; }
      next.textos = t;
    }
    const after = resolveFuncao(d, { ...state, [key]: next });
    const de: Record<string, unknown> = {}, para: Record<string, unknown> = {};
    if (p.on !== undefined) { de.on = before.on; para.on = after.on; }
    if (p.params) { de.params = {}; para.params = {}; for (const k of Object.keys(p.params)) { (de.params as Record<string, number>)[k] = before.params[k]; (para.params as Record<string, number>)[k] = after.params[k]; } }
    if (p.textos) { de.textos = {}; para.textos = {}; for (const k of Object.keys(p.textos)) { (de.textos as Record<string, string>)[k] = before.textos[k]; (para.textos as Record<string, string>)[k] = after.textos[k]; } }
    const value = { ...state, [key]: next };
    await tx.update(settings).set({ value, updatedAt: new Date() }).where(eq(settings.key, KEY));
    await tx.insert(auditLog).values({ userId, action: "funcao", entity: "settings", entityId: KEY, data: { key, de, para } });
  });
}

// ---- Fase C: liga/desliga simples (a API curta que as telas e as ações da Fase C usam), sobre o mesmo registro ----
type Q = Tx | typeof db;
/** Liga/desliga de cada função da Fase C. Valor ausente ou inválido → o padrão do registro (ligada). */
export async function getFuncoes(q: Q = db): Promise<Funcoes> {
  const state = await getFuncoesState(q);
  return Object.fromEntries(FUNCOES_FASE_C.map((k) => [k, resolveFuncao(FUNCOES.find((d) => d.key === k)!, state).on])) as Funcoes;
}
export async function isFuncaoOn(f: Funcao, q: Q = db): Promise<boolean> { return (await getFuncoes(q))[f]; }
/** Em toda ação nova do servidor: função desligada recusa (esconder na tela não basta). */
export async function assertFuncao(f: Funcao, q: Q = db): Promise<void> {
  if (!(await isFuncaoOn(f, q))) throw new UserFacingError("Essa função está desligada em Configurações › Recursos.");
}
/** Muda só as funções do `patch`; cada mudança é auditada como as demais funções. */
export async function saveFuncoes(patch: Partial<Funcoes>, userId: string): Promise<Funcoes> {
  for (const [k, on] of Object.entries(patch)) {
    if (!(FUNCOES_FASE_C as readonly string[]).includes(k) || typeof on !== "boolean") throw new UserFacingError("Função desconhecida.");
    await saveFuncao(k, { on }, userId);
  }
  return getFuncoes();
}
