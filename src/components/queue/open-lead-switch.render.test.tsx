// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
// O `useSearchParams` do Next anda atrás do `history.replaceState` (atualiza numa transição): aqui ele só muda quando o teste manda.
const nav = vi.hoisted(() => ({ sp: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh() {} }), usePathname: () => "/atendimento", useSearchParams: () => new URLSearchParams(nav.sp),
}));
import { useCurrentLead, useOpenLead } from "./open-lead";

const J = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
afterEach(cleanup);
beforeEach(() => {
  nav.sp = "";
  window.history.replaceState(null, "", "/atendimento");
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});

function Probe() {
  const lead = useCurrentLead(null), open = useOpenLead();
  return <><p data-testid="lead">{lead ?? "nenhuma"}</p><button onClick={() => open(J)}>J</button><button onClick={() => open(B)}>B</button></>;
}
const urlLead = () => new URLSearchParams(window.location.search).get("lead");

// QA r58 (avisos-equipe, conversa.spec:114, fila.spec:28): trocar rápido de conversa voltava para a anterior e o ?lead= ficava nela;
// a conversa nova nunca era marcada como lida ("Não lidas" não zerava).
it("troca rápida J → B antes de o Next ver a URL de J: fica em B, a URL vai para B e não volta para J", () => {
  const { rerender } = render(<Probe />);
  act(() => { screen.getByRole("button", { name: "J" }).click(); });
  expect(screen.getByTestId("lead").textContent).toBe(J);
  expect(urlLead()).toBe(J);
  act(() => { screen.getByRole("button", { name: "B" }).click(); });
  expect(screen.getByTestId("lead").textContent).toBe(B);
  expect(urlLead()).toBe(B);
  // O Next alcança a escrita de J (já passada) e depois a de B: a tela nunca volta para J.
  nav.sp = `lead=${J}`; act(() => { rerender(<Probe />); });
  expect(screen.getByTestId("lead").textContent).toBe(B);
  nav.sp = `lead=${B}`; act(() => { rerender(<Probe />); });
  expect(screen.getByTestId("lead").textContent).toBe(B);
  expect(urlLead()).toBe(B);
});

it("a URL mudada por outro motivo (link do sino, voltar) ainda vence a troca pendente", () => {
  const { rerender } = render(<Probe />);
  act(() => { screen.getByRole("button", { name: "J" }).click(); });
  const other = "33333333-3333-4333-8333-333333333333";
  window.history.replaceState(null, "", `/atendimento?lead=${other}`);
  nav.sp = `lead=${other}`; act(() => { rerender(<Probe />); });
  expect(screen.getByTestId("lead").textContent).toBe(other);
});
