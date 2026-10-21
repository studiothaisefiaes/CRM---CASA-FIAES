// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const save = vi.hoisted(() => vi.fn(async (_v: unknown, _c?: boolean) => ({ ok: true as const, descartadas: 0 })));
vi.mock("@/app/(app)/config/resumo-whatsapp/actions", () => ({ saveSummaryWhatsappAction: save }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { SummaryWhatsappSettings } from "./summary-whatsapp";
import { SUMMARY_WHATSAPP_DEFAULTS } from "@/lib/summary-whatsapp";

afterEach(() => { cleanup(); save.mockClear(); });

const PEOPLE = [{ id: "g1", name: "Thaise", gestao: true }, { id: "g2", name: "Marta", gestao: true }, { id: "e1", name: "Sara", gestao: false }];
const comNumero = { ...SUMMARY_WHATSAPP_DEFAULTS, numeros: [{ userId: "g1", phone: "+5571988880001" }] };
const next = () => fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

it("uma pergunta por passo: quem recebe, que horas, para quantas pessoas, como começa", () => {
  render(<SummaryWhatsappSettings initial={comNumero} people={PEOPLE} />);
  expect(screen.getByRole("heading", { name: "Quem recebe o resumo do dia no WhatsApp?" })).toBeTruthy();
  next();
  expect(screen.getByRole("heading", { name: "A que horas o resumo sai?" })).toBeTruthy();
  next();
  expect(screen.getByRole("heading", { name: "Para quantas pessoas, no máximo?" })).toBeTruthy();
  next();
  expect(screen.getByRole("heading", { name: "Como a mensagem começa?" })).toBeTruthy();
});

it("quem está sem número mostra 'Sem número, fica de fora.'", () => {
  render(<SummaryWhatsappSettings initial={comNumero} people={PEOPLE} />);
  expect(screen.getAllByText("Sem número, fica de fora.")).toHaveLength(1); // Marta; Thaise tem número
});

it("a linha de abertura é editável, tem prévia e 'Usar o texto sugerido'; só salva as pessoas mostradas", async () => {
  render(<SummaryWhatsappSettings initial={{ ...comNumero, numeros: [...comNumero.numeros, { userId: "sumiu", phone: "+5571911110000" }] }} people={PEOPLE} />);
  next(); next(); next();
  fireEvent.change(screen.getByLabelText("Linha de abertura"), { target: { value: "Oi! {data}" } });
  expect(screen.getByRole("region", { name: "Prévia" }).textContent).toBe("Oi! terça-feira, 20/10");
  fireEvent.click(screen.getByRole("button", { name: "Usar o texto sugerido" }));
  expect((screen.getByLabelText("Linha de abertura") as HTMLInputElement).value).toBe("*Resumo do dia* ({data})");
  fireEvent.change(screen.getByLabelText("Linha de abertura"), { target: { value: "Oi! {data}" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0]).toMatchObject({ titulo: "Oi! {data}", numeros: [{ userId: "g1", phone: "+5571988880001" }] });
});

it("ligar pede a confirmação de envio real e só então salva com confirmouEnvio", async () => {
  render(<SummaryWhatsappSettings initial={comNumero} people={PEOPLE} />);
  fireEvent.click(screen.getByRole("switch", { name: "Resumo do dia no WhatsApp" }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByText("Ligar o envio automático?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Entendi, ligar" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0]).toMatchObject({ enabled: true, destino: "gestao", hora: 19 });
  expect(save.mock.calls[0][1]).toBe(true);
});

it("desligar salva na hora, sem a confirmação", async () => {
  render(<SummaryWhatsappSettings initial={{ ...comNumero, enabled: true }} people={PEOPLE} />);
  fireEvent.click(screen.getByRole("switch", { name: "Resumo do dia no WhatsApp" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0]).toMatchObject({ enabled: false });
});

it("mudar a hora e o limite muda o que é salvo; 'escolhidas' lista todas com permissão", async () => {
  render(<SummaryWhatsappSettings initial={comNumero} people={PEOPLE} />);
  fireEvent.click(screen.getByRole("radio", { name: "Só as pessoas que eu escolher" }));
  expect(screen.getByLabelText("WhatsApp de Sara")).toBeTruthy();
  next();
  fireEvent.change(screen.getByLabelText("Hora (0 a 23)"), { target: { value: "20" } });
  next();
  fireEvent.change(screen.getByLabelText("Máximo de pessoas"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0]).toMatchObject({ destino: "escolhidas", hora: 20, maxPessoas: 2 });
  expect(save.mock.calls[0][1]).toBe(false);
});

it("destino Gestão mostra só as pessoas da Gestão e pede o WhatsApp de cada uma", () => {
  render(<SummaryWhatsappSettings initial={comNumero} people={PEOPLE} />);
  expect(screen.getByLabelText("WhatsApp de Thaise")).toBeTruthy();
  expect(screen.getByLabelText("WhatsApp de Marta")).toBeTruthy();
  expect(screen.queryByLabelText("WhatsApp de Sara")).toBeNull();
});
