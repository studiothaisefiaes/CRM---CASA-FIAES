// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const save = vi.hoisted(() => vi.fn(async (_: unknown) => ({ ok: true as const })));
vi.mock("@/app/(app)/config/depois-atendimento/actions", () => ({ saveAfterVisitAction: save }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => () => {} }));
import { AfterVisitSettings } from "./after-visit";
import { AFTER_VISIT_DEFAULTS, type AfterVisitConfig } from "@/lib/after-visit";
import { CASA_AGRADECIMENTO } from "@/lib/casa-texts";

afterEach(() => { cleanup(); save.mockClear(); });

const BASE: AfterVisitConfig = { ...AFTER_VISIT_DEFAULTS, linkGoogle: "https://g.page/r/casa-fiaes/review" };
const radio = (name: string) => screen.getByRole("radio", { name }) as HTMLInputElement;
const next = () => fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

it("uma pergunta por passo, na ordem: o que recebe, quanto tempo depois, o texto com prévia", () => {
  render(<AfterVisitSettings initial={BASE} />);
  expect(screen.getByRole("heading", { name: "O que a cliente recebe depois do atendimento?" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Quanto tempo depois?" })).toBeNull();
  next();
  expect(screen.getByRole("heading", { name: "Quanto tempo depois?" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "O que a cliente recebe depois do atendimento?" })).toBeNull();
  next();
  expect(screen.getByRole("heading", { name: "O que diz a mensagem?" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Prévia" }).textContent).toContain("Oi, Maria! Obrigada por estar com a gente hoje na Casa Fiaes. 💛");
  expect(screen.getByRole("region", { name: "Prévia" }).textContent).toContain("https://g.page/r/casa-fiaes/review");
});

it("nasce desligado: ligar fica desabilitado com 'Ligue pela troca do ChatGuru para o CRM', também a Pesquisa de satisfação", () => {
  render(<AfterVisitSettings initial={BASE} />);
  expect(radio("Nada").checked).toBe(true);
  expect(radio("Agradecimento com o link do Google").disabled).toBe(true);
  expect(radio("Pesquisa de satisfação (nota de 1 a 5; nota alta recebe o link do Google)").disabled).toBe(true);
  expect(screen.getByRole("link", { name: "Ligue pela troca do ChatGuru para o CRM" }).getAttribute("href")).toBe("/config/virada?alvo=depois");
});

it("ligado na Pesquisa de satisfação: o modo aparece marcado e Nada desliga na hora", async () => {
  render(<AfterVisitSettings initial={{ ...BASE, mode: "pesquisa" }} />);
  expect(radio("Pesquisa de satisfação (nota de 1 a 5; nota alta recebe o link do Google)").checked).toBe(true);
  fireEvent.click(radio("Nada"));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ ...BASE, mode: "desligado" }));
});

it("passos da pesquisa: a pergunta, a nota alta e o que acontece com a nota baixa, tudo editável e salvo", async () => {
  render(<AfterVisitSettings initial={BASE} />);
  next(); next(); next();
  expect(screen.getByRole("heading", { name: "O que a Pesquisa de satisfação pergunta?" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Prévia da pesquisa" }).textContent).toContain("Maria, de 1 a 5, como foi seu atendimento hoje na Casa Fiaes?");
  expect(screen.getByRole("region", { name: "Prévia da pesquisa" }).textContent).toContain("5 · Excelente");
  fireEvent.change(screen.getByLabelText("A partir de que nota a cliente recebe o link do Google"), { target: { value: "5" } });
  next();
  expect(screen.getByRole("heading", { name: "E quando a nota é baixa?" })).toBeTruthy();
  expect(screen.getByText(/Nota de 1 a 4/)).toBeTruthy();
  expect(screen.getByRole("region", { name: "Prévia do aviso" }).textContent).toBe("Maria deu nota 2 para Escova com Gilvan. Fale com ela hoje.");
  fireEvent.change(screen.getByLabelText("Aviso para a gestão"), { target: { value: "Nota {nota}: {nome}." } });
  fireEvent.change(screen.getByLabelText("Etiqueta que a cliente recebe"), { target: { value: "Atenção" } });
  expect(screen.getByRole("region", { name: "Prévia do aviso" }).textContent).toBe("Nota 2: Maria.");
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ ...BASE, notaAltaMin: 5, textoNotaBaixa: "Nota {nota}: {nome}.", etiquetaNotaBaixa: "Atenção" }));
  fireEvent.click(screen.getByRole("button", { name: "Usar o texto sugerido" }));
  expect((screen.getByLabelText("Aviso para a gestão") as HTMLTextAreaElement).value).toBe(BASE.textoNotaBaixa);
});

it("salvar os números e o texto mantém o modo; 'Usar o texto da Casa' volta o texto sugerido", async () => {
  render(<AfterVisitSettings initial={{ ...BASE, textoAgradecimento: "Oi, {primeiro_nome}! Valeu." }} />);
  next();
  fireEvent.change(screen.getByLabelText("Minutos depois do atendimento"), { target: { value: "30" } });
  fireEvent.change(screen.getByLabelText("A partir de que hora"), { target: { value: "9" } });
  fireEvent.change(screen.getByLabelText("Até que hora"), { target: { value: "19" } });
  fireEvent.change(screen.getByLabelText("Depois de quantas horas não manda mais"), { target: { value: "16" } }); // pior espera: 30 min + 14 h fechadas = 14 h 30; + 1 h de folga cabe em 16 h
  next();
  expect((screen.getByLabelText("Texto do agradecimento") as HTMLTextAreaElement).value).toBe("Oi, {primeiro_nome}! Valeu.");
  fireEvent.click(screen.getByRole("button", { name: "Usar o texto da Casa" }));
  expect((screen.getByLabelText("Texto do agradecimento") as HTMLTextAreaElement).value).toBe(CASA_AGRADECIMENTO);
  fireEvent.change(screen.getByLabelText("Link da Avaliação no Google"), { target: { value: "https://g.page/r/outro/review" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({
    ...BASE, mode: "desligado", delayMinutes: 30, janelaInicio: 9, janelaFim: 19, horasMax: 16, textoAgradecimento: CASA_AGRADECIMENTO, linkGoogle: "https://g.page/r/outro/review",
  }));
});

it("ligado (depois da Virada): escolher Nada desliga na hora", async () => {
  render(<AfterVisitSettings initial={{ ...BASE, mode: "agradecimento" }} />);
  expect(radio("Agradecimento com o link do Google").checked).toBe(true);
  expect(screen.queryByText("Ligue pela troca do ChatGuru para o CRM")).toBeNull();
  fireEvent.click(radio("Nada"));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ ...BASE, mode: "desligado" }));
});

it("passo 2: combinação que nunca sairia (1.440 min com limite de 24 h) mostra o erro e não salva", async () => {
  render(<AfterVisitSettings initial={BASE} />);
  next();
  fireEvent.change(screen.getByLabelText("Minutos depois do atendimento"), { target: { value: "1440" } });
  expect(screen.getByRole("alert").textContent).toContain("pode levar até 36 h para sair. Aumente o limite para pelo menos 37 h");
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await new Promise((r) => setTimeout(r, 0));
  expect(save).not.toHaveBeenCalled();
});
