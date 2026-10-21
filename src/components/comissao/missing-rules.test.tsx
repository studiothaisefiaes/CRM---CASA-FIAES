// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const preview = vi.fn();
const apply = vi.fn();
const setCommission = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(app)/caixa/comissao/actions", () => ({ previewReapplyAction: (...a: unknown[]) => preview(...a), applyReapplyAction: (...a: unknown[]) => apply(...a) }));
vi.mock("@/app/(app)/caixa/actions", () => ({ setCommissionAction: (...a: unknown[]) => setCommission(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
import { MissingRules } from "./missing-rules";
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const gap = { professionalId: "p1", professionalName: "Ana", serviceId: "s1", serviceLabel: "Corte", items: 3, baseCents: 18000, hasRuleNow: false };

it("psico r68 #19: diz o que falta e define a regra pelo próprio aviso", async () => {
  setCommission.mockResolvedValue({ ok: true, data: undefined });
  render(<MissingRules gaps={[gap]} from="2026-06-01" to="2026-10-19" canEdit />);
  expect(screen.getByText(/Falta definir a regra de comissão de Ana no serviço Corte/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("% de Ana em Corte"), { target: { value: "40" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Definir regra" })); });
  expect(setCommission).toHaveBeenCalledWith({ professionalId: "p1", serviceId: "s1", bp: 4000 });
});

it("com a regra já definida, oferece aplicar às fechadas com prévia e só grava na confirmação", async () => {
  preview.mockResolvedValue({ ok: true, data: { items: 3, comandas: 3, byProfessional: [{ professionalId: "p1", name: "Ana", items: 3, beforeCents: 0, afterCents: 7200 }] } });
  apply.mockResolvedValue({ ok: true, data: { items: 3, comandas: 3, byProfessional: [] } });
  render(<MissingRules gaps={[{ ...gap, hasRuleNow: true }]} from="2026-06-01" to="2026-10-19" canEdit />);
  expect(screen.queryByRole("button", { name: "Definir regra" })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Ver o que mudaria" })); });
  expect(screen.getByText(/Mudaria 3 itens em 3 comandas/)).toBeTruthy();
  expect(apply).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar e aplicar" })); });
  expect(apply).toHaveBeenCalledWith({ from: "2026-06-01", to: "2026-10-19", professionalId: "p1" });
});
