// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("@/app/(app)/contatos/actions", () => ({ startConversationAction: vi.fn(), unignoreContactAction: vi.fn() }));
vi.mock("@/app/(app)/funil/actions", () => ({ setTeamContactAction: vi.fn() }));
import { ConfirmByPhoneList } from "./confirm-by-phone";
afterEach(cleanup);

const items = [
  { contactId: "c1", name: "Beatriz Souza", phone: "+5571988887777", firstStart: "2026-10-18T12:00:00.000Z", services: [{ service: "Luzes", pro: "Thaise" }, { service: "Coloração", pro: "Sidney" }] },
  { contactId: "c2", name: "Roger Lima", phone: "+5571977776666", firstStart: "2026-10-18T17:30:00.000Z", services: [{ service: "Corte", pro: null }] },
];

it("Confirmar por telefone: quantas, por quê, hora, nome, serviços, telefone para ligar e Iniciar conversa", () => {
  render(<ConfirmByPhoneList items={items} canStart />);
  expect(screen.getByText("2 clientes com horário amanhã sem conversa no CRM.")).toBeTruthy();
  expect(screen.getByText(/não recebem o lembrete/)).toBeTruthy();
  expect(screen.getByText("09:00")).toBeTruthy();
  expect(screen.getByText("Luzes com Thaise · Coloração com Sidney")).toBeTruthy();
  const tel = screen.getByRole("link", { name: /Ligar para Beatriz Souza/ });
  expect(tel.getAttribute("href")).toBe("tel:+5571988887777");
  expect(screen.getAllByRole("button", { name: /Iniciar conversa/ })).toHaveLength(2);
});

it("sem permissão de contatos: só o telefone; lista vazia diz que está em dia", () => {
  render(<ConfirmByPhoneList items={items.slice(0, 1)} canStart={false} />);
  expect(screen.queryByRole("button", { name: /Iniciar conversa/ })).toBeNull();
  cleanup();
  render(<ConfirmByPhoneList items={[]} canStart />);
  expect(screen.getByText("Todas as clientes de amanhã têm conversa no CRM.")).toBeTruthy();
});
