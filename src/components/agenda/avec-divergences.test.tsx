// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AvecDivergences } from "./avec-divergences";
import type { AvecRejected } from "@/server/domain/agenda/twins";

afterEach(cleanup);
const rej = (o: Partial<AvecRejected>): AvecRejected => ({ id: "1", reason: "data_fora_do_limite", day: "4676-11-10", hm: "09:00", clientName: "Ana Teste", serviceLabel: "Corte", professionalName: "MAIARA", ...o });

it("separa as recusadas pelo motivo, cada grupo com seu título e sua explicação", () => {
  render(<AvecDivergences items={[]} rejected={[rej({}), rej({ id: "2", reason: "cliente_nao_encontrada", day: "2026-10-05", hm: null, clientName: "Bia Teste", serviceLabel: null, professionalName: null })]} />);
  expect(screen.getByRole("heading", { name: /Data impossível no Avec/ })).toBeTruthy();
  expect(screen.getByRole("heading", { name: /Cliente não encontrada no CRM/ })).toBeTruthy();
  expect(screen.getByText("No Avec: 10/11/4676 às 09:00.")).toBeTruthy();
  expect(screen.getByText("Ficha do Avec, cadastro em 05/10/2026.")).toBeTruthy();
});

it("só cliente não encontrada: não mostra o título de data impossível", () => {
  render(<AvecDivergences items={[]} rejected={[rej({ reason: "cliente_nao_encontrada", day: "2026-10-05", hm: null })]} />);
  expect(screen.queryByRole("heading", { name: /Data impossível/ })).toBeNull();
  expect(screen.getByRole("heading", { name: /Cliente não encontrada no CRM/ })).toBeTruthy();
});
