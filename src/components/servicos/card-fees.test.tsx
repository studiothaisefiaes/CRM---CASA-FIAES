// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const save = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock("@/app/(app)/servicos/actions", () => ({ savePaymentFeeAction: (...a: unknown[]) => save(...a) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { CardFeesEditor } from "./card-fees";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("a grade mostra as 5 bandeiras nas 3 colunas, com o valor salvo em %", () => {
  render(<CardFeesEditor fees={[{ method: "credito", brand: "visa", parcelado: false, feeBp: 243 }, { method: "debito", brand: "elo", parcelado: false, feeBp: 199 }]} />);
  for (const b of ["Visa", "Mastercard", "Elo", "Hipercard", "Amex"]) expect(screen.getByRole("rowheader", { name: b })).toBeTruthy();
  for (const c of ["Débito", "Crédito à vista", "Crédito parcelado"]) expect(screen.getByRole("columnheader", { name: c })).toBeTruthy();
  expect((screen.getByLabelText("Visa Crédito à vista") as HTMLInputElement).value).toBe("2,43");
  expect((screen.getByLabelText("Elo Débito") as HTMLInputElement).value).toBe("1,99");
  expect((screen.getByLabelText("Visa Débito") as HTMLInputElement).value).toBe("");
  expect(screen.queryByRole("rowheader", { name: "Alelo" })).toBeNull();
});

it("salvar '2,43' chama a ação com feeBp 243; limpar apaga; outras bandeiras salvas aparecem", async () => {
  render(<CardFeesEditor fees={[{ method: "credito", brand: "visa", parcelado: false, feeBp: 243 }, { method: "debito", brand: "alelo", parcelado: false, feeBp: 150 }]} />);
  expect(screen.getByRole("rowheader", { name: "Alelo" })).toBeTruthy();
  const el = screen.getByLabelText("Mastercard Crédito à vista");
  fireEvent.change(el, { target: { value: "2,43" } });
  await act(async () => { fireEvent.blur(el); });
  expect(save).toHaveBeenCalledWith({ method: "credito", brand: "mastercard", parcelado: false, feeBp: 243 });
  const v = screen.getByLabelText("Visa Crédito à vista");
  fireEvent.change(v, { target: { value: "" } });
  await act(async () => { fireEvent.blur(v); });
  expect(save).toHaveBeenLastCalledWith({ method: "credito", brand: "visa", parcelado: false, feeBp: null });
});

it("sem permissão a grade é só leitura e não salva", async () => {
  render(<CardFeesEditor canEdit={false} fees={[{ method: "credito", brand: "visa", parcelado: false, feeBp: 243 }]} />);
  const el = screen.getByLabelText("Visa Crédito à vista") as HTMLInputElement;
  expect(el.disabled).toBe(true);
  await act(async () => { fireEvent.blur(el); });
  expect(save).not.toHaveBeenCalled();
});

it("sair de uma célula não trava as outras (Tab segue no teclado)", async () => {
  let release: (v: { ok: boolean }) => void = () => {};
  save.mockImplementationOnce(() => new Promise((r) => { release = r; }));
  render(<CardFeesEditor fees={[]} />);
  const a = screen.getByLabelText("Visa Débito");
  fireEvent.change(a, { target: { value: "1,99" } });
  await act(async () => { fireEvent.blur(a); });
  expect((screen.getByLabelText("Visa Crédito à vista") as HTMLInputElement).disabled).toBe(false);
  expect((screen.getByLabelText("Visa Débito") as HTMLInputElement).disabled).toBe(false);
  await act(async () => { release({ ok: true }); });
});

it("Adicionar bandeira: escolher Alelo põe a linha na grade e salva o débito", async () => {
  render(<CardFeesEditor fees={[]} />);
  expect(screen.queryByRole("rowheader", { name: "Alelo" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Adicionar bandeira"), { target: { value: "alelo" } });
  expect(screen.getByRole("rowheader", { name: "Alelo" })).toBeTruthy();
  const el = screen.getByLabelText("Alelo Débito");
  fireEvent.change(el, { target: { value: "3,5" } });
  await act(async () => { fireEvent.blur(el); });
  expect(save).toHaveBeenCalledWith({ method: "debito", brand: "alelo", parcelado: false, feeBp: 350 });
});
