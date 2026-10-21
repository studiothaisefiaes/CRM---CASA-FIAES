// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const { save } = vi.hoisted(() => ({ save: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, agenda: "sincronizada" as const })) }));
vi.mock("@/app/(app)/config/etapas/actions", () => ({ saveSpecialDaysAction: (...a: unknown[]) => save(...a) }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));
import { SpecialDaysEditor } from "./special-days";

beforeEach(() => { save.mockClear(); toast.mockClear(); });
afterEach(cleanup);
const props = { today: "2026-12-10", diasAFrente: 60 };

it("faz uma pergunta no título e mostra o vazio", () => {
  render(<SpecialDaysEditor days={[]} {...props} />);
  expect(screen.getByRole("heading", { name: "Em que dias a Casa abre diferente?" })).toBeTruthy();
  expect(screen.getByText("Nenhum dia especial. A Casa segue o horário da semana.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Salvar dias" })).toBeNull(); // r68 #10: sem mudança, sem botão cinza
});
it("adiciona um dia fechado com texto e salva exatamente o que a gestão escreveu", async () => {
  render(<SpecialDaysEditor days={[]} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Adicionar dia" }));
  fireEvent.change(screen.getByLabelText("Data do dia especial 1"), { target: { value: "2026-12-25" } });
  fireEvent.change(screen.getByLabelText("Texto do dia 2026-12-25"), { target: { value: "Feliz Natal 💛" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar dias" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith([{ day: "2026-12-25", window: null, text: "Feliz Natal 💛" }]));
  expect(toast).toHaveBeenCalledWith("Dias especiais salvos", "ok");
});
it("horário reduzido mostra Das __ às __; voltar para Fechada esconde", () => {
  render(<SpecialDaysEditor days={[{ day: "2026-12-24", window: ["08:00", "13:00"], text: null }]} {...props} />);
  expect((screen.getByLabelText("Fecha em 2026-12-24") as HTMLSelectElement).value).toBe("13:00");
  fireEvent.change(screen.getByLabelText("Como a Casa fica em 2026-12-24"), { target: { value: "fechada" } });
  expect(screen.queryByLabelText("Fecha em 2026-12-24")).toBeNull();
});
it("remover dia salva a lista sem ele; dia que já passou não aparece", async () => {
  render(<SpecialDaysEditor days={[{ day: "2026-12-01", window: null, text: null }, { day: "2026-12-25", window: null, text: null }]} {...props} />);
  expect(screen.queryByLabelText("Texto do dia 2026-12-01")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Remover dia" }));
  fireEvent.click(screen.getByRole("button", { name: "Salvar dias" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith([]));
});
it("erro do servidor vira aviso e a Agenda só consulta é dita", async () => {
  save.mockResolvedValueOnce({ ok: false, error: "O dia 25/12 aparece duas vezes." } as never);
  render(<SpecialDaysEditor days={[{ day: "2026-12-25", window: null, text: null }]} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Remover dia" }));
  fireEvent.click(screen.getByRole("button", { name: "Adicionar dia" }));
  fireEvent.click(screen.getByRole("button", { name: "Salvar dias" }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith("O dia 25/12 aparece duas vezes.", "error"));
  save.mockResolvedValueOnce({ ok: true, agenda: "consulta" } as never);
  fireEvent.click(screen.getByRole("button", { name: "Salvar dias" }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith("Dias salvos. A Agenda está só em consulta: o bloqueio não foi criado.", "ok"));
});
it("função desligada avisa e não deixa salvar", () => {
  render(<SpecialDaysEditor days={[{ day: "2026-12-25", window: null, text: null }]} {...props} ligada={false} />);
  expect(screen.getByText("A função Dias especiais está desligada", { exact: false })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remover dia" }));
  expect((screen.getByRole("button", { name: "Salvar dias" }) as HTMLButtonElement).disabled).toBe(true); // mudou, mas desligada: o aviso acima explica
});
