// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { createQuickReplyAction, makeQuickReplyUniversalAction, setQuickReplyIaQuandoAction, attachQuickReplyFileAction } = vi.hoisted(() => ({
  attachQuickReplyFileAction: vi.fn(async (..._a: unknown[]): Promise<{ ok: true; data: { name: string; kind: string } } | { ok: false; error: string }> => ({ ok: true, data: { name: "v.mp4", kind: "video" } })),
  setQuickReplyIaQuandoAction: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })),
  createQuickReplyAction: vi.fn(async (..._a: unknown[]) => ({ ok: true as const, data: { id: "n1" } })),
  makeQuickReplyUniversalAction: vi.fn(async (..._a: unknown[]) => ({ ok: true as const })),
}));
vi.mock("@/app/(app)/config/actions", () => ({ addListItemAction: vi.fn(), setKeywordBoostAction: vi.fn(), updateListItemAction: vi.fn(), saveServiceCycleDaysAction: vi.fn() }));
vi.mock("@/app/(app)/config/listas/actions", () => ({ saveServiceDetailsAction: vi.fn() }));
vi.mock("@/app/(app)/config/respostas/actions", () => ({ attachQuickReplyFileAction, detachQuickReplyFileAction: vi.fn(), setQuickReplyFolderAction: vi.fn(), setQuickReplyIaQuandoAction }));
vi.mock("@/app/(app)/conversa/actions", () => ({ createQuickReplyAction, makeQuickReplyUniversalAction }));
import { ListsEditor } from "./lists";
import { ToastProvider } from "@/components/ui/toast";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const base = { kind: "quick_reply" as const, active: true, cycleDays: null, category: null, attachment: null };
const items = [
  { ...base, id: "u1", label: "boas-vindas", body: "Oi!", ownerName: null },
  { ...base, id: "p1", label: "jeito-sara", body: "Oi, sou a Sara", ownerName: "Sara Lima" },
];

describe("Configurações › Respostas prontas: universal e pessoal", () => {
  it("a pessoal mostra de quem é e a gestão transforma em universal", async () => {
    render(<ListsEditor items={items} />);
    expect(screen.getByText("Só de Sara Lima")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Tornar universal/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Tornar universal /jeito-sara" }));
    await waitFor(() => expect(makeQuickReplyUniversalAction).toHaveBeenCalledWith("p1"));
  });
  it("adicionar: botões de variável, prévia com exemplo e escolha de quem usa", async () => {
    render(<ListsEditor items={items} />);
    const form = screen.getByRole("form", { name: "Adicionar" });
    fireEvent.change(within(form).getByLabelText("Nome"), { target: { value: "confirmar" } });
    const body = within(form).getByLabelText("Texto da resposta") as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: "Oi, " } });
    body.setSelectionRange(4, 4);
    fireEvent.click(within(form).getByRole("button", { name: "Primeiro nome" }));
    expect(body.value).toBe("Oi, {primeiro_nome}");
    expect(within(form).getByTestId("previa-resposta").textContent).toBe("Oi, Ana");
    fireEvent.click(within(form).getByLabelText(/Só minha/));
    fireEvent.click(within(form).getByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(createQuickReplyAction).toHaveBeenCalledWith({ label: "confirmar", body: "Oi, {primeiro_nome}", scope: "minha", folder: null }));
  });
});

describe("Configurações › Respostas prontas: foto/vídeo com legenda e \"A IA indica quando…\" (24/10)", () => {
  const video = { ...base, id: "v1", label: "metodo-fiaes", body: "Assista!", ownerName: null, attachment: { name: "metodo.mp4", kind: "video" }, iaQuando: "a cliente perguntar sobre o Método Fiaes" };
  const pdf = { ...base, id: "d1", label: "tabela", body: "Segue", ownerName: null, attachment: { name: "tabela.pdf", kind: "document" } };
  const pessoal = { ...base, id: "p2", label: "meu-video", body: "Oi", ownerName: "Sara Lima", attachment: { name: "v.mp4", kind: "video" } };
  it("explica que foto e vídeo vão com o texto como legenda, embaixo", () => {
    render(<ListsEditor items={[video]} />);
    expect(screen.getByText(/Foto e vídeo vão com o texto como legenda, embaixo/)).toBeTruthy();
  });
  it("a gestão vê o campo só na universal com foto/vídeo e grava ao sair do campo", async () => {
    render(<ListsEditor items={[video, pdf, pessoal]} canManageIa />);
    const field = screen.getByLabelText("A IA indica /metodo-fiaes quando…") as HTMLInputElement;
    expect(field.value).toBe("a cliente perguntar sobre o Método Fiaes");
    expect(screen.queryByLabelText("A IA indica /tabela quando…")).toBeNull();
    expect(screen.queryByLabelText("A IA indica /meu-video quando…")).toBeNull();
    fireEvent.change(field, { target: { value: "perguntarem do Método Fiaes" } });
    fireEvent.blur(field);
    await waitFor(() => expect(setQuickReplyIaQuandoAction).toHaveBeenCalledWith("v1", "perguntarem do Método Fiaes"));
  });
  it("quem não é da gestão não vê o campo", () => {
    render(<ListsEditor items={[video]} />);
    expect(screen.queryByLabelText("A IA indica /metodo-fiaes quando…")).toBeNull();
  });
});

describe("Configurações › Respostas prontas: subir o vídeo (50 MB leva tempo no balcão)", () => {
  const MB = 1024 * 1024;
  const item = { ...base, id: "u9", label: "metodo-fiaes", body: "Assista!", ownerName: null };
  const pick = (name: string, type: string, size: number) => {
    const f = new File(["x"], name, { type });
    Object.defineProperty(f, "size", { value: size });
    fireEvent.change(screen.getByLabelText("Arquivo de /metodo-fiaes"), { target: { files: [f] } });
  };

  it("vídeo acima de 64 MB (ou outro arquivo acima de 16 MB) é recusado na hora, sem subir nada", async () => {
    render(<ToastProvider><ListsEditor items={[item]} /></ToastProvider>);
    pick("metodo.mov", "video/quicktime", 70 * MB);
    expect((await screen.findByRole("alert")).textContent).toContain("O vídeo passa de 64 MB. Corte um pedaço e tente de novo.");
    cleanup();
    render(<ToastProvider><ListsEditor items={[item]} /></ToastProvider>);
    pick("tabela.pdf", "application/pdf", 20 * MB);
    expect((await screen.findByRole("alert")).textContent).toContain("O arquivo passa de 16 MB. Escolha um menor.");
    expect(attachQuickReplyFileAction).not.toHaveBeenCalled();
  });

  it("enquanto sobe e comprime, a tela diz o que está acontecendo; no fim, \"Anexo salvo\"", async () => {
    let done!: (v: { ok: true; data: { name: string; kind: string } }) => void;
    attachQuickReplyFileAction.mockImplementationOnce(() => new Promise((r) => { done = r; }));
    render(<ToastProvider><ListsEditor items={[item]} /></ToastProvider>);
    pick("metodo.mp4", "video/mp4", 50 * MB);
    expect((await screen.findByText(/Enviando o vídeo e deixando mais leve/)).textContent).toContain("Não feche esta tela");
    done({ ok: true, data: { name: "metodo.mp4", kind: "video" } });
    await waitFor(() => expect(screen.queryByText(/Enviando o vídeo e deixando mais leve/)).toBeNull());
    expect(await screen.findByText("Anexo salvo")).toBeTruthy();
  });

  it("a internet caiu no meio (a ação nem respondeu): erro claro, sem quebrar a tela", async () => {
    attachQuickReplyFileAction.mockImplementationOnce(async () => { throw new Error("Failed to fetch"); });
    render(<ToastProvider><ListsEditor items={[item]} /></ToastProvider>);
    pick("metodo.mp4", "video/mp4", 30 * MB);
    expect((await screen.findByRole("alert")).textContent).toContain("Não deu para subir o arquivo. Confira a internet e tente de novo.");
    expect(screen.queryByText(/Enviando o vídeo/)).toBeNull();
  });
});
