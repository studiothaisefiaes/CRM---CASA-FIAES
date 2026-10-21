// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { save } = vi.hoisted(() => ({ save: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })) }));
vi.mock("@/app/(app)/config/actions", () => ({ saveAgendaSettingsAction: (...a: unknown[]) => save(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { AgendaSettingsForm } from "./agenda-settings";

afterEach(() => { cleanup(); save.mockClear(); });

it("mostra o modo de agora explicado e salva o modo e o passo escolhidos", async () => {
  render(<AgendaSettingsForm mode="consulta" passoMin={30} />);
  expect((screen.getByRole("radio", { name: /Só consulta/ }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText(/não marca, não remarca, não bloqueia/)).toBeTruthy();
  // r68 #10: nada mudou = nada de botão cinza, só "Tudo salvo"
  expect(screen.queryByRole("button", { name: "Salvar" })).toBeNull();
  expect(screen.getByText("Tudo salvo")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: /Nos dois sistemas/ }));
  fireEvent.change(screen.getByLabelText("Passo da grade e das sugestões"), { target: { value: "15" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ mode: "dupla", passoMin: 15 }));
});
