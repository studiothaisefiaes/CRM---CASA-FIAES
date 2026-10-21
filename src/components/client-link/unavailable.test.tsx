// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { LinkUnavailable } from "./unavailable";
afterEach(cleanup);

it("r66 #8: texto em português, marca da Casa e botão do WhatsApp (sem inglês)", () => {
  const { container } = render(<LinkUnavailable title="Agendamento online indisponível agora" text="Fale com a Casa." waHref="https://wa.me/5571900000000" />);
  expect(screen.getByRole("heading", { name: "Agendamento online indisponível agora" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Falar com a Casa pelo WhatsApp" }).getAttribute("href")).toBe("https://wa.me/5571900000000");
  expect(container.textContent).toContain("Casa Fiaes");
  expect(container.textContent).not.toMatch(/could not be found/i);
});
it("sem WhatsApp cadastrado: só o texto, sem botão quebrado", () => {
  render(<LinkUnavailable title="x" text="y" waHref={null} />);
  expect(screen.queryByRole("link")).toBeNull();
});
