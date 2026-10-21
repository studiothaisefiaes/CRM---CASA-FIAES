// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const movementAction = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock("@/app/(app)/caixa/actions", () => ({ movementAction: (...a: unknown[]) => movementAction(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { MovementSheet } from "./movement-sheet";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const PROS = [{ id: "p1", name: "Ana" }];

it("na sangria, 'É vale de uma profissional?' abre a escolha e o campo 'Senha dela'; o vale manda a senha", async () => {
  render(<MovementSheet open onClose={() => {}} kind="sangria" valeProfessionals={PROS} />);
  expect(screen.queryByLabelText("Senha dela")).toBeNull();
  fireEvent.click(screen.getByLabelText("É vale de uma profissional?"));
  fireEvent.change(screen.getByLabelText("Profissional"), { target: { value: "p1" } });
  fireEvent.change(screen.getByLabelText("Valor (R$)"), { target: { value: "50" } });
  fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "vale" } });
  fireEvent.change(screen.getByLabelText("Senha dela"), { target: { value: "ana-123" } });
  fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
  await waitFor(() => expect(movementAction).toHaveBeenCalledWith({ kind: "sangria", valueCents: 5000, reason: "vale", vale: { professionalId: "p1", password: "ana-123" } }));
});

it("sem a lista (liga/desliga, sem permissão) e no suprimento a pergunta não aparece", () => {
  const { rerender } = render(<MovementSheet open onClose={() => {}} kind="sangria" />);
  expect(screen.queryByLabelText("É vale de uma profissional?")).toBeNull();
  rerender(<MovementSheet open onClose={() => {}} kind="suprimento" valeProfessionals={PROS} />);
  expect(screen.queryByLabelText("É vale de uma profissional?")).toBeNull();
});
