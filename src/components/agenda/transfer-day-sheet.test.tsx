// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { preview, transfer, toast } = vi.hoisted(() => ({ preview: vi.fn(), transfer: vi.fn(), toast: vi.fn() }));
vi.mock("@/app/(app)/agenda/actions", () => ({
  previewTransferDayAction: (...a: unknown[]) => preview(...a),
  transferDayAction: (...a: unknown[]) => transfer(...a),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));
import { TransferDaySheet } from "./transfer-day-sheet";

afterEach(() => { cleanup(); preview.mockReset(); transfer.mockReset(); toast.mockReset(); });

const PROS = [{ id: "a", name: "Ana" }, { id: "b", name: "Bia" }, { id: "c", name: "Carla" }];
const PREVIA = {
  movable: [{ appointmentId: "h1", hm: "10:00", clientName: "Paula Souza", serviceLabel: "Corte" }],
  askedForHer: [{ appointmentId: "h2", hm: "11:00", clientName: "Rita Lima", serviceLabel: "Hidratação" }],
  blocked: [{ appointmentId: "h3", hm: "14:00", clientName: "Lia Reis", serviceLabel: "Mechas", reason: "Bia não faz esse serviço." }],
};

it("um passo por tela: De quem? → Para quem? → lista com caixas ('Ela pediu a Ana' desmarcado) → Passar", async () => {
  preview.mockResolvedValue({ ok: true, data: PREVIA });
  transfer.mockResolvedValue({ ok: true, data: { moved: 1, skipped: [] } });
  const onClose = vi.fn();
  render(<TransferDaySheet open onClose={onClose} day="2026-10-16" pros={PROS} />);

  expect(screen.getByRole("group", { name: "De quem?" })).toBeTruthy();
  expect(screen.queryByRole("group", { name: "Para quem?" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Ana" }));

  const para = screen.getByRole("group", { name: "Para quem?" });
  expect(screen.queryByRole("group", { name: "De quem?" })).toBeNull();
  expect(para.textContent).not.toContain("Ana");
  fireEvent.click(screen.getByRole("button", { name: "Bia" }));
  await waitFor(() => expect(preview).toHaveBeenCalledWith({ fromProfessionalId: "a", toProfessionalId: "b", day: "2026-10-16" }));

  const livre = await screen.findByRole("checkbox", { name: /10:00 · Paula Souza · Corte/ });
  const pediu = screen.getByRole("checkbox", { name: /11:00 · Rita Lima · Hidratação/ });
  expect((livre as HTMLInputElement).checked).toBe(true);
  expect((pediu as HTMLInputElement).checked).toBe(false);
  expect(screen.getByText("Ela pediu a Ana")).toBeTruthy();
  expect(screen.getByText("Bia não faz esse serviço.")).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: /Lia Reis/ })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Passar 1 horário" }));
  await waitFor(() => expect(transfer).toHaveBeenCalledWith({ fromProfessionalId: "a", toProfessionalId: "b", day: "2026-10-16", appointmentIds: ["h1"], confirmAskedForHer: false }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(toast).toHaveBeenCalledWith("1 horário passou para a Bia");
});

it("marcar 'Ela pediu a Ana' manda o tique; o que não passou volta com o motivo", async () => {
  preview.mockResolvedValue({ ok: true, data: PREVIA });
  transfer.mockResolvedValue({ ok: true, data: { moved: 1, skipped: [{ appointmentId: "h1", reason: "Bia já tem Gal das 10:00 às 11:00" }] } });
  const onClose = vi.fn();
  render(<TransferDaySheet open onClose={onClose} day="2026-10-16" pros={PROS} />);
  fireEvent.click(screen.getByRole("button", { name: "Ana" }));
  fireEvent.click(screen.getByRole("button", { name: "Bia" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: /11:00 · Rita Lima/ }));
  fireEvent.click(screen.getByRole("button", { name: "Passar 2 horários" }));
  await waitFor(() => expect(transfer).toHaveBeenCalledWith(expect.objectContaining({ appointmentIds: ["h1", "h2"], confirmAskedForHer: true })));
  expect(await screen.findByText("Bia já tem Gal das 10:00 às 11:00")).toBeTruthy();
  expect(screen.getByText(/10:00 · Paula Souza · Corte/)).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
});

it("Voltar refaz a pergunta anterior; sem horários, diz e não deixa passar", async () => {
  preview.mockResolvedValue({ ok: true, data: { movable: [], askedForHer: [], blocked: [] } });
  render(<TransferDaySheet open onClose={() => {}} day="2026-10-16" pros={PROS} />);
  fireEvent.click(screen.getByRole("button", { name: "Ana" }));
  fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
  expect(screen.getByRole("group", { name: "De quem?" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Carla" }));
  fireEvent.click(screen.getByRole("button", { name: "Bia" }));
  expect(await screen.findByText("A Carla não tem horários para passar nesse dia.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Passar/ })).toBeNull();
});
