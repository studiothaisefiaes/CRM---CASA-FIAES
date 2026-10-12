import { it, expect, vi, afterEach } from "vitest";
import { DemoProvider } from "./demo-provider";
import { EvolutionProvider, providerFor } from "./evolution";
import { parseEnv } from "../env";

afterEach(() => { vi.unstubAllGlobals(); });
const noNetwork = () => { const f = vi.fn(async () => { throw new Error("rede"); }); vi.stubGlobal("fetch", f); return f; };

it("envio da demonstração dá certo sem sair nada pela rede", async () => {
  const fetch = noNetwork();
  const p = new DemoProvider();
  const r = await p.sendText("demo-recepcao", "+5571900000001", "Oi!");
  expect(r.externalId).toMatch(/^DEMO-/);
  const r2 = await p.sendText("demo-recepcao", "+5571900000001", "Oi de novo");
  expect(r2.externalId).not.toBe(r.externalId);
  await p.sendMedia("demo-recepcao", "+5571900000001", { name: "f.png", mime: "image/png", data: Buffer.from("x"), mediatype: "image" }, null);
  await p.sendAudio("demo-recepcao", "+5571900000001", Buffer.from("x"));
  await p.sendPoll("demo-recepcao", "+5571900000001", "Confirma?", ["Sim", "Não"]);
  await p.markRead("demo-recepcao", "+5571900000001", ["A"]);
  expect(fetch).not.toHaveBeenCalled();
});
it("o número da demonstração aparece sempre conectado e sem foto de perfil", async () => {
  noNetwork();
  const p = new DemoProvider();
  await expect(p.state("demo-recepcao")).resolves.toBe("conectado");
  await expect(p.connect("demo-recepcao")).resolves.toEqual({ status: "conectado" });
  await expect(p.profilePictureUrl("demo-recepcao", "+5571900000001")).resolves.toBeNull();
});

const env = (demo: boolean) => parseEnv({
  DATABASE_URL: `postgres://crm:x@localhost:5433/${demo ? "crm_demo" : "crm"}`, EVOLUTION_URL: "http://127.0.0.1:9", EVOLUTION_API_KEY: "k".repeat(20),
  WEBHOOK_SECRET: "w".repeat(30), WEBHOOK_PUBLIC_URL: "http://localhost:3000", SESSION_SECRET: "s".repeat(40), APP_URL: "http://localhost:3000", ...(demo ? { DEMO: "true" } : {}),
});
it("com DEMO=true o app usa o WhatsApp de mentira; sem a flag, a Evolution", () => {
  expect(providerFor(env(true))).toBeInstanceOf(DemoProvider);
  expect(providerFor(env(false))).toBeInstanceOf(EvolutionProvider);
});
