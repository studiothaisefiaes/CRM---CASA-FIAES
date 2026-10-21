// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
const calls: unknown[][] = [];
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("@/app/(app)/contatos/consent-actions", () => ({ saveConsentAction: async (...a: unknown[]) => { calls.push(a); return { ok: true }; } }));
import { ConsentBlock } from "./consent-block";

afterEach(() => { cleanup(); calls.length = 0; });
const none = { whatsapp: null, ai: null, cpfNota: null };

it("três perguntas, cada uma com Sim, Não e Não perguntado; a marcada vem do banco", () => {
  render(<ConsentBlock contactId="c1" value={{ whatsapp: false, ai: null, cpfNota: true }} canEdit />);
  for (const q of ["Recebe campanhas por WhatsApp?", "Pode ser atendida com ajuda da IA?", "Quer CPF na nota?"]) expect(screen.getByRole("radiogroup", { name: q })).toBeTruthy();
  const zap = screen.getByRole("radiogroup", { name: "Recebe campanhas por WhatsApp?" });
  expect(within(zap).getByRole("radio", { name: "Não" }).getAttribute("aria-checked")).toBe("true");
  expect(within(screen.getByRole("radiogroup", { name: "Pode ser atendida com ajuda da IA?" })).getByRole("radio", { name: "Não perguntado" }).getAttribute("aria-checked")).toBe("true");
});

it("escolher uma resposta grava só aquela pergunta; 'Não perguntado' grava null", async () => {
  render(<ConsentBlock contactId="c1" value={{ whatsapp: false, ai: null, cpfNota: null }} canEdit />);
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Pode ser atendida com ajuda da IA?" })).getByRole("radio", { name: "Sim" }));
  await vi.waitFor(() => expect(calls).toEqual([["c1", { ai: true }]]));
  const naoPerg = () => within(screen.getByRole("radiogroup", { name: "Recebe campanhas por WhatsApp?" })).getByRole("radio", { name: "Não perguntado" }) as HTMLButtonElement;
  await vi.waitFor(() => expect(naoPerg().disabled).toBe(false)); // a gravação anterior terminou
  fireEvent.click(naoPerg());
  await vi.waitFor(() => expect(calls[1]).toEqual(["c1", { whatsapp: null }]));
});

it("sem a permissão as respostas aparecem, mas não mudam", () => {
  render(<ConsentBlock contactId="c1" value={none} canEdit={false} />);
  const r = within(screen.getByRole("radiogroup", { name: "Quer CPF na nota?" })).getByRole("radio", { name: "Sim" }) as HTMLButtonElement;
  expect(r.disabled).toBe(true);
});
