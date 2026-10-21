import { sql, type SQL } from "drizzle-orm";

/**
 * Vendas para os relatórios do Salão e para o "total gasto" da cliente: o Avec (`sales_items`, `sales_payments`) e as comandas fechadas do
 * CRM, nas MESMAS colunas, para as consultas só trocarem a tabela. QA r66, I-1.
 *
 * Mesma regra "compara, não soma" do Financeiro: com o caixa do CRM ligado (`caixa_modo` = crm), o dia que tem comanda do CRM vale o CRM
 * e as linhas do Avec desse dia ficam de fora; o dia sem comanda do CRM segue com o Avec. Itens pelo dia da comanda; pagamentos pelo dia
 * do pagamento (Salvador). Linha gravada pelo CRM em `sales_items` (origin <> 'avec') nunca é cortada.
 */
const CRM_ON: SQL = sql`exists (select 1 from settings st where st.key = 'caixa_modo' and st.value = '"crm"'::jsonb)`;

/** Itens de venda: sold_on, comanda, item, kind, category, professional_*, contact_id, client_name, value/discount/total/commission, from_package. */
export const SALES_ITEMS: SQL = sql`(
  select si.id, si.contact_id, si.client_name, si.sold_on, si.comanda, si.item, si.kind, si.category, si.professional_id, si.professional_name,
    si.qty, si.value_cents, si.discount_cents, si.total_cents, si.commission_cents, si.from_package, si.origin
  from sales_items si
  where si.origin <> 'avec' or not (${CRM_ON} and exists (select 1 from comandas cx where cx.status = 'fechada' and cx.day = si.sold_on))
  union all
  select ci.id, c.contact_id, c.client_name, c.day, c.number::text, ci.label,
    case ci.kind when 'servico' then 'servico' when 'produto' then 'produto' when 'pacote_venda' then 'pacote' else 'outro' end,
    l.category, ci.professional_id, null::text, ci.qty, ci.total_cents, ci.discount_cents, coalesce(ci.net_cents, ci.total_cents), ci.commission_cents,
    (ci.kind = 'pacote_sessao'), 'crm'
  from comanda_items ci join comandas c on c.id = ci.comanda_id left join lists l on l.id = ci.service_id
  where ${CRM_ON} and c.status = 'fechada' and ci.cancelled_at is null and ci.kind not in ('divida')
) `;

const METHOD_LABEL = sql`case cp.method when 'pix' then 'Pix' when 'credito' then 'Cartão de Crédito' when 'debito' then 'Cartão de Débito'
  when 'dinheiro' then 'Dinheiro' else 'Outra forma' end`;

/** Pagamentos: contact_id, comanda, paid_on, comanda_on, method, value_cents. Cortesia e crédito da cliente usado não são dinheiro que entrou. */
export const SALES_PAYMENTS: SQL = sql`(
  select sp.id, sp.contact_id, sp.client_name, sp.comanda, sp.paid_on, sp.comanda_on, sp.method, sp.value_cents
  from sales_payments sp
  where not (${CRM_ON} and exists (
    select 1 from comanda_payments cq join comandas cc on cc.id = cq.comanda_id
    where cq.cancelled_at is null and cc.status <> 'cancelada' and cq.method not in ('cortesia', 'credito_cliente')
      and (cq.created_at at time zone 'America/Bahia')::date = coalesce(sp.paid_on, sp.comanda_on)))
  union all
  select cp.id, c.contact_id, c.client_name, c.number::text, (cp.created_at at time zone 'America/Bahia')::date, c.day, ${METHOD_LABEL},
    (cp.value_cents - cp.change_cents)
  from comanda_payments cp join comandas c on c.id = cp.comanda_id
  where ${CRM_ON} and cp.cancelled_at is null and c.status <> 'cancelada' and cp.method not in ('cortesia', 'credito_cliente')
) `;
