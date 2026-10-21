// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import RootNotFound from "@/app/not-found";
import AppNotFound from "@/app/(app)/not-found";
import AppError from "@/app/(app)/error";
import PublicError from "@/app/error";

afterEach(cleanup);

it("404 (fora do sistema): em português, com a marca e a saída para o Hoje", () => {
  render(<RootNotFound />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Esta página não existe");
  expect(screen.getByText("Casa")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Voltar para o Hoje" }).getAttribute("href")).toBe("/");
  expect(document.body.textContent).not.toMatch(/could not be found|404 This page/i);
});

it("404 dentro do sistema: mesma frase e a mesma saída", () => {
  render(<AppNotFound />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Esta página não existe");
  expect(screen.getByRole("link", { name: "Voltar para o Hoje" }).getAttribute("href")).toBe("/");
});

it("erro inesperado: em português, 'Tentar de novo' chama o retry e há saída para o Hoje", () => {
  const retry = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(<AppError error={Object.assign(new Error("boom"), { digest: "abc123" })} retry={retry} />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Algo deu errado nesta tela");
  fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.getByRole("link", { name: "Voltar para o Hoje" }).getAttribute("href")).toBe("/");
  expect(screen.getByText(/abc123/)).toBeTruthy(); // código para a gestão achar o erro no registro
  expect(document.body.textContent).not.toContain("boom"); // a mensagem técnica não vai para a tela
});

it("erro na parte pública: mesma marca e saída", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(<PublicError error={new Error("x")} retry={() => {}} />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Algo deu errado nesta tela");
  expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
});
