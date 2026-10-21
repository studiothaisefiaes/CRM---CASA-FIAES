// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace: vi.fn() }) }));
import { LiveProvider, useLive } from "./live";
import { newVersionKnown, resetVersionState, setLoadedVersion } from "./version-state";

class FakeEventSource { onmessage: unknown = null; onerror: unknown = null; close() {} }
let serverVersion: string | Error = "b1";
const fetchMock = vi.fn(async () => {
  if (serverVersion instanceof Error) throw serverVersion;
  return { ok: true, json: async () => ({ versao: serverVersion }) } as Response;
});

let api: ReturnType<typeof useLive> | null = null;
function Grab() { api = useLive(); return null; }

beforeEach(() => {
  resetVersionState(); refresh.mockClear(); fetchMock.mockClear(); serverVersion = "b1";
  vi.stubGlobal("EventSource", FakeEventSource); vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setLoadedVersion("b1");
  render(<LiveProvider><Grab /></LiveProvider>);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); api = null; });

const pedirRefresh = async () => { await act(async () => { api!.requestRefresh(); await vi.advanceTimersByTimeAsync(200); }); };

describe("tempo real x versão nova (20/10: o refresh do servidor novo recarregava a página na mão da pessoa)", () => {
  it("mesma versão: recarrega os dados normalmente", async () => {
    await pedirRefresh();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("versão nova: não recarrega (fica o aviso para a pessoa tocar quando quiser)", async () => {
    serverVersion = "b2";
    await pedirRefresh();
    expect(refresh).not.toHaveBeenCalled();
    expect(newVersionKnown()).toBe(true);
    await pedirRefresh();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("servidor fora do ar (reiniciando na troca): espera e confere de novo antes de recarregar", async () => {
    serverVersion = new TypeError("Failed to fetch");
    await pedirRefresh();
    expect(refresh).not.toHaveBeenCalled();
    serverVersion = "b2"; // voltou, já na versão nova
    await act(async () => { await vi.advanceTimersByTimeAsync(5_500); });
    expect(refresh).not.toHaveBeenCalled();
    expect(newVersionKnown()).toBe(true);
  });
});
