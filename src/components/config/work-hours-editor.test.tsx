// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusinessHours } from "@/lib/business-hours";

const { setHours } = vi.hoisted(() => ({ setHours: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })) }));
vi.mock("@/app/(app)/config/actions", () => ({ setWorkHoursAction: (...a: unknown[]) => setHours(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { WorkHoursEditor } from "./work-hours-editor";

afterEach(() => { cleanup(); setHours.mockClear(); });

const CASA: BusinessHours = { "0": null, "1": null, "2": ["09:00", "18:00"], "3": ["09:00", "18:00"], "4": ["09:00", "18:00"], "5": ["09:00", "18:00"], "6": ["09:00", "18:00"] };
const ID = "11111111-1111-4111-8111-111111111111";
const week = (over: Record<string, [string, string][] | null>) => ({ "0": null, "1": null, "2": null, "3": null, "4": null, "5": null, "6": null, ...over });

it("sem horário próprio: segue o da Casa; definir um parte do horário da Casa", () => {
  render(<WorkHoursEditor professionalId={ID} name="Ana" value={null} casa={CASA} />);
  expect(screen.getByText("Segue o horário da Casa: ter–sáb, 9h–18h")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Definir horário próprio" }));
  expect(screen.getByRole("switch", { name: "Terça: trabalha" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("switch", { name: "Segunda: trabalha" }).getAttribute("aria-checked")).toBe("false");
  expect((screen.getByLabelText("Terça, das") as HTMLSelectElement).value).toBe("09:00");
  expect((screen.getByLabelText("Terça, às") as HTMLSelectElement).value).toBe("18:00");
});

it("trabalhar num dia em que a Casa não abre pergunta antes de salvar", async () => {
  render(<WorkHoursEditor professionalId={ID} name="Ana" value={null} casa={CASA} />);
  fireEvent.click(screen.getByRole("button", { name: "Definir horário próprio" }));
  fireEvent.click(screen.getByRole("switch", { name: "Segunda: trabalha" }));
  fireEvent.click(screen.getByRole("button", { name: "Salvar horário" }));
  expect(screen.getByText("A Casa não abre na segunda. Ela vai atender mesmo assim?")).toBeTruthy();
  expect(setHours).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Sim, salvar" }));
  await waitFor(() => expect(setHours).toHaveBeenCalledWith(ID, week({
    "1": [["09:00", "18:00"]], "2": [["09:00", "18:00"]], "3": [["09:00", "18:00"]], "4": [["09:00", "18:00"]], "5": [["09:00", "18:00"]], "6": [["09:00", "18:00"]],
  })));
});

it("intervalo vira a segunda faixa; erro de faixa aparece sem salvar", async () => {
  render(<WorkHoursEditor professionalId={ID} name="Ana" value={week({ "2": [["09:00", "18:00"]] })} casa={CASA} />);
  fireEvent.click(screen.getByRole("button", { name: "Terça: adicionar intervalo" }));
  fireEvent.change(screen.getByLabelText("Terça, das"), { target: { value: "09:00" } });
  fireEvent.change(screen.getByLabelText("Terça, às"), { target: { value: "12:00" } });
  fireEvent.change(screen.getByLabelText("Terça, depois do intervalo, das"), { target: { value: "13:00" } });
  fireEvent.change(screen.getByLabelText("Terça, depois do intervalo, às"), { target: { value: "12:30" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar horário" }));
  expect(screen.getByRole("alert").textContent).toBe("Terça, 2ª faixa: o fim precisa ser depois do início.");
  expect(setHours).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Terça, depois do intervalo, às"), { target: { value: "18:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar horário" }));
  await waitFor(() => expect(setHours).toHaveBeenCalledWith(ID, week({ "2": [["09:00", "12:00"], ["13:00", "18:00"]] })));
});

it("'Igual ao da Casa' apaga o horário próprio", async () => {
  render(<WorkHoursEditor professionalId={ID} name="Ana" value={week({ "2": [["10:00", "16:00"]] })} casa={CASA} />);
  expect(screen.getByText("Horário próprio: ter, 10h–16h")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Igual ao da Casa" }));
  await waitFor(() => expect(setHours).toHaveBeenCalledWith(ID, null));
});

it("Casa aberta 24 h: o horário próprio começa às 06:00 (o mais cedo que ele aceita)", () => {
  const dia: [string, string] = ["00:00", "24:00"];
  render(<WorkHoursEditor professionalId={ID} name="Ana" value={null} casa={{ "0": dia, "1": dia, "2": dia, "3": dia, "4": dia, "5": dia, "6": dia }} />);
  fireEvent.click(screen.getByRole("button", { name: "Definir horário próprio" }));
  expect((screen.getByLabelText("Terça, das") as HTMLSelectElement).value).toBe("06:00");
  expect((screen.getByLabelText("Terça, às") as HTMLSelectElement).value).toBe("24:00");
});
