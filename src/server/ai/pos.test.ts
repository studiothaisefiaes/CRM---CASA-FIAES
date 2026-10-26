import { describe, expect, it } from "vitest";
import { semAntesDoValor, semEscapes, semJuvenil, semCumprimento, metodoComMarca, pareceIlegivel, pareceRobo, posProcessar, semArtigoNaThaise, semArtigoNosNomes, semPromessaDeRetorno, umaPerguntaSo, vaiVerificar, garantirHorario } from "./pos";

describe("Thaise sem artigo", () => {
  it.each([
    ["Vou ver a agenda da Thaise Fiaes.", "Vou ver a agenda de Thaise Fiaes."],
    ["A avaliação é com a Thaise.", "A avaliação é com Thaise."],
    ["Com a Thaise Fiaes, o corte é R$ 450,00.", "Com Thaise Fiaes, o corte é R$ 450,00."],
    ["Da Thaise você vai gostar.", "De Thaise você vai gostar."],
    ["Na Thaise tem horário.", "Em Thaise tem horário."],
    ["O corte é feito pela Thaise.", "O corte é feito por Thaise."],
    ["Pela Thaise Fiaes é diferente.", "Por Thaise Fiaes é diferente."],
    ["A Thaise está viajando.", "Thaise está viajando."],
    ["Quem avalia é a Thaise Fiaes.", "Quem avalia é Thaise Fiaes."],
    ["Vou perguntar para a Thaise.", "Vou perguntar para Thaise."],
    ["Mandei à Thaise.", "Mandei a Thaise."],
    ["com a Thaíse amanhã", "com Thaíse amanhã"],
  ])("%s", (a, b) => expect(semArtigoNaThaise(a)).toBe(b));

  it("não mexe no que não é artigo antes de Thaise", () => {
    for (const t of ["Thaise Fiaes é a nossa Diretora Técnica.", "A avaliação é com Thaise Fiaes.", "Fala com a Cati.", "Pegada a Thaisa", "nada a ver"]) expect(semArtigoNaThaise(t)).toBe(t);
  });
});

describe("Método Fiaes®", () => {
  it.each([
    ["O Método Fiaes preserva o comprimento.", "O Método Fiaes® preserva o comprimento."],
    ["o metodo fiaes é seguro", "o método Fiaes® é seguro"],
    ["Método Fiaes® e Método Fiaes ®", "Método Fiaes® e Método Fiaes®"],
    ["Manutenção do Método Fiaes(R).", "Manutenção do Método Fiaes®."],
  ])("%s", (a, b) => expect(metodoComMarca(a)).toBe(b));
  it("não duplica e não mexe em outro texto", () => {
    for (const t of ["O Método Fiaes® preserva.", "Somos a Casa Fiaes.", "um método novo"]) expect(metodoComMarca(t)).toBe(t);
  });
});

describe("promessa de retorno", () => {
  it.each([
    ["Vou verificar a agenda para hoje e já te retorno com as opções.", "Vou verificar a agenda para hoje."],
    ["Vou verificar a agenda e te retorno ainda hoje. Você prefere manhã ou tarde?", "Vou verificar a agenda. Você prefere manhã ou tarde?"],
    ["Hoje não tenho horário confirmado aqui, então vou verificar e te retorno com as opções.", "Hoje não tenho horário confirmado aqui, então vou verificar."],
    ["Já te retorno!", "Vou ver isso para você!"],
    ["Em instantes te respondo.", "Vou ver isso para você."],
    ["Já já te retorno, tá bom?", "Vou ver isso para você, tá bom?"],
    ["Recebi suas fotos, te retorno em breve.", "Recebi suas fotos, vou ver isso para você."],
    ["Assim que eu tiver a resposta, te retorno.", "Vou ver isso para você."],
    ["Vou confirmar com a equipe e te aviso ainda hoje.", "Vou confirmar com a equipe."],
    ["Vou ver com ela e já te aviso.", "Vou ver com ela."],
    ["Eu vou verificar a agenda e te passo a próxima data disponível.", "Eu vou verificar a agenda."],
    ["Vou encaminhar para a Cati, ela vai te retornar.", "Vou encaminhar para a Cati."],
    ["Retorno em instantes com os valores.", "Vou ver isso para você."],
    ["Oi! Vou checar e volto já.", "Oi! Vou checar."],
    ["Vou verificar a agenda da quinta, minha flor, e já te passo os horários disponíveis 💛", "Vou verificar a agenda da quinta, minha flor 💛"],
    ["Ainda estou conferindo. Assim que eu tiver as opções, te envio por aqui 💛", "Ainda estou conferindo. 💛"], // "estou conferindo" já diz o que a Casa faz
    ["Vou verificar a agenda do Gilvan. Assim que eu confirmar um horário, te aviso por aqui 💛", "Vou verificar a agenda do Gilvan. 💛"],
    ["Estou confirmando o valor. Assim que tiver a informação, te envio por aqui 💛 Mais alguma dúvida?", "Estou confirmando o valor. Vou ver isso para você 💛 Mais alguma dúvida?"],
  ])("%s", (a, b) => expect(semPromessaDeRetorno(a)).toBe(b));

  it("não altera o que não casa", () => {
    for (const t of [
      "Vou verificar a agenda para você.",
      "Já te mando a localização 😊",
      "O retorno já está incluso no valor.",
      "Te passo o endereço: Alameda das Seringueiras, 44.",
      "A manutenção tem retorno em 90 dias.",
      "Parte do retorno é na avaliação.",
      "Posso te responder por aqui mesmo?",
      "Vou te enviar um vídeo, quando puder dê uma olhadinha.",
    ]) expect(semPromessaDeRetorno(t)).toBe(t);
  });
});

describe("uma pergunta só", () => {
  it("fica só a última pergunta", () => {
    expect(umaPerguntaSo("Para hoje temos horário. Quer que eu veja um horário com ela? Você prefere manhã ou tarde?")).toBe("Para hoje temos horário. Você prefere manhã ou tarde?");
    expect(umaPerguntaSo("Tenho terça às 15h. Prefere esse? Posso reservar pra você? 💛")).toBe("Tenho terça às 15h. Posso reservar pra você? 💛");
    expect(umaPerguntaSo("Já conhece o Método? Ele preserva o comprimento.\nQuer que eu te conte como é a avaliação?")).toBe("Ele preserva o comprimento.\nQuer que eu te conte como é a avaliação?");
    expect(umaPerguntaSo("Quer saber mais? Posso reservar?")).toBe("Posso reservar?");
  });
  it("o \"Tudo bem?\" do cumprimento fica", () => {
    const t = "Oii, Mary! Tudo bem? Que bom que você chamou a gente! Me conta, o que mais te incomoda hoje no seu cabelo?";
    expect(umaPerguntaSo(t)).toBe(t);
    expect(umaPerguntaSo("Oii, Val! Tudo bem? Quer marcar? Prefere manhã ou tarde?")).toBe("Oii, Val! Tudo bem? Prefere manhã ou tarde?");
  });
  it("com 0 ou 1 pergunta, nada muda", () => {
    for (const t of ["Combinado! Até sexta.", "O corte é R$ 120,00. Posso reservar?", "Valor: R$ 1.158,00. Quer que eu veja?"]) expect(umaPerguntaSo(t)).toBe(t);
  });
});

describe("texto embaralhado", () => {
  it.each([
    ['{"resumo": "quer preço", "sugestao": "Oi'],
    ['Oi! "sugestao": "texto"'],
    ["Oii Ana!!! vvvvvvvvvvvvvv tudo bem"],
    ["xkcd brrr pfft grrr mrrr tsss Oi"],
    ["casa casa casa casa casa"],
    ["Hello! Thanks for reaching out, we will get back to you with the price for your hair."],
    ["Здравствуйте, спасибо за сообщение, мы скоро ответим"],
    ["Oi �� tudo � bem"],
  ])("%s", (t) => expect(pareceIlegivel(t)).toBe(true));

  it("texto normal da Casa passa", () => {
    for (const t of [
      "Oiiii! Que bom ter você por aqui 💛",
      "Oii, Karina! Tudo bem? Para a manutenção do Método Fiaes®, tenho terça, 21/10, às 9h com Ilma. Posso reservar pra você?",
      "Perfeito, Alê! Amanhã às 12h, fica bom para sua avaliação com Thaise Fiaes?",
      "Pix, cartão de crédito e débito. Parcelamos em até 3x sem juros a partir de R$ 400,00.",
      "kkkk que bom! 😍",
      "Ok!",
    ]) expect(pareceIlegivel(t)).toBe(false);
  });
});

describe("posProcessar", () => {
  it("aplica tudo junto", () => {
    expect(posProcessar("Oii, Val! Tudo bem? Vou verificar a agenda da Thaise Fiaes para hoje e já te retorno com as opções. Conhece o Metodo Fiaes? Você prefere manhã ou tarde?"))
      .toBe("Oi, Val! Tudo bem? Vou verificar a agenda de Thaise Fiaes para hoje. Você prefere manhã ou tarde?"); // "Oii" vira "Oi" (semJuvenil)
  });
  it("texto bom volta igual (mesma referência)", () => {
    const t = "Oi, Mary! Tudo bem? O Método Fiaes® preserva o comprimento. Quer que eu te conte como é a avaliação com Thaise Fiaes?";
    expect(posProcessar(t)).toBe(t);
  });
  it("mantém o {primeiro_nome} do lote", () => {
    expect(posProcessar("Oii, {primeiro_nome}! A Thaise volta dia 07/10. Quer reservar?")).toBe("Oi, {primeiro_nome}! Thaise volta dia 07/10. Quer reservar?");
  });
});

describe("sem artigo antes de QUALQUER profissional ou da equipe", () => {
  const NOMES = ["MAIARA", "Cati", "fabiana santos", "JACKSON", "Gilvan", "Casa", "Al"];
  it.each([
    ["Posso marcar com a Maiara?", "Posso marcar com Maiara?"],
    ["É a agenda da Cati.", "É a agenda de Cati."],
    ["Feito pela Fabiana.", "Feito por Fabiana."],
    ["O Jackson faz o corte.", "Jackson faz o corte."],
    ["A agenda do Gilvan e com o Gilvan.", "A agenda de Gilvan e com Gilvan."],
    ["Na Maiara tem vaga e no Jackson também.", "Em Maiara tem vaga e em Jackson também."],
    ["Vou passar para a Cati e pro... para o Jackson.", "Vou passar para Cati e pro... para Jackson."],
    ["Mandei ao Jackson e à Maiara.", "Mandei a Jackson e a Maiara."],
    ["Aqui é a Cati, da Casa Fiaes.", "Aqui é Cati, da Casa Fiaes."],
    ["Às 9h com a Thaise Fiaes.", "Às 9h com Thaise Fiaes."],
  ])("%s", (a, b) => expect(semArtigoNosNomes(a, NOMES)).toBe(b));
  it("não mexe em quem não está na lista, em minúscula nem em palavra comum", () => {
    for (const t of ["Fala com a Bruna.", "a cati", "Bem-vinda à Casa Fiaes!", "Com o Alisamento", "o Gilvanildo chegou", "da Maiaras"]) expect(semArtigoNosNomes(t, NOMES)).toBe(t);
  });
  it("posProcessar recebe os nomes", () => {
    expect(posProcessar("Tenho terça às 9h com a Maiara. Posso reservar?", ["Maiara"])).toBe("Tenho terça às 9h com Maiara. Posso reservar?");
    expect(posProcessar("Tenho terça às 9h com a Maiara. Posso reservar?")).toBe("Tenho terça às 9h com a Maiara. Posso reservar?");
  });
});

describe("mensagem de robô / propaganda de empresa", () => {
  it("caso 1 (Claro: faturas, boleto, linha digitável, protocolo)", () => {
    expect(pareceRobo(["Aguarde um momento... Vou buscar suas faturas em aberto. ⏳", "Para pagar entre e busque no seu banco a opção de *pagar boleto com linha digitável.* Cole o código copiado e realize o pagamento. Não precisa enviar o comprovante. A compensação do pagamento é feita em até 3 dias úteis. ✨", "Aqui está o protocolo do seu serviço 2[telefone]. A Claro agradece!"])).toBe(true);
    expect(pareceRobo(["Oferta exclusiva! Clique aqui: https://promo.exemplo.com para garantir sua promoção"])).toBe(true);
  });
  it("cliente de verdade não é robô", () => {
    for (const t of [["Posso pagar com boleto?"], ["Qual o protocolo para remarcar?"], ["Tem horário amanhã?", "Mandei o comprovante do pagamento"], ["Vi a promoção no Instagram, ainda vale?"]]) expect(pareceRobo(t), t.join(" / ")).toBe(false);
  });
});

describe("vaiVerificar: 'vou verificar' e equivalentes (avaliação real 17/10)", () => {
  it.each([
    "Sobre o corte com Jackson: amanhã à tarde ainda não tenho um horário confirmado na agenda, então vou verificar e te aviso.", // P1
    "Bruna, entendi o imprevisto, imagina! Vou verificar a agenda das 12h de hoje com a equipe.", // P2
    "Vou verificar com Gilvan se consigo deixar o teste e a realização no mesmo dia para você, tudo bem?", // P3
    "Vamos verificar o seu cancelamento com a equipe.",
    "Vou ver isso para você!", // o que o próprio pós-processamento escrevia no lugar de "já te retorno"
    "Deixa eu ver a agenda pra você.",
    "Vou dar uma olhada na agenda.",
    "Vou conferir com Thaise.",
    "Já te retorno com as opções.",
  ])("%s", (t) => expect(vaiVerificar(t)).toBe(true));
  it.each(["Tenho quarta, 21/10, às 9h com Gilvan.", "Te vejo quarta!", "Vou te ver quarta!", "Você vai ver o resultado já na primeira sessão.", "Vou reservar pra você."])(
    "não é: %s", (t) => expect(vaiVerificar(t)).toBe(false));
});

describe("garantirHorario: com horário livre e pedido de horário, a sugestão sempre traz um horário concreto (sem 'vou verificar')", () => {
  const HOJE = "2026-10-16"; // sexta (o dia da avaliação real)
  const op = (id: string, day: string, time: string, pro: string) =>
    ({ id, day, time, professionalId: `p-${pro.toLowerCase().split(" ")[0]}`, professionalName: pro, serviceId: "s", serviceLabel: "Luzes e Mechas", durationMin: 60, origem: "lista" as const });
  const OPS = [op("h1", "2026-10-17", "09:00", "MARILIA"), op("h2", "2026-10-17", "15:00", "MARILIA"), op("h3", "2026-10-20", "09:00", "JAMILLE"),
    op("h4", "2026-10-21", "12:00", "JAMILLE"), op("h5", "2026-10-21", "09:00", "GILVAN"), op("h6", "2026-10-22", "14:30", "THAISE FIAES")];
  const g = (t: string, textosCliente: string[], extra: Partial<Parameters<typeof garantirHorario>[1]> = {}) =>
    garantirHorario(t, { opcoes: OPS, pediu: true, textosCliente, hoje: HOJE, ...extra });
  const perguntas = (t: string) => (t.match(/\?/g) ?? []).length;

  it("coerência (20/10): a IA pede outra coisa (fotos) sem adiar: a pergunta dela fica; ela pediu um dia sem opção: nada é acrescentado", () => {
    const fotos = "O valor do Método é personalizado. Pode me enviar as fotos atuais e a referência? 💛";
    expect(g(fotos, ["quero marcar e saber o valor"]).trocou).toBe(false);
    const sabado = "Que bom que você vem no dia 24! Quer que eu veja um horário nesse dia para você?";
    expect(g(sabado, ["vou no dia 24/10, quero marcar"]).trocou).toBe(false);
    expect(g("Tenho horários sim! Qual período prefere?", ["tem horário pra luzes?"]).horario?.id).toBe("h1");
  });
  it("coerência (20/10): o que fica já diz que não há horário ou passa para a equipe → nada é acrescentado (a proposta contradiria a mensagem)", () => {
    const enc = "Sinto muito que você esteja doente, melhoras! Vou encaminhar a remarcação para a equipe ver o melhor dia para você 💛";
    expect(g(enc, ["Vou precisar remarcar amanhã"])).toEqual({ texto: enc, horario: null, trocou: false });
    const fechada = "Na segunda semana a agenda dela está fechada, então não consigo confirmar um horário com ela agora.";
    expect(g(fechada, ["pode ser na segunda semana"]).trocou).toBe(false);
  });

  it("P1 (Joaquim): 'ainda não tenho… então vou verificar e te aviso' sai; a proposta segue o dia e o período pedidos; uma pergunta só, no fim", () => {
    const r = g("Oii, Joaquim! Tudo bem? 💛 O Método Fiaes® preserva o comprimento. Sobre o corte com Jackson: amanhã à tarde ainda não tenho um horário confirmado na agenda, então vou verificar e te aviso. Você tem preferência de horário? Me envia também 2 ou 3 fotos.",
      ["Boa tarde queria saber como funciona o metodo fiaes e queria marcar um corte de cabelo com jackson amanha a tarde."]);
    expect(r.texto).toBe("Oii, Joaquim! Tudo bem? 💛 O Método Fiaes® preserva o comprimento. Me envia também 2 ou 3 fotos. Tenho sábado, 17/10, às 15h com Marilia. Posso reservar pra você?");
    expect(r.horario?.id).toBe("h2");
    expect(r.trocou).toBe(true);
    expect(vaiVerificar(r.texto)).toBe(false);
    expect(perguntas(r.texto)).toBe(2); // "Tudo bem?" do cumprimento + a proposta
  });

  it("P2 (Bruna): 'Vou verificar a agenda das 12h de hoje' sai; a hora pedida (12:00) escolhe a opção; a outra pergunta sai", () => {
    const r = g("Bruna, entendi o imprevisto, imagina! Vou verificar a agenda das 12h de hoje com a equipe. Você está vindo para a Casa?",
      ["Consegue reagendar por favor o procedimento do cabelo e unha para 12:00?"]);
    expect(r.texto).toBe("Bruna, entendi o imprevisto, imagina! Tenho quarta, 21/10, às 12h com Jamille. Posso reservar pra você?");
    expect(r.horario?.id).toBe("h4");
  });

  it("P3 (Luanda): 'Vou verificar com Gilvan se consigo…' sai; a profissional citada e o dia pedido escolhem a opção", () => {
    const r = g("Entendo, Lu! Como você vai viajar, o ideal é fazer as luzes na quarta. Vou verificar com Gilvan se consigo deixar o teste e a realização no mesmo dia para você, tudo bem?",
      ["Vou viajar realmente preciso fazer as luzes quarta", "Por isso estou perguntando"]);
    expect(r.texto).toBe("Entendo, Lu! Como você vai viajar, o ideal é fazer as luzes na quarta. Tenho quarta, 21/10, às 9h com Gilvan. Posso reservar pra você?");
    expect(r.horario?.id).toBe("h5");
  });

  it("'sábado à tarde': a proposta é de sábado à tarde", () => {
    const r = g("Vou ver a agenda de sábado pra você!", ["Tem horário sábado à tarde?"]);
    expect(r.texto).toBe("Tenho sábado, 17/10, às 15h com Marilia. Posso reservar pra você?");
    expect(r.horario?.id).toBe("h2");
  });

  it("Thaise: 'com nossa Diretora Técnica, Thaise Fiaes', sem artigo", () => {
    const r = garantirHorario("Vou verificar a agenda de Thaise.", { opcoes: [OPS[5]], pediu: true, textosCliente: ["quero a avaliação do Método"], hoje: HOJE });
    expect(r.texto).toBe("Tenho quinta, 22/10, às 14h30 com nossa Diretora Técnica, Thaise Fiaes. Posso reservar pra você?");
  });

  it("sem hora no texto e sem 'vou verificar' ('Qual dia fica melhor?'): ganha a proposta", () => {
    expect(g("Que bom que você chamou! Qual dia fica melhor pra você?", ["quero agendar luzes"]).texto)
      .toBe("Que bom que você chamou! Tenho sábado, 17/10, às 9h com Marilia. Posso reservar pra você?");
  });

  it("nada no período pedido: diz com carinho e oferece o mais próximo", () => {
    expect(g("Vou verificar.", ["tem domingo à tarde?"], { fora: "dom 18/10 à tarde" }).texto)
      .toBe("Para dom 18/10 à tarde não tenho horário livre; o mais próximo é sábado, 17/10, às 15h com Marilia. Posso reservar pra você?");
  });

  it("frase que cita assistente sai (assistente nunca é oferecida)", () => {
    const r = g("Tenho quarta às 9h com Sidney. Posso reservar?", ["tem quarta?"], { assistentes: ["SIDNEY SANTOS"] });
    expect(r.texto).not.toMatch(/sidney/i);
    expect(r.texto).toBe("Tenho quarta, 21/10, às 12h com Jamille. Posso reservar pra você?");
  });

  it("não mexe: sem pedido, sem opções, ou com hora já no texto (confirmação fora da lista fica)", () => {
    const t = "Vou verificar a agenda.";
    expect(g(t, ["oi"], { pediu: false })).toEqual({ texto: t, horario: null, trocou: false });
    expect(g(t, ["tem sábado?"], { opcoes: [] })).toEqual({ texto: t, horario: null, trocou: false });
    const c = "Perfeito, Paula! Fica confirmado hoje, sexta, 16/10, às 14h30. Até logo! 🌷";
    expect(g(c, ["Então pode ser 14:30"])).toEqual({ texto: c, horario: null, trocou: false });
  });

  it("hora inventada (nem da lista nem pedida pela cliente, caso Leomar da avaliação real): a frase sai e entra a proposta da lista", () => {
    const r = g("Imagina, Leomar! Imprevistos acontecem 💛 Para o sábado que vem (24/10), tenho Jackson às 11h para o seu corte. Posso reservar pra você?",
      ["Existe a possibilidade de remarcar p sabado que vem? Ocorreu um imprevisto e não vamos conseguir ir"]);
    // A frase inteira com a hora inventada sai (o 💛 não fecha frase). Ela pediu o sábado 24/10 e não há opção nele: a proposta diz isso
    // com carinho e oferece o mais próximo (coerência, 20/10: oferecer outro dia sem dizer contradizia o pedido dela).
    expect(r.texto).toBe("Imagina, Leomar! Para sáb 24/10 não tenho horário livre; o mais próximo é sábado, 17/10, às 9h com Marilia. Posso reservar pra você?");
    expect(r.horario?.id).toBe("h1");
    // O horário de funcionamento ("das 9h às 18h") não é proposta inventada.
    const info = "Funcionamos de terça a sábado, das 9h às 18h. Tenho quarta, 21/10, às 12h com Jamille. Posso reservar pra você?";
    expect(g(info, ["tem quarta?"]).texto).toBe(info);
  });

  it("F3 (revisão): só é 'inventada' a hora OFERECIDA (tenho/temos/consigo/disponível); informação com hora fica", () => {
    for (const [t, c] of [
      ["Seu horário é amanhã às 10h com Gilvan.", ["que horas é meu horário amanhã?"]],
      ["A manutenção dura em média 4h. Tenho quarta, 21/10, às 12h com Jamille. Posso reservar pra você?", ["quero agendar a manutenção"]],
      ["Funcionamos de terça a sábado, das 10h às 19h. Tenho quarta, 21/10, às 12h com Jamille. Posso reservar pra você?", ["tem quarta?"]],
      ["Poxa, o horário de terça às 15h não está mais livre. Tenho quarta, 21/10, às 9h com Gilvan. Posso reservar pra você?", ["Pode ser"]],
    ] as [string, string[]][]) expect(g(t, c).texto, t).toBe(t);
  });

  it("'vou verificar' junto de um horário já proposto: só a frase de adiar sai; o horário da IA fica", () => {
    const r = g("Tenho quarta, 21/10, às 9h com Gilvan. Vou verificar se dá para fazer o teste junto.", ["tem quarta?"]);
    expect(r).toEqual({ texto: "Tenho quarta, 21/10, às 9h com Gilvan.", horario: null, trocou: true });
  });
});

describe("semCumprimento: conversa em andamento não cumprimenta de novo (coerência, 20/10)", () => {
  it.each([
    ["Oii, Carla! Entendi, as mechas com Thaise Fiaes em outubro.", "Entendi, as mechas com Thaise Fiaes em outubro."],
    ["Oii, Vanessa! Tudo bem? Sinto muito pela sua filha.", "Sinto muito pela sua filha."],
    ["Bom dia, querida! Vou ver com Jackson para você.", "Vou ver com Jackson para você."],
    ["Oi, tudo bem? 😍 Que bom que deu certo!", "Que bom que deu certo!"],
  ])("%s", (t, esperado) => expect(semCumprimento(t)).toBe(esperado));
  it.each(["Perfeito, Natália! Seu horário está confirmado.", "Oi", "Oii, Ana! Tudo bem?", "Olá! 😍"])("fica igual: %s", (t) => expect(semCumprimento(t)).toBe(t));
});

describe("semAntesDoValor (20/10)", () => {
  it("tira 'Antes de falarmos do valor' quando a mensagem já deu o valor; a pergunta fica", () => {
    expect(semAntesDoValor("O investimento é de R$ 7.000,00, em até 10x. Antes de falarmos do valor, me conta: você já trabalha com alongamento de cabelo?"))
      .toBe("O investimento é de R$ 7.000,00, em até 10x. Me conta: você já trabalha com alongamento de cabelo?");
  });
  it("sem valor na mensagem, a frase é natural e fica", () => {
    const t = "Antes de falarmos do valor, me conta: você já fez o Método?";
    expect(semAntesDoValor(t)).toBe(t);
  });
});

describe("semJuvenil (20/10: o dono achava a IA juvenil)", () => {
  it.each([
    ["Oii, Fernanda! Boa tarde.", "Oi, Fernanda! Boa tarde."],
    ["Simmm! Temos às 10h.", "Sim! Temos às 10h."],
    ["Kkkk, foi um susto e tanto, querida, perdão de novo! 😅 Amanhã tenho às 9h.", "Foi um susto e tanto, querida, perdão de novo! Amanhã tenho às 9h."],
    ["Claro, amore! O combo fica R$ 4.000,00.", "Claro, querida! O combo fica R$ 4.000,00."],
    ["Perdão mesmo 🤭 Amanhã tenho às 9h.", "Perdão mesmo Amanhã tenho às 9h."],
  ])("%s → %s", (a, b) => {
    expect(semJuvenil(a)).toBe(b);
  });
  it("não mexe no que é maduro (Oi, Sim, Simone, amor pelo cabelo)", () => {
    for (const t of ["Oi, Ana! Sim, temos às 10h.", "Simone, combinado!", "Feito com amor e cuidado 💛", "Mimmo"]) expect(semJuvenil(t)).toBe(t);
  });
});

describe("saída quebrada do Sonnet 5.5 (avaliação 20/10)", () => {
  it("escape de JSON literal vira o caractere (acentos e emoji); escape cortado no fim sai", () => {
    expect(semEscapes("Vamos cuidar da sua manuten\\u00e7\\u00e3o \\ud83d\\udc9b Tenho ter\\u00e7a, \\u00e0s 9h.")).toBe("Vamos cuidar da sua manutenção 💛 Tenho terça, às 9h.");
    expect(semEscapes("Fica para a tonaliza\\u00e7\\u00")).toBe("Fica para a tonalizaç");
    expect(semEscapes("Sem escape nenhum.")).toBe("Sem escape nenhum.");
    expect(posProcessar("Oi! Tenho ter\\u00e7a \\u00e0s 9h.")).toBe("Oi! Tenho terça às 9h.");
  });
  it("acento quebrado ou texto sem acento nenhum é ilegível (pede de novo)", () => {
    expect(pareceIlegivel("Imagina, Tatiana, imprevistos acontecem! đź’› Tenho quinta, dia 01/10, Ă s 9h com Cati. Posso reservar para vocĂŞ?")).toBe(true);
    expect(pareceIlegivel("Imagina, Tatiana! A avaliacao e com Thaise Fiaes, que esta fora nesta semana, entao posso te passar o proximo horario.")).toBe(true);
    expect(pareceIlegivel("Imagina, Tatiana, imprevistos acontecem! đ Tenho quinta, dia 01/10, Ã\u00a0s 9h com Cati. Posso reservar para vocÃŞ?")).toBe(true);
    expect(pareceIlegivel("Imagina, Tatiana! A avaliação é com Thaise Fiaes, que está fora nesta semana.")).toBe(false);
    expect(pareceIlegivel("ATENÇÃO, Ana: NÃO esqueça o documento, tudo bem?")).toBe(false);
    expect(pareceIlegivel("Oi, Ana! Tudo bem? Ja te mando.")).toBe(false);
  });
});

describe("marca de material da IA ([[material:/atalho]], 24/10)", () => {
  it("tira a marca do texto e devolve o atalho (normalizado)", async () => {
    const { separarMaterial } = await import("./pos");
    expect(separarMaterial("O Método Fiaes® é exclusivo da Casa. Assista ao vídeo! 💛\n[[material:/metodo-fiaes]]")).toEqual({ texto: "O Método Fiaes® é exclusivo da Casa. Assista ao vídeo! 💛", material: "metodo-fiaes" });
    expect(separarMaterial("Veja o vídeo.\n\n[[ material : /Metodo-Fiaes ]]  ")).toEqual({ texto: "Veja o vídeo.", material: "metodo-fiaes" });
    expect(separarMaterial("[[material:metodo-fiaes]]\nVeja o vídeo.")).toEqual({ texto: "Veja o vídeo.", material: "metodo-fiaes" });
  });
  it("sem marca: texto igual e nenhum material; duas marcas: fica a primeira e as duas saem do texto", async () => {
    const { separarMaterial } = await import("./pos");
    expect(separarMaterial("Oi, Paula! Tudo bem?")).toEqual({ texto: "Oi, Paula! Tudo bem?", material: null });
    expect(separarMaterial("Olha só.\n[[material:/a]]\n[[material:/b]]")).toEqual({ texto: "Olha só.", material: "a" });
  });
  it("marca no meio da frase também sai sem deixar espaço duplo", async () => {
    const { separarMaterial } = await import("./pos");
    expect(separarMaterial("Assista [[material:/metodo]] e me conta o que achou.")).toEqual({ texto: "Assista e me conta o que achou.", material: "metodo" });
  });
  it("marca torta nunca vaza para o texto: atalho com espaço, colchete simples, sem fechar ou vazia", async () => {
    const { separarMaterial } = await import("./pos");
    expect(separarMaterial("Assista ao vídeo!\n[[material:/Metodo Fiaes]]")).toEqual({ texto: "Assista ao vídeo!", material: "metodo-fiaes" });
    expect(separarMaterial("Assista ao vídeo!\n[material:/metodo-fiaes]")).toEqual({ texto: "Assista ao vídeo!", material: "metodo-fiaes" });
    expect(separarMaterial("Assista ao vídeo!\n[[material:/metodo-fiaes]")).toEqual({ texto: "Assista ao vídeo!", material: "metodo-fiaes" });
    expect(separarMaterial("Assista ao vídeo!\n[[material:/metodo-fiaes")).toEqual({ texto: "Assista ao vídeo!", material: "metodo-fiaes" });
    expect(separarMaterial("Assista ao vídeo!\n[[ MATERIAL : / Método-Fiaes ]]")).toEqual({ texto: "Assista ao vídeo!", material: "método-fiaes" });
    expect(separarMaterial("Oi!\n[[material:]]")).toEqual({ texto: "Oi!", material: null });
  });
});
