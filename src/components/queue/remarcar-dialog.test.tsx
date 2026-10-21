// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RemarcarDialog, remarcarAt, REMARCAR_MOTIVO } from "./remarcar-dialog";

afterEach(cleanup);
const bahia = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`).getTime();

it("item 6 (17/10): 'Lembrar de remarcar' daqui a 15, 30 ou 60 dias, às 10h, pulando dia em que a Casa não abre", () => {
  const now = bahia("2026-10-17", "15:00"); // sábado
  const tercaASabado = (ms: number) => { const d = new Date(ms - 3 * 3_600_000).getUTCDay(); return d >= 2 && d <= 6; };
  expect(remarcarAt(now, 30, tercaASabado)).toBe(bahia("2026-11-17", "10:00")); // 16/11 é segunda: vai para terça
  expect(remarcarAt(now, 15, () => true)).toBe(bahia("2026-11-01", "10:00"));
});

it("escolher o prazo devolve a data, o motivo e a mensagem de retomada com o primeiro nome", () => {
  const onPick = vi.fn();
  render(<RemarcarDialog open onClose={() => {}} name="Paula Souza" onPick={onPick} />);
  expect(screen.getAllByRole("button", { name: /Daqui a \d+ dias/ }).map((b) => b.textContent)).toEqual(["Daqui a 15 dias", "Daqui a 30 dias", "Daqui a 60 dias"]);
  fireEvent.click(screen.getByRole("button", { name: "Daqui a 30 dias" }));
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ motivo: REMARCAR_MOTIVO, text: expect.stringMatching(/^Oi, Paula! .*remarcar seu horário/) }));
  expect(onPick.mock.calls[0][0].at).toBeGreaterThan(Date.now() + 29 * 86_400_000);
});
