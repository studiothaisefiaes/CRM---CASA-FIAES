// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
import { DailySummary } from "./daily-summary";

afterEach(cleanup);
const props = { text: "Resumo de hoje (terça)\n• Nenhuma conversa nova hoje", links: [], highlight: true, title: "Resumo do dia" };

it("com o atalho, oferece 'Receber todo dia às 19h no meu WhatsApp' para a configuração", () => {
  render(<DailySummary {...props} receiveHref="/config/resumo-whatsapp" />);
  expect((screen.getByRole("link", { name: "Receber todo dia às 19h no meu WhatsApp" }) as HTMLAnchorElement).getAttribute("href")).toBe("/config/resumo-whatsapp");
});
it("sem o atalho (quem não configura o sistema), a oferta não aparece", () => {
  render(<DailySummary {...props} />);
  expect(screen.queryByRole("link", { name: /Receber todo dia/ })).toBeNull();
});
it("o rótulo usa a hora configurada", () => {
  render(<DailySummary {...props} receiveHref="/config/resumo-whatsapp" receiveHour={20} />);
  expect(screen.getByRole("link", { name: "Receber todo dia às 20h no meu WhatsApp" })).toBeTruthy();
});
