// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PageBack, PageHeader } from "@/components/page-header";
import { SaveButton } from "./save-button";
import { buttonClass } from "./button-styles";
import { Card } from "./card";
import { tabClass } from "./tab-styles";

afterEach(cleanup);

it("PageHeader: um título de página (32 px, 400), ação à direita, abas logo abaixo e a linha de filtros por último", () => {
  render(<PageHeader title="Caixa" subtitle="Caixa de Rita · aberto" actions={<button>Abrir caixa</button>} tabs={<nav aria-label="Abas">abas</nav>}
    toolbar={<span>filtros</span>} back={<PageBack href="/x">Voltar</PageBack>} />);
  const h1 = screen.getByRole("heading", { level: 1, name: "Caixa" });
  expect(h1.className).toContain("text-2xl");
  expect(h1.className).toContain("font-normal");
  const order = ["Voltar", "Caixa", "Abrir caixa", "abas", "filtros"].map((t) => screen.getByText(t));
  for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole("link", { name: /Voltar/ }).getAttribute("href")).toBe("/x");
});

it("botões: três estilos com alturas fixas (32/40/48) e alvo de toque de 44 px", () => {
  expect(buttonClass({ size: "sm" })).toContain("h-8");
  expect(buttonClass({ size: "md" })).toContain("h-10");
  expect(buttonClass({ size: "lg" })).toContain("h-12");
  for (const v of ["primary", "secondary", "ghost", "link", "gold", "danger"] as const) expect(buttonClass({ variant: v })).toContain("pointer-coarse:min-h-11");
  expect(buttonClass({ variant: "secondary" })).toContain("border");
  expect(buttonClass({ variant: "link" })).toContain("text-gold-ink");
  expect(buttonClass({ size: "sm" })).toContain("rounded-[var(--radius-control)]");
});

it("Salvar: sem mudança não há botão cinza, há 'Tudo salvo'; com mudança é o botão preto; bloqueado diz o porquê", () => {
  const { rerender } = render(<SaveButton dirty={false} />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByRole("status").textContent).toBe("Tudo salvo");
  rerender(<SaveButton dirty />);
  const b = screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement;
  expect(b.disabled).toBe(false);
  expect(b.className).toContain("bg-ink");
  rerender(<SaveButton dirty blocked="Escolha um valor de 1 a 48." />);
  expect((screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("alert").textContent).toBe("Escolha um valor de 1 a 48.");
});

it("cartão padrão e aba sublinhada", () => {
  render(<Card title="Regras">x</Card>);
  const card = screen.getByRole("heading", { name: "Regras" }).closest("section")!;
  expect(card.className).toContain("rounded-[var(--radius-card)]");
  expect(card.className).toContain("border-line");
  expect(tabClass(true)).toContain("border-ink");
  expect(tabClass(false)).toContain("border-transparent");
  expect(tabClass(true)).toContain("h-11");
});
