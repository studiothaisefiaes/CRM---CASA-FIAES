import { sql } from "drizzle-orm";
import { db } from "../db";
import { auditLog } from "../db/schema";
import { groupNames, isUsableName, nameTokens, samePerson } from "@/lib/same-person";
import { addPersonTx } from "./people-on-number";
import { refreshContactStatsTx } from "./contact-stats";

/**
 * Várias pessoas no mesmo número a partir do que JÁ foi importado (scripts/pessoas-mesmo-numero.ts, 17/10, caso Cati).
 * Antes da 0051 o CRM guardava um contato por número: a filha que usa o celular da mãe ficava com os horários e pacotes na ficha da mãe,
 * e só o nome de cada registro (`client_name`, como veio do Avec) dizia de quem era. Aqui:
 * 1. junta, por contato titular, os nomes dos horários, pacotes e usos de pacote (`samePerson`: apelido e erro de digitação são a mesma);
 * 2. com dois ou mais grupos de nome, o grupo do nome do contato fica com ele e cada outro vira uma pessoa a mais do número
 *    (ou a que já existe com esse nome), com os horários, as visitas inteiras dela, os pacotes e os usos religados;
 * 3. contato sem nome, ou cujo nome não bate com nenhum grupo (nome do WhatsApp), fica "a conferir": não se mexe.
 * Nomes genéricos ("Cliente", "Teste") nunca viram pessoa. Idempotente: depois de aplicar, um novo plano não acha mais o mesmo caso.
 */

export type NameRow = { contactId: string; contactName: string | null; avec: boolean; clientName: string; kind: "horario" | "pacote" | "uso"; n: number };
export type ExistingPerson = { holderId: string; id: string; name: string | null };
export type NewPerson = { name: string; names: string[]; horarios: number; pacotes: number; usos: number; personId: string | null };
export type PeopleCase = { holderId: string; holderName: string | null; holderNames: string[]; pessoas: NewPerson[] };
export type Unsure = { holderId: string; holderName: string | null; grupos: string[]; motivo: string };
export type PeoplePlan = { casos: PeopleCase[]; conferir: Unsure[] };

const GENERIC = new Set(["cliente", "clientes", "avulsa", "avulso", "teste", "nao", "sei", "sem", "nome", "atualizar", "modelo", "x", "xx", "xxx"]);
const isGeneric = (name: string) => nameTokens(name).every((w) => GENERIC.has(w) || w.length < 2);

/** O nome da pessoa: o mais completo do grupo (mais palavras); empate, o que mais aparece. */
function bestName(items: { name: string; n: number }[]): string {
  return [...items].sort((a, b) => nameTokens(b.name).length - nameTokens(a.name).length || b.n - a.n)[0].name.trim().replace(/\s+/g, " ");
}

/** O plano, só com os dados (sem banco): o teste e o ensaio de produção usam o mesmo cálculo. */
export function planFromRows(rows: NameRow[], existing: ExistingPerson[], skip: string[] = []): PeoplePlan {
  const byHolder = new Map<string, NameRow[]>();
  for (const r of rows) if (r.clientName.trim() && isUsableName(r.clientName)) byHolder.set(r.contactId, [...(byHolder.get(r.contactId) ?? []), r]);
  const plan: PeoplePlan = { casos: [], conferir: [] };
  for (const [holderId, list] of byHolder) {
    // `--pular`: o titular que a Casa conferiu e não quer separar (pelo id inteiro ou pelos 8 primeiros caracteres do ensaio).
    if (skip.some((s) => s && holderId.startsWith(s))) continue;
    const names = new Map<string, { name: string; n: number; horarios: number; pacotes: number; usos: number }>();
    for (const r of list) {
      const k = r.clientName.trim();
      const e = names.get(k) ?? { name: k, n: 0, horarios: 0, pacotes: 0, usos: 0 };
      e.n += r.n;
      if (r.kind === "horario") e.horarios += r.n; else if (r.kind === "pacote") e.pacotes += r.n; else e.usos += r.n;
      names.set(k, e);
    }
    const holderName = list[0].contactName;
    // O nome da ficha entra no agrupamento (une, por exemplo, o apelido entre parênteses "(Liz Matos)" ao "Liz Matos" do Avec).
    const HOLDER = { name: holderName ?? "", n: 0, horarios: 0, pacotes: 0, usos: 0, holder: true };
    const items = [...names.values()].map((x) => ({ ...x, holder: false }));
    const tagged = groupNames(isUsableName(holderName) ? [...items, HOLDER] : items)
      .map((g) => ({ own: g.some((x) => x.holder), names: g.filter((x) => !x.holder) }))
      .filter((g) => g.names.length && (g.own || !g.names.every((x) => isGeneric(x.name))));
    const groups = tagged.map((g) => g.names);
    if (groups.length < 2) continue;
    const own = tagged.findIndex((g) => g.own);
    const grupos = groups.map((g) => bestName(g));
    if (own < 0) {
      plan.conferir.push({ holderId, holderName, grupos, motivo: holderName?.trim() ? "o nome da ficha não bate com nenhum nome do Avec" : "a ficha está sem nome" });
      continue;
    }
    const people = existing.filter((p) => p.holderId === holderId);
    const pessoas: NewPerson[] = [];
    for (const [k, g] of groups.entries()) {
      if (k === own) continue;
      const name = bestName(g);
      const found = people.find((p) => g.some((x) => nameTokens(x.name).join(" ") === nameTokens(p.name).join(" "))) ?? people.find((p) => g.some((x) => samePerson(x.name, p.name)));
      pessoas.push({
        name: found?.name ?? name, names: g.map((x) => x.name), personId: found?.id ?? null,
        horarios: g.reduce((n, x) => n + x.horarios, 0), pacotes: g.reduce((n, x) => n + x.pacotes, 0), usos: g.reduce((n, x) => n + x.usos, 0),
      });
    }
    plan.casos.push({ holderId, holderName, holderNames: groups[own].map((x) => x.name), pessoas });
  }
  plan.casos.sort((a, b) => (a.holderName ?? "").localeCompare(b.holderName ?? "", "pt-BR"));
  return plan;
}

/** O que está no banco: os nomes dos horários, pacotes e usos de cada contato titular (só leitura). */
export async function loadNameRows(): Promise<{ rows: NameRow[]; existing: ExistingPerson[] }> {
  const r = await db.execute(sql`
    with x as (
      select contact_id, client_name, 'horario' as kind from appointments where contact_id is not null and coalesce(trim(client_name), '') <> ''
      union all select contact_id, client_name, 'pacote' from client_packages where contact_id is not null and coalesce(trim(client_name), '') <> ''
      union all select contact_id, client_name, 'uso' from package_uses where contact_id is not null and coalesce(trim(client_name), '') <> ''
    )
    select x.contact_id as "contactId", c.name as "contactName", (c.imported_fields -> 'avec') is not null as avec, trim(x.client_name) as "clientName", x.kind, count(*)::int as n
      from x join contacts c on c.id = x.contact_id
     where c.shares_phone_with is null
     group by 1, 2, 3, 4, 5`);
  const p = await db.execute(sql`select shares_phone_with as "holderId", id, name from contacts where shares_phone_with is not null`);
  return { rows: r.rows as NameRow[], existing: p.rows as ExistingPerson[] };
}

export type PeopleBackup = { geradoEm: string; casos: { holderId: string; registros: { tabela: string; id: string; contactId: string | null; clientName: string | null }[] }[] };
export type PeopleApplied = { pessoasNovas: number; pessoasExistentes: number; horarios: number; visitas: number; pacotes: number; usos: number };

/**
 * Aplica o plano numa transação: grava o backup (o dono de cada registro antes), cria as pessoas, religa horários, visitas inteiras dela,
 * pacotes e usos, e recalcula a visão por contato. Só o que ainda está no titular com um dos nomes do grupo é religado.
 */
export async function applyPeoplePlan(plan: PeoplePlan, writeBackup: (b: PeopleBackup) => Promise<void>, userId: string | null = null): Promise<PeopleApplied> {
  const out: PeopleApplied = { pessoasNovas: 0, pessoasExistentes: 0, horarios: 0, visitas: 0, pacotes: 0, usos: 0 };
  await db.transaction(async (tx) => {
    const backup: PeopleBackup = { geradoEm: new Date().toISOString(), casos: [] };
    for (const c of plan.casos) {
      const all = c.pessoas.flatMap((p) => p.names);
      const reg = await tx.execute(sql`
        select 'appointments' as tabela, id, contact_id as "contactId", client_name as "clientName" from appointments where contact_id = ${c.holderId} and trim(client_name) in ${all}
        union all select 'client_packages', id, contact_id, client_name from client_packages where contact_id = ${c.holderId} and trim(client_name) in ${all}
        union all select 'package_uses', id, contact_id, client_name from package_uses where contact_id = ${c.holderId} and trim(client_name) in ${all}
        union all select 'visits', v.id, v.contact_id, v.client_name from visits v where v.contact_id = ${c.holderId}
          and exists (select 1 from appointments a where a.visit_id = v.id and trim(a.client_name) in ${all})`);
      backup.casos.push({ holderId: c.holderId, registros: reg.rows as PeopleBackup["casos"][number]["registros"] });
    }
    await writeBackup(backup);
    for (const c of plan.casos) {
      for (const p of c.pessoas) {
        let id = p.personId;
        if (!id) {
          const r = await addPersonTx(tx, c.holderId, { name: p.name });
          id = r.id;
          if (r.created) out.pessoasNovas++; else out.pessoasExistentes++;
        } else out.pessoasExistentes++;
        const names = p.names;
        const a = await tx.execute(sql`update appointments set contact_id = ${id}, updated_at = now() where contact_id = ${c.holderId} and trim(client_name) in ${names} returning visit_id`);
        out.horarios += a.rows.length;
        // A visita vai junto só quando TODOS os horários dela são da pessoa (mãe e filha na mesma visita: a visita fica no titular).
        const v = await tx.execute(sql`update visits v set contact_id = ${id}, client_name = ${p.name}, updated_at = now() where v.contact_id = ${c.holderId}
          and exists (select 1 from appointments a where a.visit_id = v.id) and not exists (select 1 from appointments a where a.visit_id = v.id and a.contact_id is distinct from ${id}) returning v.id`);
        out.visitas += v.rows.length;
        out.pacotes += (await tx.execute(sql`update client_packages set contact_id = ${id}, updated_at = now() where contact_id = ${c.holderId} and trim(client_name) in ${names} returning id`)).rows.length;
        out.usos += (await tx.execute(sql`update package_uses set contact_id = ${id} where contact_id = ${c.holderId} and trim(client_name) in ${names} returning id`)).rows.length;
      }
    }
    await tx.insert(auditLog).values({ userId, action: "pessoas_mesmo_numero", entity: "contacts", data: { ...out, casos: plan.casos.length } });
    if (plan.casos.length) await refreshContactStatsTx(tx);
  });
  return out;
}
