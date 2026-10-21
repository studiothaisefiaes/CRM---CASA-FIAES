// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const push = vi.fn(), replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh() {} }), usePathname: () => "/funil", useSearchParams: () => new URLSearchParams("dono=x&lead=d1"),
}));
// queue-route puxa a lista e as ações do servidor; aqui só interessa o BackToQueue.
vi.mock("./queue-list", () => ({}));
vi.mock("./stage-quick-menu", () => ({}));
vi.mock("./contact-kind-menu", () => ({}));
vi.mock("./bulk-bar", () => ({}));
vi.mock("./queue-selection", () => ({}));
vi.mock("./conversation-opening", () => ({}));
vi.mock("./conversation-cache", () => ({}));
vi.mock("./use-conversation-cache-live", () => ({}));
import { useCloseLead, useOpenLead } from "./open-lead";
import { BackToQueue } from "./queue-route";

afterEach(cleanup);
beforeEach(() => { push.mockClear(); replace.mockClear(); window.history.replaceState(null, "", "/funil?dono=x&lead=d1"); });
const media = (desktop: boolean) => { window.matchMedia = ((q: string) => ({ matches: desktop, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia; };

function Probe({ run }: { run: (open: (id: string) => void, close: () => void) => void }) {
  const open = useOpenLead(), close = useCloseLead();
  return <button onClick={() => run(open, close)}>ir</button>;
}

it("no Quadro, fechar a conversa volta ao Quadro com os filtros", () => {
  media(true);
  render(<Probe run={(_o, c) => c()} />);
  screen.getByRole("button").click();
  expect(push).toHaveBeenCalledWith("/funil?dono=x", { scroll: false });
});

it.each([true, false])("no Quadro, Próximo da fila abre a outra conversa no próprio Quadro (desktop=%s)", (desktop) => {
  media(desktop);
  render(<Probe run={(o) => o("d2")} />);
  screen.getByRole("button").click();
  expect(replace).toHaveBeenCalledWith("/funil?dono=x&lead=d2", { scroll: false });
});

it("no Quadro, o voltar do painel leva ao Quadro, não à Fila", () => {
  render(<BackToQueue compact />);
  const link = screen.getByRole("link", { name: "Voltar para o quadro" });
  expect(link.getAttribute("href")).toBe("/funil?dono=x");
});
