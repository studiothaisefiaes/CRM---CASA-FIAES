// @vitest-environment jsdom
import { it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { KeepScheduledDialog } from "./keep-scheduled-dialog";
afterEach(cleanup);

const NOW = Date.parse("2026-10-13T13:00:00Z"); // terça 10:00 em Salvador
const AMANHA_10 = new Date("2026-10-14T13:00:00Z");

it("Resolver com 1 programada: pergunta 'Manter a mensagem de amanhã 10:00?' com Manter e Cancelar", () => {
  const onKeep = vi.fn(), onCancelMessage = vi.fn(), onClose = vi.fn();
  render(<KeepScheduledDialog open action="resolver" items={[{ at: AMANHA_10 }]} nowMs={NOW} pending={false} onKeep={onKeep} onCancelMessage={onCancelMessage} onClose={onClose} />);
  expect(screen.getByRole("dialog", { name: "Manter a mensagem de amanhã 10:00?" })).toBeTruthy();
  expect(screen.getByText(/A conversa vai ser resolvida/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Manter" }));
  expect(onKeep).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(onCancelMessage).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
});

it("Perdido com 2 programadas: conta as duas e diz quando sai a primeira", () => {
  render(<KeepScheduledDialog open action="perdido" items={[{ at: AMANHA_10.toISOString() }, { at: "2026-10-16T17:30:00Z" }]} nowMs={NOW} pending={false} onKeep={() => {}} onCancelMessage={() => {}} onClose={() => {}} />);
  expect(screen.getByRole("dialog", { name: "Manter as 2 mensagens programadas?" })).toBeTruthy();
  expect(screen.getByText(/vai para Perdido/)).toBeTruthy();
  expect(screen.getByText(/A primeira sai amanhã 10:00/)).toBeTruthy();
});
