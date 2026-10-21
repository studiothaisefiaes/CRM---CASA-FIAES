// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import AppError from "./error";
import PublicError from "../error";
import { newVersionKnown, resetVersionState } from "@/components/shell/version-state";

beforeEach(() => resetVersionState());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const skew = Object.assign(new Error('Server Action "40ab" was not found on the server.'), { name: "UnrecognizedActionError" });

describe("tela de erro x versão nova (20/10: 'Failed to find Server Action' até dar F5)", () => {
  it("erro de versão: diz que saiu versão nova, com Atualizar (não o 'Algo deu errado' com código)", () => {
    render(<AppError error={skew} retry={() => {}} />);
    expect(screen.getByRole("heading", { name: "Saiu uma versão nova do CRM" })).toBeTruthy();
    expect(screen.getByText(/O que você estava escrevendo fica guardado/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Atualizar" })).toBeTruthy();
    expect(screen.queryByText(/Código do erro/)).toBeNull();
    expect(newVersionKnown()).toBe(true);
  });

  it("fora do sistema (app da profissional, login) também", () => {
    render(<PublicError error={skew} retry={() => {}} />);
    expect(screen.getByRole("button", { name: "Atualizar" })).toBeTruthy();
  });

  it("outro erro continua com 'Tentar de novo' e o código", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<AppError error={Object.assign(new Error("x"), { digest: "abc123" })} retry={() => {}} />);
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
    expect(screen.getByText("abc123")).toBeTruthy();
    expect(newVersionKnown()).toBe(false);
  });
});
