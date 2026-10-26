import { z } from "zod";
import { can, type Perm } from "@/lib/permissions";
import { salonRange, SALON_PRESETS, type SalonRange } from "@/lib/salon-period";
import type { SessionUser } from "../../auth/sessions-store";
import { periodWindow, type Period, type ReportFilter } from "../../reports/common";
import { hideMoney, scopedFilter } from "../../reports/screen";
import {
  crmVsPhone, dataQuality, demandHeatmap, executiveNumbers, financeWithPaid, firstResponse, followupEfficacy, funnelMilestones, lossesByReasonAndStage,
  personVsGoal, sourceToSale, staleNow,
} from "../../reports/queries";
import { dailySummaryText } from "../../reports/summary-text";
import { returnCohorts } from "../../reports/cohort";
import { loadSalon, salonFinance } from "../../reports/salon";
import { replyTimesByAuthor } from "../../reports/replies";
import { loadOcupacao } from "../../reports/ocupacao";
import { loadFinanceiro } from "../../reports/financeiro";
import { financeExceptions } from "../../reports/financeiro/excecoes";
import { loadNotas, notasFiscaisOn } from "../../reports/financeiro/notas";
import { assertCanSeeResultado, loadResultado } from "../../reports/financeiro/resultado";
import { loadSatisfaction } from "../../domain/satisfaction";
import { getRelatoriosConfig } from "../../domain/relatorios-config";
import { getFinanceiroConfig } from "../../domain/financeiro/config";
import { getCaixaRecursos } from "../../domain/caixa/recursos";
import { listExpenses } from "../../domain/financeiro/despesas";
import { ApiErro, rotaApi, zUuid, type RotaApi } from "../rota";

/**
 * Relatórios pela API: um endpoint por relatório que a tela de Relatórios já calcula, chamando a MESMA função (nada é recalculado aqui).
 * Relatório é cálculo: só leitura. As travas são as da tela: sem "Ver números de toda a equipe" os números do CRM são só da pessoa da
 * chave (`scopedFilter`); R$ só com "ver valores"; Salão pede a equipe; Financeiro pede valores.
 *
 * Dois tipos de período, como na tela (não se inventa outro cálculo):
 * - Visão geral e Análise (números do CRM): `?periodo=hoje|7d|mes|ano` (o cálculo compara com o período anterior de mesmo tamanho).
 * - Salão e Financeiro: `?de=AAAA-MM-DD&ate=AAAA-MM-DD` ou `?periodo=hoje|7d|mes|mes-passado|ano`.
 * O objeto de `dados` é o mesmo que a tela recebe (nomes dos campos como no código; datas no fuso da Casa).
 */
const GRUPO = "Relatórios";

const zCrm = z.object({
  periodo: z.enum(["hoje", "7d", "semana", "mes", "ano"]).default("mes").meta({ description: "hoje, 7d (ou semana), mes (padrão) ou ano." }),
  dono: zUuid.optional().meta({ description: "Só os números desta pessoa (vale para quem vê os números de toda a equipe; sem isso, são sempre os da pessoa da chave)." }),
  origem: z.string().max(80).optional().meta({ description: "Só as conversas desta origem (o rótulo, como na tela)." }),
});
const zDia = z.iso.date({ error: "Use o dia no formato AAAA-MM-DD." });
const zSalao = z.object({
  de: zDia.optional(), ate: zDia.optional(),
  periodo: z.enum(SALON_PRESETS.filter((p) => p !== "livre") as [string, ...string[]]).optional().meta({ description: "Sem `de`/`ate`: hoje, 7d, mes (padrão), mes-passado ou ano." }),
});
const zResposta = z.object({
  dados: z.unknown().meta({ description: "O resultado do cálculo, igual ao da tela." }),
  periodo: z.object({ de: z.string(), ate: z.string(), rotulo: z.string() }),
});

type Crm = z.output<typeof zCrm>;
type Salao = z.output<typeof zSalao>;
const filtroCrm = (user: SessionUser, q: Crm): ReportFilter =>
  scopedFilter(user, { period: (q.periodo === "semana" ? "7d" : q.periodo) as Period, ownerId: q.dono ?? null, source: q.origem ?? null });
const ROTULO: Record<Period, string> = { hoje: "Hoje", "7d": "7 dias", mes: "Este mês", ano: "Este ano" };
const periodoCrm = (f: ReportFilter) => { const w = periodWindow(f); return { de: w.from, ate: w.to, rotulo: ROTULO[f.period] }; }; // Date: sai com -03:00 (paraJson)
const faixa = (q: Salao): SalonRange => salonRange({ periodo: q.periodo ?? null, de: q.de ?? null, ate: q.ate ?? null }, new Date());
const periodoSalao = (r: SalonRange) => ({ de: r.from, ate: r.to, rotulo: r.label });

const exigir = (user: SessionUser, perms: Perm[]) => {
  const falta = perms.filter((p) => !can(user.perms, p));
  if (falta.length) throw new ApiErro(403, `Este relatório pede também: ${falta.join(", ")}.`);
};
const desligado = (o: string) => new ApiErro(404, `${o} está desligado em Configurações.`);

function crm(caminho: string, resumo: string, extra: Perm[], calc: (user: SessionUser, f: ReportFilter) => Promise<unknown>, descricao?: string): RotaApi {
  return rotaApi({
    metodo: "GET", caminho: `/relatorios/${caminho}`, escopo: "ler", perm: "relatorios.ver", grupo: GRUPO, resumo,
    descricao: [descricao, "Período do CRM (`periodo`); sem \"Ver números de toda a equipe\", só os números da pessoa da chave.", extra.length ? `Pede também: ${extra.join(", ")}.` : ""].filter(Boolean).join(" "),
    query: zCrm, resposta: zResposta,
    handler: async ({ user, query }) => {
      exigir(user, extra);
      const f = filtroCrm(user, query);
      return { dados: await calc(user, f), periodo: periodoCrm(f) };
    },
  });
}
function salao(caminho: string, resumo: string, extra: Perm[], calc: (user: SessionUser, r: SalonRange, q: Salao & Record<string, unknown>) => Promise<unknown>, descricao?: string, query: z.ZodObject<z.ZodRawShape> = zSalao): RotaApi {
  return rotaApi({
    metodo: "GET", caminho: `/relatorios/${caminho}`, escopo: "ler", perm: "relatorios.ver", grupo: GRUPO, resumo,
    descricao: [descricao, "Período por dia (`de`/`ate` ou `periodo`).", extra.length ? `Pede também: ${extra.join(", ")}.` : ""].filter(Boolean).join(" "),
    query, resposta: zResposta,
    handler: async ({ user, query: q }) => {
      exigir(user, extra);
      const r = faixa(q as Salao);
      return { dados: await calc(user, r, q as Salao & Record<string, unknown>), periodo: periodoSalao(r) };
    },
  });
}

const money = (u: SessionUser) => can(u.perms, "valores.ver");

export const RELATORIOS: RotaApi[] = [
  // Visão geral
  crm("resumo-do-dia", "Resumo do dia", [], (u, f) => dailySummaryText(u, f.now), "O texto do resumo (o mesmo do topo da Visão geral). Não depende do período."),
  crm("numeros", "Números do período", [], async (u, f) => hideMoney(await executiveNumbers(f), money(u)), "Conversas, agendamentos, vendas (R$ só com ver valores) e comparação com o período anterior."),
  crm("resposta", "Tempo de primeira resposta", [], (_u, f) => firstResponse(f)),
  crm("funil", "Etapas da conversa no período", [], (_u, f) => funnelMilestones(f)),
  crm("parados", "Conversas paradas agora", [], (_u, f) => staleNow({ now: f.now, ownerId: f.ownerId, source: f.source }), "O retrato de agora (o período não muda este)."),
  crm("origem", "De onde vieram e quanto viraram venda", [], async (u, f) => (await sourceToSale(f)).map((s) => ({ ...s, receitaCents: money(u) ? s.receitaCents : null }))),
  crm("perdas", "Perdas por motivo e etapa", [], (_u, f) => lossesByReasonAndStage(f)),
  crm("canal", "Respostas pelo CRM x pelo celular", [], (_u, f) => crmVsPhone(f)),
  crm("qualidade", "Qualidade dos dados", [], (_u, f) => dataQuality(f), "Fichas sem origem, sem nome… (não depende do período)."),
  // Análise
  crm("followup", "Eficácia das tentativas de retomada", [], (_u, f) => followupEfficacy(f)),
  crm("calor", "Mapa de calor da demanda", [], (_u, f) => demandHeatmap(f), "Matriz dia da semana × hora com a quantidade de mensagens de clientes."),
  crm("respostas-por-pessoa", "Tempo de resposta por pessoa", [], (_u, f) => replyTimesByAuthor(f)),
  crm("pessoas", "Cada pessoa x meta", ["relatorios.equipe"], (_u, f) => personVsGoal(f)),
  crm("vendas-e-cobrancas", "Vendas, pagas e a receber", ["relatorios.equipe", "valores.ver"], (_u, f) => financeWithPaid(f)),
  crm("faturamento-salao", "Faturamento do salão no período do CRM", ["relatorios.equipe", "valores.ver"], (_u, f) => salonFinance(f)),
  crm("retorno", "Clientes que voltaram (coortes)", ["relatorios.equipe"], (_u, f) => returnCohorts(f.now ?? new Date()), "Não depende do período."),
  // Salão
  salao("salao", "Salão: faturamento, profissionais, serviços, clientes, comparecimento", ["relatorios.equipe"], (u, r) => loadSalon(u, r), "R$ só com ver valores (sem isso, ordenado por quantidade)."),
  salao("satisfacao", "Pesquisa de satisfação", ["relatorios.equipe"], (u, r) => loadSatisfaction(u, r)),
  salao("ocupacao", "Ocupação da agenda", ["relatorios.equipe"], async (u, r, q) => {
    if (!(await getRelatoriosConfig()).ocupacao) throw desligado("O relatório de Ocupação");
    if (q.medida === "valor" && !money(u)) throw new ApiErro(403, "Medir em valor pede ver valores.");
    return loadOcupacao(u, r, { professionalId: (q.profissional as string | undefined) ?? null, medida: q.medida === "valor" ? "valor" : "horarios" });
  }, "Com a Ocupação ligada em Configurações › Relatórios.", zSalao.extend({ profissional: zUuid.optional(), medida: z.enum(["horarios", "valor"]).optional() })),
  // Financeiro
  salao("financeiro", "Financeiro: entradas do caixa e do Avec", ["valores.ver"], async (u, r) => {
    const [v, recursos] = await Promise.all([loadFinanceiro(r), getCaixaRecursos()]);
    // Como a tela: a comissão só com comissao.ver; as exceções só com relatorios.excecoes e a função ligada.
    return { ...v, commission: can(u.perms, "comissao.ver") ? v.commission : null, exceptions: can(u.perms, "relatorios.excecoes") && recursos.excecoes ? v.exceptions : null };
  }),
  salao("excecoes", "Exceções (descontos, cortesias, preços mudados, cancelamentos)", ["valores.ver", "relatorios.excecoes"], async (_u, r) => {
    if (!(await getCaixaRecursos()).excecoes) throw desligado("As Exceções");
    return financeExceptions(r);
  }),
  salao("resultado", "Resultado (DRE)", ["valores.ver"], async (u, r) => {
    if (!(await getFinanceiroConfig()).resultado) throw desligado("O Resultado");
    assertCanSeeResultado(u.perms);
    return loadResultado(r, new Date());
  }, "Com o Resultado ligado em Configurações › Financeiro."),
  salao("contas-a-pagar", "Contas a pagar", ["valores.ver"], async (_u, r) => {
    if (!(await getFinanceiroConfig()).contasAPagar) throw desligado("Contas a pagar");
    return listExpenses({ from: r.from, to: r.to }, new Date());
  }, "Com Contas a pagar ligado em Configurações › Financeiro."),
  salao("notas-fiscais", "Notas fiscais do período", ["valores.ver"], async (_u, r) => {
    if (!(await notasFiscaisOn(r))) throw desligado("A nota fiscal");
    return loadNotas(r);
  }),
];
