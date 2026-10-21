import { beforeEach, describe, expect, it } from "vitest";
import { stringifyWithDates } from "@/lib/json-dates";
import {
  __setConversationCacheDeps, FRESH_MS, forgetConversations, invalidateConversation, invalidateFromEvent, isFresh, loadConversation,
  peekConversation, prefetchConversation,
} from "./conversation-cache";

type Call = { url: string; signal?: AbortSignal; priority?: string; resolve: (body: unknown) => void; reject: (e: unknown) => void };
let calls: Call[] = [];
let now = 1_000_000;
const ok = (id: string, n = 1) => ({ ok: true, data: { deal: { id, createdAt: new Date("2026-10-16T10:00:00Z") }, n }, viewer: { id: "u", perms: [] } });
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  forgetConversations();
  calls = []; now = 1_000_000;
  __setConversationCacheDeps({
    now: () => now,
    fetch: ((url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      const call: Call = { url, signal: init?.signal ?? undefined, priority: (init as { priority?: string } | undefined)?.priority, resolve: (body) => resolve(new Response(stringifyWithDates(body))), reject };
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      calls.push(call);
    })) as unknown as typeof fetch,
  });
});

describe("cache das conversas", () => {
  it("guarda a resposta (com Date) e, nova, não busca de novo; velha depois de FRESH_MS", async () => {
    const p = loadConversation("a");
    expect(calls.map((c) => c.url)).toEqual(["/api/conversa/a"]);
    calls[0].resolve(ok("a"));
    const r = await p;
    expect(r.ok && (r.data.deal.createdAt as unknown as Date)).toBeInstanceOf(Date);
    expect(peekConversation("a")?.data.deal.id).toBe("a");
    expect(isFresh("a")).toBe(true);
    now += FRESH_MS + 1;
    expect(isFresh("a")).toBe(false);
    expect(peekConversation("a")).not.toBeNull(); // velha continua para mostrar na hora
  });

  it("duas aberturas juntam no mesmo pedido; `fresh` sempre pede de novo e a resposta antiga não cobre a nova", async () => {
    const p1 = loadConversation("a");
    const p2 = loadConversation("a");
    expect(calls).toHaveLength(1);
    const p3 = loadConversation("a", { fresh: true });
    expect(calls).toHaveLength(2);
    calls[1].resolve(ok("a", 2));
    await p3;
    calls[0].resolve(ok("a", 1));
    await Promise.all([p1, p2]);
    expect((peekConversation("a")!.data as unknown as { n: number }).n).toBe(2);
  });

  it("aviso do lead durante a busca: guarda, mas fica velha; aviso de outro lead não mexe", async () => {
    const p = loadConversation("a");
    invalidateFromEvent({ type: "mensagem_recebida", dealId: "a" });
    calls[0].resolve(ok("a"));
    await p;
    expect(peekConversation("a")).not.toBeNull();
    expect(isFresh("a")).toBe(false);
    const q = loadConversation("b"); calls[1].resolve(ok("b")); await q;
    invalidateFromEvent({ type: "mensagem_recebida", dealId: "a" });
    invalidateFromEvent({ type: "conversa_lida", dealId: "b" }); // só a lista
    expect(isFresh("b")).toBe(true);
    invalidateFromEvent({ type: "reconectado" }); // tipo desconhecido: todas
    expect(isFresh("b")).toBe(false);
  });

  it("o painel que sai cancela o pedido só dele; o da pré-busca continua e fica guardado", async () => {
    const c1 = new AbortController();
    const p = loadConversation("a", { signal: c1.signal });
    c1.abort();
    await expect(p).rejects.toThrow();
    expect(calls[0].signal?.aborted).toBe(true);

    // Abrir de novo logo depois (StrictMode do dev, A→B→A rápido): pedido novo, nunca o cancelado.
    const again = loadConversation("a");
    expect(calls).toHaveLength(2);
    expect(calls[1].signal?.aborted).toBe(false);
    calls[1].resolve(ok("a"));
    expect((await again).ok).toBe(true);
    calls.splice(1, 1);

    prefetchConversation("b");
    const c2 = new AbortController();
    const q = loadConversation("b", { signal: c2.signal });
    expect(calls).toHaveLength(2); // juntou com a pré-busca
    c2.abort();
    await expect(q).rejects.toThrow();
    expect(calls[1].signal?.aborted).toBe(false);
    calls[1].resolve(ok("b"));
    await tick(); await tick();
    expect(isFresh("b")).toBe(true);
  });

  it("pré-busca: no máximo 2 ao mesmo tempo, pula as novas e as já a caminho, fila curta", async () => {
    for (const id of ["a", "b", "c", "d"]) prefetchConversation(id);
    expect(calls).toHaveLength(2);
    prefetchConversation("a"); // já a caminho
    expect(calls).toHaveLength(2);
    calls[0].resolve(ok(calls[0].url.split("/").pop()!));
    await tick(); await tick();
    expect(calls).toHaveLength(3);
    for (let i = 0; i < 20; i++) prefetchConversation(`x${i}`);
    for (let i = 0; i < 30; i++) { calls.forEach((c) => c.resolve(ok("z"))); await tick(); }
    expect(calls.length).toBeLessThanOrEqual(3 + 1 + 8); // a fila guarda só as 8 mais recentes
  });

  it("erro de rede vira o texto para a tela; ao sair, tudo é esquecido", async () => {
    const p = loadConversation("a");
    calls[0].reject(new TypeError("Failed to fetch"));
    expect(await p).toEqual({ ok: false, error: "Não foi possível abrir a conversa. Tente de novo." });
    const q = loadConversation("b"); calls[1].resolve(ok("b")); await q;
    forgetConversations();
    expect(peekConversation("b")).toBeNull();
    invalidateConversation("b"); // sem erro
  });
});

describe("prioridade na rede (17/10)", () => {
  it("a conversa aberta pede com prioridade alta; a pré-busca, baixa (não disputa a banda com a que a pessoa abriu)", async () => {
    prefetchConversation("p");
    void loadConversation("aberta").catch(() => {});
    expect(calls.map((c) => [c.url, c.priority])).toEqual([["/api/conversa/p", "low"], ["/api/conversa/aberta", "high"]]);
  });
});
