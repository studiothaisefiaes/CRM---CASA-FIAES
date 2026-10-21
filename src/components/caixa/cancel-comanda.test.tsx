// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const cancelar = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const desfazer = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const toast = vi.fn();
vi.mock("@/app/(app)/caixa/actions", () => ({ cancelarComandaAction: (...a: unknown[]) => cancelar(...a), undoCancelarComandaAction: (...a: unknown[]) => desfazer(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { CancelComandaDialog } from "./cancel-comanda";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("psico r68 #1: cancelar comanda pede confirmação e motivo; o aviso traz Desfazer", async () => {
  const onDone = vi.fn();
  render(<CancelComandaDialog open comandaId="c1" label="Comanda 4 · Lia" onClose={() => {}} onDone={onDone} />);
  expect(screen.getByRole("dialog", { name: "Cancelar a comanda 4 · Lia?" })).toBeTruthy();
  const ok = screen.getByRole("button", { name: "Cancelar a comanda" }) as HTMLButtonElement;
  expect(ok.disabled).toBe(true);
  expect(screen.getByText("Para cancelar, escreva o motivo.")).toBeTruthy(); // o cinza diz o porquê
  fireEvent.change(screen.getByLabelText("Motivo do cancelamento (obrigatório)"), { target: { value: "cliente desistiu" } });
  await act(async () => { fireEvent.click(ok); });
  expect(cancelar).toHaveBeenCalledWith("c1", "cliente desistiu");
  expect(onDone).toHaveBeenCalled();
  const [texto, tom, acao] = toast.mock.calls[0] as [string, string, { label: string; onClick: () => void }];
  expect([texto, tom, acao.label]).toEqual(["Comanda 4 · Lia cancelada", "ok", "Desfazer"]);
  await act(async () => { acao.onClick(); });
  expect(desfazer).toHaveBeenCalledWith("c1");
});
