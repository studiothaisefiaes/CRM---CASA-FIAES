import { describe, it, expect } from "vitest";
import { SIGNAL_LABEL, SIGNAL_ORDER, compileMatchers, matchKeywords, matchService, signalsOf } from "./signals";

const inb = (body: string) => [{ direction: "in" as const, body, createdAt: new Date(Date.UTC(2026, 9, 13, 13, 0)) }];
const has = (body: string, s: string) => (signalsOf(inb(body)) as string[]).includes(s);

describe("sinais novos", () => {
  it("pediu desconto", () => {
    expect(has("Tem algum desconto pra pagamento no pix?", "pediu_desconto")).toBe(true);
    expect(has("vocês tem promoção essa semana", "pediu_desconto")).toBe(true);
    expect(has("faz por menos?", "pediu_desconto")).toBe(true);
    expect(has("tem cupom?", "pediu_desconto")).toBe(true);
    expect(has("quero desmarcar", "pediu_desconto")).toBe(false);
  });
  it("quer remarcar ou cancelar", () => {
    expect(has("Preciso remarcar meu horário", "remarcar_cancelar")).toBe(true);
    expect(has("vou ter que desmarcar", "remarcar_cancelar")).toBe(true);
    expect(has("Quero cancelar", "remarcar_cancelar")).toBe(true);
    expect(has("não vou poder ir amanhã", "remarcar_cancelar")).toBe(true);
    expect(has("pode marcar pra mim?", "remarcar_cancelar")).toBe(false);
    expect(has("cancelamento do cartão", "remarcar_cancelar")).toBe(false); // só o verbo conta
  });
  it("reclamação (e 'não gostei do preço' é objeção de preço, não reclamação)", () => {
    expect(has("Não gostei do resultado", "reclamacao")).toBe(true);
    expect(has("fiquei insatisfeita com a escova", "reclamacao")).toBe(true);
    expect(has("ficou ruim, manchou tudo", "reclamacao")).toBe(true);
    expect(has("quero fazer uma reclamação", "reclamacao")).toBe(true);
    expect(has("estragou meu cabelo", "reclamacao")).toBe(true);
    expect(has("não gostei do preço", "reclamacao")).toBe(false);
    expect(has("adorei, ficou lindo", "reclamacao")).toBe(false);
    // falsos positivos achados na revisão
    expect(has("não posso reclamar, ficou ótimo", "reclamacao")).toBe(false);
    expect(has("não tenho do que reclamar", "reclamacao")).toBe(false);
    expect(has("o sol queimou meu cabelo, queria hidratar", "reclamacao")).toBe(false);
    expect(has("Não gostei muito do preço", "reclamacao")).toBe(false);
    expect(has("não gostei dos preços", "reclamacao")).toBe(false);
    expect(has("vocês queimaram meu cabelo", "reclamacao")).toBe(true);
  });
  it("evento", () => {
    expect(has("sou noiva, caso em dezembro", "evento")).toBe(true);
    expect(has("é pra uma formatura", "evento")).toBe(true);
    expect(has("vou ser madrinha de casamento", "evento")).toBe(true);
    expect(has("festa de 15 anos, debutante", "evento")).toBe(true);
    expect(has("estou de noivado marcado", "evento")).toBe(true); // começo da palavra conta (noiva → noivado), como documentado no plano
    expect(has("me caso em março", "evento")).toBe(true);
    // falsos positivos achados na revisão
    expect(has("nesse caso em específico", "evento")).toBe(false);
    expect(has("tenho 15 anos", "evento")).toBe(false);
  });
  it("urgente", () => {
    expect(has("é urgente!", "urgente")).toBe(true);
    expect(has("consegue hoje ainda?", "urgente")).toBe(true);
    expect(has("o quanto antes por favor", "urgente")).toBe(true);
  });
  it("indicação", () => {
    expect(has("A Maria me indicou vocês", "indicacao")).toBe(true);
    expect(has("foi indicação da minha prima", "indicacao")).toBe(true);
    expect(has("me passaram seu contato", "indicacao")).toBe(true);
  });
  it("todo sinal tem rótulo e lugar na ordem; risco primeiro", () => {
    for (const s of SIGNAL_ORDER) expect(SIGNAL_LABEL[s]).toBeTruthy();
    expect(SIGNAL_ORDER.slice(0, 2)).toEqual(["reclamacao", "urgente"]);
  });
});

describe("interesse por serviço", () => {
  const services = [{ id: "1", label: "Corte" }, { id: "2", label: "Coloração" }, { id: "3", label: "Progressiva" }];
  it("casa o nome do serviço como palavra inteira, sem acento nem caixa", () => {
    expect(matchService("quanto fica a COLORACAO?", services)?.label).toBe("Coloração");
    expect(matchService("queria fazer progressiva", services)?.label).toBe("Progressiva");
    expect(matchService("vocês fazem corte?", services)?.label).toBe("Corte");
  });
  it("não casa dentro de outra palavra ('cortesia' não é Corte); sem serviço cadastrado, nada", () => {
    expect(matchService("é cortesia?", services)).toBeNull();
    expect(matchService("oi", [])).toBeNull();
  });
});

describe("palavras-chave da gestão", () => {
  const items = [
    { label: "Mega hair", phrases: ["mega hair", "aplique"], boost: true },
    { label: "Noiva", phrases: ["dia da noiva"], boost: false },
  ];
  it("casa frase inteira, sem acento, caixa ou pontuação", () => {
    expect(matchKeywords("Vocês colocam MEGA-HAIR?", items).map((k) => k.label)).toEqual(["Mega hair"]);
    expect(matchKeywords("queria um aplique!", items).map((k) => k.label)).toEqual(["Mega hair"]);
    expect(matchKeywords("tem pacote dia da noiva?", items).map((k) => k.label)).toEqual(["Noiva"]);
  });
  it("frase parcial dentro de outra palavra não casa", () => {
    expect(matchKeywords("apliquei hidratação", items)).toEqual([]);
  });
});

describe("comparações compiladas uma vez (Fila com muitos leads)", () => {
  it("dão o mesmo resultado que as funções diretas, e palavra-chave não emenda duas mensagens", () => {
    const m = compileMatchers([{ label: "Corte" }, { label: "Coloração" }], [{ label: "Mega hair", phrases: ["mega hair"], boost: true }]);
    expect(m.service(["queria coloracao"])?.label).toBe("Coloração");
    expect(m.service(["é cortesia?"])).toBeNull();
    expect(m.keywords(["vocês colocam MEGA-HAIR?"]).map((k) => k.label)).toEqual(["Mega hair"]);
    expect(m.keywords(["queria um mega", "hair bonito"])).toEqual([]); // frase não atravessa mensagens
  });
});
