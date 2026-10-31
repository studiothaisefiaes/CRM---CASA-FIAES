import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { adCampaigns, deals, users } from "../db/schema";
import { moveDealTx, recordInbound } from "../domain/deals";
import { nameAdCampaign } from "../domain/ad-origin";
import { adToSale, entryPointToSale, sourceToSale } from "./queries";
import { loadOverview } from "./screen";
import { parseOrigin } from "@/lib/ad-origin";
import { permsFor } from "../../../test/perms";
import { resetDb } from "../../../test/db";
import { etapasAntigasAtivas } from "../../../test/legacy-stages";
import { AD_REPLY } from "../../../test/fixtures/evolution";

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 13, h + 3, m)); // 13/10, hora de Salvador
const adOf = (sourceId: string, body = AD_REPLY.body) => parseOrigin([{ externalAdReply: { ...AD_REPLY, sourceId, body } }]);
const door = (source: string, app = "whatsapp") => parseOrigin([{ entryPointConversionSource: source, entryPointConversionApp: app }]);
let n = 0;
async function lead(origin: ReturnType<typeof parseOrigin> | null, at = T(9)) {
  n++;
  const r = await recordInbound({ channelId: null, externalId: `O${n}`, phoneRaw: `7191000${String(1000 + n)}`, body: "oi", at, hasAdReferral: !!origin?.ad, origin });
  if (!("dealId" in r)) throw new Error("sem conversa");
  return r.dealId;
}
const sell = async (id: string, cents: number) => {
  await db.update(deals).set({ valueCents: cents, paymentMethod: "pix" }).where(eq(deals.id, id));
  await db.transaction((tx) => moveDealTx(tx, id, "fechado", null, "venda", T(15)));
};
const schedule = (id: string) => db.transaction((tx) => moveDealTx(tx, id, "agendado", null, "manual", T(12)));
let uid = "";

beforeEach(async () => {
  await resetDb(); await etapasAntigasAtivas(); n = 0;
  [{ id: uid }] = await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
});

describe("relatório de Origem: por campanha e por porta de entrada", () => {
  it("por campanha: conversas, agendados, fechados e receita (as mesmas regras da origem); anúncios com o mesmo nome somam", async () => {
    const a1 = await lead(adOf("111"));
    const a2 = await lead(adOf("111"));
    const b1 = await lead(adOf("222", "Outro anúncio de cabelo"));
    await lead(door("global_search_new_chat"));
    await schedule(a1); await sell(a1, 30_000); await schedule(b1);
    let rows = await adToSale({ period: "hoje", now: T(18) });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ campanha: "“Hoje quis mostrar um cabelo sem finalização. Porque…”", anuncios: ["111"], leads: 2, agendados: 1, fechados: 1, receitaCents: 30_000 });
    expect(rows[1]).toMatchObject({ campanha: "“Outro anúncio de cabelo”", leads: 1, agendados: 1, fechados: 0 });
    // A gestão dá o mesmo nome aos dois anúncios: viram uma campanha só.
    await nameAdCampaign("111", "Método Fiaes outubro", uid); await nameAdCampaign("222", "Método Fiaes outubro", uid);
    rows = await adToSale({ period: "hoje", now: T(18) });
    expect(rows).toEqual([expect.objectContaining({ campanha: "Método Fiaes outubro", anuncios: ["111", "222"], leads: 3, agendados: 2, fechados: 1, receitaCents: 30_000 })]);
    // A origem principal mostra o nome da campanha (a mesma coluna que o resto do CRM usa).
    expect((await sourceToSale({ period: "hoje", now: T(18) })).find((r) => r.origem === "Método Fiaes outubro")).toMatchObject({ leads: 3 });
    void a2;
  });

  it("por porta de entrada: cada porta na ordem fixa e 'Não informada' para as sem porta", async () => {
    const x = await lead(adOf("111"));
    await lead(door("click_to_chat_link", "instagram"));
    await lead(door("click_to_chat_link")); await lead(door("click_to_chat_link"));
    await lead(null);
    await sell(x, 10_000);
    const rows = await entryPointToSale({ period: "hoje", now: T(18) });
    expect(rows.map((r) => [r.porta, r.rotulo, r.leads])).toEqual([["anuncio", "Anúncio", 1], ["instagram", "Botão do Instagram", 1], ["link", "Link", 2], [null, "Não informada", 1]]);
    expect(rows[0]).toMatchObject({ fechados: 1, receitaCents: 10_000 });
  });

  it("vale o filtro de pessoa/origem e o período (coorte)", async () => {
    await lead(adOf("111"), T(9));
    const ontem = new Date(T(9).getTime() - 86_400_000);
    await lead(adOf("111"), ontem);
    expect((await adToSale({ period: "hoje", now: T(18) }))[0].leads).toBe(1);
    expect(await adToSale({ period: "hoje", now: T(18), source: "Indicação" })).toEqual([]);
  });

  it("na tela: receita só para quem vê valores", async () => {
    const x = await lead(adOf("111")); await sell(x, 10_000);
    const gestor = { id: uid, name: "G", email: "g@c.com", perms: permsFor("gestor") };
    const atendente = { id: uid, name: "A", email: "a@c.com", perms: permsFor("atendente") };
    const g = await loadOverview(gestor, { period: "hoje", now: T(18) });
    expect(g.ads[0].receitaCents).toBe(10_000);
    expect(g.entries.find((e) => e.porta === "anuncio")?.receitaCents).toBe(10_000);
    const a = await loadOverview(atendente, { period: "hoje", now: T(18) });
    expect(a.ads.every((r) => r.receitaCents === null)).toBe(true);
    expect(a.entries.every((r) => r.receitaCents === null)).toBe(true);
  });

  it("anúncio arquivado continua no relatório (arquivar só limpa a lista de Configurações)", async () => {
    await lead(adOf("111"));
    await db.update(adCampaigns).set({ archivedAt: new Date() });
    expect(await adToSale({ period: "hoje", now: T(18) })).toHaveLength(1);
  });
});
