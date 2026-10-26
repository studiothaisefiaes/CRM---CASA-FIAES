import { describe, it, expect, afterEach } from "vitest";
import { forgetPushOptIn, OPTIN_KEY, resubscribeIfGranted, showClientNotice } from "./push-sync";

type Sub = { endpoint: string; toJSON: () => { keys?: { p256dh?: string; auth?: string } } };
const sub = (endpoint = "https://fcm.googleapis.com/x"): Sub => ({ endpoint, toJSON: () => ({ keys: { p256dh: "P", auth: "A" } }) });

function fakeRegistration(existing: Sub | null) {
  const calls = { subscribe: 0, key: null as Uint8Array | null };
  const reg = {
    pushManager: {
      getSubscription: async () => existing,
      subscribe: async (o: { applicationServerKey: Uint8Array }) => { calls.subscribe++; calls.key = o.applicationServerKey; return sub("https://fcm.googleapis.com/novo"); },
    },
  };
  return { reg, calls };
}

describe("resubscribeIfGranted (push depois de sair e entrar de novo)", () => {
  it("permissão concedida e sem inscrição (o Sair apagou): inscreve de novo e salva para o usuário atual", async () => {
    const { reg, calls } = fakeRegistration(null);
    const saved: unknown[] = [];
    const r = await resubscribeIfGranted({ permission: "granted", publicKey: "AQAB", getRegistration: async () => reg, save: async (s) => { saved.push(s); return { ok: true }; } });
    expect(r).toBe("saved");
    expect(calls.subscribe).toBe(1);
    expect(Array.from(calls.key!)).toEqual([1, 0, 1]);
    expect(saved).toEqual([{ endpoint: "https://fcm.googleapis.com/novo", p256dh: "P", auth: "A" }]);
  });
  it("já inscrito: não cria outra, só salva para o usuário atual (o aparelho pode ter trocado de pessoa)", async () => {
    const { reg, calls } = fakeRegistration(sub());
    const saved: unknown[] = [];
    expect(await resubscribeIfGranted({ permission: "granted", publicKey: "AQAB", getRegistration: async () => reg, save: async (s) => { saved.push(s); return { ok: true }; } })).toBe("saved");
    expect(calls.subscribe).toBe(0);
    expect(saved).toHaveLength(1);
  });
  for (const permission of ["default", "denied"] as const) {
    it(`permissão "${permission}": não faz nada (o convite cuida)`, async () => {
      const { reg, calls } = fakeRegistration(null);
      let saves = 0;
      expect(await resubscribeIfGranted({ permission, publicKey: "AQAB", getRegistration: async () => reg, save: async () => { saves++; return { ok: true }; } })).toBe("skipped");
      expect(calls.subscribe + saves).toBe(0);
    });
  }
  it("sem chave VAPID ou sem service worker: não faz nada", async () => {
    const { reg } = fakeRegistration(null);
    const save = async () => ({ ok: true });
    expect(await resubscribeIfGranted({ permission: "granted", publicKey: "", getRegistration: async () => reg, save })).toBe("skipped");
    expect(await resubscribeIfGranted({ permission: "granted", publicKey: "AQAB", getRegistration: async () => undefined, save })).toBe("skipped");
  });
  it("erro do navegador ou do servidor: devolve 'failed' sem lançar (é silencioso)", async () => {
    const reg = { pushManager: { getSubscription: async () => null, subscribe: async () => { throw new Error("NotAllowedError"); } } };
    expect(await resubscribeIfGranted({ permission: "granted", publicKey: "AQAB", getRegistration: async () => reg, save: async () => ({ ok: true }) })).toBe("failed");
    const { reg: ok } = fakeRegistration(sub());
    expect(await resubscribeIfGranted({ permission: "granted", publicKey: "AQAB", getRegistration: async () => ok, save: async () => ({ ok: false }) })).toBe("failed");
  });
});

describe("forgetPushOptIn (ao sair)", () => {
  const store = new Map<string, string>();
  const g = globalThis as { localStorage?: unknown };
  afterEach(() => { delete g.localStorage; store.clear(); });
  it("apaga a marca do convite: o próximo usuário do aparelho volta a ver o convite", () => {
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
    store.set(OPTIN_KEY, "1");
    forgetPushOptIn();
    expect(store.has(OPTIN_KEY)).toBe(false);
  });
  it("sem localStorage não lança", () => { expect(() => forgetPushOptIn()).not.toThrow(); });
});

describe("showClientNotice (Cati 24/10: 'não aparece notificação de mensagem')", () => {
  const n = { title: "Mensagem de cliente", body: "Maria escreveu: “oi”", url: "/atendimento?lead=x", tag: "/atendimento?lead=x" };
  const run = async (o: { permission?: string; focused?: boolean; hasPush?: boolean }) => {
    const shown: unknown[] = [];
    const r = await showClientNotice(n, { permission: o.permission ?? "granted", focused: o.focused ?? false, hasPush: async () => o.hasPush ?? false, show: (x) => shown.push(x) });
    return { r, shown };
  };
  it("CRM aberto em outra janela (Avec na frente) e permissão concedida: mostra a notificação", async () => {
    expect(await run({})).toEqual({ r: true, shown: [n] });
  });
  it("janela do CRM em foco: só o som (já está vendo); sem permissão: nada", async () => {
    expect((await run({ focused: true })).shown).toEqual([]);
    expect((await run({ permission: "default" })).shown).toEqual([]);
  });
  it("aparelho com push ativo: o push já mostra, a tela não repete", async () => {
    expect((await run({ hasPush: true })).shown).toEqual([]);
  });
});
