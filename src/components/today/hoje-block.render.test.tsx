// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { HojeBlock } from "./hoje-block";
afterEach(cleanup);

it("bloco do Hoje: título (a região), número, contexto e a prévia; 'Ver todos' abre o painel grande com a lista inteira", () => {
  render(
    <HojeBlock id="teste" title="Agenda de hoje" icon={null} count={5} context="2 confirmados" hidden={2}
      panel={<p>lista inteira</p>} panelPhrase="Todos os horários de hoje.">
      <p>três primeiros</p>
    </HojeBlock>,
  );
  const bloco = screen.getByRole("region", { name: "Agenda de hoje" });
  expect(bloco.textContent).toContain("5");
  expect(bloco.textContent).toContain("2 confirmados");
  expect(bloco.textContent).toContain("três primeiros");
  expect(screen.queryByText("lista inteira")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Ver todos: Agenda de hoje" }));
  const painel = screen.getByRole("dialog", { name: "Agenda de hoje" });
  expect(painel.textContent).toContain("lista inteira");
  expect(painel.textContent).toContain("Todos os horários de hoje.");
});

it("o '+N' mostra quantos ficaram de fora e também abre o painel", () => {
  render(<HojeBlock id="t2" title="Aniversário hoje" icon={null} count={7} hidden={4} panel={<p>as sete</p>}><p>três</p></HojeBlock>);
  fireEvent.click(screen.getByRole("button", { name: "Ver todos: Aniversário hoje" }));
  expect(screen.getByRole("dialog").textContent).toContain("as sete");
  expect(screen.getByText("+4")).toBeTruthy();
});

it("sem painel não há 'Ver todos'; com zero o bloco fica, apagado (data-vazio)", () => {
  render(<HojeBlock id="t3" title="Parados agora" icon={null} count={0}><p>Ninguém parado.</p></HojeBlock>);
  expect(screen.queryByRole("button", { name: /Ver todos/ })).toBeNull();
  expect(screen.getByRole("region", { name: "Parados agora" }).getAttribute("data-vazio")).toBe("sim");
});
