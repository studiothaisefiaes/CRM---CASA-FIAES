// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { BusinessHours } from "@/lib/business-hours";

vi.mock("@/app/(app)/config/actions", () => ({
  createProfessionalAction: vi.fn(), updateProfessionalAction: vi.fn(), setWorkHoursAction: vi.fn(), setAppearanceAction: vi.fn(),
  setProfessionalServiceAction: vi.fn(), acceptSuggestionsAction: vi.fn(),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
vi.mock("@/app/(app)/config/profissionais/acesso-actions", () => ({ inviteProAction: vi.fn(), regenerateProInviteAction: vi.fn(), revokeProAccessAction: vi.fn(), saveProAppSettingsAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/config/profissionais" }));
import { ProfessionalsEditor } from "./professionals";

afterEach(cleanup);
const CASA: BusinessHours = { "0": null, "1": null, "2": ["09:00", "18:00"], "3": ["09:00", "18:00"], "4": ["09:00", "18:00"], "5": ["09:00", "18:00"], "6": ["09:00", "18:00"] };
const pro = (id: string, name: string, over: Record<string, unknown> = {}) =>
  ({ id, name, fullName: null, role: null, active: true, serviceIds: [] as string[], workHours: null, color: null, agendaPosition: null, photoVersion: null, ...over });
const ITEMS = [pro("p1", "Ana", { role: "Cabeleireira", serviceIds: ["s1"] }), pro("p2", "Antiga", { active: false }), pro("p3", "Bia", { photoVersion: "9" })];
const SERVICES = [{ id: "s1", label: "Corte", category: "Cabelo" }];

it("à esquerda as ativas (foto, nome, 'Cargo · N serviços') e 'Desativadas · N'; sem escolha, a direita pede para escolher", () => {
  render(<ProfessionalsEditor tab="lista" items={ITEMS} services={SERVICES} casa={CASA} suggestions={[]} selectedId={null} />);
  const ativas = screen.getByRole("list", { name: "Profissionais ativas" });
  expect(within(ativas).getAllByRole("link").map((l) => l.getAttribute("aria-label"))).toEqual(["Abrir Ana", "Abrir Bia"]);
  expect(within(ativas).getByText("Cabeleireira · 1 serviço")).toBeTruthy();
  expect(within(ativas).getByRole("link", { name: "Abrir Bia" }).querySelector("img")?.getAttribute("src")).toBe("/api/profissionais/p3/foto?v=9");
  expect(screen.getByText("Desativadas · 1")).toBeTruthy();
  expect(screen.getByRole("link", { name: "+ Adicionar profissional" }).getAttribute("href")).toBe("/config/profissionais?id=nova");
  expect(screen.getByText("Escolha uma profissional na lista")).toBeTruthy();
});

it("com ?id, a ficha dela abre à direita; com ?id=nova, o formulário de adicionar", () => {
  const { rerender } = render(<ProfessionalsEditor tab="lista" items={ITEMS} services={SERVICES} casa={CASA} suggestions={[]} selectedId="p1" />);
  expect(screen.getByRole("region", { name: "Ficha de Ana" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Abrir Ana" }).getAttribute("aria-current")).toBe("page");
  rerender(<ProfessionalsEditor tab="lista" items={ITEMS} services={SERVICES} casa={CASA} suggestions={[]} selectedId="nova" />);
  expect(screen.getByText("Adicionar profissional")).toBeTruthy();
});
