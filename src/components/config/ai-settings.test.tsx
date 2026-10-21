// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("@/app/(app)/config/ia/actions", () => ({ saveAiSettingsAction: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { AiSettingsForm } from "./ai-settings";

afterEach(cleanup);

const spend = { monthMicros: 0, monthCalls: 0, todayCalls: 0 };

it("explica a sugestão como é hoje: só no botão Sugerir resposta, fica guardada, dá para pedir outra e vale para a Equipe", () => {
  render(<AiSettingsForm initial={{ enabled: true, monthlyLimitUsd: 40, dailyCalls: 1500 }} spend={spend} hasKey model="claude-haiku" />);
  const texto = document.body.textContent ?? "";
  expect(screen.getByRole("heading", { name: "Como funciona" })).toBeTruthy();
  expect(texto).toContain("A qualquer momento, toque em Sugerir resposta");
  expect(texto).toContain("mostra a sugestão já guardada, sem gastar de novo");
  // O botão da sugestão é "Usar e editar" (16/10): a explicação usa o mesmo nome.
  expect(texto).toContain("A atendente toca Usar e editar");
  expect(texto).toContain("contatos da Equipe");
  // O texto antigo dizia que abrir a conversa já gerava a sugestão.
  expect(texto).not.toMatch(/abre a conversa e a cliente espera resposta: a IA escreve/);
  expect(texto).not.toContain("quando a cliente escreve.");
});
