// @vitest-environment jsdom
import { it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";

const { move } = vi.hoisted(() => ({ move: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: undefined })) }));
vi.mock("@/app/(app)/funil/actions", () => ({ moveDealAction: (...a: unknown[]) => move(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { StageQuickMenu } from "./stage-quick-menu";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(cleanup);

const stages = [
  { key: "atendimento", name: "Em conversa", color: "#2f7d4f" }, { key: "aguardando", name: "Aguardando cliente", color: "#b8863f" }, { key: "orcamento", name: "Orçamento", color: "#3b5bdb" },
];

it("lista as etapas com a cor de cada uma, marca a atual e move com um toque", async () => {
  const done = vi.fn();
  render(<StageQuickMenu target={{ dealId: "d1", name: "Ana", stageKey: "atendimento" }} stages={stages} onClose={() => {}} onDone={done} openHref="/atendimento/d1" />);
  expect(screen.getByRole("button", { name: /Em conversa/ }).getAttribute("aria-current")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: /Orçamento/ }));
  await waitFor(() => expect(move).toHaveBeenCalledWith("d1", "orcamento"));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(screen.getByRole("link", { name: /Agendar, fechar venda ou perdido/ }).getAttribute("href")).toBe("/atendimento/d1");
});
