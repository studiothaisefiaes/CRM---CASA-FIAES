// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const targets = vi.fn(), fwd = vi.fn();
vi.mock("@/app/(app)/conversa/actions", () => ({ forwardTargetsAction: (...a: unknown[]) => targets(...a), forwardAction: (...a: unknown[]) => fwd(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
import { ForwardDialog } from "./forward-dialog";

const msg = { id: "m1" } as never;
afterEach(() => { cleanup(); targets.mockReset(); fwd.mockReset(); });

describe("Para quem?", () => {
  it("lista as conversas, marca duas e encaminha só as marcadas", async () => {
    targets.mockResolvedValue({ ok: true, data: [{ dealId: "d1", name: "Sara", phone: "+5571", team: true }, { dealId: "d2", name: "Ana", phone: "+5572", team: false }] });
    fwd.mockResolvedValue({ ok: true, data: { sent: 2, failed: [] } });
    const onClose = vi.fn();
    render(<ForwardDialog message={msg} dealId="src" max={10} onClose={onClose} />);
    fireEvent.click(await screen.findByLabelText("Sara"));
    fireEvent.click(screen.getByLabelText("Ana"));
    fireEvent.click(screen.getByRole("button", { name: "Encaminhar para 2" }));
    await waitFor(() => expect(fwd).toHaveBeenCalledWith("m1", ["d1", "d2"]));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
  it("não deixa marcar mais que o limite e mostra a Equipe", async () => {
    targets.mockResolvedValue({ ok: true, data: [{ dealId: "d1", name: "Sara", phone: "+5571", team: true }, { dealId: "d2", name: "Ana", phone: "+5572", team: false }] });
    render(<ForwardDialog message={msg} dealId="src" max={1} onClose={() => {}} />);
    fireEvent.click(await screen.findByLabelText("Sara"));
    expect((screen.getByLabelText("Ana") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Equipe")).toBeTruthy();
  });
  it("pessoa sem conversa aberta e número novo digitado também recebem (20/10)", async () => {
    targets.mockResolvedValue({ ok: true, data: [{ dealId: null, contactId: "c9", name: "Carla", phone: "+5571911110005", team: false }] });
    fwd.mockResolvedValue({ ok: true, data: { sent: 2, failed: [] } });
    render(<ForwardDialog message={msg} dealId="src" max={10} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Buscar conversa"), { target: { value: "71 98888-7777" } });
    fireEvent.click(await screen.findByLabelText("Carla"));
    fireEvent.click(await screen.findByLabelText(/^Número/));
    fireEvent.click(screen.getByRole("button", { name: "Encaminhar para 2" }));
    await waitFor(() => expect(fwd).toHaveBeenCalledWith("m1", [{ contactId: "c9" }, { phone: "71988887777" }]));
  });
});
