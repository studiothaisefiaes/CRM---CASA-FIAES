// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const a = vi.hoisted(() => ({
  save: vi.fn(async (_alvo: string, _m: string[]) => ({ ok: true as const })),
  test: vi.fn(async (_alvo: string, _phone: string, _modo?: string): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true })),
  ligar: vi.fn(async (_alvo: string, _o: unknown) => ({ ok: true as const })),
}));
vi.mock("@/app/(app)/config/virada/actions", () => ({ saveViradaAction: a.save, sendViradaTestAction: a.test, ligarViradaAction: a.ligar }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { ViradaSettings, type ViradaEstado } from "./virada";

afterEach(() => { cleanup(); a.save.mockClear(); a.test.mockClear(); a.ligar.mockClear(); });

const PREVIEW = "Oi, Thaise! 💛\n\nPodemos confirmar sua presença amanhã na Casa Fiaes?";
const estado = (patch: Partial<ViradaEstado["lembrete"]> = {}): ViradaEstado => ({
  lembrete: { ligado: false, marcados: [], previews: { lembrete: { kind: "text", text: PREVIEW } }, testeRecente: {}, editarEm: "/config/automacoes?parte=lembrete", ...patch },
  depois: {
    ligado: false, marcados: [], editarEm: "/config/depois-atendimento", testeRecente: {},
    previews: { agradecimento: { kind: "text", text: "Oi, Thaise! Obrigada" }, pesquisa: { kind: "poll", text: "Thaise, de 1 a 5?", options: ["5 · Excelente", "1 · Muito ruim"] } },
  },
});
const heading = () => screen.getByRole("heading", { level: 3 }).textContent;
const continuar = () => fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

it("uma pergunta por passo, na ordem; só no fim aparece 'Ligar o lembrete', que pede a confirmação de envio real", async () => {
  render(<ViradaSettings alvo="lembrete" estado={estado()} horasTeste={24} />);
  expect(heading()).toBe("O lembrete do ChatGuru está desligado?");
  expect(screen.getByText(/desative o diálogo automático do lembrete/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Ligar o lembrete" })).toBeNull();
  expect((screen.getByRole("button", { name: "Continuar" }) as HTMLButtonElement).disabled).toBe(true);

  fireEvent.click(screen.getByRole("checkbox", { name: "Sim, está desligado" }));
  await waitFor(() => expect(a.save).toHaveBeenLastCalledWith("lembrete", ["chatguru_lembrete"]));
  continuar();
  expect(heading()).toBe("A confirmação por WhatsApp do Avec está desligada?");
  expect(screen.getByText("Configurações › Notificações › Envio de WhatsApp para clientes")).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: "Sim, está desligada" }));
  await waitFor(() => expect(a.save).toHaveBeenLastCalledWith("lembrete", ["chatguru_lembrete", "avec_confirmacao"]));
  continuar();
  expect(heading()).toBe("O texto está certo?");
  expect(screen.getByLabelText("Prévia").textContent).toContain("Podemos confirmar sua presença amanhã");
  fireEvent.click(screen.getByRole("checkbox", { name: "Sim, o texto está certo" }));
  await waitFor(() => expect(a.save).toHaveBeenCalledTimes(3));
  continuar();
  expect(heading()).toBe("Chegou o teste no seu WhatsApp?");
  expect(screen.queryByRole("button", { name: "Ligar o lembrete" })).toBeNull();
  const chegou = screen.getByRole("checkbox", { name: "Sim, chegou" }) as HTMLInputElement;
  expect(chegou.disabled).toBe(true); // só depois de mandar o teste
  fireEvent.change(screen.getByLabelText("Para qual WhatsApp mando o teste?"), { target: { value: "(71) 98888-7777" } });
  fireEvent.click(screen.getByRole("button", { name: "Mandar o teste" }));
  await waitFor(() => expect(a.test).toHaveBeenCalledWith("lembrete", "(71) 98888-7777", undefined));
  await waitFor(() => expect(chegou.disabled).toBe(false));
  fireEvent.click(chegou);
  await waitFor(() => expect(a.save).toHaveBeenLastCalledWith("lembrete", ["chatguru_lembrete", "avec_confirmacao", "texto_conferido", "teste_enviado"]));

  fireEvent.click(await screen.findByRole("button", { name: "Ligar o lembrete" }));
  expect(a.ligar).not.toHaveBeenCalled();
  expect(screen.getByText("Isto vai enviar mensagens reais para clientes.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Entendi, ligar" }));
  await waitFor(() => expect(a.ligar).toHaveBeenCalledWith("lembrete", { confirmouEnvio: true }));
});

it("o número do teste: avisa antes que vira contato de Equipe e mostra a recusa (número de cliente, Spam) no campo", async () => {
  render(<ViradaSettings alvo="lembrete" estado={estado({ marcados: ["chatguru_lembrete", "avec_confirmacao", "texto_conferido"] })} horasTeste={24} />);
  for (let i = 0; i < 3; i++) continuar();
  expect(heading()).toBe("Chegou o teste no seu WhatsApp?");
  expect(screen.getByText(/vira contato de Equipe/)).toBeTruthy();
  a.test.mockResolvedValueOnce({ ok: false, error: "Esse número é de uma cliente (Paula Souza). Use o WhatsApp da gestora." });
  fireEvent.change(screen.getByLabelText("Para qual WhatsApp mando o teste?"), { target: { value: "71988887777" } });
  fireEvent.click(screen.getByRole("button", { name: "Mandar o teste" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Esse número é de uma cliente (Paula Souza). Use o WhatsApp da gestora.");
  expect((screen.getByRole("checkbox", { name: "Sim, chegou" }) as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Mandar o teste" }));
  expect((await screen.findByRole("status")).textContent).toContain("Mandei");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("o teste ainda vale (feito nas últimas horas): 'Sim, chegou' já pode ser marcado", () => {
  render(<ViradaSettings alvo="lembrete" estado={estado({ marcados: ["chatguru_lembrete", "avec_confirmacao", "texto_conferido"], testeRecente: { lembrete: true } })} horasTeste={24} />);
  for (let i = 0; i < 3; i++) continuar();
  expect((screen.getByRole("checkbox", { name: "Sim, chegou" }) as HTMLInputElement).disabled).toBe(false);
  expect(screen.getByText(/vale por 24 horas/)).toBeTruthy();
});

it("já ligado: diz que está ligado e onde desligar, sem o checklist", () => {
  render(<ViradaSettings alvo="lembrete" estado={estado({ ligado: true, marcados: ["chatguru_lembrete", "avec_confirmacao", "texto_conferido", "teste_enviado"] })} horasTeste={24} />);
  expect(screen.getByText("O lembrete do horário está ligado.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Desligar em Lembrete do horário" }).getAttribute("href")).toBe("/config/automacoes?parte=lembrete");
  expect(screen.queryByRole("checkbox")).toBeNull();
});

it("Depois do atendimento: primeiro o que a cliente recebe, depois o agradecimento do Avec, o texto do modo escolhido e o teste", async () => {
  render(<ViradaSettings alvo="depois" estado={{ ...estado(), depois: { ...estado().depois, marcados: ["avec_agradecimento", "texto_conferido"] } }} horasTeste={24} />);
  expect(heading()).toBe("O que a cliente recebe depois do atendimento?");
  fireEvent.click(screen.getByRole("radio", { name: /Pesquisa de satisfação/ }));
  continuar();
  expect(heading()).toBe("O agradecimento por WhatsApp do Avec está desligado?");
  continuar();
  expect(heading()).toBe("O texto está certo?");
  expect(screen.getByLabelText("Prévia").textContent).toContain("Thaise, de 1 a 5?");
  continuar();
  fireEvent.change(screen.getByLabelText("Para qual WhatsApp mando o teste?"), { target: { value: "71988887777" } });
  fireEvent.click(screen.getByRole("button", { name: "Mandar o teste" }));
  await waitFor(() => expect(a.test).toHaveBeenCalledWith("depois", "71988887777", "pesquisa"));
  const chegou = screen.getByRole("checkbox", { name: "Sim, chegou" }) as HTMLInputElement;
  await waitFor(() => expect(chegou.disabled).toBe(false));
  fireEvent.click(chegou);
  fireEvent.click(await screen.findByRole("button", { name: "Ligar o Depois do atendimento" }));
  fireEvent.click(screen.getByRole("button", { name: "Entendi, ligar" }));
  await waitFor(() => expect(a.ligar).toHaveBeenCalledWith("depois", { confirmouEnvio: true, modo: "pesquisa" }));
});
