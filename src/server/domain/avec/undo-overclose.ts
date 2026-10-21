import { sql } from "drizzle-orm";
import { db, type Tx } from "../../db";
import { normText } from "./normalize";
import { CLOSABLE, saleDecision, type SaleDetail } from "./sales-close";
import { PLACEHOLDER_WINDOW_MS } from "../agenda/twins";

/**
 * Correção do que a limpeza de 18/10 (`limpar-avec-lixo --aplicar`) fez com a regra antiga (QA r58, I-14):
 *  - baixas: a venda do Avec fechou como compareceu TODOS os horários abertos da cliente no dia. Desfaz só os que a regra nova
 *    (`saleDecision`) não fecharia: volta o status de antes, guardado no `audit_log` (`avec_baixa_comanda`, `data.de`), e marca
 *    `avec_review = 'venda_sem_par'` ("Conferir com o Avec");
 *  - Atendimento do lead: foi cancelado se o Avec tinha horário da cliente no mesmo dia, sem olhar a hora. Desfaz os que não tinham
 *    horário do Avec a até 2 h: volta o status, tira o lead dos horários do Avec que o receberam ali e marca `avec_review = 'atendimento_longe'`.
 * Baixas da regra por venda (`data.regra = 2`) entram só se tinham item de comanda e a regra atual não as fecharia (QA r66, I-3): a hora da
 * venda vai gravada na baixa (`data.soldAt`); a baixa só pela hora do pagamento (sem item) fica, para não ser desfeita e refeita.
 * Só mexe no que ficou exatamente como a limpeza deixou (mexido depois no CRM ou pelo Avec: fica, e conta em `mexidos`).
 * Cada desfeito grava `audit_log` (`avec_baixa_desfeita` / `avec_atendimento_desfeito`) com o id do registro original: rodar de novo não acha nada.
 */

/** Baixas da limpeza ainda como ela deixou, com os itens de comanda da cliente no dia. Só leitura (o mesmo texto serve para estimar em produção). */
export const BAIXAS_QUERY = `select l.id::text as audit_id, a.id::text as appointment_id, l.data->>'de' as de, a.status, a.avec_status, a.crm_touched_at is not null as mexido,
    a.avec_twin_of is not null as gemeo, a.professional_id::text as professional_id, a.service_id::text as service_id, a.service_label, a.starts_at,
    coalesce((select json_agg(json_build_object('professionalId', s.professional_id, 'item', s.item, 'kind', s.kind)) from sales_items s
      where s.contact_id = a.contact_id and s.sold_on = (a.starts_at at time zone 'America/Bahia')::date), '[]'::json) as itens,
    exists (select 1 from audit_log u where u.action = 'avec_baixa_desfeita' and u.data->>'auditId' = l.id::text) as desfeito,
    to_char(l.created_at at time zone 'America/Bahia', 'YYYY-MM-DD') as dia_baixa, l.data->>'regra' as regra, l.data->>'soldAt' as sold_at,
    exists (select 1 from deal_events e join deals d on d.id = e.deal_id where d.contact_id = a.contact_id and e.type = 'etapa_alterada'
      and e.created_at >= l.created_at and e.payload->>'motivo' like 'avec%') as conversa_movida
  from audit_log l join appointments a on a.id::text = l.entity_id
  where l.action = 'avec_baixa_comanda' and l.data->>'de' is not null
  order by l.created_at, l.id`;

export const ATENDIMENTOS_QUERY = `select l.id::text as audit_id, h.id::text as appointment_id, l.data->>'de' as de, h.status, h.cancelled_via, h.cancel_note, h.cancelled_at, h.starts_at,
    h.deal_id::text as deal_id, h.confirmed_at,
    coalesce((select json_agg(json_build_object('id', a.id, 'startsAt', a.starts_at, 'dealId', a.deal_id, 'status', a.status, 'updatedAt', a.updated_at,
      'confirmedAt', a.confirmed_at, 'crmTouched', a.crm_touched_at is not null)) from appointments a where a.id::text in (select jsonb_array_elements_text(l.data->'avec'))), '[]'::json) as avec,
    exists (select 1 from audit_log u where u.action = 'avec_atendimento_desfeito' and u.data->>'auditId' = l.id::text) as desfeito
  from audit_log l join appointments h on h.id::text = l.entity_id
  where l.action = 'avec_juntou_atendimento'
  order by l.created_at, l.id`;

export type BaixaRow = {
  audit_id: string; appointment_id: string; de: string; status: string; avec_status: string | null; mexido: boolean; gemeo: boolean;
  professional_id: string | null; service_id: string | null; service_label: string; starts_at: string | Date; itens: { professionalId: string | null; item: string; kind: string }[]; desfeito: boolean;
  /** Dia (Salvador) em que a baixa foi feita. */ dia_baixa: string;
  /** `data.regra` da baixa: "2" = a regra por venda (18/10); null = a limpeza ou a regra de antes. `sold_at`: a hora da venda que a regra 2 usou. */ regra?: string | null; sold_at?: string | null;
  /** A importação moveu a conversa da cliente depois da baixa (ex.: para Atendida): conferir à mão, o script não volta a etapa. */ conversa_movida: boolean;
};
export type AtendimentoRow = {
  audit_id: string; appointment_id: string; de: string; status: string; cancelled_via: string | null; cancel_note: string | null; cancelled_at: string | Date | null;
  starts_at: string | Date; deal_id: string | null; confirmed_at: string | Date | null; desfeito: boolean;
  avec: { id: string; startsAt: string; dealId: string | null; status: string; updatedAt: string; confirmedAt: string | null; crmTouched: boolean }[];
};

/** O status que o horário tinha antes da baixa: `de` é o status do CRM, ou o texto do Avec que o CRM não conhece (aí estava em `conferir`). */
export const statusBefore = (de: string) => (CLOSABLE.includes(de) ? { status: de, avecStatus: null } : { status: "conferir", avecStatus: de });

export type BaixaPlan = {
  total: number; ficam: number; desfazer: BaixaRow[]; mexidos: number; jaDesfeitos: number; semItens: number; porAno: Record<string, number>;
  /** Dia em que a baixa desfeita foi feita (a limpeza de 18/10, importações antigas). */ porDia: Record<string, number>;
  /** Dos desfeitos, quantos têm a conversa movida pelo Avec depois da baixa (para a recepção conferir). */ conversasMovidas: number;
};

/** Função pura: quais baixas a regra nova não faria. `services`: nome normalizado → id do serviço. */
export function planBaixas(rows: BaixaRow[], services: Map<string, string>): BaixaPlan {
  const plan: BaixaPlan = { total: 0, ficam: 0, desfazer: [], mexidos: 0, jaDesfeitos: 0, semItens: 0, porAno: {}, porDia: {}, conversasMovidas: 0 };
  for (const r of rows) {
    if (r.de === "chegou" && r.mexido) continue; // "chegou" esquecido (parte B): o Chegou foi do CRM, a regra não mudou
    if (r.regra === "2" && !r.itens.length) continue;
    plan.total++;
    if (r.desfeito) { plan.jaDesfeitos++; continue; }
    const details: SaleDetail[] = r.itens.map((i) => ({ ...i, serviceId: services.get(normText(i.item)) ?? null }));
    // QA r66: o desfazer cobre também o que a regra por venda (regra 2) fechou. Baixa da regra 2 sem item de comanda foi pela hora do
    // pagamento: continua valendo (a hora vem gravada; sem ela não há como refazer a conta, então fica).
    const d = saleDecision({ professionalId: r.professional_id, serviceId: r.service_id, serviceLabel: r.service_label, startsAt: new Date(r.starts_at) }, { details, soldAt: r.sold_at ? new Date(r.sold_at) : null });
    if (d === "fecha") { plan.ficam++; continue; }
    // Só o que ficou como a limpeza deixou: compareceu, sem mexida no CRM, não virou gêmeo e o Avec não mudou o que estava guardado.
    if (r.status !== "compareceu" || r.mexido || r.gemeo || r.avec_status !== r.de) { plan.mexidos++; continue; }
    plan.desfazer.push(r);
    if (!r.itens.length) plan.semItens++;
    const ano = new Date(r.starts_at).toISOString().slice(0, 4);
    plan.porAno[ano] = (plan.porAno[ano] ?? 0) + 1;
    plan.porDia[r.dia_baixa] = (plan.porDia[r.dia_baixa] ?? 0) + 1;
    if (r.conversa_movida) plan.conversasMovidas++;
  }
  return plan;
}

export type AtendimentoPlan = { total: number; ficam: number; desfazer: AtendimentoRow[]; mexidos: number; jaDesfeitos: number };

const NOTE = "Junto com o horário do Avec do mesmo dia.";
export function planAtendimentos(rows: AtendimentoRow[]): AtendimentoPlan {
  const plan: AtendimentoPlan = { total: 0, ficam: 0, desfazer: [], mexidos: 0, jaDesfeitos: 0 };
  for (const r of rows) {
    plan.total++;
    if (r.desfeito) { plan.jaDesfeitos++; continue; }
    const h = new Date(r.starts_at).getTime();
    if (r.avec.some((a) => Math.abs(new Date(a.startsAt).getTime() - h) <= PLACEHOLDER_WINDOW_MS)) { plan.ficam++; continue; }
    if (r.status !== "cancelado" || r.cancelled_via !== "avec" || r.cancel_note !== NOTE) { plan.mexidos++; continue; }
    plan.desfazer.push(r);
  }
  return plan;
}

export async function loadServices(q: Tx | typeof db = db) {
  const rows = (await q.execute(sql`select id::text as id, label from lists where kind = 'service'`)).rows as { id: string; label: string }[];
  return new Map(rows.map((s) => [normText(s.label), s.id]));
}

/**
 * Gap Avec (A1): o 0248 "Agendamentos por status › Agendado" entrava como lista de espera ("espera" às 00:00, chave `avec:esp:`). Não é
 * espera: sai do banco o que nada referencia (sem conversa, comanda, aviso da profissional, nota, link da visita, gêmeo ou resultado de
 * espera, e não mexido no CRM). Cada apagado fica no `audit_log` (`avec_espera_apagada`) com a linha inteira, para dar para voltar.
 */
export const ESPERA_AVEC = sql`a.external_key like 'avec:esp:%' and a.status in ('espera', 'espera_encaixada', 'espera_desistiu')`;
export const ESPERA_LIVRE = sql`a.deal_id is null and a.crm_touched_at is null
  and not exists (select 1 from comanda_items x where x.appointment_id = a.id)
  and not exists (select 1 from pro_notifications x where x.appointment_id = a.id)
  and not exists (select 1 from client_notes x where x.appointment_id = a.id)
  and not exists (select 1 from appointments x where x.avec_twin_of = a.id or x.wait_result_appointment_id = a.id)
  and (a.visit_id is null or not exists (select 1 from client_links l where l.visit_id = a.visit_id))`;

export type UndoReport = {
  baixas: { total: number; ficam: number; desfeitas: number; semItens: number; mexidos: number; jaDesfeitas: number; porAno: Record<string, number>; porDia: Record<string, number>; conversasMovidas: number };
  atendimentos: { total: number; ficam: number; desfeitos: number; mexidos: number; jaDesfeitos: number };
  /** Os "espera" que vieram do 0248: apagadas (nada apontava para elas) e as que ficam (com conversa, comanda, nota, link ou mexidas). */
  espera: { total: number; apagadas: number; ficam: number };
};

class DryRun extends Error {}

/** `apply: false` (--dry-run) faz tudo numa transação e desfaz no fim: os números são os do --aplicar. */
export async function undoAvecOverclose(opts: { apply: boolean; now: Date }): Promise<UndoReport> {
  const iso = opts.now.toISOString();
  let out!: UndoReport;
  try {
    await db.transaction(async (tx) => {
      const services = await loadServices(tx);
      const b = planBaixas((await tx.execute(sql.raw(BAIXAS_QUERY))).rows as BaixaRow[], services);
      let desfeitas = 0;
      for (const r of b.desfazer) {
        const before = statusBefore(r.de);
        const done = await tx.execute(sql`update appointments set status = ${before.status}, avec_status = ${before.avecStatus}, avec_review = 'venda_sem_par', updated_at = ${iso}::timestamptz
          where id = ${r.appointment_id}::uuid and status = 'compareceu' and crm_touched_at is null returning id`);
        if (!done.rows.length) continue;
        await tx.execute(sql`insert into audit_log (action, entity, entity_id, data) values ('avec_baixa_desfeita', 'appointment', ${r.appointment_id},
          ${JSON.stringify({ de: "compareceu", para: before.status, auditId: r.audit_id, motivo: "venda do Avec não bate com a profissional nem com o serviço" })}::jsonb)`);
        desfeitas++;
      }
      const a = planAtendimentos((await tx.execute(sql.raw(ATENDIMENTOS_QUERY))).rows as AtendimentoRow[]);
      let desfeitos = 0;
      for (const r of a.desfazer) {
        const done = await tx.execute(sql`update appointments set status = ${r.de}, cancel_reason = null, cancel_note = null, cancelled_via = null, cancelled_at = null,
          avec_review = 'atendimento_longe', updated_at = ${iso}::timestamptz where id = ${r.appointment_id}::uuid and status = 'cancelado' returning id`);
        if (!done.rows.length) continue;
        // O lead (e a confirmação) que passaram para os horários do Avec naquela hora voltam a ficar só no Atendimento.
        const sameMoment = (x: string | Date | null) => !!x && !!r.cancelled_at && new Date(x).getTime() === new Date(r.cancelled_at).getTime();
        const tirados: string[] = [];
        for (const x of r.avec.filter((x) => !x.crmTouched && sameMoment(x.updatedAt))) {
          if (r.deal_id && x.dealId === r.deal_id) {
            await tx.execute(sql`update appointments set deal_id = null, updated_at = ${iso}::timestamptz where id = ${x.id}::uuid`);
            tirados.push(x.id);
          }
          if (r.de === "confirmado" && x.status === "confirmado" && x.confirmedAt && r.confirmed_at && new Date(x.confirmedAt).getTime() === new Date(r.confirmed_at).getTime()) {
            await tx.execute(sql`update appointments set status = 'agendado', confirmed_at = null, confirmed_via = null, updated_at = ${iso}::timestamptz where id = ${x.id}::uuid`);
          }
        }
        await tx.execute(sql`insert into audit_log (action, entity, entity_id, data) values ('avec_atendimento_desfeito', 'appointment', ${r.appointment_id},
          ${JSON.stringify({ de: "cancelado", para: r.de, auditId: r.audit_id, leadTiradoDe: tirados, motivo: "horário do Avec a mais de 2 h" })}::jsonb)`);
        desfeitos++;
      }
      const total = Number(((await tx.execute(sql`select count(*)::int as n from appointments a where ${ESPERA_AVEC}`)).rows[0] as { n: number }).n);
      const gone = (await tx.execute(sql`delete from appointments a where ${ESPERA_AVEC} and ${ESPERA_LIVRE} returning to_jsonb(a.*) as linha, a.id::text as id, a.external_key as chave`))
        .rows as { linha: Record<string, unknown>; id: string; chave: string }[];
      for (const g of gone) {
        await tx.execute(sql`insert into audit_log (action, entity, entity_id, data) values ('avec_espera_apagada', 'appointment', ${g.id},
          ${JSON.stringify({ motivo: "0248 Agendamentos por status (Agendado) importado como lista de espera", chave: g.chave, linha: g.linha })}::jsonb)`);
      }
      out = {
        espera: { total, apagadas: gone.length, ficam: total - gone.length },
        baixas: { total: b.total, ficam: b.ficam, desfeitas, semItens: b.semItens, mexidos: b.mexidos, jaDesfeitas: b.jaDesfeitos, porAno: b.porAno, porDia: b.porDia, conversasMovidas: b.conversasMovidas },
        atendimentos: { total: a.total, ficam: a.ficam, desfeitos, mexidos: a.mexidos, jaDesfeitos: a.jaDesfeitos },
      };
      if (!opts.apply) throw new DryRun();
    });
  } catch (e) { if (!(e instanceof DryRun)) throw e; }
  return out;
}
