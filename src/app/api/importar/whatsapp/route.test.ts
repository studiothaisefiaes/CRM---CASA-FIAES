import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { contacts, users } from "@/server/db/schema";
import { resetDb } from "../../../../../test/db";

const { session } = vi.hoisted(() => ({ session: { user: null as null | { id: string; perms: string[] } } }));
vi.mock("@/server/auth/sessions-store", () => ({ findSessionUser: async () => session.user }));
import { POST } from "./route";

const CHAT = "02/03/2025 09:01 - Cliente Teste: Oi\n02/03/2025 09:05 - Casa Fiaes: Bom dia!";
const req = (headers: Record<string, string> = {}) => {
  const fd = new FormData();
  fd.set("file", new File([CHAT], "Conversa do WhatsApp com +55 71 99999-0011.txt", { type: "text/plain" }));
  return new NextRequest("http://localhost/api/importar/whatsapp", { method: "POST", body: fd, headers: { cookie: "cf_session=x", ...headers } });
};
let uid = "";
beforeEach(async () => {
  await resetDb();
  [{ id: uid }] = await db.insert(users).values({ name: "Recepção Teste", email: "r@teste.local", passwordHash: "x" }).returning();
  await db.insert(contacts).values({ name: "Cliente Teste", phoneE164: "+5571999990011" });
});

describe("POST /api/importar/whatsapp: só gestão ou quem mexe na ficha", () => {
  it("sem sessão: 401; sem permissão: 403; de outro site: 403", async () => {
    session.user = null;
    expect((await POST(req())).status).toBe(401);
    session.user = { id: uid, perms: ["atendimento.ver", "agenda.marcar"] };
    expect((await POST(req())).status).toBe(403);
    session.user = { id: uid, perms: ["contatos.ver", "contatos.editar"] };
    expect((await POST(req())).status).toBe(403);
    session.user = { id: uid, perms: ["config.sistema"] };
    expect((await POST(req({ "sec-fetch-site": "cross-site" }))).status).toBe(403);
  });
  it("com Trazer a conversa do WhatsApp ou Configurar o sistema: devolve a prévia (só ver Clientes não basta; QA r66)", async () => {
    for (const perms of [["contatos.importar"], ["config.sistema"]]) {
      session.user = { id: uid, perms };
      const r = await POST(req());
      expect(r.status).toBe(200);
      expect((await r.json()).data).toMatchObject({ total: 2, newCount: 2, casa: "Casa Fiaes", contact: { source: "arquivo" } });
    }
  });
});
