// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ContactAvatar, __resetAvatarObserver } from "./contact-avatar";

type Cb = (entries: { target: Element; isIntersecting: boolean }[]) => void;
const g = globalThis as unknown as { IntersectionObserver?: unknown };
afterEach(() => { cleanup(); delete g.IntersectionObserver; __resetAvatarObserver(); });

function fakeObserver() {
  const state: { cb: Cb | null; opts: IntersectionObserverInit | null; watched: Set<Element> } = { cb: null, opts: null, watched: new Set() };
  g.IntersectionObserver = class {
    constructor(cb: Cb, opts: IntersectionObserverInit) { state.cb = cb; state.opts = opts; }
    observe(el: Element) { state.watched.add(el); }
    unobserve(el: Element) { state.watched.delete(el); }
    disconnect() { state.watched.clear(); }
  };
  return state;
}

it("sem IntersectionObserver: a foto aparece direto (miniatura com a versão)", () => {
  const { container } = render(<ContactAvatar contactId="c1" hasAvatar name="Ana Lima" version="17" size={44} />);
  const img = container.querySelector("img")!;
  expect(img.getAttribute("src")).toBe("/api/avatar/c1?v=17");
  expect(img.getAttribute("width")).toBe("44");
});

it("lista longa: a foto só é pedida quando o item chega perto da tela (margem de 200 px)", () => {
  const io = fakeObserver();
  const { container } = render(<ContactAvatar contactId="c2" hasAvatar name="Bia Santos" version="9" />);
  expect(container.querySelector("img")).toBeNull();
  // Antes de carregar: um círculo neutro do mesmo tamanho (sem as iniciais piscando antes da foto).
  const ph = container.querySelector("[data-foto-pendente]")!;
  expect(ph).not.toBeNull();
  expect(ph.textContent).toBe("");
  expect(io.opts?.rootMargin).toBe("200px");
  expect(io.watched.has(ph)).toBe(true);
  act(() => io.cb!([{ target: ph, isIntersecting: true }]));
  expect(container.querySelector("img")?.getAttribute("src")).toBe("/api/avatar/c2?v=9");
  expect(io.watched.size).toBe(0);
});

it("sem foto: as iniciais, sem observar nada", () => {
  const io = fakeObserver();
  const { container } = render(<ContactAvatar contactId="c3" hasAvatar={false} name="Carla Dias" />);
  expect(container.textContent).toBe("CD");
  expect(io.watched.size).toBe(0);
});

it("a foto de uma cliente falhou: a próxima cliente na mesma tela (cabeçalho) ainda mostra a foto dela", () => {
  const { container, rerender } = render(<ContactAvatar contactId="c4" hasAvatar name="Dora Reis" version="1" />);
  fireEvent.error(container.querySelector("img")!);
  expect(container.textContent).toBe("DR");
  rerender(<ContactAvatar contactId="c5" hasAvatar name="Eva Melo" version="2" />);
  expect(container.querySelector("img")?.getAttribute("src")).toBe("/api/avatar/c5?v=2");
});
