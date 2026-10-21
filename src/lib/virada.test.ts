import { describe, expect, it } from "vitest";
import { FUNCOES } from "./funcoes";
import { VIRADA_FALTA, VIRADA_ITENS, VIRADA_PASSOS, viradaKey, viradaPronta } from "./virada";

describe("Virada: a lista do que precisa estar feito antes de ligar", () => {
  it("os itens de cada alvo, na ordem da tela", () => {
    expect(VIRADA_ITENS).toEqual({
      lembrete: ["chatguru_lembrete", "avec_confirmacao", "texto_conferido", "teste_enviado"],
      depois: ["avec_agradecimento", "texto_conferido", "teste_enviado"],
    });
    expect(viradaKey("lembrete")).toBe("virada_lembrete");
    expect(viradaKey("depois")).toBe("virada_depois");
  });

  it("pronta só com todos os itens do alvo marcados (ordem e repetição não importam)", () => {
    expect(viradaPronta("lembrete", [])).toBe(false);
    expect(viradaPronta("lembrete", ["chatguru_lembrete", "avec_confirmacao", "texto_conferido"])).toBe(false);
    expect(viradaPronta("lembrete", ["teste_enviado", "texto_conferido", "avec_confirmacao", "chatguru_lembrete", "teste_enviado"])).toBe(true);
    // O agradecimento do Avec não substitui a confirmação do Avec, nem o contrário.
    expect(viradaPronta("lembrete", ["chatguru_lembrete", "avec_agradecimento", "texto_conferido", "teste_enviado"])).toBe(false);
    expect(viradaPronta("depois", ["avec_agradecimento", "texto_conferido", "teste_enviado"])).toBe(true);
    expect(viradaPronta("depois", ["avec_confirmacao", "texto_conferido", "teste_enviado"])).toBe(false);
  });

  it("a mensagem do servidor quando falta a Virada", () => {
    expect(VIRADA_FALTA.lembrete).toBe("Faça a troca do ChatGuru para o CRM antes de ligar: confirme que o lembrete do ChatGuru e a confirmação do Avec estão desligados.");
    expect(VIRADA_FALTA.depois).toMatch(/^Faça a troca do ChatGuru para o CRM antes de ligar: .*agradecimento do Avec/);
  });

  it("uma pergunta por passo, na ordem do brief", () => {
    expect(VIRADA_ITENS.lembrete.map((i) => VIRADA_PASSOS[i].pergunta)).toEqual([
      "O lembrete do ChatGuru está desligado?",
      "A confirmação por WhatsApp do Avec está desligada?",
      "O texto está certo?",
      "Chegou o teste no seu WhatsApp?",
    ]);
    expect(VIRADA_PASSOS.avec_confirmacao.caminho).toBe("Configurações › Notificações › Envio de WhatsApp para clientes");
    expect(VIRADA_PASSOS.chatguru_lembrete.caminho).toBeTruthy();
  });

  it("a função 'virada' no registro: liga na própria tela e o teste vale por 24 h (1 a 72)", () => {
    const f = FUNCOES.find((x) => x.key === "virada");
    expect(f).toMatchObject({ label: "Troca do ChatGuru para o CRM", enviaParaCliente: false, padraoLigada: true, ligaEm: "/config/virada" });
    expect(f?.params).toEqual([{ key: "horas_validade_teste", label: "O teste vale por", unit: "horas", min: 1, max: 72, default: 24 }]);
  });
});
