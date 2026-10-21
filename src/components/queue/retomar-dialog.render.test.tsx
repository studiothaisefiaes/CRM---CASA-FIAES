// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
vi.mock("@/app/(app)/conversa/actions", () => ({ resumeAction: vi.fn(), bulkResumeAction: vi.fn() }));
vi.mock("@/app/(app)/atendimento/programadas/actions", () => ({ editScheduledAction: vi.fn() }));
vi.mock("@/app/(app)/conversa/ai-actions", () => ({ aiProgramadaAction: vi.fn(), aiProgramadaAvailableAction: vi.fn(async () => ({ ok: true, data: false })) }));
import { RetomarDialog } from "./retomar-dialog";
afterEach(cleanup);

it("Retomar: as respostas prontas aparecem pelo nome legível (o atalho fica de dica), não pelo atalho cru", () => {
  render(<RetomarDialog open onClose={() => {}} dealIds={["d1"]} name="Paula" onDone={() => {}}
    prontas={[{ id: "q1", label: "pos-atendimento", body: "Oi, {primeiro_nome}! Como ficou?" }, { id: "q2", label: "avaliacao", body: "Avalia a gente?" }]} />);
  const chips = screen.getByLabelText("Respostas prontas");
  expect(within(chips).getByRole("button", { name: "Pós-atendimento" }).getAttribute("title")).toBe("/pos-atendimento");
  expect(within(chips).getByRole("button", { name: "Avaliação" })).toBeTruthy();
  expect(within(chips).queryByText("pos-atendimento")).toBeNull();
});
