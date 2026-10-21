// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { previewAudienceAction, createCampaignAction, confirmCampaignAction } = vi.hoisted(() => ({
  previewAudienceAction: vi.fn(async () => ({ ok: true as const, data: { found: 10, eligible: 7, tooMany: false, sample: [{ id: "c1", name: "Ana Teste", phone: "+5571999990071" }],
    excluded: [{ reason: "nunca_escreveu", label: "nunca escreveram para a Casa (risco de bloqueio)", n: 3 }] } })),
  createCampaignAction: vi.fn(async () => ({ ok: true as const, data: { id: "camp1", total: 7 } })),
  confirmCampaignAction: vi.fn(async () => ({ ok: true as const, data: { startAt: new Date().toISOString(), endsAround: new Date().toISOString() } })),
}));
vi.mock("@/app/(app)/contatos/massa-actions", () => ({ previewAudienceAction, createCampaignAction, confirmCampaignAction }));
import { MassMessageSheet } from "./mass-message-sheet";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("mensagem em massa: montar e confirmar", () => {
  it("mostra quem recebe e quem fica de fora; só confirma com o risco marcado e o total digitado", async () => {
    render(<MassMessageSheet open onClose={() => {}} audience={{ q: null, onlyClients: true }} tags={["VIP"]} summary="Só clientes" />);
    fireEvent.click(screen.getByRole("button", { name: "Ver quem recebe" }));
    expect(await screen.findByText("7 vão receber")).toBeTruthy();
    expect(screen.getByText(/3 nunca escreveram para a Casa \(risco de bloqueio\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.change(screen.getByLabelText("Nome (só a equipe vê)"), { target: { value: "Retorno outubro" } });
    fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "{saudacao}, {primeiro_nome}! Sentimos sua falta." } });
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    await waitFor(() => expect(createCampaignAction).toHaveBeenCalledWith({ name: "Retorno outubro", body: "{saudacao}, {primeiro_nome}! Sentimos sua falta.", audience: { q: null, onlyClients: true, tag: null }, intervalSeconds: 180 }));
    const confirm = await screen.findByRole("button", { name: "Confirmar envio" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Entendo que o WhatsApp pode bloquear o número/));
    fireEvent.change(screen.getByLabelText("Digite 7 para confirmar"), { target: { value: "6" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Digite 7 para confirmar"), { target: { value: "7" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(confirmCampaignAction).toHaveBeenCalledWith("camp1", { typedTotal: 7, acceptRisk: true }));
  });
});
