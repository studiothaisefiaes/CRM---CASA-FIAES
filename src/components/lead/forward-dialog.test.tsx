// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { targets, fwd, toast } = vi.hoisted(() => ({ targets: vi.fn(), fwd: vi.fn(), toast: vi.fn() }));
vi.mock("@/app/(app)/conversa/actions", () => ({ forwardTargetsAction: (...a: unknown[]) => targets(...a), forwardMessagesAction: (...a: unknown[]) => fwd(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));
import { ForwardDialog } from "./forward-dialog";
import type { Msg } from "./conversation";

const msg = [{ id: "m1" }] as never;
const m = (over: Partial<Msg>): Msg => ({ id: "m1", direction: "in", kind: "text", body: "oi", status: "received", createdAt: "2026-10-20T13:00:00.000Z", sender: null, fromPhone: false, ...over });
afterEach(() => { cleanup(); targets.mockReset(); fwd.mockReset(); toast.mockReset(); });

describe("Para quem?", () => {
  it("lista as conversas, marca duas e encaminha só as marcadas", async () => {
    targets.mockResolvedValue({ ok: true, data: [{ dealId: "d1", name: "Sara", phone: "+5571", team: true }, { dealId: "d2", name: "Ana", phone: "+5572", team: false }] });
    fwd.mockResolvedValue({ ok: true, data: { messages: 1, targets: 2 } });
    const onClose = vi.fn();
    render(<ForwardDialog messages={msg} dealId="src" max={10} onClose={onClose} />);
    fireEvent.click(await screen.findByLabelText("Sara"));
    fireEvent.click(screen.getByLabelText("Ana"));
    fireEvent.click(screen.getByRole("button", { name: "Encaminhar para 2" }));
    await waitFor(() => expect(fwd).toHaveBeenCalledWith(["m1"], ["d1", "d2"]));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(toast).toHaveBeenCalledWith("Encaminhando para 2 conversas. Se não sair, aviso no sino.", "ok");
  });
  it("não deixa marcar mais que o limite e mostra a Equipe", async () => {
    targets.mockResolvedValue({ ok: true, data: [{ dealId: "d1", name: "Sara", phone: "+5571", team: true }, { dealId: "d2", name: "Ana", phone: "+5572", team: false }] });
    render(<ForwardDialog messages={msg} dealId="src" max={1} onClose={() => {}} />);
    fireEvent.click(await screen.findByLabelText("Sara"));
    expect((screen.getByLabelText("Ana") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Equipe")).toBeTruthy();
  });
  it("pessoa sem conversa aberta e número novo digitado também recebem (20/10)", async () => {
    targets.mockResolvedValue({ ok: true, data: [{ dealId: null, contactId: "c9", name: "Carla", phone: "+5571911110005", team: false }] });
    fwd.mockResolvedValue({ ok: true, data: { messages: 1, targets: 2 } });
    render(<ForwardDialog messages={msg} dealId="src" max={10} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Buscar conversa"), { target: { value: "71 98888-7777" } });
    fireEvent.click(await screen.findByLabelText("Carla"));
    fireEvent.click(await screen.findByLabelText(/^Número/));
    fireEvent.click(screen.getByRole("button", { name: "Encaminhar para 2" }));
    await waitFor(() => expect(fwd).toHaveBeenCalledWith(["m1"], [{ contactId: "c9" }, { phone: "71988887777" }]));
  });
  it("várias (24/10): diz quantas vão, encaminha todas de uma vez e fecha na hora (os envios seguem; o que não sair vai para o sino)", async () => {
    targets.mockResolvedValue({ ok: true, data: [{ dealId: "d1", name: "Sara", phone: "+5571", team: true }] });
    fwd.mockResolvedValue({ ok: true, data: { messages: 3, targets: 1 } });
    const onClose = vi.fn();
    render(<ForwardDialog messages={[m({ id: "a" }), m({ id: "b" }), m({ id: "c" })]} dealId="src" max={10} onClose={onClose} />);
    expect(screen.getByText(/3 mensagens, na ordem da conversa/)).toBeTruthy();
    fireEvent.click(await screen.findByLabelText("Sara"));
    fireEvent.click(screen.getByRole("button", { name: "Encaminhar" }));
    await waitFor(() => expect(fwd).toHaveBeenCalledWith(["a", "b", "c"], ["d1"]));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
    expect(toast).toHaveBeenCalledWith("Encaminhando 3 mensagens para 1 conversa. Se alguma não sair, aviso no sino.", "ok");
  });
  it("pedido recusado (limite, mensagem que não encaminha): avisa e o diálogo continua aberto", async () => {
    targets.mockResolvedValue({ ok: true, data: [{ dealId: "d1", name: "Sara", phone: "+5571", team: true }] });
    fwd.mockResolvedValue({ ok: false, error: "Uma das mensagens escolhidas não pode ser encaminhada." });
    const onClose = vi.fn();
    render(<ForwardDialog messages={[m({ id: "a" }), m({ id: "b" })]} dealId="src" max={10} onClose={onClose} />);
    fireEvent.click(await screen.findByLabelText("Sara"));
    fireEvent.click(screen.getByRole("button", { name: "Encaminhar" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Uma das mensagens escolhidas não pode ser encaminhada.", "error"));
    expect(onClose).not.toHaveBeenCalled();
  });
  it("Voltar fecha sem encaminhar (a seleção continua)", async () => {
    targets.mockResolvedValue({ ok: true, data: [] });
    const onClose = vi.fn();
    render(<ForwardDialog messages={[m({ id: "a" }), m({ id: "b" })]} dealId="src" max={10} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(onClose).toHaveBeenCalledWith(false);
    expect(fwd).not.toHaveBeenCalled();
  });
});
