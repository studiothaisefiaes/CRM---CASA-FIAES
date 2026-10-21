// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { BusinessHours } from "@/lib/business-hours";

const actions = vi.hoisted(() => ({
  updateProfessionalAction: vi.fn(async () => ({ ok: true })), setAppearanceAction: vi.fn(async () => ({ ok: true })),
  setProfessionalServiceAction: vi.fn(async () => ({ ok: true })), acceptSuggestionsAction: vi.fn(async () => ({ ok: true })),
  setWorkHoursAction: vi.fn(async () => ({ ok: true })), createProfessionalAction: vi.fn(async () => ({ ok: true })),
}));
const toast = vi.fn();
vi.mock("@/app/(app)/config/actions", () => actions);
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/config/profissionais" }));
import { ProfessionalPanel } from "./professional-sheet";

afterEach(() => { cleanup(); toast.mockReset(); Object.values(actions).forEach((f) => f.mockClear()); });
const CASA: BusinessHours = { "0": null, "1": null, "2": ["09:00", "18:00"], "3": ["09:00", "18:00"], "4": ["09:00", "18:00"], "5": ["09:00", "18:00"], "6": ["09:00", "18:00"] };
const PRO = { id: "p1", name: "Ana", fullName: null, role: "Cabeleireira", active: true, serviceIds: ["s1"], workHours: null, color: null, agendaPosition: null, photoVersion: null };
const SERVICES = [
  { id: "s1", label: "Corte", category: "Cabelo" }, { id: "s2", label: "Hidratação", category: "Cabelo" },
  { id: "s3", label: "Manicure", category: "Unhas" }, { id: "s4", label: "Café", category: null },
];
const SUG = [{ professionalId: "p1", professionalName: "Ana", serviceId: "s2", serviceLabel: "Hidratação", count: 7 }, { professionalId: "p1", professionalName: "Ana", serviceId: "s3", serviceLabel: "Manicure", count: 3 }];
const panel = () => render(<ProfessionalPanel pro={PRO} services={SERVICES} casa={CASA} suggestions={SUG} />);

it("ficha em blocos, na ordem da 6.10; sem horário próprio, diz que segue a Casa", () => {
  panel();
  const ficha = screen.getByRole("region", { name: "Ficha de Ana" });
  expect(within(ficha).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Foto", "Dados", "Vínculo", "Dias e horário de trabalho", "Serviços que faz"]);
  expect(within(ficha).getByText(/Segue o horário da Casa: ter–sáb, 9h–18h/)).toBeTruthy();
  expect(within(ficha).getByLabelText("Enviar foto")).toBeTruthy();
});

it("serviços por categoria, com busca e caixa de marcar; marcar grava na hora", async () => {
  panel();
  const bloco = screen.getByRole("region", { name: "Serviços que faz" });
  expect(within(bloco).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Cabelo", "Unhas", "Outros"]);
  fireEvent.change(within(bloco).getByRole("searchbox", { name: "Buscar serviço" }), { target: { value: "hidra" } });
  expect(within(bloco).getAllByRole("checkbox").map((c) => c.getAttribute("aria-label"))).toEqual(["Hidratação"]);
  await act(async () => { fireEvent.click(within(bloco).getByRole("checkbox", { name: "Hidratação" })); });
  expect(actions.setProfessionalServiceAction).toHaveBeenCalledWith("p1", "s2", true);
});

it("o aviso do Avec: 'Ver e marcar' mostra o que ela fez e marca tudo de uma vez", async () => {
  panel();
  expect(screen.getByText("O Avec mostra que ela fez mais 2 serviços este ano")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Ver e marcar" }));
  expect(screen.getByText("fez 7 vezes")).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Marcar todos" })); });
  expect(actions.acceptSuggestionsAction).toHaveBeenCalledWith({ professionalId: "p1" });
});

it("Salvar só com mudança; Desativar com horários marcados oferece 'Desativar mesmo assim' (força e fica registrado)", async () => {
  panel();
  const salvar = screen.getByRole("button", { name: "Salvar" });
  expect((salvar as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Nome na agenda"), { target: { value: "Aninha" } });
  await act(async () => { fireEvent.click(salvar); });
  expect(actions.updateProfessionalAction).toHaveBeenCalledWith("p1", { name: "Aninha", fullName: "", role: "Cabeleireira" });

  actions.updateProfessionalAction.mockResolvedValueOnce({ ok: false, error: "Ela tem 1 horário marcado: remarque antes. Paula 16/10 10:00" } as never);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Desativar" })); });
  expect(toast).toHaveBeenLastCalledWith("Ela tem 1 horário marcado: remarque antes. Paula 16/10 10:00", "error", expect.objectContaining({ label: "Desativar mesmo assim" }));
  const force = toast.mock.calls.at(-1)![2] as { onClick: () => void };
  await act(async () => { force.onClick(); });
  expect(actions.updateProfessionalAction).toHaveBeenLastCalledWith("p1", { active: false, force: true });
});

it("Vínculo: parceira mostra CNPJ e razão social e grava só o que mudou; as outras não pedem CNPJ", async () => {
  panel();
  const bloco = screen.getByRole("region", { name: "Vínculo" });
  expect(within(bloco).queryByLabelText("CNPJ da parceira")).toBeNull();
  fireEvent.click(within(bloco).getByRole("radio", { name: "CLT" }));
  expect(within(bloco).queryByLabelText("CNPJ da parceira")).toBeNull();
  fireEvent.click(within(bloco).getByRole("radio", { name: "Parceira (salão-parceiro)" }));
  fireEvent.change(within(bloco).getByLabelText("CNPJ da parceira"), { target: { value: "11222333000181" } });
  fireEvent.change(within(bloco).getByLabelText("Razão social da parceira"), { target: { value: "Ana Silva ME" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
  expect(actions.updateProfessionalAction).toHaveBeenCalledWith("p1", { name: "Ana", fullName: "", role: "Cabeleireira", bond: "parceira", cnpj: "11222333000181", legalName: "Ana Silva ME" });
});

it("Repasse: Mensal, Quinzenal ou Semanal, só para quem paga a comissão; Salvar grava o período", async () => {
  const { unmount } = panel();
  expect(screen.queryByLabelText("Repasse")).toBeNull();
  unmount();
  render(<ProfessionalPanel pro={{ ...PRO, payoutPeriod: "mensal" }} services={SERVICES} casa={CASA} suggestions={SUG} canPayout />);
  const sel = screen.getByLabelText("Repasse") as HTMLSelectElement;
  expect([...sel.options].map((o) => o.textContent)).toEqual(["Mensal", "Quinzenal", "Semanal (domingo a sábado)"]);
  fireEvent.change(sel, { target: { value: "quinzenal" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar" })); });
  expect(actions.updateProfessionalAction).toHaveBeenCalledWith("p1", expect.objectContaining({ payoutPeriod: "quinzenal" }));
});
