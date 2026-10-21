// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

const { transcreverDitadoAction, toast } = vi.hoisted(() => ({ transcreverDitadoAction: vi.fn(), toast: vi.fn() }));
vi.mock("@/app/(app)/conversa/ai-actions", () => ({ transcreverDitadoAction }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));
import { DictateButton } from "./dictate-button";

/** Gravador falso: start() grava, stop() entrega um pedaço de áudio e para (como o MediaRecorder do navegador). */
class FakeRecorder {
  static isTypeSupported = (t: string) => t === "audio/webm;codecs=opus";
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown, public opts: { mimeType: string }) {}
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["som"], { type: "audio/webm" }) }); this.onstop?.(); }
}
const stopTrack = vi.fn();
beforeEach(() => {
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) } });
  transcreverDitadoAction.mockReset(); toast.mockReset(); stopTrack.mockReset();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Campo({ onTranscribed }: { onTranscribed?: (v: string) => void }) {
  const [v, setV] = useState("mandar o endereço");
  return <><input aria-label="tema" value={v} onChange={(e) => setV(e.target.value)} /><DictateButton value={v} onChange={setV} onTranscribed={onTranscribed} /></>;
}

describe("Falar (Cati 16/10): grava, o servidor transcreve e o texto entra no campo", () => {
  it("gravar → parar → transcrever: soma ao que já estava, avisa quem pediu e solta o microfone", async () => {
    transcreverDitadoAction.mockResolvedValue({ ok: true, data: { texto: "e dizer que tem estacionamento" } });
    const onTranscribed = vi.fn();
    render(<Campo onTranscribed={onTranscribed} />);
    fireEvent.click(screen.getByRole("button", { name: "Falar em vez de digitar" }));
    const parar = await screen.findByRole("button", { name: "Parar e usar o que falei" });
    expect(parar.textContent).toMatch(/Parar 0:00/);
    await act(async () => { fireEvent.click(parar); });
    await waitFor(() => expect((screen.getByRole("textbox", { name: "tema" }) as HTMLInputElement).value).toBe("mandar o endereço e dizer que tem estacionamento"));
    expect(onTranscribed).toHaveBeenCalledWith("mandar o endereço e dizer que tem estacionamento");
    const fd = transcreverDitadoAction.mock.calls[0][0] as FormData;
    expect((fd.get("audio") as File).type).toBe("audio/webm");
    expect(stopTrack).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Falar em vez de digitar" })).toBeTruthy();
  });

  it("erro do servidor: avisa e o campo fica como estava (nada segue sozinho)", async () => {
    transcreverDitadoAction.mockResolvedValue({ ok: false, error: "Não deu para ouvir nada. Fale mais perto do microfone." });
    const onTranscribed = vi.fn();
    render(<Campo onTranscribed={onTranscribed} />);
    fireEvent.click(screen.getByRole("button", { name: "Falar em vez de digitar" }));
    const parar = await screen.findByRole("button", { name: "Parar e usar o que falei" });
    await act(async () => { fireEvent.click(parar); });
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Não deu para ouvir nada. Fale mais perto do microfone.", "error"));
    expect((screen.getByRole("textbox", { name: "tema" }) as HTMLInputElement).value).toBe("mandar o endereço");
    expect(onTranscribed).not.toHaveBeenCalled();
  });

  it("navegador sem gravador: sem o botão", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    render(<Campo />);
    expect(screen.queryByRole("button", { name: "Falar em vez de digitar" })).toBeNull();
  });
});
