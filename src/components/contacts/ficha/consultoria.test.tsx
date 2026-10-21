// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const saveFichaAnswerAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
const addClientPhotoAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { id: "p9" } }));
const removeClientPhotoAction = vi.fn(async (..._a: unknown[]) => ({ ok: true as const }));
vi.mock("@/app/(app)/contatos/actions", () => ({
  saveFichaAnswerAction: (...a: unknown[]) => saveFichaAnswerAction(...a),
  addClientPhotoAction: (...a: unknown[]) => addClientPhotoAction(...a),
  removeClientPhotoAction: (...a: unknown[]) => removeClientPhotoAction(...a),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/contatos/c1", useRouter: () => ({ refresh, push: vi.fn() }), useSearchParams: () => new URLSearchParams(window.location.search) }));
import { ConsultoriaTab, type ConsultoriaProps } from "./consultoria";
import { ConsultoriaCard } from "./blocks";
import { ToastProvider } from "@/components/ui/toast";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.clearAllMocks(); window.history.replaceState(null, "", "/"); });

const q = (n: number, value: string | string[] | null = null, kind: "texto" | "opcao" | "caixas" | "sim_nao" = "texto") =>
  ({ id: `q${n}`, label: `Pergunta número ${n}?`, kind, options: kind === "opcao" || kind === "caixas" ? ["Um", "Dois"] : [], value });
/** 32 perguntas; as `answered` primeiras já respondidas. */
const anamnese = (answered: number) => Array.from({ length: 32 }, (_, i) => q(i + 1, i < answered ? "ok" : null));
const base = (o: Partial<ConsultoriaProps> = {}): ConsultoriaProps => ({
  contactId: "c1", anamnese: anamnese(18), visits: [], newVisitId: null, photos: [], can: { answer: true, addPhoto: true, removePhoto: true }, ...o,
});
const show = (o: Partial<ConsultoriaProps> = {}) => render(<ToastProvider><ConsultoriaTab {...base(o)} /></ToastProvider>);

it("Anamnese: resumo '18 de 32 respondidas' e botão Continuar; vazio mostra Preencher", () => {
  show();
  expect(screen.getByText("18 de 32 respondidas")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Continuar" })).toBeTruthy();
  cleanup();
  show({ anamnese: anamnese(0) });
  expect(screen.getByText("0 de 32 respondidas")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Preencher" })).toBeTruthy();
});

it("Preencher anamnese mostra UMA pergunta por tela, salva ao avançar e mostra 'x de 32'", async () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  const dlg = screen.getByRole("dialog");
  // Continua na primeira sem resposta (a 19ª), e só ela aparece.
  expect(within(dlg).getByText("Pergunta 19 de 32")).toBeTruthy();
  expect(within(dlg).getByText("Pergunta número 19?")).toBeTruthy();
  expect(within(dlg).queryByText("Pergunta número 20?")).toBeNull();
  expect(within(dlg).queryByText("Pergunta número 18?")).toBeNull();
  fireEvent.change(within(dlg).getByLabelText("Pergunta número 19?"), { target: { value: "Resposta A" } });
  expect(saveFichaAnswerAction).not.toHaveBeenCalled(); // só salva ao avançar
  await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Próxima" })); });
  expect(saveFichaAnswerAction).toHaveBeenCalledWith({ contactId: "c1", questionId: "q19", value: "Resposta A" });
  expect(within(dlg).getByText("Pergunta 20 de 32")).toBeTruthy();
  // Pular não grava nada
  await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Pular" })); });
  expect(saveFichaAnswerAction).toHaveBeenCalledTimes(1);
  expect(within(dlg).getByText("Pergunta 21 de 32")).toBeTruthy();
  // Anterior volta e mostra o que foi digitado
  fireEvent.click(within(dlg).getByRole("button", { name: "Anterior" }));
  fireEvent.click(within(dlg).getByRole("button", { name: "Anterior" }));
  expect((within(dlg).getByLabelText("Pergunta número 19?") as HTMLInputElement).value).toBe("Resposta A");
});

it("erro ao salvar não avança e mostra o motivo; sem mudança não chama o servidor", async () => {
  show({ anamnese: [q(1), q(2, "x")] });
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  const dlg = screen.getByRole("dialog");
  saveFichaAnswerAction.mockResolvedValueOnce({ ok: false, error: "Essa pergunta não está mais em uso." } as never);
  fireEvent.change(within(dlg).getByLabelText("Pergunta número 1?"), { target: { value: "oi" } });
  await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Próxima" })); });
  expect(within(dlg).getByRole("alert").textContent).toContain("não está mais em uso");
  expect(within(dlg).getByText("Pergunta 1 de 2")).toBeTruthy();
  await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Próxima" })); });
  expect(within(dlg).getByText("Pergunta 2 de 2")).toBeTruthy();
  saveFichaAnswerAction.mockClear();
  await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Concluir" })); }); // valor igual ao salvo: nada a gravar
  expect(saveFichaAnswerAction).not.toHaveBeenCalled();
  expect(refresh).toHaveBeenCalled();
});

it("opção, caixas e sim/não gravam o valor escolhido", async () => {
  show({ anamnese: [q(1, null, "opcao"), q(2, null, "caixas"), q(3, null, "sim_nao")] });
  fireEvent.click(screen.getByRole("button", { name: "Preencher" }));
  const dlg = screen.getByRole("dialog");
  fireEvent.click(within(dlg).getByRole("radio", { name: "Dois" }));
  await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Próxima" })); });
  fireEvent.click(within(dlg).getByRole("checkbox", { name: "Um" }));
  fireEvent.click(within(dlg).getByRole("checkbox", { name: "Dois" }));
  await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Próxima" })); });
  fireEvent.click(within(dlg).getByRole("radio", { name: "Não" }));
  await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Concluir" })); });
  expect(saveFichaAnswerAction.mock.calls.map((c) => c[0])).toEqual([
    { contactId: "c1", questionId: "q1", value: "Dois" }, { contactId: "c1", questionId: "q2", value: ["Um", "Dois"] }, { contactId: "c1", questionId: "q3", value: "nao" },
  ]);
});

it("sem fichas.responder não há botão de preencher", () => {
  show({ can: { answer: false, addPhoto: false, removePhoto: false } });
  expect(screen.queryByRole("button", { name: /Preencher|Continuar/ })).toBeNull();
  expect(screen.getByText("18 de 32 respondidas")).toBeTruthy();
});

const visits = [
  { visitId: "v2", day: "2026-10-14", answered: [{ label: "Estilo", value: "Natural" }], fill: [q(50)] },
  { visitId: "v1", day: "2026-08-02", answered: [{ label: "Estilo", value: "Ousado" }, { label: "Cores", value: ["Loiro", "Mel"] }], fill: [q(50)] },
];
it("consultorias por visita navegam com ‹ ›, como no Avec, e 'Ver a última' volta à mais nova", () => {
  show({ visits, newVisitId: "v2" });
  expect(screen.getByText("Visita de 14/10/2026")).toBeTruthy();
  expect(screen.getByText("Natural")).toBeTruthy();
  const prev = screen.getByRole("button", { name: "Visita anterior" }), next = screen.getByRole("button", { name: "Visita seguinte" });
  expect((next as HTMLButtonElement).disabled).toBe(true); // já é a mais nova
  fireEvent.click(prev);
  expect(screen.getByText("Visita de 02/08/2026")).toBeTruthy();
  expect(screen.getByText("Ousado")).toBeTruthy();
  expect(screen.getByText("Loiro, Mel")).toBeTruthy();
  expect((prev as HTMLButtonElement).disabled).toBe(true); // a mais velha
  fireEvent.click(screen.getByRole("button", { name: "Ver a última" }));
  expect(screen.getByText("Visita de 14/10/2026")).toBeTruthy();
});

it("Nova abre a consultoria da visita de hoje (ou da última) com a visita no pedido; sem visita fica desligada", async () => {
  show({ visits, newVisitId: "v2" });
  fireEvent.click(screen.getByRole("button", { name: "Nova" }));
  const dlg = screen.getByRole("dialog");
  expect(within(dlg).getByText("Pergunta 1 de 1")).toBeTruthy();
  fireEvent.change(within(dlg).getByLabelText("Pergunta número 50?"), { target: { value: "x" } });
  await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Concluir" })); });
  expect(saveFichaAnswerAction).toHaveBeenCalledWith({ contactId: "c1", questionId: "q50", visitId: "v2", value: "x" });
  cleanup();
  show({ visits: [], newVisitId: null });
  expect((screen.getByRole("button", { name: "Nova" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/ainda não tem visita/i)).toBeTruthy();
});

const photos = [
  { id: "f1", visitId: "v2", day: "2026-10-14", kind: "antes" as const, url: "/api/contatos/c1/fotos/f1" },
  { id: "f2", visitId: "v2", day: "2026-10-14", kind: "depois" as const, url: "/api/contatos/c1/fotos/f2" },
  { id: "f3", visitId: null, day: null, kind: "antes" as const, url: "/api/contatos/c1/fotos/f3" },
];
it("Fotos de antes e depois agrupadas por visita; apagar pede confirmação", async () => {
  show({ photos });
  expect(screen.getByText("Fotos de antes e depois")).toBeTruthy();
  expect(screen.getByText("Visita de 14/10/2026")).toBeTruthy();
  expect(screen.getByText("Sem visita")).toBeTruthy();
  expect(screen.getByAltText("Antes, visita de 14/10/2026").getAttribute("src")).toBe("/api/contatos/c1/fotos/f1");
  expect(screen.getByAltText("Depois, visita de 14/10/2026")).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: /^Apagar foto/ })[0]);
  expect(removeClientPhotoAction).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Apagar" })); });
  expect(removeClientPhotoAction).toHaveBeenCalledWith("f1");
});

it("Adicionar foto: dois caminhos (câmera e arquivo), sem recorte nem filtro, e envia o arquivo como veio", async () => {
  show({ photos: [], visits, newVisitId: "v2" });
  fireEvent.click(screen.getByRole("button", { name: "Adicionar foto" }));
  const dlg = screen.getByRole("dialog");
  const camera = within(dlg).getByLabelText("Tirar foto") as HTMLInputElement, arquivo = within(dlg).getByLabelText("Escolher arquivo") as HTMLInputElement;
  expect(camera.type).toBe("file"); expect(camera.getAttribute("accept")).toBe("image/*"); expect(camera.getAttribute("capture")).toBe("environment");
  expect(arquivo.type).toBe("file"); expect(arquivo.getAttribute("accept")).toBe("image/*"); expect(arquivo.hasAttribute("capture")).toBe(false); // deixa escolher da galeria
  expect(within(dlg).queryByRole("button", { name: /recort|filtro|edit/i })).toBeNull(); // nada de recorte, filtro ou edição
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "x.jpg", { type: "image/jpeg" });
  fireEvent.change(arquivo, { target: { files: [file] } });
  fireEvent.click(within(dlg).getByRole("radio", { name: "Depois" }));
  await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Enviar" })); });
  const fd = addClientPhotoAction.mock.calls[0][0] as FormData;
  expect(fd.get("contactId")).toBe("c1");
  expect(fd.get("kind")).toBe("depois");
  expect(fd.get("visitId")).toBe("v2");
  expect((fd.get("photo") as File).name).toBe("x.jpg");
});

it("foto maior que o limite configurado é recusada na tela, sem chamar o servidor; falha da chamada vira mensagem", async () => {
  render(<ToastProvider><ConsultoriaTab {...base({ photos: [], maxMb: 1 })} /></ToastProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Adicionar foto" }));
  const dlg = screen.getByRole("dialog");
  const grande = new File([new Uint8Array(1024 * 1024 + 1)], "g.jpg", { type: "image/jpeg" });
  fireEvent.change(within(dlg).getByLabelText("Escolher arquivo"), { target: { files: [grande] } });
  await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Enviar" })); });
  expect(within(dlg).getByRole("alert").textContent).toBe("A foto passa de 1 MB. Escolha uma menor.");
  expect(addClientPhotoAction).not.toHaveBeenCalled();
  fireEvent.change(within(dlg).getByLabelText("Tirar foto"), { target: { files: [new File([new Uint8Array(10)], "p.jpg", { type: "image/jpeg" })] } });
  addClientPhotoAction.mockRejectedValueOnce(new Error("Body exceeded"));
  await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Enviar" })); });
  expect(within(dlg).getByRole("alert").textContent).toContain("Não foi possível enviar a foto");
});

it("'Ver a última' aparece também para quem só vê (sem fichas.responder)", () => {
  show({ visits, newVisitId: "v2", can: { answer: false, addPhoto: false, removePhoto: false } });
  fireEvent.click(screen.getByRole("button", { name: "Visita anterior" }));
  fireEvent.click(screen.getByRole("button", { name: "Ver a última" }));
  expect(screen.getByText("Visita de 14/10/2026")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Nova" })).toBeNull();
});

it("Pular depois de digitar descarta o valor não salvo (ao voltar não parece salvo)", async () => {
  show({ anamnese: [q(1), q(2)] });
  fireEvent.click(screen.getByRole("button", { name: "Preencher" }));
  const dlg = screen.getByRole("dialog");
  fireEvent.change(within(dlg).getByLabelText("Pergunta número 1?"), { target: { value: "rascunho" } });
  await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Pular" })); });
  fireEvent.click(within(dlg).getByRole("button", { name: "Anterior" }));
  expect((within(dlg).getByLabelText("Pergunta número 1?") as HTMLInputElement).value).toBe("");
  expect(saveFichaAnswerAction).not.toHaveBeenCalled();
});

it("função fotos desligada (photos null) esconde a seção; sem permissão esconde os botões", () => {
  show({ photos: null });
  expect(screen.queryByText("Fotos de antes e depois")).toBeNull();
  cleanup();
  show({ photos, can: { answer: true, addPhoto: false, removePhoto: false } });
  expect(screen.getByText("Fotos de antes e depois")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Adicionar foto" })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Apagar foto/ })).toBeNull();
});

it("cartão do Resumo 'Consultoria' abre a aba", () => {
  render(<ConsultoriaCard answered={18} total={32} lastDay="2026-10-14" money />);
  expect(screen.getByText("Consultoria")).toBeTruthy();
  expect(screen.getByText("Anamnese: 18 de 32 respondidas")).toBeTruthy();
  expect(screen.getByText("Última consultoria: 14/10/2026")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Abrir Consultoria/ }));
  expect(window.location.search).toBe("?aba=consultoria");
});
