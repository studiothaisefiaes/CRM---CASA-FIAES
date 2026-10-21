// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { scheduleMessageAction } = vi.hoisted(() => ({ scheduleMessageAction: vi.fn() }));
vi.mock("@/app/(app)/conversa/actions", () => ({ scheduleMessageAction }));
import { ScheduleMessageDialog } from "./schedule-message-dialog";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("agendar envio", () => {
  it("manda o dia e a hora de Salvador e o “não sai se ela escrever” marcado por padrão", async () => {
    scheduleMessageAction.mockResolvedValue({ ok: true, data: { at: "2026-10-21T13:00:00.000Z" } });
    const onDone = vi.fn();
    render(<ScheduleMessageDialog open onClose={() => {}} dealId="d1" text="Confirma amanhã?" onDone={onDone} />);
    fireEvent.change(screen.getByLabelText("Dia"), { target: { value: "2026-10-21" } });
    fireEvent.change(screen.getByLabelText("Hora"), { target: { value: "10:00" } });
    expect((screen.getByLabelText("Não enviar se a cliente escrever antes") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Agendar" }));
    await waitFor(() => expect(scheduleMessageAction).toHaveBeenCalledWith({ dealId: "d1", text: "Confirma amanhã?", at: "2026-10-21T13:00:00.000Z", cancelIfReply: true }));
    expect(onDone).toHaveBeenCalledWith("2026-10-21T13:00:00.000Z");
  });
  it("o motivo da recusa do servidor aparece no próprio diálogo", async () => {
    scheduleMessageAction.mockResolvedValue({ ok: false, error: "Nesse horário a Casa está fechada (segunda, a Casa não abre). Escolha um horário com a Casa aberta." });
    render(<ScheduleMessageDialog open onClose={() => {}} dealId="d1" text="Oi" onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Agendar" }));
    expect((await screen.findByRole("alert")).textContent).toContain("a Casa não abre");
  });
});
