import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const { session } = vi.hoisted(() => ({ session: { perms: [] as string[], id: "" } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/session", () => ({
  assertPerm: async (p: string) => { if (!session.perms.includes(p)) throw new (await import("@/server/domain/errors")).UserFacingError("Você não tem permissão para isso."); return { id: session.id, perms: session.perms }; },
}));
import { db } from "@/server/db";
import { channels, libraryFiles, messages, users } from "@/server/db/schema";
import { recordInbound } from "@/server/domain/deals";
import { setWhatsappProvider } from "@/server/whatsapp/evolution";
import { resetDb } from "../../../../../test/db";
import { deleteLibraryFileAction, updateLibraryFileAction, uploadLibraryFileAction } from "./actions";
import { listLibraryAction, sendLibraryFileAction } from "../../conversa/actions";

vi.mock("@/server/domain/deal-scope", async (orig) => ({ ...(await orig<typeof import("@/server/domain/deal-scope")>()), assertCanActOnDeal: async () => {} }));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const sentMedia: string[] = [];
const provider = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async () => ({ externalId: "T" }), sendMedia: async () => { sentMedia.push("m"); return { externalId: "M" + sentMedia.length }; }, sendAudio: async () => ({ externalId: "A" }),
};
const form = () => { const f = new FormData(); f.set("file", new File([new Uint8Array(PNG)], "t.png", { type: "image/png" })); f.set("name", "Tabela"); f.set("tags", JSON.stringify(["Preços"])); return f; };
let dealId = "";
const as = (perms: string[]) => { session.perms = perms; session.id = uid; };
let uid = "";

beforeEach(async () => {
  sentMedia.length = 0; await resetDb(); setWhatsappProvider(provider);
  [{ id: uid }] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [ch] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning();
  const r = await recordInbound({ channelId: ch.id, externalId: "IN1", phoneRaw: "71999995555", body: "oi" });
  if (!("dealId" in r)) throw new Error(); dealId = r.dealId;
});

describe("Biblioteca: permissões no servidor", () => {
  it("subir, editar e apagar exigem biblioteca.gerir", async () => {
    as(["biblioteca.enviar", "config.diaadia"]);
    expect(await uploadLibraryFileAction(form())).toEqual({ ok: false, error: "Você não tem permissão para isso." });
    expect(await db.select().from(libraryFiles)).toHaveLength(0);
    as(["biblioteca.gerir"]);
    const up = await uploadLibraryFileAction(form());
    expect(up.ok).toBe(true);
    const id = up.ok ? up.data!.id : "";
    as(["biblioteca.enviar"]);
    expect(await updateLibraryFileAction(id, { name: "X", caption: null, tags: [] })).toMatchObject({ ok: false });
    expect(await deleteLibraryFileAction(id)).toMatchObject({ ok: false });
    expect((await db.select().from(libraryFiles).where(eq(libraryFiles.id, id)))[0]).toMatchObject({ name: "Tabela", deletedAt: null });
    as(["biblioteca.gerir"]);
    expect(await deleteLibraryFileAction(id)).toEqual({ ok: true, data: undefined });
  });
  it("listar e enviar na conversa exigem biblioteca.enviar", async () => {
    as(["biblioteca.gerir"]);
    const up = await uploadLibraryFileAction(form());
    const id = up.ok ? up.data!.id : "";
    expect(await listLibraryAction()).toMatchObject({ ok: false });
    expect(await sendLibraryFileAction(dealId, id, null)).toMatchObject({ ok: false });
    expect(sentMedia).toHaveLength(0);
    as(["biblioteca.enviar", "atendimento.ver"]);
    expect(await listLibraryAction()).toMatchObject({ ok: true });
    expect(await sendLibraryFileAction(dealId, id, "Oi 💛")).toMatchObject({ ok: true });
    expect(sentMedia).toHaveLength(1);
    expect((await db.select().from(messages)).filter((m) => m.direction === "out")).toHaveLength(1);
  });
  it("Biblioteca desligada: a lista do clipe e o envio são recusados", async () => {
    as(["biblioteca.gerir", "biblioteca.enviar", "atendimento.ver"]);
    const up = await uploadLibraryFileAction(form());
    const id = up.ok ? up.data!.id : "";
    const { saveFuncao } = await import("@/server/domain/funcoes");
    await saveFuncao("biblioteca", { on: false }, uid);
    expect(await listLibraryAction()).toEqual({ ok: false, error: "Biblioteca está desligada em Configurações › Recursos." });
    expect(await sendLibraryFileAction(dealId, id, null)).toMatchObject({ ok: false });
    expect(await uploadLibraryFileAction(form())).toMatchObject({ ok: false });
    expect(sentMedia).toHaveLength(0);
  });
});
