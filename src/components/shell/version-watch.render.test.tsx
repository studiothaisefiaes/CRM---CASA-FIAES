// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VERSION_POLL_MS, VersionWatch } from "./version-watch";
import { resetVersionState } from "./version-state";

let serverVersion = "b1";
const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ versao: serverVersion }) }) as Response);

beforeEach(() => { resetVersionState(); serverVersion = "b1"; vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); fetchMock.mockClear(); });

describe("aviso de versão nova do CRM (20/10, Cati: atualização derrubava a tela)", () => {
  it("pergunta a cada minuto; com versão nova, mostra o aviso fixo e só recarrega quando a pessoa toca", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const reload = vi.fn();
    render(<VersionWatch versao="b1" onReload={reload} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(VERSION_POLL_MS + 10); });
    expect(fetchMock).toHaveBeenCalledWith("/api/versao", expect.objectContaining({ cache: "no-store" }));
    expect(screen.queryByTestId("versao-nova")).toBeNull();
    serverVersion = "b2";
    await act(async () => { await vi.advanceTimersByTimeAsync(VERSION_POLL_MS + 10); });
    const aviso = await screen.findByTestId("versao-nova");
    expect(aviso.textContent).toContain("Versão nova do CRM.");
    // Ninguém tocou: nada recarrega, nem depois de muito tempo (pode estar digitando).
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * VERSION_POLL_MS); });
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("voltar para a janela pergunta na hora", async () => {
    serverVersion = "b2";
    render(<VersionWatch versao="b1" onReload={() => {}} />);
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(await screen.findByRole("button", { name: "Atualizar" })).toBeTruthy();
  });

  it("ação da versão antiga que ninguém tratou (Failed to find Server Action): vira o aviso, não o erro", async () => {
    render(<VersionWatch versao="b1" onReload={() => {}} />);
    const reason = Object.assign(new Error('Server Action "40ab" was not found on the server.'), { name: "UnrecognizedActionError" });
    const ev = Object.assign(new Event("unhandledrejection", { cancelable: true }), { reason, promise: Promise.resolve() });
    act(() => { window.dispatchEvent(ev); });
    await waitFor(() => expect(screen.getByTestId("versao-nova")).toBeTruthy());
    expect(ev.defaultPrevented).toBe(true);
  });

  it("servidor fora do ar no meio da troca: sem aviso e sem recarregar", async () => {
    fetchMock.mockImplementationOnce(async () => { throw new TypeError("Failed to fetch"); });
    render(<VersionWatch versao="b1" onReload={() => {}} />);
    act(() => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId("versao-nova")).toBeNull();
  });
});
