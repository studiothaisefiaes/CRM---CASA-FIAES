import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../../../../../test/db";

const SECRET = "s".repeat(32);
vi.mock("@/server/env", async (orig) => {
  const m = await orig<typeof import("@/server/env")>();
  return { ...m, env: () => ({ ...m.env(), CHATGURU_IMPORT_SECRET: SECRET }) };
});
const { POST } = await import("./route");
const req = (token: string, body: unknown) => new NextRequest(`http://x/api/importar/chatguru?token=${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(async () => { await resetDb(); });

describe("POST /api/importar/chatguru", () => {
  it("sem o segredo certo: 401 e nada gravado", async () => {
    expect((await POST(req("errado", { celular: "5571999887766", chat_id: "a" }))).status).toBe(401);
  });
  it("com o segredo: importa a ficha", async () => {
    const r = await POST(req(SECRET, { celular: "5571999887766", chat_id: "a", nome: "Rita", tags: ["VIP"] }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, created: true });
  });
});
