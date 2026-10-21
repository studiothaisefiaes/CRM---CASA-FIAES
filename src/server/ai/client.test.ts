import { describe, expect, it, vi } from "vitest";
import { AiError, callSuggestion, SUGGESTION_JSON_SCHEMA } from "./client";

const ok = (payload: unknown, usage = { input_tokens: 700, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0, output_tokens: 150 }, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ id: "msg_1", model: "claude-haiku-5-5", stop_reason: "end_turn", content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: JSON.stringify(payload) }], usage, ...extra }), { status: 200, headers: { "content-type": "application/json" } });
const good = { resumo: "Quer saber o preço do corte.", sugestao: "Oi, Maria! O corte fica R$ 120. Quer que eu veja um horário?", precisa_humano: false, motivo: "" };
const opts = (fetchImpl: typeof fetch) => ({ apiKey: "sk-teste", model: "claude-haiku-5-5", fetchImpl, timeoutMs: 50, retryDelayMs: 1 });

describe("cliente da IA (fetch na Messages API, sem SDK)", () => {
  it("monta o pedido: chave, versão, Haiku, bloco fixo com cache, saída em JSON, sem raciocínio, esforço baixo e teto de 600 tokens", async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok(good));
    const r = await callSuggestion({ system: "BLOCO FIXO", user: "conversa" }, opts(f as unknown as typeof fetch));
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    const h = init!.headers as Record<string, string>;
    expect(h["x-api-key"]).toBe("sk-teste");
    expect(h["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(String(init!.body));
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.system).toEqual([{ type: "text", text: "BLOCO FIXO", cache_control: { type: "ephemeral" } }]);
    expect(body.messages).toEqual([{ role: "user", content: "conversa" }]);
    expect(body.output_config.format).toEqual({ type: "json_schema", schema: SUGGESTION_JSON_SCHEMA });
    expect(body.output_config.effort).toBe("low");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.max_tokens).toBe(600);
    expect(body.temperature).toBeUndefined();
    expect(r.data).toEqual(good);
    // Sonnet 5.5 recusa `disabled` (400): sem raciocínio é `between_tools` (20/10).
    const g = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok(good));
    await callSuggestion({ system: "BLOCO FIXO", user: "conversa" }, { ...opts(g as unknown as typeof fetch), model: "claude-sonnet-5-5" });
    expect(JSON.parse(String(g.mock.calls[0][1]!.body)).thinking).toEqual({ type: "between_tools" });
    expect(r.usage).toEqual({ inputTokens: 700, cachedTokens: 2000, cacheWriteTokens: 0, outputTokens: 150 });
    expect(r.costMicros).toBe(70 + 20 + 75);
    expect(r.model).toBe("claude-haiku-5-5");
  });

  it("o esquema pede os 6 campos (retomar_dias: cancelou sem nova data, Cati 17/10), sem campo extra", () => {
    expect(SUGGESTION_JSON_SCHEMA.required).toEqual(["resumo", "sugestao", "precisa_humano", "motivo", "horario", "retomar_dias"]);
    expect(SUGGESTION_JSON_SCHEMA.properties.retomar_dias.type).toBe("integer");
    expect(SUGGESTION_JSON_SCHEMA.additionalProperties).toBe(false);
  });

  it("sem chave não chama a API", async () => {
    const f = vi.fn();
    await expect(callSuggestion({ system: "s", user: "u" }, { ...opts(f as unknown as typeof fetch), apiKey: "" })).rejects.toMatchObject({ code: "sem_chave" });
    expect(f).not.toHaveBeenCalled();
  });

  it("erro passageiro (500/529/429) tenta mais uma vez só", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 529 })).mockResolvedValueOnce(ok(good));
    const r = await callSuggestion({ system: "s", user: "u" }, opts(f));
    expect(r.data.sugestao).toContain("R$ 120");
    expect(f).toHaveBeenCalledTimes(2);
    const g = vi.fn().mockResolvedValue(new Response("{}", { status: 500 }));
    await expect(callSuggestion({ system: "s", user: "u" }, opts(g))).rejects.toMatchObject({ code: "http", status: 500 });
    expect(g).toHaveBeenCalledTimes(2);
  });

  it("400 (pedido errado) não repete", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "bad" } }), { status: 400 }));
    await expect(callSuggestion({ system: "s", user: "u" }, opts(f))).rejects.toMatchObject({ code: "http", status: 400 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("demora demais: corta no tempo limite, tenta de novo e desiste", async () => {
    const hang = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    const t = Date.now();
    await expect(callSuggestion({ system: "s", user: "u" }, opts(hang as unknown as typeof fetch))).rejects.toMatchObject({ code: "timeout" });
    expect(hang).toHaveBeenCalledTimes(2);
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it("resposta fora do formato: erro de formato, com o uso para contar no teto", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ model: "m", stop_reason: "end_turn", content: [{ type: "text", text: "não é json" }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 }));
    const e = await callSuggestion({ system: "s", user: "u" }, opts(f)).catch((x) => x);
    expect(e).toBeInstanceOf(AiError);
    expect(e.code).toBe("formato");
    expect(e.usage).toEqual({ inputTokens: 10, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 5 });
    expect(f).toHaveBeenCalledTimes(1);
    const g = vi.fn().mockResolvedValue(ok({ resumo: "x", sugestao: 3 }));
    await expect(callSuggestion({ system: "s", user: "u" }, opts(g))).rejects.toMatchObject({ code: "formato" });
  });

  it("recusa do modelo vira erro próprio", async () => {
    const f = vi.fn().mockResolvedValue(ok(good, undefined, { stop_reason: "refusal", content: [] }));
    await expect(callSuggestion({ system: "s", user: "u" }, opts(f))).rejects.toMatchObject({ code: "recusa" });
  });

  it("tira assinatura que a IA tenha posto e espaços sobrando", async () => {
    const f = vi.fn().mockResolvedValue(ok({ ...good, sugestao: "*SARA - CASA FIAES:*\n  Oi, Maria!  " }));
    expect((await callSuggestion({ system: "s", user: "u" }, opts(f))).data.sugestao).toBe("Oi, Maria!");
  });
});
