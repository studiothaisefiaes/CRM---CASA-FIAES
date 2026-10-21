// src/components/team/team-now.test.tsx
// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TeamNowPanel, TeamNowStrip } from "./team-now";
import type { TeamNow } from "@/server/queries/team-now";

afterEach(cleanup);
const NOW = new Date("2026-10-15T15:00:00Z");
const team: TeamNow = {
  members: [{ id: "s", name: "Sara", state: "respondendo", waiting: 4, mine: 30, lastReplyAt: new Date(NOW.getTime() - 4 * 60_000).toISOString(), lastReplyVia: "celular", receives: true }],
  unowned: { waiting: 1, total: 3 },
};

it("painel do Hoje escreve o estado, a última resposta, quantas esperam e leva aos sem dono", () => {
  render(<TeamNowPanel team={team} now={NOW} />);
  expect(screen.getByText("Respondendo agora", { exact: false })).toBeTruthy();
  expect(screen.getByText("Última resposta: há 4 min, pelo celular")).toBeTruthy();
  expect(screen.getByText("4 esperando")).toBeTruthy();
  expect(screen.getByRole("link", { name: /Sem dono/ }).getAttribute("href")).toContain("view=sem-dono");
});

it("faixa da Fila: uma linha só com mini avatares, 'Sara está com 4 · Cati com 0'; sem quem não recebe conversa e sem o 'sem dono'", () => {
  const t: TeamNow = { ...team, members: [
    { ...team.members[0], name: "Sara Lima" }, // sem assinatura vem o nome inteiro: a linha usa o primeiro nome
    { id: "c", name: "Cati", state: "no_crm", waiting: 0, mine: 2, lastReplyAt: null, lastReplyVia: null, receives: true },
    { id: "j", name: "Joaquim", state: "no_crm", waiting: 0, mine: 0, lastReplyAt: null, lastReplyVia: null, receives: false },
  ] };
  const { container } = render(<TeamNowStrip team={t} now={NOW} />);
  const summary = container.querySelector("summary")!;
  expect(summary.textContent).toContain("Sara está com 4 · Cati com 0");
  expect(summary.textContent).not.toContain("Joaquim");
  expect(summary.textContent).not.toMatch(/sem dono/i);
  expect(summary.querySelectorAll("[data-mini-avatar]")).toHaveLength(2);
  expect(summary.innerHTML).not.toContain("truncate");
});

it("faixa da Fila some quando ninguém recebe conversa", () => {
  const { container } = render(<TeamNowStrip team={{ ...team, members: [{ ...team.members[0], receives: false }] }} now={NOW} />);
  expect(container.innerHTML).toBe("");
});
