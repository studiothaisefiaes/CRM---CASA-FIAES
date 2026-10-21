// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { search, preview, merge, push } = vi.hoisted(() => ({ search: vi.fn(), preview: vi.fn(), merge: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }), usePathname: () => "/contatos/A/unir" }));
vi.mock("@/app/(app)/contatos/actions", () => ({ searchMergeTargetsAction: search, previewMergeAction: preview, mergeContactsAction: merge }));
import { MergeFlow, goesAlong } from "./merge-flow";
import { ToastProvider } from "@/components/ui/toast";

beforeAll(() => { window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const M0 = { conversas: 0, mensagens: 0, horarios: 0, comandas: 0, vendas: 0, pacotes: 0, pontos: 0, fichas: 0, fotos: 0, notas: 0 };
const views = (o: { aBlock?: string[]; bBlock?: string[] } = {}) => ({
  ok: true, data: {
    a: { side: { id: "A", name: "Rita Fictícia", hint: "sem número de WhatsApp", hasWhatsapp: false }, ifDropped: { ...M0, conversas: 1 }, blockers: o.aBlock ?? [] },
    b: { side: { id: "B", name: "Rita F.", hint: "final 1002", hasWhatsapp: true }, ifDropped: { ...M0, conversas: 3, horarios: 12 }, blockers: o.bBlock ?? [] },
  },
});
const ui = () => render(<ToastProvider><MergeFlow base={{ id: "A", name: "Rita Fictícia", hint: "sem número de WhatsApp" }} suspects={[{ id: "B", name: "Rita F.", hint: "final 1002", signals: ["cpf", "final8"] }]} /></ToastProvider>);

describe("fluxo de unir", () => {
  it("um passo por tela: Com quem? → Qual fica? (sugere o com WhatsApp) → 'Vai junto' + Estou ciente → Unir", async () => {
    preview.mockResolvedValue(views());
    merge.mockResolvedValue({ ok: true, data: { keptId: "B" } });
    ui();
    expect(screen.getByRole("heading", { name: /Com quem unir/ })).toBeTruthy();
    expect(screen.getByText(/mesmo CPF · mesmo final de telefone/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\+55|\d{8}/); // nunca o número inteiro
    fireEvent.click(screen.getByRole("button", { name: /Rita F\./ }));
    await screen.findByRole("heading", { name: "Qual cadastro fica?" });
    expect((screen.getByRole("radio", { name: /Rita F\./ }) as HTMLInputElement).checked).toBe(true); // sugerida: tem WhatsApp
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    // fica B (Rita F.), sai A: vai junto o histórico de A
    expect(screen.getByTestId("vai-junto").textContent).toBe("Vai junto: 1 conversa.");
    const unir = screen.getByRole("button", { name: "Unir" }) as HTMLButtonElement;
    expect(unir.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /Estou ciente: não dá para desfazer/ }));
    expect(unir.disabled).toBe(false);
    fireEvent.click(unir);
    await waitFor(() => expect(merge).toHaveBeenCalledWith("B", "A", true));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/contatos/B"));
  });

  it("trocar quem fica mostra o que vai junto do outro; bloqueio impede Unir", async () => {
    preview.mockResolvedValue(views({ bBlock: ["Comanda aberta das duas no mesmo dia."] }));
    ui();
    fireEvent.click(screen.getByRole("button", { name: /Rita F\./ }));
    await screen.findByRole("heading", { name: "Qual cadastro fica?" });
    fireEvent.click(screen.getByRole("radio", { name: /Rita Fictícia/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByTestId("vai-junto").textContent).toBe("Vai junto: 3 conversas, 12 horários.");
    expect(screen.getByRole("alert").textContent).toContain("Comanda aberta");
    expect((screen.getByRole("button", { name: "Unir" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("busca por nome ou telefone", async () => {
    search.mockResolvedValue({ ok: true, data: [{ id: "C", name: "Rita Outra", hint: "final 7788" }] });
    ui();
    fireEvent.change(screen.getByLabelText(/procure por nome/i), { target: { value: "rita" } });
    expect(await screen.findByRole("button", { name: /Rita Outra/ })).toBeTruthy();
    expect(search).toHaveBeenCalledWith("A", "rita");
  });

  it("goesAlong lista só o que tem", () => {
    expect(goesAlong({ ...M0, conversas: 3, horarios: 12 })).toBe("3 conversas, 12 horários");
    expect(goesAlong(M0)).toBe("nada além do cadastro");
  });
});
