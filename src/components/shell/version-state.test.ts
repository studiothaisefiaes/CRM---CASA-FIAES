import { beforeEach, describe, expect, it, vi } from "vitest";
import { announceNewVersion, checkVersion, newVersionKnown, onNewVersion, resetVersionState, setLoadedVersion } from "./version-state";

const resp = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response;

beforeEach(() => resetVersionState());

describe("versão do CRM aberta x a do servidor", () => {
  it("igual: nada muda; diferente: avisa uma vez e fica sabendo", async () => {
    setLoadedVersion("b1");
    const fetcher = vi.fn(async () => resp({ versao: "b1" }));
    expect(await checkVersion({ fetcher })).toBe("igual");
    expect(newVersionKnown()).toBe(false);
    const seen = vi.fn();
    onNewVersion(seen);
    fetcher.mockImplementation(async () => resp({ versao: "b2" }));
    expect(await checkVersion({ fetcher })).toBe("nova");
    expect(newVersionKnown()).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
    // Já sabe: nem pergunta de novo.
    expect(await checkVersion({ fetcher })).toBe("nova");
    expect(fetcher).toHaveBeenCalledTimes(2);
    announceNewVersion();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("a versão carregada é a primeira que a tela recebeu (um refresh do servidor novo não a troca)", async () => {
    setLoadedVersion("b1");
    setLoadedVersion("b2");
    expect(await checkVersion({ fetcher: async () => resp({ versao: "b2" }) })).toBe("nova");
  });

  it("servidor fora do ar (reiniciando) ou sessão vencida: 'falhou', sem aviso", async () => {
    setLoadedVersion("b1");
    expect(await checkVersion({ fetcher: async () => { throw new TypeError("Failed to fetch"); } })).toBe("falhou");
    expect(await checkVersion({ fetcher: async () => resp({}, false) })).toBe("falhou");
    expect(await checkVersion({ fetcher: async () => ({ ok: true, json: async () => { throw new SyntaxError("<html>"); } }) as unknown as Response })).toBe("falhou");
    expect(newVersionKnown()).toBe(false);
  });

  it("desenvolvimento (sem id de build) ou tela sem versão registrada: sempre igual, sem pedir nada", async () => {
    const fetcher = vi.fn(async () => resp({ versao: "x" }));
    expect(await checkVersion({ fetcher })).toBe("igual");
    setLoadedVersion("dev");
    expect(await checkVersion({ fetcher })).toBe("igual");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("pedidos juntos viram um só; com maxAgeMs, a resposta recente vale", async () => {
    setLoadedVersion("b1");
    let n = 0;
    const fetcher = vi.fn(async () => { n++; return resp({ versao: "b1" }); });
    await Promise.all([checkVersion({ fetcher }), checkVersion({ fetcher }), checkVersion({ fetcher })]);
    expect(n).toBe(1);
    await checkVersion({ fetcher, maxAgeMs: 10_000 });
    expect(n).toBe(1);
    await checkVersion({ fetcher });
    expect(n).toBe(2);
  });
});
