// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const save = vi.hoisted(() => vi.fn(async (_: unknown) => ({ ok: true as const })));
vi.mock("@/app/(app)/config/automacoes/lembrete-actions", () => ({ saveLembreteD1Action: save }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { ReminderD1Card } from "./reminder-d1";
import { CASA_CONFIRMACAO_D1 } from "@/lib/casa-texts";

afterEach(cleanup);

it("'Usar o texto da Casa' põe a confirmação da véspera da Casa (com endereço e mapa)", () => {
  render(<ReminderD1Card value={{ enabled: false, comLink: false, texto: "Oi, {primeiro_nome}! Até amanhã.", textoRemarcado: "Oi, {primeiro_nome}! Remarcado para {data}." }} />);
  fireEvent.click(screen.getByRole("button", { name: "Usar o texto da Casa no lembrete" }));
  expect((screen.getByLabelText("Texto do lembrete") as HTMLTextAreaElement).value).toBe(CASA_CONFIRMACAO_D1);
  expect(screen.getByText(/\{endereco\} e \{mapa\}/)).toBeTruthy();
});

const V = { enabled: false, comLink: false, texto: "Oi, {primeiro_nome}! Até amanhã.", textoRemarcado: "Oi, {primeiro_nome}! Remarcado para {data}." };
it("desligado: ligar é pela Virada (o link leva para lá; a tela não liga sozinha)", () => {
  render(<ReminderD1Card value={V} />);
  expect(screen.getByRole("link", { name: "Ligar pela troca do ChatGuru para o CRM" }).getAttribute("href")).toBe("/config/virada?alvo=lembrete");
  expect(screen.queryByRole("switch")).toBeNull();
});
it("ligado: o interruptor só desliga, na hora", async () => {
  render(<ReminderD1Card value={{ ...V, enabled: true }} />);
  fireEvent.click(screen.getByRole("switch", { name: "Lembrete do horário" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ ...V, enabled: false }));
});
