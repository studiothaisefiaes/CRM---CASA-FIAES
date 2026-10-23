// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { path } = vi.hoisted(() => ({ path: { value: "/" } }));
vi.mock("next/navigation", () => ({ usePathname: () => path.value }));
vi.mock("@/app/(app)/quiet/actions", () => ({ resumeAlertsAction: vi.fn() }));
import { ShellBannersView } from "./connection-banner";

afterEach(() => { cleanup(); path.value = "/"; });
const base = { disconnected: [], quiet: [], workerStoppedSince: null };

it("worker parado: faixa vermelha em toda tela, inclusive Conversas, dizendo o que deixou de funcionar", () => {
  path.value = "/atendimento";
  render(<ShellBannersView banners={{ ...base, workerStoppedSince: new Date(Date.now() - 10 * 60_000).toISOString() }} perms={[]} />);
  const b = screen.getByTestId("banner-worker");
  expect(b.getAttribute("role")).toBe("alert");
  expect(b.textContent).toContain("Avisos de mensagem");
  expect(b.textContent).toContain("há 10 minutos");
  expect(b.textContent).toContain("Avise a gestão");
});

it("worker em dia: sem faixa", () => {
  render(<ShellBannersView banners={base} perms={[]} />);
  expect(screen.queryByTestId("banner-worker")).toBeNull();
});
