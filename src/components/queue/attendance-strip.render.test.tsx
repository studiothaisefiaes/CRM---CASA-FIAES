// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("@/app/(app)/funil/actions", () => ({ setAttendanceAction: vi.fn(), undoMissedAttendanceAction: vi.fn() }));
vi.mock("./use-lead-actions", () => ({ attendanceToast: () => "" }));
vi.mock("./open-lead", () => ({ useOpenLead: () => () => {} }));
import { AttendanceStrip } from "./attendance-strip";
afterEach(cleanup);

const item = { dealId: "d1", contactId: "c1", name: "Flávia Gonçalves de Albuquerque", phone: "+5571999990001", hasAvatar: false, scheduledAt: "2026-10-16T18:00:00.000Z" };

it("'Ela veio?': o nome aparece inteiro (quebra a linha, não corta) e a hora junto", () => {
  render(<AttendanceStrip items={[item as never]} />);
  const nome = screen.getByText("Flávia Gonçalves de Albuquerque");
  expect(nome.className).not.toMatch(/\btruncate\b/);
  expect(nome.className).toMatch(/break-words/);
  expect(screen.getByText(/às 15:00/)).toBeTruthy();
});

it("no celular é uma coluna (nome em cima, botões embaixo); no computador volta a ser uma linha", () => {
  render(<AttendanceStrip items={[item as never]} />);
  const li = screen.getByTestId("conferir-item");
  expect(li.className).toMatch(/(^|\s)flex-col(\s|$)/);
  expect(li.className).toMatch(/lg:flex-row/);
  const botoes = screen.getByRole("button", { name: "Veio: Flávia Gonçalves de Albuquerque" }).parentElement!;
  expect(botoes.contains(screen.getByRole("button", { name: "Faltou: Flávia Gonçalves de Albuquerque" }))).toBe(true);
  expect(botoes).not.toBe(li);
});
