// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/(app)/contatos/actions", () => ({ addPersonAction: vi.fn(), mergeContactsAction: vi.fn(), previewMergeAction: vi.fn(), searchMergeTargetsAction: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
import { MergeFlow } from "./merge-flow";
import { PeopleOnNumber } from "./people-on-number";
afterEach(cleanup);

it("r66 #18: sem sugestões, diz 'Nenhuma sugestão' em vez de um 'Ou' solto", () => {
  render(<MergeFlow base={{ id: "a", name: "Ana", hint: "final 1234" }} suspects={[]} />);
  expect(screen.getByText("Nenhuma sugestão. Procure pelo nome ou telefone.")).toBeTruthy();
  expect(screen.queryByText(/^Ou procure/)).toBeNull();
});
it("r66 #20: só ela no número, a ficha mostra um botão discreto (sem caixa nem explicação); com mais gente, a lista", () => {
  render(<PeopleOnNumber contactId="a" people={[{ id: "a", name: "Ana", relation: null, isHolder: true }]} />);
  expect(screen.queryByText("Pessoas neste número")).toBeNull();
  expect(screen.getByRole("button", { name: /Adicionar outra pessoa/ })).toBeTruthy();
  cleanup();
  render(<PeopleOnNumber contactId="a" people={[{ id: "a", name: "Ana", relation: null, isHolder: true }, { id: "b", name: "Bia", relation: "filha", isHolder: false }]} />);
  expect(screen.getByText("Pessoas neste número")).toBeTruthy();
});
