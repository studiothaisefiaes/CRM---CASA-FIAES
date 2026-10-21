// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const push = vi.fn(), replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh() {} }), usePathname: () => "/funil", useSearchParams: () => new URLSearchParams("dono=x&lead=d1"),
}));
vi.mock("@/components/queue/conversation-pane", () => ({
  ConversationPane: ({ dealId, back }: { dealId: string; back: string }) => (
    <div data-testid="pane" data-back={back}>{dealId}<textarea aria-label="Mensagem" defaultValue="" /><input type="checkbox" aria-label="Marcar" /><button>Agendar horário</button></div>
  ),
}));
const toast = vi.fn();
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));
const loadConversation = vi.fn(async (..._a: unknown[]) => ({ ok: true, data: { contact: { name: "Valéria Nogueira", phoneE164: "+5571997101001" } } }));
vi.mock("@/components/queue/conversation-cache", () => ({ loadConversation: (...a: unknown[]) => loadConversation(...a) }));
import { pushModal, popModal } from "@/components/ui/modal-stack";
import { reportComposerText } from "@/components/lead/composer-draft";
import { BoardLeadPanel } from "./board-lead-panel";

afterEach(cleanup);
beforeEach(() => { push.mockClear(); replace.mockClear(); toast.mockClear(); reportComposerText("d1", ""); window.history.replaceState(null, "", "/funil?dono=x&lead=d1"); });

it("abre o painel da Fila numa gaveta com o nome da cliente", () => {
  render(<BoardLeadPanel dealId="d1" name="Aline Prado" />);
  const dlg = screen.getByRole("dialog", { name: "Conversa com Aline Prado" });
  expect(dlg.getAttribute("aria-modal")).toBe("true");
  expect(screen.getByTestId("pane").textContent).toMatch(/^d1/);
  expect(screen.getByTestId("pane").dataset.back).toBe("below-lg");
});

it("sem o nome (link antigo de lead fora do Quadro): Conversa até a conversa chegar, depois o nome dela", async () => {
  render(<BoardLeadPanel dealId="d1" name={null} />);
  expect(screen.getByRole("dialog", { name: "Conversa" })).toBeTruthy();
  expect(await screen.findByRole("dialog", { name: "Conversa com Valéria Nogueira" })).toBeTruthy();
  expect(loadConversation).toHaveBeenCalledWith("d1");
});

it("sem lead aberto, nada aparece", () => {
  render(<BoardLeadPanel dealId={null} name={null} />);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("Esc fecha e volta ao Quadro com os filtros", () => {
  render(<BoardLeadPanel dealId="d1" name="Aline Prado" />);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(push).toHaveBeenCalledWith("/funil?dono=x", { scroll: false });
});

it("tocar no fundo fecha", () => {
  render(<BoardLeadPanel dealId="d1" name="Aline Prado" />);
  fireEvent.click(screen.getByTestId("fundo-painel"));
  expect(push).toHaveBeenCalledWith("/funil?dono=x", { scroll: false });
});

it("Esc com resposta digitada não fecha", () => {
  render(<BoardLeadPanel dealId="d1" name="Aline Prado" />);
  const box = screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: "Oi, Aline" } });
  box.focus();
  fireEvent.keyDown(box, { key: "Escape" });
  expect(push).not.toHaveBeenCalled();
});

it("Esc com outro diálogo por cima não fecha a gaveta", () => {
  render(<BoardLeadPanel dealId="d1" name="Aline Prado" />);
  let id = 0;
  act(() => { id = pushModal(); });
  fireEvent.keyDown(document, { key: "Escape" });
  expect(push).not.toHaveBeenCalled();
  popModal(id);
});

it("resposta escrita no campo (já sem foco nele, o segundo Esc): Esc não fecha e avisa", () => {
  render(<BoardLeadPanel dealId="d1" name="Aline Prado" />);
  reportComposerText("d1", "Oi, Aline, temos horário amanhã");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(push).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/resposta/i), "info");
});

it("resposta escrita: tocar no fundo também não fecha", () => {
  render(<BoardLeadPanel dealId="d1" name="Aline Prado" />);
  reportComposerText("d1", "Oi");
  fireEvent.click(screen.getByTestId("fundo-painel"));
  expect(push).not.toHaveBeenCalled();
});

it("caixa de marcar em foco não segura o Esc (o value dela é sempre 'on')", () => {
  render(<BoardLeadPanel dealId="d1" name="Aline Prado" />);
  (screen.getByLabelText("Marcar") as HTMLInputElement).focus();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(push).toHaveBeenCalled();
});

it("foco: entra na gaveta ao abrir, o Tab fica dentro dela e volta para quem abriu ao fechar", async () => {
  const card = document.createElement("a"); card.href = "#"; card.textContent = "Aline Prado"; document.body.appendChild(card); card.focus();
  const { unmount } = render(<BoardLeadPanel dealId="d1" name="Aline Prado" />);
  const dlg = screen.getByRole("dialog", { name: "Conversa com Aline Prado" });
  await waitFor(() => expect(dlg.contains(document.activeElement)).toBe(true));
  const botao = screen.getByRole("button", { name: "Agendar horário" });
  botao.focus();
  fireEvent.keyDown(document, { key: "Tab" });
  expect(dlg.contains(document.activeElement)).toBe(true);
  unmount();
  expect(document.activeElement).toBe(card);
  card.remove();
});
