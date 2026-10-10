import { it, expect, beforeEach } from "vitest";
import { db } from "../db"; import { auditLog, deals, leadSources, users } from "../db/schema";
import { createSource, sourceLink, matchSource, setSourceActive } from "./sources"; import { recordInbound } from "./deals";
import { resetDb } from "../../../test/db";
let uid = ""; beforeEach(async () => { await resetDb(); [{ id: uid }] = await db.insert(users).values({ name: "T", email: "t@c.com", role: "gestor", passwordHash: "x" }).returning(); });
it("link wa.me com frase + código e reconhecimento na 1ª mensagem", async () => {
  const s = await createSource({ label: "Bio do Instagram", kind: "instagram", prefill: "Oi! Vi vocês no Instagram" }, uid);
  expect(s.code).toMatch(/^[a-z0-9]{8}$/);
  expect(sourceLink(s, "+557199990404")).toBe(`https://wa.me/557199990404?text=${encodeURIComponent(`Oi! Vi vocês no Instagram #${s.code}`)}`);
  await recordInbound({ channelId: null, externalId: "S1", phoneRaw: "71999994444", body: `Oi! Vi vocês no Instagram #${s.code}` });
  expect((await db.select().from(deals))[0]).toMatchObject({ sourceId: s.id, sourceLabel: "Bio do Instagram", origin: "Bio do Instagram" });
});
it("cliente apagou o código mas manteve a frase → reconhece pela frase", async () => {
  const s = await createSource({ label: "Panfleto", kind: "panfleto", prefill: "Peguei o panfleto da Casa" }, uid);
  expect(await matchSource("peguei o panfleto da casa")).toEqual({ id: s.id, label: "Panfleto" });
  expect(await matchSource("  Peguei   o panfleto\nda Casa, quanto custa?")).toEqual({ id: s.id, label: "Panfleto" });
});
it("código em qualquer lugar e sem diferenciar maiúsculas", async () => {
  const s = await createSource({ label: "Google", kind: "google", prefill: "Oi, achei no Google" }, uid);
  expect(await matchSource(`quero agendar #${s.code.toUpperCase()} obrigada`)).toEqual({ id: s.id, label: "Google" });
});
it("mensagem comum → null", async () => { expect(await matchSource("oi, qual o valor?")).toBeNull(); expect(await matchSource(null)).toBeNull(); });
it("origem desativada não reconhece; sem prefill o link leva só o código", async () => {
  const s = await createSource({ label: "Cartaz", kind: "outro" }, uid);
  expect(s.prefill).toBeNull();
  expect(sourceLink(s, "5571965914")).toBe(`https://wa.me/5571965914?text=${encodeURIComponent(`#${s.code}`)}`);
  expect(await matchSource(`#${s.code}`)).not.toBeNull();
  await setSourceActive(s.id, false, uid);
  expect(await matchSource(`#${s.code}`)).toBeNull();
});
it("lead que já existe não muda de origem em mensagens seguintes", async () => {
  const a = await createSource({ label: "A", kind: "outro", prefill: "frase a" }, uid);
  const b = await createSource({ label: "B", kind: "outro", prefill: "frase b" }, uid);
  await recordInbound({ channelId: null, externalId: "X1", phoneRaw: "71999995555", body: `oi #${a.code}` });
  await recordInbound({ channelId: null, externalId: "X2", phoneRaw: "71999995555", body: `oi #${b.code}` });
  expect((await db.select().from(deals))[0]).toMatchObject({ sourceId: a.id });
});
it("frase empatada entre duas origens ativas → null (não atribui em silêncio)", async () => {
  await createSource({ label: "Panfleto A", kind: "panfleto", prefill: "Peguei o panfleto da Casa" }, uid);
  await createSource({ label: "Panfleto B", kind: "panfleto", prefill: "Peguei o panfleto da Casa" }, uid);
  expect(await matchSource("peguei o panfleto da casa")).toBeNull();
});
it("frase mais longa vence a mais curta; origem desativada não gera empate", async () => {
  const curta = await createSource({ label: "Curta", kind: "outro", prefill: "Vi vocês no Instagram" }, uid);
  const longa = await createSource({ label: "Longa", kind: "instagram", prefill: "Vi vocês no Instagram do salão" }, uid);
  expect(await matchSource("oi, vi vocês no instagram do salão")).toEqual({ id: longa.id, label: "Longa" });
  await setSourceActive(longa.id, false, uid);
  expect(await matchSource("oi, vi vocês no instagram do salão")).toEqual({ id: curta.id, label: "Curta" });
  const dup = await createSource({ label: "Dup", kind: "outro", prefill: "Vi vocês no Instagram" }, uid);
  expect(dup.id).not.toBe(curta.id);
  expect(await matchSource("vi vocês no instagram")).toBeNull();
});
it("frase de reserva com menos de 12 caracteres não reconhece; com 12 reconhece", async () => {
  await createSource({ label: "Curtinha", kind: "outro", prefill: "Oi! Quero" }, uid);
  expect(await matchSource("oi! quero agendar um horário")).toBeNull();
  const s = await createSource({ label: "Doze", kind: "outro", prefill: "Oi, tudo bem" }, uid);
  expect(await matchSource("oi, tudo bem? quero agendar")).toEqual({ id: s.id, label: "Doze" });
});
it("limite do código: prefixo e sufixo de outro código não casam", async () => {
  const [row] = await db.insert(leadSources).values({ code: "abc12345", label: "Fixo", kind: "outro" }).returning();
  expect(await matchSource("oi #abc1234")).toBeNull();
  expect(await matchSource("oi #abc12345x")).toBeNull();
  expect(await matchSource("oi #abc123456789")).toBeNull();
  expect(await matchSource("oi #abc12345.")).toEqual({ id: row.id, label: "Fixo" });
  expect(await matchSource("#ABC12345")).toEqual({ id: row.id, label: "Fixo" });
});
it("setSourceActive valida o id antes de gravar auditoria", async () => {
  await expect(setSourceActive("nao-e-uuid", false, uid)).rejects.toThrow();
  expect(await db.select().from(auditLog)).toHaveLength(0);
});
