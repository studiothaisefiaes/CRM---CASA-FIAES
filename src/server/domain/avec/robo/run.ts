import { applyAvecFiles, type AvecFileInput } from "../apply";
import { buildTable } from "./parse";
import { bahiaDay, planReports, weeklyDue, type RoboReport } from "./plan";
import { alertRoboFailure, getRoboLast, saveRoboLast, type RoboLast } from "./settings";

/** De onde vêm os relatórios: o Avec de verdade (Playwright) ou um simulado nos testes. */
export interface AvecSource {
  /** Cabeçalho e linhas cruas (como o Avec devolve) do relatório, com os parâmetros por cima do formulário. */
  fetchReport(code: string, params: Record<string, string>): Promise<{ headers: string[]; aaData: unknown }>;
}

/** Entrar no Avec falhou (senha trocada, tela de login mudou): para tudo. */
export class AvecLoginError extends Error {}

export type RoboOptions = { now?: Date; dryRun?: boolean; forceWeekly?: boolean; only?: string[]; log?: (m: string) => void; pauseMs?: number;
  /** Rodada parcial (a de hora em hora da agenda): não grava como a última rodada do dia. */ partial?: boolean };

/** Condição da Casa, não falha do robô (ex.: sem programa de fidelidade): fica no resultado do relatório, sem aviso no sino. */
const SOFT = /não há programa/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Baixa os relatórios do dia, entrega ao mesmo importador do upload e grava o resultado (`avec_robo_ultimo`). Falha → aviso no sino. */
export async function runRobo(source: AvecSource, opts: RoboOptions = {}): Promise<RoboLast & { dryRun: boolean }> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const today = bahiaDay(now);
  const prev = opts.dryRun ? null : await getRoboLast().catch(() => null);
  const weekly = !!opts.forceWeekly || weeklyDue(prev?.semanalEm, today);
  const plan: RoboReport[] = planReports(now, { weekly, only: opts.only });

  const erros: string[] = [];
  const relatorios: RoboLast["relatorios"] = [];
  const inputs: AvecFileInput[] = [];
  for (const rep of plan) {
    try {
      const { headers, aaData } = await source.fetchReport(rep.code, rep.params);
      const rows = buildTable(rep.code, rep.expect, headers, aaData);
      relatorios.push({ codigo: rep.code, titulo: rep.title, linhas: rows.length - 1 });
      inputs.push({ fileName: `robo-avec-${rep.code}-${today}.xlsx`, rows, now });
      log(`${rep.code} ${rep.title}: ${rows.length - 1} linhas`);
    } catch (e) {
      const msg = (e as Error).message;
      relatorios.push({ codigo: rep.code, titulo: rep.title, linhas: 0, erro: msg });
      log(`${rep.code} ${rep.title}: ERRO`);
      if (e instanceof AvecLoginError) { erros.push(msg); break; }
      erros.push(msg.startsWith(rep.code) ? msg : `${rep.code}: ${msg}`);
    }
    if (opts.pauseMs) await sleep(opts.pauseMs);
  }

  let linhasNovas = 0;
  if (!opts.dryRun && inputs.length) {
    const batch = await applyAvecFiles(inputs, { now });
    for (const f of batch.files) {
      const code = /robo-avec-(\d{4})-/.exec(f.fileName)?.[1] ?? f.fileName;
      if (f.error) { const r = relatorios.find((x) => x.codigo === code); if (r) r.erro = f.error; if (!SOFT.test(f.error)) erros.push(`${code}: ${f.error}`); }
    }
    linhasNovas = Object.values(batch.summary).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);
  }

  // A semanal só conta como feita se TODOS os relatórios semanais do plano rodaram (login que falha, `only` e erro no meio não contam; QA r66, I-2).
  const weeklyAll = planReports(now, { weekly: true }).filter((p) => p.weekly);
  const doneWeekly = weekly && weeklyAll.every((p) => {
    const r = relatorios.find((x) => x.codigo === p.code);
    return !!r && (!r.erro || SOFT.test(r.erro));
  });
  const result: RoboLast = {
    em: now.toISOString(), ok: erros.length === 0, relatorios, linhasNovas, erros,
    semanalEm: doneWeekly ? today : prev?.semanalEm ?? null,
  };
  if (!opts.dryRun) {
    // Rodada parcial (só alguns relatórios: a de hora em hora da agenda, 20/10) não vira "a última rodada": a completa das 20h continua rodando.
    if (!opts.partial) await saveRoboLast(result);
    if (erros.length) await alertRoboFailure(today, `A atualização automática do Avec teve problema: ${erros.slice(0, 3).join("; ")}${erros.length > 3 ? ` (+${erros.length - 3})` : ""}. Veja Configurações › Ligação com o Avec.`);
  }
  return { ...result, dryRun: !!opts.dryRun };
}
