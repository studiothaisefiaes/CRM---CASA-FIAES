// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { registerCallAction } = vi.hoisted(() => ({ registerCallAction: vi.fn() }));
vi.mock("@/app/(app)/conversa/actions", () => ({ registerCallAction }));
import { RegisterCallDialog } from "./register-call-dialog";

afterEach(() => { cleanup(); vi.clearAllMocks(); try { sessionStorage.clear(); } catch {} });
const base = { open: true, onClose: () => {}, dealId: "d1", name: "Thamires Lopes", phone: "+5571990000003" };

describe("Registrar ligação", () => {
  it("Atendeu: pede o que foi falado (assunto opcional) e a duração; salva sem mandar nada e oferece Marcar horário", async () => {
    registerCallAction.mockResolvedValue({ ok: true, data: { messageId: "m1" } });
    const onSaved = vi.fn(); const onBook = vi.fn();
    render(<RegisterCallDialog {...base} phoneBrowser={false} onSaved={onSaved} onBook={onBook} />);
    expect(screen.getByText(/não envia nada para a cliente/i)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Ligar agora" })).toBeNull(); // computador: sem discar
    fireEvent.click(screen.getByRole("radio", { name: "Atendeu" }));
    const save = screen.getByRole("button", { name: "Salvar ligação" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // falta o que foi falado
    fireEvent.change(screen.getByLabelText("Assunto (opcional)"), { target: { value: "Agendamento" } });
    fireEvent.change(screen.getByLabelText("O que foi falado"), { target: { value: "marcou escova sábado 10h" } });
    fireEvent.change(screen.getByLabelText("Duração em minutos (opcional)"), { target: { value: "4" } });
    fireEvent.click(save);
    await waitFor(() => expect(registerCallAction).toHaveBeenCalledWith({ dealId: "d1", outcome: "atendeu", durationMin: 4, subject: "Agendamento", note: "marcou escova sábado 10h" }));
    expect(onSaved).toHaveBeenCalledWith({ answered: true });
    fireEvent.click(await screen.findByRole("button", { name: "Marcar horário" }));
    expect(onBook).toHaveBeenCalled();
  });

  it("Salvar cinza diz o porquê: primeiro o resultado, depois (Atendeu) o que foi falado; com tudo preenchido a frase some", () => {
    render(<RegisterCallDialog {...base} phoneBrowser={false} onSaved={() => {}} />);
    const save = screen.getByRole("button", { name: "Salvar ligação" }) as HTMLButtonElement;
    const why = () => document.getElementById(save.getAttribute("aria-describedby") ?? "")?.textContent ?? null;
    expect(save.disabled).toBe(true);
    expect(why()).toBe("Para salvar, escolha o resultado da ligação.");
    fireEvent.click(screen.getByRole("radio", { name: "Atendeu" }));
    expect(why()).toBe("Para salvar, escreva o que foi falado.");
    fireEvent.change(screen.getByLabelText(/O que foi falado/), { target: { value: "marcou escova" } });
    expect(save.disabled).toBe(false);
    expect(save.getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByText(/Para salvar/)).toBeNull();
  });

  it("Não atendeu e Caixa postal/ocupado: salva direto, sem anotação", async () => {
    registerCallAction.mockResolvedValue({ ok: true, data: { messageId: "m2" } });
    const onSaved = vi.fn();
    render(<RegisterCallDialog {...base} phoneBrowser={false} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("radio", { name: "Caixa postal/ocupado" }));
    expect(screen.queryByLabelText("O que foi falado")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Salvar ligação" }));
    await waitFor(() => expect(registerCallAction).toHaveBeenCalledWith({ dealId: "d1", outcome: "ocupado", durationMin: null, subject: null, note: null }));
    expect(onSaved).toHaveBeenCalledWith({ answered: false });
  });

  it("recusa do servidor aparece no diálogo", async () => {
    registerCallAction.mockResolvedValue({ ok: false, error: "Essa conversa não existe mais." });
    render(<RegisterCallDialog {...base} phoneBrowser={false} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Não atendeu" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar ligação" }));
    expect((await screen.findByRole("alert")).textContent).toContain("não existe mais");
  });

  it("celular: 'Ligar agora' disca o número e o diálogo fica esperando o resultado", () => {
    render(<RegisterCallDialog {...base} phoneBrowser onSaved={() => {}} />);
    const link = screen.getByRole("link", { name: "Ligar agora" });
    expect(link.getAttribute("href")).toBe("tel:+5571990000003");
    fireEvent.click(link);
    expect(screen.getByText(/Quando desligar/)).toBeTruthy();
    expect(sessionStorage.getItem("ligacao:d1")).not.toBeNull(); // voltando à página (mesmo recarregada), o registro abre de novo
  });
});
