// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const { save, saveAvec, refresh } = vi.hoisted(() => ({
  save: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { id: "p" } })), saveAvec: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })), refresh: vi.fn(),
}));
vi.mock("@/app/(app)/servicos/actions", () => ({ saveLoyaltyProgramAction: (...a: unknown[]) => save(...a), saveAvecLoyaltyProgramAction: (...a: unknown[]) => saveAvec(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { LoyaltyPrograms, type LoyaltyProgramView } from "./loyalty-programs";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const S = { corte: "c1111111-1111-4111-8111-111111111111", fin: "f1111111-1111-4111-8111-111111111111", rit: "f2222222-2222-4222-8222-222222222222" };
const SERVICES = [{ id: S.corte, label: "Corte" }, { id: S.fin, label: "Finalização simples" }, { id: S.rit, label: "Ritual de tratamento" }];
const FIEL = "a1111111-1111-4111-8111-111111111111", DEZ = "a2222222-2222-4222-8222-222222222222", ANIV = "a3333333-3333-4333-8333-333333333333";
const PROGRAMS: LoyaltyProgramView[] = [
  { id: FIEL, name: "Fiel da Fiaes", description: null, kind: "contagem", goal: 12, countsServiceIds: null, rewardServiceIds: [S.fin], rewardDiscountBp: 10000, maxDiscountBp: 2000, countsPackageSessions: false, rewardReasonTemplate: "Fidelidade: {programa}", active: true },
  { id: DEZ, name: "10x Você", description: "Acompanhe pelo nosso sistema", kind: "contagem", goal: 10, countsServiceIds: [S.corte], rewardServiceIds: [S.corte], rewardDiscountBp: 10000, maxDiscountBp: null, countsPackageSessions: true, rewardReasonTemplate: "Prêmio do {programa}", active: true },
  { id: ANIV, name: "Aniversário", description: null, kind: "aniversario", goal: null, countsServiceIds: null, rewardServiceIds: [S.rit], rewardDiscountBp: 5000, maxDiscountBp: null, countsPackageSessions: false, rewardReasonTemplate: "Fidelidade: {programa}", active: true },
];
const ui = (o: { canEdit?: boolean; funcaoOn?: boolean; avec?: string | null } = {}) =>
  render(<LoyaltyPrograms programs={PROGRAMS} services={SERVICES} avecProgramId={o.avec ?? null} canEdit={o.canEdit ?? true} funcaoOn={o.funcaoOn ?? true} />);

it("lista os programas da Casa com o que conta e o que é prêmio", () => {
  ui();
  expect(screen.getByText("A cada 12 serviços, um prêmio")).toBeTruthy();
  expect(screen.getByText("Contam: todos os serviços")).toBeTruthy();
  expect(screen.getByText("Prêmio (100% de desconto): Finalização simples")).toBeTruthy();
  expect(screen.getByText("Prêmio no mês do aniversário, uma vez por ano")).toBeTruthy();
});

it("Serviços › Fidelidade: editar quais serviços contam e quais são prêmio", async () => {
  ui();
  fireEvent.click(screen.getByRole("button", { name: "Abrir Fiel da Fiaes" }));
  const sheet = screen.getByRole("dialog", { name: "Fiel da Fiaes" });
  // hoje conta tudo; passa a contar só o Corte e o Ritual
  fireEvent.click(within(sheet).getByRole("radio", { name: "Só alguns" }));
  const contam = within(sheet).getByRole("group", { name: "Serviços que contam" });
  fireEvent.click(within(contam).getByLabelText("Corte"));
  fireEvent.click(within(contam).getByLabelText("Ritual de tratamento"));
  // o prêmio troca de Finalização para Ritual
  const premio = within(sheet).getByRole("group", { name: "Serviços do prêmio" });
  fireEvent.click(within(premio).getByLabelText("Finalização simples"));
  fireEvent.click(within(premio).getByLabelText("Ritual de tratamento"));
  fireEvent.change(within(sheet).getByLabelText("Meta (quantos serviços valem o prêmio)"), { target: { value: "8" } });
  fireEvent.change(within(sheet).getByLabelText("Desconto máximo que ainda pontua (%)"), { target: { value: "12,5" } });
  await act(async () => { fireEvent.click(within(sheet).getByRole("button", { name: "Salvar" })); });
  expect(save).toHaveBeenCalledWith({
    id: FIEL, name: "Fiel da Fiaes", description: null, goal: 8, countsServiceIds: [S.corte, S.rit], rewardServiceIds: [S.rit],
    rewardDiscountBp: 10000, maxDiscountBp: 1250, countsPackageSessions: false, rewardReasonTemplate: "", active: true,
  });
  expect(refresh).toHaveBeenCalled();
});

it("motivo do prêmio com 'Usar o texto sugerido'; erro do servidor fica no painel", async () => {
  save.mockResolvedValueOnce({ ok: false, error: "Já existe um programa com esse nome." } as never);
  ui();
  fireEvent.click(screen.getByRole("button", { name: "Abrir 10x Você" }));
  const sheet = screen.getByRole("dialog", { name: "10x Você" });
  expect((within(sheet).getByLabelText("Motivo do desconto do prêmio") as HTMLInputElement).value).toBe("Prêmio do {programa}");
  fireEvent.click(within(sheet).getByRole("button", { name: "Usar o texto sugerido" }));
  expect((within(sheet).getByLabelText("Motivo do desconto do prêmio") as HTMLInputElement).value).toBe("Fidelidade: {programa}");
  await act(async () => { fireEvent.click(within(sheet).getByRole("button", { name: "Salvar" })); });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: DEZ, rewardReasonTemplate: "", countsPackageSessions: true, countsServiceIds: [S.corte] }));
  expect(within(sheet).getByRole("alert").textContent).toBe("Já existe um programa com esse nome.");
});

it("a recepção só consulta: sem Novo programa, sem Salvar e campos travados", () => {
  ui({ canEdit: false });
  expect(screen.queryByRole("button", { name: "Novo programa" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Abrir Fiel da Fiaes" }));
  const sheet = screen.getByRole("dialog", { name: "Fiel da Fiaes" });
  expect(within(sheet).queryByRole("button", { name: "Salvar" })).toBeNull();
  expect((within(sheet).getByLabelText("Nome") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText("Programa que recebe o saldo") as HTMLSelectElement).disabled).toBe(true);
});

it("função desligada: avisa e trava", () => {
  ui({ funcaoOn: false });
  expect(screen.getByRole("note").textContent).toMatch(/Fidelidade está desligada/);
  expect(screen.queryByRole("button", { name: "Novo programa" })).toBeNull();
  expect((screen.getByLabelText("Programa que recebe o saldo") as HTMLSelectElement).disabled).toBe(true);
});

it("escolher o programa que recebe o saldo do Avec", async () => {
  ui();
  await act(async () => { fireEvent.change(screen.getByLabelText("Programa que recebe o saldo"), { target: { value: DEZ } }); });
  expect(saveAvec).toHaveBeenCalledWith(DEZ);
  const opts = within(screen.getByLabelText("Programa que recebe o saldo")).getAllByRole("option").map((o) => o.textContent);
  expect(opts).toEqual(["Fiel da Fiaes", "10x Você"]); // cada programa de contagem uma vez só
});

it("marca o programa que está valendo e, para quem só consulta, o 'Todos os serviços' não é botão", () => {
  ui({ avec: DEZ, canEdit: false });
  expect((screen.getByLabelText("Programa que recebe o saldo") as HTMLSelectElement).value).toBe(DEZ);
  expect(screen.getByText("Hoje o saldo do Avec entra em 10x Você.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Abrir Fiel da Fiaes" }));
  const sheet = screen.getByRole("dialog", { name: "Fiel da Fiaes" });
  expect(within(sheet).queryByRole("radio")).toBeNull();
  expect(within(sheet).getByText("Todos os serviços")).toBeTruthy();
});
