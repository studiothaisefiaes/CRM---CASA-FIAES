import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, channels, contacts, deals, outbox, profiles, pushSubscriptions, stages, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { sendPushForPendingAlerts } from "../push";
import { CLIENT_MESSAGE_ALERT } from "./client-message-alert";
import { beat } from "./presence";
import { freeCandidates } from "./distribution";
import { activeUsers, recordInbound } from "./deals";
import { saveAutoMessage } from "./auto-message-settings";
import { getQueueFilterOptions } from "../queries/queue";
import { permsFor } from "../../../test/perms";

/**
 * Perfil Contador (26/10): a pessoa criada pelo link não atende. Não entra no rodízio nem no "Disponível", não recebe aviso nem push de
 * conversa ("Fulana escreveu", escaladas) e não aparece nas listas de quem atende.
 */
const NOW = new Date("2026-10-13T13:00:00Z"); // terça 10h em Salvador: Casa aberta
let contador = "", ana = "";

beforeEach(async () => {
  await resetDb();
  const pid = async (k: string) => (await db.select().from(profiles).where(eq(profiles.key, k)))[0].id;
  contador = (await db.insert(users).values({ name: "Carlos Contador", email: "carlos@contabil.com", passwordHash: "x", profileId: await pid("contador") }).returning())[0].id;
  ana = (await db.insert(users).values({ name: "Ana", email: "ana@c.com", passwordHash: "x", profileId: await pid("atendente") }).returning())[0].id;
});
afterEach(() => setWhatsappProvider(null));

describe("Contador fora do rodízio e dos avisos", () => {
  it("abrir o CRM não o deixa Disponível (só quem recebe conversas acorda)", async () => {
    expect(await beat(contador, NOW)).toBe("ausente");
    expect((await db.select().from(users).where(eq(users.id, contador)))[0].availability).toBe("ausente");
  });

  it("nem forçado como Disponível ele entra na distribuição", async () => {
    await db.update(users).set({ availability: "disponivel", lastSeenAt: NOW }).where(eq(users.id, contador));
    await db.update(users).set({ availability: "disponivel", lastSeenAt: NOW }).where(eq(users.id, ana));
    const ids = await db.transaction((tx) => freeCandidates(tx, NOW, 99)).then((c) => c.map((x) => x.id));
    expect(ids).toEqual([ana]);
  });

  it("não conta como alguém Disponível para a mensagem de ausência", async () => {
    const sent: string[] = [];
    setWhatsappProvider({
      createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
      sendText: async (_i: string, _t: string, text: string) => { sent.push(text); return { externalId: "OUT" + sent.length }; }, sendPoll: async () => ({ externalId: "P" }),
    } as never);
    const [{ id: ch }] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning();
    await saveAutoMessage("ausencia", { enabled: true, text: "Já, já alguém te responde." }, ana);
    await db.update(users).set({ availability: "disponivel", lastSeenAt: NOW }).where(eq(users.id, contador));
    await recordInbound({ channelId: ch, externalId: "c-1", phoneRaw: "71990000901", pushName: "Carla Werneck", body: "oi", at: NOW, now: NOW });
    expect((await db.select().from(outbox)).map((o) => o.text)).toEqual(["Já, já alguém te responde."]);
    expect(sent).toEqual([]);
  });

  it("não recebe push de \"Fulana escreveu\" nem de escalada para a gestão", async () => {
    const [c] = await db.insert(contacts).values({ phoneE164: "+5571999990900", name: "Maria" }).returning();
    const [st] = await db.select().from(stages).limit(1);
    const [d] = await db.insert(deals).values({ contactId: c.id, stageId: st.id }).returning();
    await db.insert(pushSubscriptions).values([
      { userId: contador, endpoint: "https://p/contador", p256dh: "k", auth: "a" },
      { userId: ana, endpoint: "https://p/ana", p256dh: "k", auth: "a" },
    ]);
    await db.insert(alerts).values([
      { dealId: d.id, userId: null, audience: "responsavel", type: CLIENT_MESSAGE_ALERT, severity: "info", message: "Maria escreveu", dedupeKey: "cm1" },
      { dealId: d.id, userId: null, audience: "gestao", level: 2, type: "x", severity: "urgente", message: "escalado", dedupeKey: "e1", waitKey: "w1" },
    ]);
    const to: string[] = [];
    await sendPushForPendingAlerts(async (sub) => { to.push(sub.endpoint); return 201; });
    expect(to).toContain("https://p/ana");
    expect(to).not.toContain("https://p/contador");
  });

  it("não aparece nas listas de quem atende (dona na Fila, nos Relatórios e no Quadro)", async () => {
    const gestor = { id: ana, perms: permsFor("gestor") };
    const { owners } = await getQueueFilterOptions(gestor as never);
    expect(owners.map((o) => o.id)).toContain(ana);
    expect(owners.map((o) => o.id)).not.toContain(contador);
    expect((await activeUsers({ atendem: true })).map((u) => u.id)).not.toContain(contador);
    // A lista geral (pessoas para a chave da API) continua com todo mundo.
    expect((await activeUsers()).map((u) => u.id)).toContain(contador);
  });
});
