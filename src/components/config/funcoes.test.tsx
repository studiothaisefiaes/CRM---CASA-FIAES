// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const { save } = vi.hoisted(() => ({ save: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })) }));
vi.mock("@/app/(app)/config/funcoes/actions", () => ({ saveFuncaoAction: (...a: unknown[]) => save(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { FuncoesEditor, type FuncaoItem } from "./funcoes";

const ENVIA: FuncaoItem = {
  def: { key: "envia", label: "Aviso de teste", description: "Avisa a cliente.", enviaParaCliente: true, padraoLigada: false,
    params: [{ key: "horas", label: "Horas de espera", unit: "horas", min: 1, max: 48, default: 24 }],
    textos: [{ key: "aviso", label: "Texto do aviso", vars: ["nome"], default: "Oi, {nome}!" }] },
  value: { on: false, params: { horas: 6 }, textos: { aviso: "Texto meu" } },
};
const PROPRIA: FuncaoItem = { def: { key: "p", label: "Menu", description: "x", enviaParaCliente: false, padraoLigada: false, ligaEm: "/config/menu" }, value: { on: false, params: {}, textos: {} } };
beforeEach(() => save.mockClear());
afterEach(cleanup);

it("registro vazio mostra o aviso", () => {
  render(<FuncoesEditor items={[]} />);
  expect(screen.getByText("Nenhum recurso novo por aqui ainda.")).toBeTruthy();
});
it("cartão com interruptor; função com tela própria só mostra o link", () => {
  render(<FuncoesEditor items={[ENVIA, PROPRIA]} />);
  expect(screen.getByRole("switch", { name: "Ligar Aviso de teste" })).toBeTruthy();
  expect(screen.getAllByRole("switch")).toHaveLength(1);
  expect(screen.getByRole("link", { name: "Abrir" })).toBeTruthy();
});
it("ligar função que envia abre a confirmação; cancelar não liga; confirmar liga", async () => {
  render(<FuncoesEditor items={[ENVIA]} />);
  fireEvent.click(screen.getByRole("switch", { name: "Ligar Aviso de teste" }));
  expect(screen.getByText("Isto vai enviar mensagens reais para clientes.", { exact: false })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("switch", { name: "Ligar Aviso de teste" }));
  fireEvent.click(screen.getByRole("button", { name: "Entendi, ligar" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("envia", { on: true }, true));
});
it("função que não envia liga direto, sem confirmação", async () => {
  render(<FuncoesEditor items={[{ ...ENVIA, def: { ...ENVIA.def, enviaParaCliente: false } }]} />);
  fireEvent.click(screen.getByRole("switch", { name: "Ligar Aviso de teste" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("envia", { on: true }, false));
});
it("Usar o texto sugerido repõe o padrão e Salvar manda só o que mudou", async () => {
  render(<FuncoesEditor items={[ENVIA]} />);
  const ta = screen.getByLabelText("Texto do aviso") as HTMLTextAreaElement;
  expect(ta.value).toBe("Texto meu");
  fireEvent.click(screen.getByRole("button", { name: "Usar o texto sugerido" }));
  expect(ta.value).toBe("Oi, {nome}!");
  expect(screen.getByText("{nome}")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Usar o padrão de Horas de espera" }));
  expect((screen.getByLabelText("Horas de espera (horas)") as HTMLInputElement).value).toBe("24");
  fireEvent.click(screen.getByRole("button", { name: "Salvar Outros" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith("envia", { params: { horas: 24 }, textos: { aviso: "Oi, {nome}!" } }, false));
});
it("erro do servidor aparece no cartão", async () => {
  save.mockResolvedValueOnce({ ok: false, error: "Horas de espera: use um número de 1 a 48." } as never);
  render(<FuncoesEditor items={[ENVIA]} />);
  fireEvent.change(screen.getByLabelText("Horas de espera (horas)"), { target: { value: "99" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar Outros" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Aviso de teste: Horas de espera: use um número de 1 a 48.");
});

it("r66 #7 + r68 #9/#10: seções por assunto em acordeão (só a primeira aberta); Salvar só aparece com mudança e diz o que vai mudar", async () => {
  const conv: FuncaoItem = { def: { key: "reagir", label: "Reagir a mensagens", description: "x", enviaParaCliente: false, padraoLigada: true }, value: { on: true, params: {}, textos: {} } };
  const cx: FuncaoItem = { def: { key: "fidelidade", label: "Fidelidade", description: "y", enviaParaCliente: false, padraoLigada: true,
    params: [{ key: "pontos", label: "Pontos", min: 1, max: 9, default: 5 }] }, value: { on: true, params: { pontos: 3 }, textos: {} } };
  const { container } = render(<FuncoesEditor items={[conv, cx]} />);
  expect(screen.getByRole("heading", { name: "Conversas" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Caixa" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Agenda" })).toBeNull(); // seção sem recurso não aparece
  const secoes = [...container.querySelectorAll("details")];
  expect(secoes.map((d) => d.open)).toEqual([true, false]); // só a primeira aberta
  // Nenhum botão Salvar cinza parado: sem mudança, nada de botão
  expect(screen.queryByRole("button", { name: /^Salvar/ })).toBeNull();
  expect(screen.getByText("Os interruptores salvam na hora.")).toBeTruthy(); // seção só com interruptores explica que não tem Salvar
  fireEvent.change(screen.getByLabelText("Pontos"), { target: { value: "4" } });
  const salvar = screen.getByRole("button", { name: "Salvar Caixa" }) as HTMLButtonElement;
  expect(salvar.disabled).toBe(false);
  expect(screen.getByText("Vai mudar: Fidelidade.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Salvar Conversas" })).toBeNull();
  fireEvent.click(salvar);
  await waitFor(() => expect(save).toHaveBeenCalledWith("fidelidade", { params: { pontos: 4 } }, false));
  expect(await screen.findByText("Salvo: Fidelidade.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Salvar Caixa" })).toBeNull();
});
