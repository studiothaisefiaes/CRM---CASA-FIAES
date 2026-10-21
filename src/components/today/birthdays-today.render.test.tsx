// @vitest-environment jsdom
import { it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
const { start } = vi.hoisted(() => ({ start: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: undefined })) }));
vi.mock("@/app/(app)/contatos/actions", () => ({ birthdayConversationAction: (...a: unknown[]) => start(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { BirthdaysPanel } from "./birthdays-today";
afterEach(cleanup);

const b = (o: object) => ({ contactId: "c1", dealId: "d1", name: "Bia Fiel", label: "15/10", today: true, loyal: true, hasAvatar: true, ...o });

it("painel de aniversários: foto e nome; 'Mandar parabéns' só abre a conversa com a mensagem no campo", async () => {
  render(<BirthdaysPanel items={[b({}), b({ contactId: "c2", dealId: null, name: "Ana Nova", loyal: false, hasAvatar: false })]} />);
  expect(document.querySelector('img[src="/api/avatar/c1"]')).toBeTruthy();
  const links = screen.getAllByRole("link", { name: /Mandar parabéns/ });
  expect(links[0].getAttribute("href")).toBe("/atendimento/d1?compose=1&parabens=1");
  fireEvent.click(screen.getByRole("button", { name: /Mandar parabéns para Ana Nova/ }));
  await waitFor(() => expect(start).toHaveBeenCalledWith("c2"));
});

it("sem aniversário hoje, o painel diz e mostra os próximos 7 dias", () => {
  render(<BirthdaysPanel items={[b({ today: false, name: "Carla Logo", label: "sáb 18/10" })]} />);
  expect(document.body.textContent).toContain("Nenhum aniversário hoje");
  expect(document.body.textContent).toContain("Próximos 7 dias");
  expect(document.body.textContent).toContain("Carla Logo");
  expect(document.body.textContent).toContain("sáb 18/10");
});

it("nome em Título (contato salvo em MAIÚSCULAS)", () => {
  render(<BirthdaysPanel items={[b({ name: "THAMIRES SOUZA" })]} />);
  expect(screen.getByText("Thamires Souza")).toBeTruthy();
});
