import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// AudioContext falso com a política de autoplay do navegador: nasce "suspended" e só toca depois de um gesto da pessoa.
let gesture = false;
const created: FakeCtx[] = [];
class FakeCtx extends EventTarget {
  state: "suspended" | "running" = gesture ? "running" : "suspended";
  currentTime = 0; destination = {};
  oscillators = 0; resumes = 0;
  constructor() { super(); created.push(this); }
  async resume() { this.resumes++; if (gesture && this.state !== "running") { this.state = "running"; this.dispatchEvent(new Event("statechange")); } }
  createOscillator() { this.oscillators++; const node = { type: "", frequency: { value: 0 }, connect: (x: unknown) => x, start() {}, stop() {} }; return node; }
  createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x: unknown) => x }; }
}
const g = globalThis as Record<string, unknown>;
let win: EventTarget;
const tick = () => new Promise((r) => setTimeout(r, 0));
const load = async () => { vi.resetModules(); return import("./sound"); };

beforeEach(() => {
  gesture = false; created.length = 0;
  win = new EventTarget(); g.window = win; g.AudioContext = FakeCtx;
  const store = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
});
afterEach(() => { delete g.window; delete g.AudioContext; delete g.localStorage; });

describe("som do alerta", () => {
  it("sem gesto o som fica bloqueado; o primeiro toque cria/retoma o AudioContext e libera", async () => {
    const s = await load();
    s.installAudioUnlock();
    expect(s.audioState()).toBe("locked");
    const seen: string[] = []; s.subscribeAudio(() => seen.push(s.audioState()));
    gesture = true; win.dispatchEvent(new Event("pointerdown"));
    await tick();
    expect(created).toHaveLength(1);
    expect(s.audioState()).toBe("running");
    expect(seen).toContain("running");
  });
  it("tecla também libera, e depois de liberado os ouvintes saem (não cria outro contexto)", async () => {
    const s = await load();
    s.installAudioUnlock(); s.installAudioUnlock(); // idempotente
    gesture = true; win.dispatchEvent(new Event("keydown")); await tick();
    win.dispatchEvent(new Event("pointerdown")); await tick();
    expect(created).toHaveLength(1);
    expect(created[0].resumes).toBe(0); // criado durante o gesto já nasce tocando; o 2º evento não mexe em nada
  });
  it("contexto criado antes do gesto (ex.: alerta chegou antes) é retomado no primeiro toque", async () => {
    const s = await load();
    s.installAudioUnlock();
    s.playAlert(); await tick(); // cria suspenso
    gesture = true; win.dispatchEvent(new Event("pointerup")); await tick();
    expect(created).toHaveLength(1);
    expect(created[0].state).toBe("running");
    expect(s.audioState()).toBe("running");
  });
  it("playAlert chama resume() e toca quando o contexto já foi liberado", async () => {
    const s = await load();
    s.installAudioUnlock();
    gesture = true; win.dispatchEvent(new Event("pointerdown")); await tick();
    created[0].state = "suspended"; // ex.: o iPhone suspende ao voltar do fundo
    s.playAlert(); await tick();
    expect(created[0].resumes).toBe(1);
    expect(created[0].oscillators).toBe(2);
  });
  it("suspenso de novo depois de liberado: o próximo toque retoma", async () => {
    const s = await load();
    s.installAudioUnlock();
    gesture = true; win.dispatchEvent(new Event("pointerdown")); await tick();
    const c = created[0];
    c.state = "suspended"; c.dispatchEvent(new Event("statechange"));
    expect(s.audioState()).toBe("locked");
    win.dispatchEvent(new Event("touchend")); await tick();
    expect(c.state).toBe("running");
  });
  it("playAlert sem gesto não agenda bipes que tocariam atrasados depois", async () => {
    const s = await load();
    s.playAlert(); await tick();
    expect(created[0].oscillators).toBe(0);
    expect(s.audioState()).toBe("locked");
  });
  it("silenciado: não toca", async () => {
    const s = await load();
    gesture = true; s.installAudioUnlock(); win.dispatchEvent(new Event("pointerdown")); await tick();
    s.muteFor(30);
    s.playAlert(); await tick();
    expect(created[0].oscillators).toBe(0);
  });
  it("navegador sem áudio: estado 'unsupported' e nada lança", async () => {
    delete g.AudioContext;
    const s = await load();
    s.installAudioUnlock();
    win.dispatchEvent(new Event("pointerdown"));
    expect(() => s.playAlert()).not.toThrow();
    expect(s.audioState()).toBe("unsupported");
  });
});
