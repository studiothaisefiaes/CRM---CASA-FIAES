// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { WaitingList } from "./waiting-list";
afterEach(cleanup);

it("Esperando resposta no Hoje: nome em Título, como na Fila", () => {
  render(<WaitingList items={[{ id: "d1", contactId: "c1", name: "THAMIRES SOUZA", phone: "+5571990001101", stageName: "Em conversa", stageKey: "atendimento", slaMinutes: 3, at: new Date().toISOString(), extra: null }]} />);
  expect(screen.getAllByText("Thamires Souza").length).toBeGreaterThan(0);
});
