// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const updateDealAction = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const updateClientDataAction = vi.fn(async (..._a: unknown[]) => ({ ok: true, data: { changed: [] } }));
vi.mock("@/app/(app)/funil/actions", () => ({ updateDealAction: (...a: unknown[]) => updateDealAction(...a) }));
vi.mock("@/app/(app)/conversa/actions", () => ({ updateClientDataAction: (...a: unknown[]) => updateClientDataAction(...a) }));
import type { DealDetail } from "@/server/queries/deal";
import { DadosDialog } from "./dados-dialog";

afterEach(cleanup);
beforeEach(() => { updateDealAction.mockClear(); updateClientDataAction.mockClear(); });

const d = (objectionId: string | null = null) => ({
  deal: { id: "d1", objectionId },
  contact: { id: "c1", name: "Aline Prado", phoneE164: "+5571990000003", email: null, instagram: null, notes: null, nickname: null, phoneAlt: null, hairType: null,
    alertNotes: null, cpf: null, birthDay: null, birthMonth: null, birthYear: null, preferredProfessionalId: null },
  sourceLabel: "Instagram", sources: [], origins: [], professionals: [],
  objections: [{ id: "o1", label: "Preço" }, { id: "o2", label: "Distância" }],
}) as unknown as DealDetail;

it("Objeção: escolher grava na conversa e conta como mudança", async () => {
  const onSaved = vi.fn();
  render(<DadosDialog open onClose={() => {}} d={d()} onSaved={onSaved} setOrigin={async () => true} />);
  fireEvent.change(screen.getByLabelText("Objeção"), { target: { value: "o1" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(1));
  expect(updateDealAction).toHaveBeenCalledWith("d1", { objectionId: "o1" });
});

it("tirar a objeção grava vazio", async () => {
  const onSaved = vi.fn();
  render(<DadosDialog open onClose={() => {}} d={d("o2")} onSaved={onSaved} setOrigin={async () => true} />);
  expect((screen.getByLabelText("Objeção") as HTMLSelectElement).value).toBe("o2");
  fireEvent.change(screen.getByLabelText("Objeção"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(1));
  expect(updateDealAction).toHaveBeenCalledWith("d1", { objectionId: null });
});

it("sem mudar a objeção, não grava", async () => {
  const onSaved = vi.fn();
  render(<DadosDialog open onClose={() => {}} d={d("o2")} onSaved={onSaved} setOrigin={async () => true} />);
  fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(0));
  expect(updateDealAction).not.toHaveBeenCalled();
});
