// @vitest-environment jsdom
import { it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QUEUE_STORAGE_KEY, readQueueState, useQueueState } from "./use-queue-state";

/** A lista rolável com `scrollTop` de verdade (no jsdom ele é sempre 0): `top` é onde a pessoa já estava quando o React montou. */
function Lista({ query, top = 0 }: { query: string; top?: number }) {
  const { ref, onScroll } = useQueueState(query);
  return (
    <div data-testid="lista" onScroll={onScroll} ref={(n) => {
      if (n && !(n as unknown as { _fake?: boolean })._fake) {
        let t = top;
        Object.defineProperty(n, "scrollTop", { configurable: true, get: () => t, set: (v: number) => { t = v; } });
        (n as unknown as { _fake?: boolean })._fake = true;
      }
      ref(n as HTMLDivElement | null);
    }} />
  );
}
const lista = (c: ReturnType<typeof render>) => c.getByTestId("lista") as HTMLDivElement;

beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

it("rolou antes da hidratação (celular lento, lista grande): a posição é guardada, não volta ao topo", () => {
  // O HTML do servidor já está rolável; a pessoa rola antes de o React ligar o onScroll. Sem guardar aqui, a volta da conversa cai no topo.
  render(<Lista query="view=todos" top={400} />);
  expect(readQueueState()).toMatchObject({ query: "view=todos", scrollTop: 400 });
  cleanup();
  sessionStorage.clear(); // visão padrão numa aba nova (com outro filtro salvo, quem decide é o QueueRestore)
  render(<Lista query="" top={350} />);
  expect(readQueueState()).toMatchObject({ query: "", scrollTop: 350 });
});

it("voltando à mesma visão, a lista volta à rolagem salva", () => {
  sessionStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify({ query: "view=todos", scrollTop: 900, lead: null }));
  const c = render(<Lista query="view=todos" />);
  expect(lista(c).scrollTop).toBe(900);
});

it("trocar de filtro com a lista montada começa do topo", () => {
  sessionStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify({ query: "view=todos", scrollTop: 900, lead: null }));
  const c = render(<Lista query="view=todos" />);
  c.rerender(<Lista query="view=sem-dono" />);
  expect(lista(c).scrollTop).toBe(0);
  expect(readQueueState()).toMatchObject({ query: "view=sem-dono", scrollTop: 0 });
});
