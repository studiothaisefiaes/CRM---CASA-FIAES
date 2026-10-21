// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("@/app/(app)/conversa/actions", () => ({ addNoteAction: vi.fn(), scheduleMessageAction: vi.fn(), sendQuickReplyAction: vi.fn() }));
vi.mock("@/app/(app)/funil/actions", () => ({ sendMessageAction: vi.fn(), sendMediaAction: vi.fn() }));
import { Composer } from "./composer";

const wide = (on: boolean) => { window.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia; };
afterEach(() => { cleanup(); wide(false); });

it("desenho aprovado (16/10): anexo, '/ Prontas', campo (sai assinada como NOME), Nota, relógio 'Programar mensagem' e Enviar, nessa ordem", () => {
  wide(true);
  const { container } = render(<Composer dealId="d1" firstName="Maria" signature="JOAQUIM" quickReplies={[{ id: "q", label: "valores", body: "Os valores…" }]} onOptimistic={() => {}} />);
  const field = screen.getByRole("textbox", { name: "Mensagem" });
  expect(field.getAttribute("placeholder")).toBe("Mensagem (sai assinada como JOAQUIM)");
  const row = field.parentElement!;
  const names = [...row.querySelectorAll("button, textarea")].map((el) => el.getAttribute("aria-label") ?? el.textContent);
  const order = ["Anexar foto, PDF ou áudio", "Respostas prontas", "Mensagem", "Nota para a equipe (a cliente não vê)", "Programar mensagem", "Enviar"];
  expect(names.filter((n) => order.includes(n ?? ""))).toEqual(order);
  expect(screen.getByRole("button", { name: "Respostas prontas" }).textContent).toContain("Prontas");
  expect(screen.getByRole("button", { name: "Nota para a equipe (a cliente não vê)" }).textContent).toContain("Nota");
  // O relógio fica sempre ativo: sem texto, o Retomar vira lembrete.
  expect((screen.getByRole("button", { name: "Programar mensagem" }) as HTMLButtonElement).disabled).toBe(false);
  expect(container.textContent).not.toContain("Enter envia");
});

it("celular: '/ Prontas' mora no [+] e abre a lista de respostas prontas no campo", () => {
  render(<Composer dealId="d1" firstName="Maria" quickReplies={[{ id: "q", label: "valores", body: "Os valores…" }]} onOptimistic={() => {}} />);
  expect(screen.queryByRole("button", { name: "Respostas prontas" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Anexar e mais" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Respostas prontas" }));
  expect(screen.getByRole("listbox", { name: "Respostas prontas" })).toBeTruthy();
  expect((screen.getByRole("textbox", { name: "Mensagem" }) as HTMLTextAreaElement).value).toBe("/");
});

it("no celular: 'Mensagem…', o relógio 'Programar mensagem' sempre à vista e abre o Retomar com o texto do campo", () => {
  const onProgram = vi.fn();
  render(<Composer dealId="d1" firstName="Maria" signature="JOAQUIM" quickReplies={[]} onOptimistic={() => {}} onProgram={onProgram} />);
  const field = screen.getByRole("textbox", { name: "Mensagem" });
  expect(field.getAttribute("placeholder")).toBe("Mensagem…");
  expect(screen.queryByRole("button", { name: /Nota para a equipe/ })).toBeNull(); // no [+]
  fireEvent.change(field, { target: { value: "Oi, Maria!" } });
  fireEvent.click(screen.getByRole("button", { name: "Programar mensagem" }));
  expect(onProgram).toHaveBeenCalledWith("Oi, Maria!");
});

it("sem assinatura cadastrada, o campo diz só 'Mensagem…'", () => {
  wide(true);
  render(<Composer dealId="d1" firstName="Maria" quickReplies={[]} onOptimistic={() => {}} />);
  expect(screen.getByRole("textbox", { name: "Mensagem" }).getAttribute("placeholder")).toBe("Mensagem…");
});
