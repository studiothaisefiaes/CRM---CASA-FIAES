// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
const setKind = vi.fn(async (_id: string, k: string) => ({ ok: true as const, data: { before: k === "cliente" ? "spam" : "cliente", changed: true, dealId: "d1", resolved: false } }));
vi.mock("@/app/(app)/funil/actions", () => ({ setContactKindAction: (id: string, k: string) => setKind(id, k), unarchiveConversationAction: vi.fn() }));
import { ToastProvider } from "@/components/ui/toast";
import { ContactKindPopover, useMarkContact } from "./contact-kind-menu";
import type { ContactKind } from "@/lib/contact-kind";
afterEach(() => { cleanup(); setKind.mockClear(); });

function Harness({ current = "cliente" as ContactKind, onDone = () => {} }) {
  const { mark } = useMarkContact(onDone);
  return <ContactKindPopover at={{ x: 40, y: 50 }} name="Claro Empresas" current={current} onClose={() => {}} onPick={(k) => mark("c1", "Claro Empresas", k)} />;
}

it("“Marcar como…”: Cliente, Equipe, Fornecedor e Spam, com o atual marcado", () => {
  render(<ToastProvider><Harness current="equipe" /></ToastProvider>);
  const menu = screen.getByRole("menu", { name: "Marcar Claro Empresas como…" });
  const opts = within(menu).getAllByRole("menuitemradio");
  expect(opts.map((o) => o.getAttribute("aria-checked"))).toEqual(["false", "true", "false", "false"]);
  expect(opts[0].textContent).toContain("Cliente");
  expect(opts[2].textContent).toContain("Fornecedor");
  expect(opts[3].textContent).toContain("Spam");
});

it("escolher Spam grava o tipo e avisa com Desfazer", async () => {
  const onDone = vi.fn();
  render(<ToastProvider><Harness onDone={onDone} /></ToastProvider>);
  await act(async () => { fireEvent.click(screen.getByRole("menuitemradio", { name: /Spam/ })); });
  expect(setKind).toHaveBeenCalledWith("c1", "spam");
  expect(onDone).toHaveBeenCalledWith("spam", false);
  expect(screen.getByText(/Claro Empresas agora é Spam e saiu da lista/)).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Desfazer" })); });
  expect(setKind).toHaveBeenLastCalledWith("c1", "cliente");
  expect(onDone).toHaveBeenLastCalledWith("cliente", true); // o Desfazer avisa para reabrir a conversa
});
