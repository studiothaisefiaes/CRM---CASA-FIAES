import { sql } from "drizzle-orm";
import { rows } from "../common";
import type { SalonRange } from "../../../lib/salon-period";
import { getNfceModo, getNfseModo } from "../../domain/fiscal/config";

/**
 * Notas fiscais (Fase D, Task 10): as notas do período (pelo dia da comanda) e o extrato de cada parceira por mês, que serve para a nota
 * que ela emite contra o Salão. Quem chama confere `valores.ver` (como o resto do Financeiro).
 */
export type NotaRow = {
  id: string; comandaNumber: number; day: string; kind: "nfse" | "nfce"; environment: "teste" | "producao"; status: string; amountCents: number;
  accessKey: string | null; rejectReason: string | null;
};
/** Comanda fechada em que a recepção escolheu emitir nota e ainda não há nota viva (a emissão automática está desligada ou ainda não rodou). */
export type AEmitirRow = { id: string; comandaNumber: number; day: string; clientName: string; escolha: "sem_cpf" | "com_cpf"; totalCents: number };
export type ParceiraExtrato = { professionalId: string; name: string; legalName: string; cnpj: string; month: string; cents: number; comandas: number };

export async function loadNotas(range: SalonRange): Promise<{ notas: NotaRow[]; parceiras: ParceiraExtrato[]; aEmitir: AEmitirRow[] }> {
  const [notas, parceiras, aEmitir] = await Promise.all([
    rows<NotaRow>(sql`
      select f.id, c.number as "comandaNumber", c.day::text as day, f.kind, f.environment, f.status, f.amount_cents as "amountCents",
        f.access_key as "accessKey", f.reject_reason as "rejectReason"
      from fiscal_documents f join comandas c on c.id = f.comanda_id
      where c.day between ${range.from}::date and ${range.to}::date
      order by c.day, c.number, f.created_at`),
    rows<ParceiraExtrato>(sql`
      select ci.professional_id as "professionalId", p.name, coalesce(nullif(trim(p.legal_name), ''), nullif(trim(p.full_name), ''), p.name) as "legalName",
        ci.partner_cnpj as cnpj, to_char(c.day, 'YYYY-MM') as month, sum(coalesce(ci.commission_cents, 0))::int as cents, count(distinct c.id)::int as comandas
      from comanda_items ci join comandas c on c.id = ci.comanda_id join professionals p on p.id = ci.professional_id
      where c.status = 'fechada' and ci.cancelled_at is null and ci.partner_cnpj is not null and c.day between ${range.from}::date and ${range.to}::date
      group by ci.professional_id, p.name, p.legal_name, p.full_name, ci.partner_cnpj, to_char(c.day, 'YYYY-MM')
      order by month, p.name`),
    aEmitirRows(range),
  ]);
  return { notas, parceiras, aEmitir };
}

const aEmitirRows = (range: SalonRange) => rows<AEmitirRow>(sql`
  select c.id, c.number as "comandaNumber", c.day::text as day, coalesce(c.client_name, 'Cliente de balcão') as "clientName", c.nota_escolha as escolha, coalesce(c.total_cents, 0) as "totalCents"
  from comandas c where c.status = 'fechada' and c.nota_escolha in ('sem_cpf', 'com_cpf') and c.day between ${range.from}::date and ${range.to}::date
    and not exists (select 1 from fiscal_documents f where f.comanda_id = c.id and f.status in ('pendente', 'autorizada'))
  order by c.day, c.number`);

/** Há alguma nota no período? A aba "Notas fiscais" aparece com a chave ligada ou com nota no período. */
export async function hasNotas(range: SalonRange): Promise<boolean> {
  const [r] = await rows<{ n: number }>(sql`
    select count(*)::int as n from fiscal_documents f join comandas c on c.id = f.comanda_id where c.day between ${range.from}::date and ${range.to}::date`);
  return (r?.n ?? 0) > 0 || (await aEmitirRows(range)).length > 0;
}

/** A aba "Notas fiscais" do Financeiro: com a chave da NFS-e ou a da NFC-e ligada (teste ou produção), ou com alguma nota no período. */
export async function notasFiscaisOn(range: SalonRange): Promise<boolean> {
  const [nfse, nfce] = await Promise.all([getNfseModo(), getNfceModo()]);
  return nfse !== "desligada" || nfce !== "desligada" || hasNotas(range);
}
