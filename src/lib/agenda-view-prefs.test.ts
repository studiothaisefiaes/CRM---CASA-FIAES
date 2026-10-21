import { describe, expect, it } from "vitest";
import {
  activeView, clickPro, DEFAULT_CFG, DEFAULT_VIEW_ID, defaultPrefs, deleteView, MAX_VIEWS, moveInOrder, normalizePrefs, orderedIds, patchActive,
  saveAsView, stepRange, visibleIds, visibleRange,
} from "./agenda-view-prefs";

const ALL = ["liv", "hel", "pri", "kat"];

describe("normalizePrefs", () => {
  it("vazio, lixo ou versão antiga viram a visão Padrão", () => {
    for (const raw of [null, undefined, 3, "x", {}, { visoes: [] }, { visoes: [{ id: "a" }] }]) expect(normalizePrefs(raw)).toEqual(defaultPrefs());
  });
  it("campo estranho cai no padrão sem perder o resto; a Padrão volta se sumiu; ativa inválida vira Padrão", () => {
    const p = normalizePrefs({ visoes: [{ id: "cabelo", nome: "Cabelo", cfg: { tam: "enorme", passo: 7, ocultas: ["kat"], card: { serv: true } }, sel: [] }], ativa: "nada" });
    expect(p.visoes.map((v) => v.id)).toEqual([DEFAULT_VIEW_ID, "cabelo"]);
    expect(p.ativa).toBe(DEFAULT_VIEW_ID);
    const c = p.visoes[1].cfg;
    expect(c.tam).toBe("conforto");
    expect(c.passo).toBe(30);
    expect(c.ocultas).toEqual(["kat"]);
    expect(c.card).toEqual({ ...DEFAULT_CFG.card, serv: true });
    expect(c.bloq).toBe(true);
  });
  it("horário visível com menos de 1 h volta para o da Casa", () => {
    const p = normalizePrefs({ visoes: [{ id: DEFAULT_VIEW_ID, nome: "Padrão", cfg: { ...DEFAULT_CFG, ini: 600, fim: 630 }, sel: [] }], ativa: DEFAULT_VIEW_ID });
    expect(activeView(p).cfg.ini).toBeNull();
  });
});

describe("visões", () => {
  it("Personalizar mexe só na visão aberta", () => {
    const base = saveAsView(defaultPrefs(), "Unhas", DEFAULT_CFG, ["kat"]).prefs; // Unhas fica ativa
    const p = patchActive(base, { tam: "grande" });
    expect(p.visoes.find((v) => v.id === "unhas")!.cfg.tam).toBe("grande");
    expect(p.visoes.find((v) => v.id === DEFAULT_VIEW_ID)!.cfg.tam).toBe("conforto");
  });
  it("Salvar como visão: cria com id do nome, vira ativa; o mesmo nome (sem acento) atualiza", () => {
    const a = saveAsView(defaultPrefs(), "  Só a Lívia ", { ...DEFAULT_CFG, tam: "grande" }, ["liv"]);
    expect(a.result).toBe("criada");
    expect(a.prefs.ativa).toBe("so-a-livia");
    expect(activeView(a.prefs)).toMatchObject({ nome: "Só a Lívia", sel: ["liv"] });
    const b = saveAsView(a.prefs, "so a livia", DEFAULT_CFG, []);
    expect(b.result).toBe("atualizada");
    expect(b.prefs.visoes).toHaveLength(2);
    expect(activeView(b.prefs)).toMatchObject({ nome: "Só a Lívia", sel: [], cfg: DEFAULT_CFG });
  });
  it("nome vazio e limite de visões recusam; nome repetido em id ganha sufixo", () => {
    expect(saveAsView(defaultPrefs(), "   ", DEFAULT_CFG, []).result).toBe("nome_vazio");
    let p = defaultPrefs();
    for (let i = 1; i < MAX_VIEWS; i++) p = saveAsView(p, `V${i}`, DEFAULT_CFG, []).prefs;
    expect(saveAsView(p, "Mais uma", DEFAULT_CFG, []).result).toBe("limite");
    const q = saveAsView(saveAsView(defaultPrefs(), "Cabelo!", DEFAULT_CFG, []).prefs, "Cabelo?", DEFAULT_CFG, []);
    expect(q.result).toBe("criada"); // nomes diferentes que dão o mesmo id
    expect(q.prefs.ativa).toBe("cabelo-2");
  });
  it("apagar: a Padrão nunca sai; apagar a ativa volta para a Padrão", () => {
    const p = saveAsView(defaultPrefs(), "Cabelo", DEFAULT_CFG, []).prefs;
    expect(deleteView(p, DEFAULT_VIEW_ID)).toBe(p);
    expect(deleteView(p, "cabelo")).toEqual(defaultPrefs());
  });
});

describe("ordem e quem aparece", () => {
  it("ordem salva primeiro; novas no fim; ids que sumiram são ignorados; ocultas saem da fileira", () => {
    const cfg = { ...DEFAULT_CFG, ordem: ["kat", "velha", "liv"], ocultas: ["hel"] };
    expect(orderedIds(cfg, ALL)).toEqual(["kat", "liv", "hel", "pri"]);
    expect(visibleIds(cfg, ALL)).toEqual(["kat", "liv", "pri"]);
  });
  it("subir/descer e soltar antes de outra", () => {
    expect(moveInOrder(DEFAULT_CFG, ALL, "pri", 0)).toEqual(["pri", "liv", "hel", "kat"]);
    expect(moveInOrder(DEFAULT_CFG, ALL, "liv", { before: "kat" })).toEqual(["hel", "pri", "liv", "kat"]);
  });
  it("clique na foto: só ela, de novo volta para todas; com Juntar soma e tira", () => {
    expect(clickPro([], "liv", false)).toEqual(["liv"]);
    expect(clickPro(["liv"], "liv", false)).toEqual([]);
    expect(clickPro(["liv", "hel"], "liv", false)).toEqual(["liv"]);
    expect(clickPro(["liv"], "hel", true)).toEqual(["liv", "hel"]);
    expect(clickPro(["liv", "hel"], "liv", true)).toEqual(["hel"]);
  });
});

describe("horário visível", () => {
  it("salvo vale; senão o da Casa arredondado; Casa 24 h (ou sem horário) mostra 7h–21h", () => {
    expect(visibleRange({ ...DEFAULT_CFG, ini: 480, fim: 1200 }, { start: 540, end: 1140 })).toEqual({ start: 480, end: 1200 });
    expect(visibleRange(DEFAULT_CFG, { start: 545, end: 1130 })).toEqual({ start: 540, end: 1140 });
    expect(visibleRange(DEFAULT_CFG, { start: 0, end: 1440 })).toEqual({ start: 420, end: 1260 });
    expect(visibleRange(DEFAULT_CFG, null)).toEqual({ start: 420, end: 1260 });
  });
  it("− e + andam 30 min e deixam pelo menos 2 h", () => {
    expect(stepRange({ start: 540, end: 1140 }, "ini", -30)).toEqual({ ini: 510, fim: 1140 });
    expect(stepRange({ start: 540, end: 660 }, "ini", 30)).toEqual({ ini: 540, fim: 660 });
    expect(stepRange({ start: 540, end: 1440 }, "fim", 30)).toEqual({ ini: 540, fim: 1440 });
  });
});
