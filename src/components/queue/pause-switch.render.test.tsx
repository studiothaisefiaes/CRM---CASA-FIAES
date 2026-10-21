// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const calls: unknown[][] = [];
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("@/app/(app)/atendimento/pause-actions", () => ({ pauseAutomationsAction: async (...a: unknown[]) => { calls.push(a); return { ok: true }; } }));
import { PauseSwitch } from "./pause-switch";

afterEach(() => { cleanup(); calls.length = 0; });

it("o interruptor tem role=switch e o nome 'Pausar automáticas desta cliente'", () => {
  render(<PauseSwitch contactId="c1" pausedUntil={null} />);
  const sw = screen.getByRole("switch", { name: "Pausar automáticas desta cliente" });
  expect(sw.getAttribute("aria-checked")).toBe("false");
});

it("ligando, pergunta 'Até quando?' com 'Até eu religar' e 'Até amanhã'; nada é gravado antes de escolher", () => {
  render(<PauseSwitch contactId="c1" pausedUntil={null} />);
  fireEvent.click(screen.getByRole("switch"));
  expect(screen.getByText("Até quando?")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Até eu religar" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Até amanhã" })).toBeTruthy();
  expect(calls).toEqual([]);
});

it("escolher 'Até amanhã' grava 'amanha'; 'Até eu religar' grava 'sempre'", async () => {
  render(<PauseSwitch contactId="c1" pausedUntil={null} />);
  fireEvent.click(screen.getByRole("switch"));
  fireEvent.click(screen.getByRole("button", { name: "Até amanhã" }));
  await vi.waitFor(() => expect(calls).toEqual([["c1", "amanha"]]));
});

it("pausada: o interruptor aparece ligado, diz até quando e desligar religa na hora", async () => {
  render(<PauseSwitch contactId="c1" pausedUntil="sempre" />);
  const sw = screen.getByRole("switch", { name: "Pausar automáticas desta cliente" });
  expect(sw.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText(/Automáticas pausadas até alguém religar/)).toBeTruthy();
  fireEvent.click(sw);
  await vi.waitFor(() => expect(calls).toEqual([["c1", null]]));
});
