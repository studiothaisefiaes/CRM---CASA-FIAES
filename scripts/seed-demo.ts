/**
 * Ambiente de DEMONSTRAÇÃO: dados 100% fictícios no banco crm_demo (nunca no crm).
 *
 *   scripts/demo.sh seed      → recria o banco crm_demo do zero (migrações + seed base + equipe + catálogo + leads)
 *   scripts/demo.sh refresh   → mantém equipe, sessões e configurações; refaz leads e conversas em relação ao AGORA
 *
 * Direto: DATABASE_URL=…/crm_demo DEMO=true npx tsx scripts/seed-demo.ts [--refresh]
 * Recusa rodar se o DATABASE_URL não terminar em /crm_demo (scripts/demo-guard.ts, o primeiro import).
 *
 * Como a Fila fica "viva": as esperas recentes são postas em minutos de EXPEDIENTE antes de agora (`businessInstantBefore`),
 * a mesma conta do prazo e dos alertas. No expediente, "atrasado há 12 min" é das 12 min anteriores; com a Casa fechada,
 * a espera cai no fim do último expediente e o relógio fica parado, como em produção. No fim o motor de automações
 * roda uma vez (no último instante de expediente), e os alertas do sino saem dele: coerentes com a regra de atraso.
 * Todos os telefones são da faixa fictícia +55 71 90000-xxxx.
 */
import "./demo-guard";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../src/server/db";
import { seed } from "../src/server/db/seed";
import { channels, contacts, deals, leadSources, lists, users } from "../src/server/db/schema";
import { hashPassword } from "../src/server/auth/password";
import { recordInbound, recordOutbound, moveDealTx } from "../src/server/domain/deals";
import { closeSale, markAttendance, setAttendance, updateDealTx } from "../src/server/domain/updates";
import { completeTaskTx, remindDueTasks, setNextActionTx } from "../src/server/domain/tasks";
import { archiveDeals } from "../src/server/domain/archive";
import { createSource } from "../src/server/domain/sources";
import { getBusinessHours } from "../src/server/domain/hours";
import { runRules } from "../src/server/rules/engine";
import { DEMO_DATABASE } from "../src/server/demo";
import { businessInstantBefore, isOpen, type BusinessHours } from "../src/lib/business-hours";

const NOW = new Date();
const REFRESH = process.argv.includes("--refresh");
const MIN = 60_000, DAY = 86_400_000, OFF = 3 * 3_600_000; // America/Bahia, UTC-3
let HOURS: BusinessHours;

// ───────────────────────── datas ─────────────────────────
const parts = (d: Date) => { const l = new Date(d.getTime() - OFF); return { y: l.getUTCFullYear(), m: l.getUTCMonth(), d: l.getUTCDate(), dow: l.getUTCDay() }; };
/** `daysAgo` dias antes de hoje (Salvador), às hh:mm. Negativo = no futuro. */
const dayAt = (daysAgo: number, hhmm: string) => { const p = parts(NOW); const [h, m] = hhmm.split(":").map(Number); return new Date(Date.UTC(p.y, p.m, p.d - daysAgo, h, m) + OFF); };
const isSunday = (daysAgo: number) => parts(dayAt(daysAgo, "12:00")).dow === 0;
/** O dia útil (a Casa não abre domingo) em `daysAgo` ou antes. */
const workDay = (daysAgo: number) => { let d = daysAgo; while (isSunday(d)) d++; return d; };
const TODAY = isSunday(0) ? -1 : 0;
const TOMORROW = (() => { let d = TODAY - 1; while (isSunday(d)) d--; return d; })();
const PREV_DAY = workDay(1);
/** `min` minutos de expediente antes de agora. */
const bizAgo = (min: number) => new Date(businessInstantBefore(NOW.getTime(), Math.max(1, Math.round(min * 60)), HOURS));

// ───────────────────────── pessoas ─────────────────────────
const phone = (n: number) => `+557190000${String(n).padStart(4, "0")}`; // faixa fictícia
let seq = 0;
type Person = { n: number; name: string | null; email?: string; instagram?: string; birthday?: [number, number, number?] };
const P = (name: string | null, extra: Omit<Person, "n" | "name"> = {}): Person => ({ n: ++seq, name, ...extra });
const first = (name: string | null) => name?.split(" ")[0] ?? "";
/** Aniversário daqui a `days` dias. */
const bdayIn = (days: number, year?: number): [number, number, number?] => { const p = parts(dayAt(-days, "12:00")); return [p.d, p.m + 1, year]; };

type Uid = "thaise" | "ana" | "bruna";
const U: Record<Uid, string> = { thaise: "", ana: "", bruna: "" };
const PACE: Record<Uid, number> = { ana: 1, bruna: 1.8, thaise: 1.3 }; // Bruna responde mais devagar (os relatórios mostram a diferença)
let channelId = "";
let linkCode = "";
const svc: Record<string, string> = {};

// ───────────────────────── carimbo de tempo ─────────────────────────
/**
 * Roda uma operação do domínio "no passado": o que ela gravou com a hora real (eventos, auditoria, tarefas, fechamento, pagamento,
 * comparecimento, arquivamento, alertas resolvidos) passa a valer `when`. Horários futuros (agendamento, vencimentos) não são tocados.
 */
async function stamp<T>(when: Date, fn: () => Promise<T>, full = false): Promise<T> {
  const db0 = (await pool.query<{ t: Date }>("select clock_timestamp() as t")).rows[0].t;
  const t0 = new Date(Math.min(db0.getTime(), Date.now()) - 2000).toISOString();
  const r = await fn();
  const w = when.toISOString();
  const db1 = (await pool.query<{ t: Date }>("select clock_timestamp() as t")).rows[0].t;
  const t1 = new Date(Math.max(db1.getTime(), Date.now()) + 2000).toISOString();
  await pool.query("update deal_events set created_at = $1 where created_at between $2 and $3", [w, t0, t1]);
  if (full) {
    await pool.query("update audit_log set created_at = $1 where created_at between $2 and $3", [w, t0, t1]);
    await pool.query("update tasks set due_at = $1::timestamptz + (due_at - created_at) where kind = 'retorno' and created_at between $2 and $3", [w, t0, t1]);
    await pool.query("update tasks set created_at = $1 where created_at between $2 and $3", [w, t0, t1]);
    await pool.query("update tasks set done_at = $1 where done_at between $2 and $3", [w, t0, t1]);
    for (const col of ["closed_at", "paid_at", "stage_entered_at", "attendance_at", "archived_at"])
      await pool.query(`update deals set ${col} = $1 where ${col} between $2 and $3`, [w, t0, t1]);
    for (const col of ["resolved_at", "read_at"]) await pool.query(`update alerts set ${col} = $1 where ${col} between $2 and $3`, [w, t0, t1]);
  }
  return r;
}

// ───────────────────────── conversas ─────────────────────────
type Step = { d: "in" | "out"; t: string; g: number };
const I = (t: string, g = 3): Step => ({ d: "in", t, g });
const O = (t: string, g = 2): Step => ({ d: "out", t, g });
type Src = "Instagram" | "Indicação" | "Google" | "Passou na frente" | "Anúncio" | "link";

/** Horários a partir de `start`, em minutos de relógio (a resposta da Casa demora conforme o ritmo de quem atende). */
function forward(start: Date, steps: Step[], who: Uid | null): Date[] {
  let t = start.getTime();
  return steps.map((s, i) => { if (i) t += Math.max(1, Math.round(s.g * (s.d === "out" && who ? PACE[who] : 1))) * MIN; return new Date(t); });
}
/** Horários em minutos de EXPEDIENTE antes de agora; o último passo fica `endMin` minutos atrás. */
function backward(endMin: number, steps: Step[]): Date[] {
  const out: Date[] = new Array(steps.length);
  let acc = endMin;
  for (let i = steps.length - 1; i >= 0; i--) { out[i] = bizAgo(acc); acc += steps[i].g; }
  return out;
}

async function talk(p: Person, owner: Uid | null, src: Src, steps: Step[], times: Date[], opts: { ad?: boolean } = {}): Promise<{ dealId: string; last: Date }> {
  let dealId: string | null = null;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i], at = times[i];
    if (at.getTime() > NOW.getTime() - 1000) throw new Error(`Passo no futuro (${p.name ?? p.n}, ${i}): ${at.toISOString()}`);
    let body = s.t.replaceAll("{nome}", first(p.name));
    // Link da bio: a frase pronta do link (com o código) vem antes do que a cliente escreveu.
    if (i === 0 && src === "link") body = `Oi! Vim pelo Instagram da Casa Fiaes #${linkCode}\n${body.replace(/^(Oi|Olá)[!,]?\s*/i, "")}`;
    if (s.d === "in") {
      const r = await stamp(at, () => recordInbound({ channelId, externalId: `DEMO-IN-${randomUUID()}`, phoneRaw: phone(p.n), pushName: p.name, body, at, now: at, hasAdReferral: i === 0 && !!opts.ad }));
      if (!("dealId" in r) || !r.dealId) throw new Error(`Mensagem não entrou (${p.name}): ${JSON.stringify(r)}`);
      if (!dealId) {
        dealId = r.dealId;
        await db.update(deals).set({ ownerId: owner ? U[owner] : null, ...(src === "link" ? {} : { sourceLabel: src, origin: src }) }).where(eq(deals.id, dealId));
        await db.update(contacts).set({ email: p.email ?? null, instagram: p.instagram ?? null, birthDay: p.birthday?.[0] ?? null, birthMonth: p.birthday?.[1] ?? null, birthYear: p.birthday?.[2] ?? null })
          .where(eq(contacts.phoneE164, phone(p.n)));
      }
    } else {
      if (!dealId) throw new Error("A conversa começa pela cliente");
      const id = dealId;
      await stamp(at, () => recordOutbound({ dealId: id, channelId, externalId: `DEMO-OUT-${randomUUID()}`, body, userId: U[owner ?? "thaise"], at }));
    }
  }
  return { dealId: dealId!, last: times[times.length - 1] };
}

// ───────────────────────── ações do domínio no passado ─────────────────────────
const schedule = (dealId: string, when: Date, at: Date, by: Uid) => stamp(at, () => db.transaction(async (tx) => {
  await updateDealTx(tx, dealId, { scheduledAt: when.toISOString() }, U[by]);
  await moveDealTx(tx, dealId, "agendado", U[by], "manual", at);
}), true);
const attend = (dealId: string, at: Date, by: Uid, status: "compareceu" | "faltou" = "compareceu") => stamp(at, () => markAttendance(dealId, status, U[by], at), true);
async function sell(dealId: string, service: string, valueCents: number, pay: "pix" | "cartao" | "dinheiro", paid: boolean, at: Date, by: Uid) {
  await stamp(at, () => closeSale(dealId, { serviceId: svc[service], valueCents, paymentMethod: pay, paidNow: paid }, U[by]), true);
}
const moveTo = (dealId: string, key: string, at: Date, reason: string, by: Uid | null = null) =>
  stamp(at, () => db.transaction((tx) => moveDealTx(tx, dealId, key, by ? U[by] : null, reason, at)), true);
async function lose(dealId: string, reason: string, at: Date, by: Uid, recontact?: Date) {
  const [r] = await db.select({ id: lists.id }).from(lists).where(and(eq(lists.kind, "lost_reason"), eq(lists.label, reason)));
  await stamp(at, () => db.transaction(async (tx) => {
    await updateDealTx(tx, dealId, { lostReasonId: r.id, recontactAt: recontact ? recontact.toISOString() : null }, U[by]);
    await moveDealTx(tx, dealId, "perdido", U[by], "manual", at);
  }), true);
}
const nextAction = (dealId: string, title: string, due: Date, assignee: Uid, at: Date, by: Uid) =>
  stamp(at, () => db.transaction((tx) => setNextActionTx(tx, dealId, { title, dueAt: due, assigneeId: U[assignee] }, U[by], at)), true);

// ───────────────────────── roteiros de conversa ─────────────────────────
/** A conversa de cada serviço até o preço; o agendamento (`booking`) entra no fim com a data e a hora certas. */
const SALE: Record<string, Step[]> = {
  "Progressiva": [
    I("Oi, boa tarde! Vocês fazem progressiva? Qual o valor?"),
    O("Oi, {nome}! Tudo bem? Fazemos sim 😊 O valor depende do comprimento e do volume. Seu cabelo está em qual altura?", 2),
    I("Na altura do ombro, bem volumoso. Tenho luzes de uns 6 meses", 4),
    I("📷 (foto do cabelo) ondulado, na altura do ombro, com as pontas mais claras das luzes", 1),
    O("Que lindo! Pra esse comprimento a progressiva sai R$ 320, já com hidratação. Dura em média 3 meses e é sem formol.", 3),
  ],
  "Botox capilar": [
    I("Oi! Quanto tá o botox capilar?"),
    O("Oi, {nome}! O botox capilar está R$ 180 e dura umas 6 semanas. Quer que eu veja um horário?", 2),
    I("Ele alisa ou só tira o frizz? Meu cabelo é cacheado e não quero perder os cachos", 5),
    O("Ele reduz o frizz e dá brilho, mas não alisa. Seus cachos ficam definidos 😊", 2),
  ],
  "Coloração": [
    I("Bom dia! Queria retocar a raiz, tô com bastante branco aparecendo"),
    O("Bom dia, {nome}! O retoque de raiz com coloração fica R$ 220. Você usa qual tom hoje?", 2),
    I("Castanho médio, acho que é o 5.0", 6),
    O("Perfeito, a gente confere o tom na hora. Qual dia fica bom pra você?", 2),
  ],
  "Mechas/Luzes": [
    I("Oi! Vi no Instagram umas luzes que vocês fizeram e amei. Quanto custa?"),
    O("Oi, {nome}! Que bom que gostou 💛 Mechas e luzes começam em R$ 480, depende do comprimento e da base. Me conta como está o cabelo hoje?", 3),
    I("📷 (foto do cabelo) castanho escuro, comprido até o meio das costas, sem química", 5),
    O("Cabelo sem química é ótimo pra clarear! Pro seu fica R$ 480, e são umas 4 horas de procedimento.", 3),
  ],
  "Corte feminino": [
    I("Oi, vocês têm horário pra corte essa semana?"),
    O("Oi, {nome}! Temos sim. O corte feminino com escova está R$ 120. Qual dia é melhor pra você?", 2),
  ],
  "Hidratação": [
    I("Boa tarde, quanto tá a hidratação?"),
    O("Boa tarde, {nome}! A hidratação está R$ 90, e com escova R$ 130. Quer agendar?", 2),
  ],
  "Terapia capilar": [
    I("Oi, meu cabelo tá caindo muito depois da gravidez. Vocês fazem algum tratamento?"),
    O("Oi, {nome}! Fazemos sim, a terapia capilar para queda. A avaliação do couro cabeludo é sem custo e a sessão sai R$ 150.", 3),
    I("Quantas sessões precisa?", 5),
    O("Normalmente de 4 a 6, uma por semana. Na avaliação a gente fecha o plano certinho pra você.", 2),
  ],
  "Manicure e pedicure": [
    I("Oi! Quanto tá mão e pé?"),
    O("Oi, {nome}! Mão e pé fica R$ 70 💅 Qual dia fica bom pra você?", 2),
  ],
  "Design de sobrancelha": [
    I("Oi, vocês fazem design de sobrancelha com henna?"),
    O("Oi, {nome}! Fazemos sim, o design com henna fica R$ 45.", 2),
  ],
  "Escova": [
    I("Oi, preciso de uma escova pra formatura"),
    O("Oi, {nome}! Que lindo, parabéns! A escova fica R$ 60, com babyliss R$ 80.", 2),
  ],
};
const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
/** "sábado (10/10) às 9h30", no fuso de Salvador. */
function whenLabel(d: Date) {
  const l = new Date(d.getTime() - OFF);
  const hh = l.getUTCHours(), mm = l.getUTCMinutes();
  return `${WEEKDAY[l.getUTCDay()]} (${String(l.getUTCDate()).padStart(2, "0")}/${String(l.getUTCMonth() + 1).padStart(2, "0")}) às ${hh}h${mm ? String(mm).padStart(2, "0") : ""}`;
}
/** O fim da conversa que vira agendamento, com o horário que fica gravado no lead. */
const booking = (when: Date): Step[] => [
  I(`Quero marcar! Pode ser ${whenLabel(when)}?`, 6),
  O(`Pode sim! Fica agendado ${whenLabel(when)} 💛`, 2),
  I("Perfeito, obrigada!", 2),
  O("Imagina! Até lá 😊", 1),
];

const SERVICES: { label: string; cents: number; cycle: number | null }[] = [
  { label: "Progressiva", cents: 32000, cycle: 90 }, { label: "Botox capilar", cents: 18000, cycle: 45 }, { label: "Corte feminino", cents: 12000, cycle: 60 },
  { label: "Coloração", cents: 22000, cycle: 35 }, { label: "Mechas/Luzes", cents: 48000, cycle: 90 }, { label: "Hidratação", cents: 9000, cycle: 30 },
  { label: "Escova", cents: 6000, cycle: null }, { label: "Terapia capilar", cents: 15000, cycle: 30 }, { label: "Manicure e pedicure", cents: 7000, cycle: 15 },
  { label: "Design de sobrancelha", cents: 4500, cycle: 20 },
];
const price = (label: string) => SERVICES.find((s) => s.label === label)!.cents;

// ───────────────────────── banco ─────────────────────────
async function recreateDatabase() {
  const admin = new URL(process.env.DATABASE_URL!);
  admin.pathname = "/postgres";
  const c = new Client({ connectionString: admin.toString() });
  await c.connect();
  try {
    await c.query(`drop database if exists ${DEMO_DATABASE} with (force)`);
    await c.query(`create database ${DEMO_DATABASE}`);
  } finally { await c.end(); }
  execSync("npx drizzle-kit migrate", { stdio: "inherit", env: process.env });
}

async function setupCatalog() {
  await seed(db);
  const hash = await hashPassword("demo1234");
  await db.insert(users).values([
    { name: "Thaíse Fiaes", email: "demo@casafiaes.com.br", role: "gestor", passwordHash: hash },
    { name: "Ana", email: "ana.demo@casafiaes.com.br", role: "atendente", passwordHash: hash },
    { name: "Bruna", email: "bruna.demo@casafiaes.com.br", role: "atendente", passwordHash: hash },
  ]);
  await db.insert(lists).values(SERVICES.map((s, position) => ({ kind: "service" as const, label: s.label, position, cycleDays: s.cycle }))).onConflictDoNothing();
  // Origens pedidas: Instagram, Indicação, Google, Passou na frente, Anúncio (as três de lá já vêm no seed base).
  await db.insert(lists).values([{ kind: "origin" as const, label: "Google", position: 6 }, { kind: "origin" as const, label: "Passou na frente", position: 7 }]).onConflictDoNothing();
  await db.insert(channels).values({ name: "Recepção", instanceName: "demo-recepcao", status: "conectado", phone: "+5571900000000", lastEventAt: NOW });
}

async function loadIds() {
  for (const u of await db.select().from(users)) {
    if (u.email === "demo@casafiaes.com.br") U.thaise = u.id;
    if (u.email === "ana.demo@casafiaes.com.br") U.ana = u.id;
    if (u.email === "bruna.demo@casafiaes.com.br") U.bruna = u.id;
  }
  if (!U.thaise || !U.ana || !U.bruna) throw new Error("Equipe da demonstração não encontrada: rode o seed completo (scripts/demo.sh seed).");
  for (const s of await db.select().from(lists).where(eq(lists.kind, "service"))) svc[s.label] = s.id;
  // Número da Recepção sempre "conectado" e sem modo quieto (alguém pode ter mexido em Configurações durante a apresentação).
  const [ch] = await db.select().from(channels).where(eq(channels.instanceName, "demo-recepcao"));
  if (ch) {
    await db.update(channels).set({ name: "Recepção", status: "conectado", phone: "+5571900000000", quietUntil: null, lastEventAt: NOW }).where(eq(channels.id, ch.id));
    channelId = ch.id;
  } else {
    channelId = (await db.insert(channels).values({ name: "Recepção", instanceName: "demo-recepcao", status: "conectado", phone: "+5571900000000", lastEventAt: NOW }).returning())[0].id;
  }
}

// ───────────────────────── os leads ─────────────────────────
async function generate() {
  await db.execute(sql`truncate table automation_runs, alerts, deal_events, messages, outbox, tasks, deals, lead_sources, contacts, webhook_events, audit_log restart identity cascade`);
  linkCode = (await createSource({ label: "Link da bio (Instagram)", kind: "instagram", prefill: "Oi! Vim pelo Instagram da Casa Fiaes" }, U.thaise)).code;
  await createSource({ label: "Google Meu Negócio", kind: "google", prefill: "Oi! Achei a Casa Fiaes no Google" }, U.thaise);

  // ── Vendas fechadas nos últimos ~60 dias (Relatórios: valor, serviço, forma de pagamento, drill-down) ──
  type Closed = { p: Person; service: string; ago: number; slot: string; who: Uid; pay: "pix" | "cartao" | "dinheiro"; paid?: boolean; src: Src; before: number; bump?: number };
  const juliana = P("Juliana Andrade", { email: "juliana.andrade@exemplo.com", instagram: "ju.andrade.ssa", birthday: [14, 3, 1991] });
  const closed: Closed[] = [
    { p: juliana, service: "Coloração", ago: 35, slot: "10:30", who: "ana", pay: "pix", src: "Indicação", before: 2 },
    { p: P("Fernanda Lima", { birthday: bdayIn(3) }), service: "Hidratação", ago: 30, slot: "15:00", who: "thaise", pay: "cartao", src: "Instagram", before: 1 },
    { p: P("Camila Rocha", { instagram: "camilarocha" }), service: "Progressiva", ago: 1, slot: "09:00", who: "ana", pay: "cartao", src: "Instagram", before: 3, bump: 4000 },
    { p: P("Patrícia Nascimento"), service: "Mechas/Luzes", ago: 2, slot: "09:00", who: "bruna", pay: "pix", src: "link", before: 4 },
    { p: P("Larissa Souza"), service: "Botox capilar", ago: 3, slot: "14:00", who: "ana", pay: "pix", src: "Google", before: 2 },
    { p: P("Aline Barreto", { birthday: [22, 7, 1988] }), service: "Corte feminino", ago: 5, slot: "17:30", who: "bruna", pay: "dinheiro", src: "Passou na frente", before: 1 },
    { p: P("Renata Moura"), service: "Manicure e pedicure", ago: 6, slot: "16:00", who: "bruna", pay: "pix", src: "Indicação", before: 1 },
    { p: P("Bianca Carvalho", { email: "bianca.c@exemplo.com" }), service: "Progressiva", ago: 8, slot: "09:00", who: "thaise", pay: "cartao", paid: false, src: "Anúncio", before: 3 },
    { p: P("Priscila Menezes"), service: "Terapia capilar", ago: 9, slot: "10:00", who: "ana", pay: "pix", src: "Google", before: 3 },
    { p: P("Daniela Pires"), service: "Escova", ago: 11, slot: "16:00", who: "bruna", pay: "dinheiro", src: "Instagram", before: 2, bump: 2000 },
    { p: P("Gabriela Teles", { birthday: [5, 1, 1995] }), service: "Coloração", ago: 13, slot: "08:00", who: "ana", pay: "cartao", src: "Indicação", before: 2 },
    { p: P("Vanessa Cerqueira"), service: "Mechas/Luzes", ago: 16, slot: "09:00", who: "thaise", pay: "cartao", src: "link", before: 5, bump: 6000 },
    { p: P("Luana Bittencourt"), service: "Manicure e pedicure", ago: 16, slot: "10:00", who: "thaise", pay: "pix", src: "Passou na frente", before: 1 },
    { p: P("Mariana Sampaio", { instagram: "mari.sampaio" }), service: "Botox capilar", ago: 19, slot: "14:00", who: "bruna", pay: "pix", src: "Anúncio", before: 2 },
    { p: P("Carla Dantas"), service: "Design de sobrancelha", ago: 22, slot: "18:00", who: "ana", pay: "dinheiro", src: "Instagram", before: 1 },
    { p: P("Jéssica Rebouças"), service: "Progressiva", ago: 26, slot: "09:00", who: "bruna", pay: "cartao", paid: false, src: "Google", before: 4 },
    { p: P("Natália Guimarães"), service: "Corte feminino", ago: 31, slot: "17:30", who: "ana", pay: "pix", src: "Indicação", before: 2 },
    { p: P("Rafaela Matos"), service: "Hidratação", ago: 41, slot: "11:00", who: "bruna", pay: "pix", src: "Instagram", before: 1 },
    { p: P("Isabela Fonseca", { email: "isa.fonseca@exemplo.com" }), service: "Mechas/Luzes", ago: 48, slot: "09:00", who: "ana", pay: "cartao", src: "Anúncio", before: 6 },
    { p: P("Amanda Queiroz"), service: "Terapia capilar", ago: 55, slot: "10:00", who: "thaise", pay: "pix", src: "Google", before: 3 },
  ];
  for (const c of closed) {
    const apptDay = workDay(c.ago);
    const appt = dayAt(apptDay, c.slot);
    const convDay = workDay(apptDay + c.before);
    const start = dayAt(convDay, ["09:12", "10:40", "13:25", "15:05", "16:50"][c.p.n % 5]);
    const steps = [...SALE[c.service], ...booking(appt)];
    const { dealId, last } = await talk(c.p, c.who, c.src, steps, forward(start, steps, c.who), { ad: c.src === "Anúncio" });
    await schedule(dealId, appt, last, c.who);
    await attend(dealId, new Date(appt.getTime() + 20 * MIN), c.who);
    const doneAt = new Date(appt.getTime() + (c.service === "Mechas/Luzes" ? 240 : c.service === "Progressiva" ? 150 : 60) * MIN);
    await sell(dealId, c.service, price(c.service) + (c.bump ?? 0), c.pay, c.paid ?? true, doneAt, c.who);
    if (c.paid === false) await stamp(doneAt, () => db.transaction((tx) => updateDealTx(tx, dealId, { chargeAt: dayAt(TODAY, "10:00").toISOString() }, U[c.who])), true);
  }

  // ── Perdidos, com motivo ──
  const lost: { p: Person; who: Uid; src: Src; ago: number; reason: string; steps: Step[]; recontact?: number }[] = [
    { p: P("Viviane Brandão"), who: "ana", src: "Instagram", ago: 4, reason: "Preço", steps: [
      I("Oi, quanto custa a progressiva?"), O("Oi, {nome}! Para cabelo médio sai R$ 320, com hidratação inclusa.", 2),
      I("Nossa, achei um pouco caro. Vou pesquisar mais um pouco, obrigada", 9), O("Imagina! Se quiser, parcelamos no cartão em até 3x 😊", 2)], recontact: 20 },
    { p: P("Débora Falcão"), who: "bruna", src: "Google", ago: 7, reason: "Escolheu outro salão", steps: [
      I("Oi! Vocês fazem mechas loiras?"), O("Fazemos sim, {nome}! A partir de R$ 480. Quer que eu veja um horário?", 3),
      I("Ah, acabei marcando em outro lugar mais perto de casa, mas obrigada!", 180)] },
    { p: P("Letícia Magalhães"), who: "ana", src: "Anúncio", ago: 15, reason: "Não respondeu mais", steps: [
      I("Oi, tem horário sábado?"), O("Oi, {nome}! Sábado tenho 9h e 14h. Qual serviço você quer fazer?", 2),
      O("Oi, {nome}! Passando para saber se ficou alguma dúvida. Posso reservar um horário pra você?", 1440)] },
    { p: P("Raquel Teixeira"), who: "bruna", src: "Indicação", ago: 21, reason: "Mora longe", steps: [
      I("Boa tarde! Vocês ficam onde?"), O("Boa tarde, {nome}! Estamos no Caminho das Árvores, pertinho do shopping 😊", 3),
      I("Ah, eu moro em Lauro de Freitas, fica longe pra mim. Obrigada!", 12)] },
    { p: P("Simone Costa"), who: "thaise", src: "Instagram", ago: 29, reason: "Só pesquisando", steps: [
      I("Quanto custa botox capilar e progressiva?"), O("Oi, {nome}! Botox capilar R$ 180 e progressiva a partir de R$ 320.", 2),
      I("Ok, só tava pesquisando mesmo, obrigada", 6)] },
    { p: P("Kátia Araújo"), who: "ana", src: "Passou na frente", ago: 38, reason: "Sem horário disponível", steps: [
      I("Tem horário domingo?"), O("Oi, {nome}! Aos domingos a Casa não abre 😕 Sábado atendemos até as 17h.", 2),
      I("Só consigo domingo, infelizmente", 15)] },
  ];
  for (const l of lost) {
    const start = dayAt(workDay(l.ago), "11:20");
    const { dealId, last } = await talk(l.p, l.who, l.src, l.steps, forward(start, l.steps, l.who), { ad: l.src === "Anúncio" });
    await lose(dealId, l.reason, new Date(last.getTime() + 2 * DAY), l.who, l.recontact ? dayAt(-l.recontact, "10:00") : undefined);
  }

  // ── "Não é cliente" (arquivados) ──
  const notClients: { p: Person; ago: number; steps: Step[] }[] = [
    { p: P("Distribuidora Bahia Cosméticos"), ago: 3, steps: [I("Bom dia! Aqui é da distribuidora, o pedido de vocês (shampoo e máscaras) sai para entrega hoje à tarde."), O("Bom dia! Obrigada, estaremos aqui.", 4)] },
    { p: P("Lu"), ago: 5, steps: [I("Thaíse, é a Lu! Domingo tem almoço lá em casa, vem? 😘")] },
    { p: P(null), ago: 9, steps: [I("Boa noite, é da pizzaria?"), O("Oi! Aqui é um salão de beleza, acho que foi engano 😊", 3), I("Ops, desculpa!", 1)] },
  ];
  for (const n of notClients) {
    const start = dayAt(workDay(n.ago), "10:05");
    const { dealId, last } = await talk(n.p, "thaise", "Indicação", n.steps, forward(start, n.steps, "thaise"));
    await stamp(new Date(last.getTime() + 5 * MIN), () => archiveDeals([dealId], U.thaise), true);
  }

  // ── Fila agora: atrasados (alerta sai do motor no fim) ──
  const late: { p: Person; who: Uid | null; src: Src; wait: number; steps: Step[]; ad?: boolean }[] = [
    { p: P("Tatiane Santos", { instagram: "tati.santos" }), who: null, src: "link", wait: 18, steps: [
      I("Oi! Quanto tá a progressiva pra cabelo longo?"), I("Meu cabelo vai até a cintura, bem grosso", 1)] },
    { p: P("Lorena Silveira"), who: "ana", src: "Google", wait: 12, steps: [
      I("Bom dia! Vocês atendem hoje? Preciso de uma escova pra um evento à noite")] },
    { p: P("Michele Paixão", { birthday: bdayIn(7) }), who: "bruna", src: "Indicação", wait: 15, steps: [
      I("Oi, a Juliana me indicou vocês!"), O("Oi, {nome}! Que bom 💛 Como posso te ajudar?", 2),
      I("Queria saber da coloração. Tenho que cobrir os brancos todo mês", 4), O("O retoque de raiz fica R$ 220 e dura umas 4 semanas.", 3),
      I("E se eu quiser cobrir os brancos e dar uma clareada? Muda o valor?", 20)] },
    { p: P("Cristiane Borges"), who: "ana", src: "Instagram", wait: 6, steps: [
      I("Oi! Vocês fazem luzes em cabelo cacheado?"), O("Oi, {nome}! Fazemos sim, com técnica própria pra não ressecar os cachos. A partir de R$ 480.", 2),
      I("Consegue sábado às 10h?", 15)] },
  ];
  for (const a of late) await talk(a.p, a.who, a.src, a.steps, backward(a.wait, a.steps), { ad: a.ad });

  // ── Perto do prazo e aguardando resposta (dentro do prazo) ──
  const near: { p: Person; who: Uid; src: Src; waitSec: number; steps: Step[]; ad?: boolean }[] = [
    { p: P("Thaís Almeida"), who: "bruna", src: "Anúncio", ad: true, waitSec: 75, steps: [I("Oi! Vi o anúncio do botox capilar. Ainda tá com o preço promocional?")] },
    { p: P("Paula Rios"), who: "ana", src: "Instagram", waitSec: 110, steps: [
      I("Oi, quero fazer hidratação essa semana"), O("Oi, {nome}! Tenho quarta às 11h ou às 14h.", 2), I("Pode ser às 15h então?", 25)] },
    { p: P("Elaine Cardoso"), who: "bruna", src: "Passou na frente", waitSec: 25, steps: [I("Oi, passei aí na frente ontem e peguei o cartão. Vocês fazem unha em gel?")] },
    { p: P("Nathália Prado", { birthday: bdayIn(5, 1993) }), who: "ana", src: "Google", waitSec: 35, steps: [
      I("Boa tarde! Quanto tá a hidratação?"), O("Boa tarde, {nome}! R$ 90, e com escova R$ 130 😊", 2), I("Obrigada! E a hidratação dura quanto tempo?", 10)] },
  ];
  for (const a of near) await talk(a.p, a.who, a.src, a.steps, backward(a.waitSec / 60, a.steps), { ad: a.ad });

  // ── Aguardando a cliente (a Casa respondeu por último) ──
  const waitingClient: { p: Person; who: Uid; src: Src; ago: number; steps: Step[] }[] = [
    { p: P("Ingrid Valente"), who: "ana", src: "Instagram", ago: 20, steps: [
      I("Oi! Queria fazer a avaliação pra queda de cabelo"), O("Oi, {nome}! A avaliação é sem custo 😊 Tenho quinta às 10h, 14h ou 16h30. Qual prefere?", 2)] },
    { p: P("Lívia Coutinho"), who: "bruna", src: "Google", ago: 32, steps: [
      I("Vocês fazem sobrancelha?"), O("Fazemos sim, {nome}! Design com henna fica R$ 45. Quer marcar?", 3)] },
    { p: P("Joana Seixas"), who: "bruna", src: "Passou na frente", ago: 45, steps: [
      I("Bom dia, tem horário pra pé e mão hoje?"), O("Bom dia, {nome}! Hoje tenho às 15h e às 17h. Qual fica melhor?", 4)] },
  ];
  for (const w of waitingClient) await talk(w.p, w.who, w.src, w.steps, backward(w.ago, w.steps));

  // ── Próximas ações (tarefas de hoje, uma atrasada) ──
  const acts: { p: Person; who: Uid; src: Src; ago: number; steps: Step[]; task: string; dueMin: number; assignee: Uid }[] = [
    { p: P("Mônica Freire", { email: "monica.freire@exemplo.com" }), who: "thaise", src: "Indicação", ago: 25, assignee: "thaise", dueMin: 90, task: "Enviar orçamento do pacote de noiva", steps: [
      I("Oi! Vou casar em dezembro e queria fazer o dia da noiva com vocês"), O("Que alegria, {nome}! Parabéns 💛 Temos pacote com cabelo, maquiagem e unhas.", 2),
      I("Que lindo! Vamos eu, minha mãe e duas madrinhas", 5), O("Vou montar o orçamento do pacote de noiva pra vocês quatro e te mando ainda hoje!", 3)] },
    { p: P("Adriana Leal"), who: "ana", src: "Instagram", ago: 40, assignee: "ana", dueMin: -25, task: "Confirmar horário de mechas no sábado", steps: [
      I("Oi, consegue mechas no sábado?"), O("Oi, {nome}! Vou confirmar com a Thaíse se tem horário pra mechas no sábado e te aviso 😊", 2)] },
    { p: P("Helena Vasconcelos"), who: "bruna", src: "Google", ago: 55, assignee: "thaise", dueMin: -40, task: "Enviar fotos de antes e depois da progressiva", steps: [
      I("Oi! Vocês têm fotos de antes e depois da progressiva?"), O("Temos sim, {nome}! Vou separar algumas e te mando.", 4)] },
  ];
  for (const a of acts) {
    const { dealId, last } = await talk(a.p, a.who, a.src, a.steps, backward(a.ago, a.steps));
    await nextAction(dealId, a.task, new Date(NOW.getTime() + a.dueMin * MIN), a.assignee, last, a.who);
  }

  // ── Agendados: hoje, amanhã e os do último dia útil para conferir o comparecimento ──
  const booked: { p: Person; who: Uid; src: Src; service: string; day: number; slot: string; convAgo: number; confirmed?: boolean }[] = [
    { p: P("Yasmin Pereira"), who: "ana", src: "Instagram", service: "Coloração", day: TODAY, slot: "10:00", convAgo: 2, confirmed: true },
    { p: P("Sandra Mota", { birthday: bdayIn(2) }), who: "bruna", src: "Indicação", service: "Progressiva", day: TODAY, slot: "11:30", convAgo: 3 },
    { p: P("Lúcia Ramos"), who: "ana", src: "Google", service: "Mechas/Luzes", day: TODAY, slot: "14:00", convAgo: 4 },
    { p: P("Bárbara Macedo", { instagram: "babi.macedo" }), who: "bruna", src: "Anúncio", service: "Manicure e pedicure", day: TODAY, slot: "16:30", convAgo: 1 },
    { p: P("Carolina Pessoa"), who: "ana", src: "link", service: "Botox capilar", day: TOMORROW, slot: "09:00", convAgo: 2 },
    { p: P("Érica Lins"), who: "bruna", src: "Passou na frente", service: "Corte feminino", day: TOMORROW, slot: "15:00", convAgo: 1 },
    { p: P("Flávia Galvão"), who: "ana", src: "Instagram", service: "Hidratação", day: PREV_DAY, slot: "10:00", convAgo: 2 },
    { p: P("Manuela Brito"), who: "bruna", src: "Google", service: "Escova", day: PREV_DAY, slot: "15:30", convAgo: 2 },
  ];
  for (const b of booked) {
    const appt = dayAt(b.day, b.slot);
    const steps = [...SALE[b.service], ...booking(appt)];
    const conv = dayAt(workDay(Math.max(b.day, 0) + b.convAgo), "14:10");
    const { dealId, last } = await talk(b.p, b.who, b.src, steps, forward(conv, steps, b.who), { ad: b.src === "Anúncio" });
    await schedule(dealId, appt, last, b.who);
    if (b.confirmed) await stamp(new Date(last.getTime() + 3 * 3_600_000), () => setAttendance(dealId, "confirmado", null), true);
  }
  // Cliente que volta: retoque da coloração de 35 dias atrás, já agendado para amanhã.
  {
    const appt = dayAt(TOMORROW, "10:00");
    const steps = [I("Oi! Tá na hora de retocar a raiz de novo 😅 Tem horário essa semana?"), O(`Oi, {nome}! Que bom te ver de novo 💛 Tenho ${whenLabel(appt)}, pode ser?`, 2), I("Perfeito!", 3), O("Agendado! Até lá 😊", 1)];
    const { dealId, last } = await talk(juliana, "ana", "Indicação", steps, backward(70, steps));
    await schedule(dealId, appt, last, "ana");
  }

  // ── Follow-up (a cliente não respondeu) ──
  const nudge = "Oi, {nome}! Passando para saber se ficou alguma dúvida. Posso reservar um horário pra você?";
  const fups: { p: Person; who: Uid; src: Src; service: string; stage: string; lastOutAgo: number }[] = [
    { p: P("Tainá Ferraz"), who: "ana", src: "Instagram", service: "Progressiva", stage: "followup_1", lastOutAgo: 3 },
    { p: P("Rita Campos"), who: "bruna", src: "Google", service: "Botox capilar", stage: "followup_1", lastOutAgo: 3 },
    { p: P("Silvana Couto"), who: "ana", src: "Anúncio", service: "Mechas/Luzes", stage: "followup_2", lastOutAgo: 5 },
    { p: P("Elisa Moreira"), who: "bruna", src: "Indicação", service: "Corte feminino", stage: "followup_3", lastOutAgo: 7 },
    { p: P("Marina Costa Reis"), who: "ana", src: "Passou na frente", service: "Terapia capilar", stage: "followup_4", lastOutAgo: 9 },
  ];
  for (const [i, f] of fups.entries()) {
    const steps = SALE[f.service].slice(0, 2);
    const start = dayAt(workDay(f.lastOutAgo), "10:20");
    const { dealId, last } = await talk(f.p, f.who, f.src, steps, forward(start, steps, f.who), { ad: f.src === "Anúncio" });
    const order = ["followup_1", "followup_2", "followup_3", "followup_4"];
    const upto = order.indexOf(f.stage);
    let t = last;
    for (let k = 0; k <= upto; k++) {
      // O último passo foi hoje cedo (o motor move na abertura); o Follow-up 4 está parado há dias.
      const enter = k === upto && f.stage !== "followup_4" ? bizAgo(8 + i * 4) : new Date(t.getTime() + DAY + 30 * MIN);
      await moveTo(dealId, order[k], enter, "automacao:followup_diario");
      if (k < upto || f.stage === "followup_4") {
        const at = new Date(enter.getTime() + 15 * MIN);
        await stamp(at, () => recordOutbound({ dealId, channelId, externalId: `DEMO-OUT-${randomUUID()}`, body: nudge.replaceAll("{nome}", first(f.p.name)), userId: U[f.who], at }));
        t = at;
      }
    }
  }

  // Clientes: quem já fechou com a Casa.
  await db.execute(sql`update contacts c set is_client = true, client_since = x.first, last_service_at = x.last
    from (select d.contact_id, min(d.closed_at) as first, max(d.closed_at) as last from deals d join stages s on s.id = d.stage_id where s.kind = 'fechado' group by d.contact_id) x
    where x.contact_id = c.id`);

  // Retornos antigos (de vendas de semanas atrás) a equipe já fez: concluídos um dia depois do vencimento. Ficam abertos só os recentes.
  const oldReturns = (await db.execute(sql`select id, due_at from tasks where kind = 'retorno' and done_at is null and due_at < ${new Date(NOW.getTime() - 3 * DAY).toISOString()}::timestamptz`)).rows as { id: string; due_at: string }[];
  for (const t of oldReturns) {
    const at = new Date(new Date(t.due_at).getTime() + DAY);
    await stamp(at, () => db.transaction((tx) => completeTaskTx(tx, t.id, U.thaise, "concluida", at)), true);
  }

  // O motor roda como o worker rodaria: minuto a minuto nos últimos 25 min de expediente (o último é agora, ou o fim do último
  // expediente com a Casa fechada). Assim cada espera ganha o alerta no prazo da etapa e sobe para a gestão aos 10 min, como em produção.
  const evalAt = isOpen(NOW.getTime(), HOURS) ? NOW : new Date(businessInstantBefore(NOW.getTime(), 1, HOURS));
  const r = { fired: 0, alerts: 0, moved: 0, errors: [] as string[] };
  for (let m = 25; m >= 0; m--) {
    const at = m === 0 ? evalAt : new Date(businessInstantBefore(evalAt.getTime(), m * 60, HOURS));
    const s = await stamp(at, () => runRules(at));
    r.fired += s.fired; r.alerts += s.alerts; r.moved += s.moved; r.errors.push(...s.errors);
  }
  await remindDueTasks(evalAt);
  // "Parado" é aviso informativo de rotina: vem lido, para o sino destacar as esperas.
  await db.execute(sql`update alerts set read_at = created_at where type = 'parado_dias'`);
  return { regras: r, evalAt };
}

async function summary(evalAt: Date) {
  const q = async (s: ReturnType<typeof sql>) => (await db.execute(s)).rows;
  console.log("Etapas:", await q(sql`select s.name, count(*)::int as n from deals d join stages s on s.id = d.stage_id where d.archived_at is null group by s.name, s.position order by s.position`));
  console.log("Atrasados (alerta de espera aberto):", (await q(sql`select count(distinct deal_id)::int as n from alerts where wait_key is not null and wait_key not like 'task:%' and resolved_at is null`))[0]);
  console.log("Totais:", (await q(sql`select (select count(*) from contacts)::int as contatos, (select count(*) from deals)::int as leads, (select count(*) from messages)::int as mensagens,
    (select count(*) from tasks where done_at is null)::int as tarefas_abertas, (select count(*) from alerts)::int as alertas, (select count(*) from deals where archived_at is not null)::int as arquivados`))[0]);
  console.log(`Motor avaliado em ${evalAt.toLocaleString("pt-BR", { timeZone: "America/Bahia" })} (${isOpen(NOW.getTime(), HOURS) ? "agora, Casa aberta" : "último expediente: a Casa está fechada agora"})`);
}

async function main() {
  if (!REFRESH) await recreateDatabase();
  if (!REFRESH) await setupCatalog();
  HOURS = await getBusinessHours();
  await loadIds();
  const t = Date.now();
  const { regras, evalAt } = await generate();
  console.log(`Demonstração ${REFRESH ? "atualizada" : "criada"} em ${((Date.now() - t) / 1000).toFixed(1)} s. Motor:`, { disparos: regras.fired, alertas: regras.alerts, movidos: regras.moved, erros: regras.errors });
  await summary(evalAt);
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(leadSources)) as { n: number }[];
  console.log(`Origens com link: ${n}. Login: demo@casafiaes.com.br / demo1234`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
