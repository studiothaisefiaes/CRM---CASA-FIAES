import { describe, expect, it } from "vitest";
import { buildSystem, buildUser, clienteLines, greetLine, greetState, messageText, resumoAntes, type CasaData } from "./prompt";

const casa: CasaData = {
  services: [{ label: "Corte", priceCents: 12000, durationMin: 60, category: "Cabelo" }, { label: "Mão", priceCents: null, durationMin: null, category: "Unhas" }],
  hours: "seg–sex 8–20, sáb 8–17", address: "Rua das Flores, 10 - Pituba", cancelUntilHours: 24,
};

describe("bloco fixo (vai para o cache)", () => {
  it("tem o jeito da Casa, as regras, serviços com preço, horário e endereço", () => {
    const s = buildSystem(casa);
    expect(s).toContain("Casa Fiaes");
    expect(s).toContain("Sem assinatura");
    expect(s).toMatch(/NUNCA: inventar preço/);
    expect(s).toContain("Cabelo: Corte R$ 120,00 (60 min)");
    expect(s).toContain("Unhas: Mão preço a confirmar");
    expect(s).toContain("seg–sex 8–20, sáb 8–17");
    expect(s).toContain("Rua das Flores, 10 - Pituba");
    expect(s).toContain("até 24 h antes");
    expect(s).toMatch(/reclama/i);
    expect(s).toMatch(/desconto/i);
    expect(s).toMatch(/remarcação/);
  });
  it("é idêntico com os mesmos dados em qualquer ordem e não tem hora do dia (senão perde o cache)", () => {
    expect(buildSystem(casa)).toBe(buildSystem({ ...casa, services: [...casa.services].reverse() }));
    expect(buildSystem(casa)).not.toMatch(/\d{2}:\d{2}/);
  });
});

describe("bloco fixo no formato de skill: seções do manual + serviços do cadastro", () => {
  const manual = { casa: "Temos estacionamento, sem manobrista.", fala: "Saudação: Seja muito bem-vinda à Casa Fiaes! 🌷", regras: "- Tolerância de atraso: 15 minutos.\n- Sinal: [a Casa precisa preencher]",
    pacotes: "Manutenção a cada 90 dias.", perguntas: "Tem estacionamento? → Temos, sem manobrista.", exemplos: "Cliente: Qual o endereço?\nResposta: Estamos na Alameda… 🌷" };
  it("seções na ordem da skill, com o fixo antes do que a Casa escreveu", () => {
    const s = buildSystem({ ...casa, manual });
    const order = ["# Skill", "## Quem você é", "Temos estacionamento", "## Como a Casa fala", "Seja muito bem-vinda", "## Regras", "NUNCA: inventar", "Tolerância de atraso",
      "## Serviços e preços", "Cabelo: Corte", "## Pacotes e Método Fiaes®", "a cada 90 dias", "## Perguntas frequentes", "## Exemplos", "Cliente: Qual o endereço?", "## Resposta"];
    const pos = order.map((t) => s.indexOf(t));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(s).toMatch(/\[a Casa precisa preencher\][^\n]*confirmar/);
    expect(buildSystem({ ...casa, manual })).toBe(buildSystem({ ...casa, manual: { ...manual } }));
  });
  it("seção vazia some; sem manual, ficam só as partes fixas e os serviços", () => {
    const s = buildSystem({ ...casa, manual: { ...manual, perguntas: "  ", exemplos: "" } });
    expect(s).not.toContain("## Perguntas frequentes");
    expect(s).not.toContain("## Exemplos");
    const bare = buildSystem(casa);
    expect(bare).toContain("## Quem você é");
    expect(bare).toContain("## Serviços e preços");
    expect(bare).not.toContain("## Pacotes e Método Fiaes®");
    expect(bare).toMatch(/Pagamento, promoções e outras políticas que não estão aqui: diga que vai confirmar/);
    expect(buildSystem({ ...casa, address: null })).toContain("Endereço: não informado");
    expect(buildSystem({ ...casa, address: null, manual })).not.toContain("não informado");
  });
  it("a descrição curta do serviço vai junto, cortada", () => {
    const s = buildSystem({ ...casa, services: [{ label: "Corte", priceCents: 12000, durationMin: 60, category: "Cabelo", description: "Inclui lavagem e finalização." }, { label: "Escova", priceCents: 8000, durationMin: null, category: "Cabelo", description: "z".repeat(400) }] });
    expect(s).toContain("Corte R$ 120,00 (60 min): Inclui lavagem e finalização.");
    expect(s).not.toContain("z".repeat(161));
  });
});

describe("pacotes ativos no bloco fixo (aba Serviços › Pacotes)", () => {
  const packages: CasaData["packages"] = [
    { name: "Combo Ritual 4 Sessões", priceCents: 143_200, sessions: 4, services: ["Ritual de Tratamento"], validityDays: 90, description: "Ganha 4 finalizações." },
    { name: "Combo Manutenção Método Fiaes", priceCents: 800_000, sessions: 4, services: ["Sessão de pacote metodo", "Finalização Metodo Fiaes"], validityDays: 365, description: null },
    { name: "Pacote sem preço", priceCents: null, sessions: 1, services: ["Corte"], validityDays: null, description: null },
  ];
  it("lista os pacotes depois dos serviços, com preço do pacote inteiro, sessões, por sessão, validade e descrição", () => {
    const s = buildSystem({ ...casa, packages });
    const sec = s.slice(s.indexOf("## Serviços e preços"), s.indexOf("## Resposta"));
    expect(sec).toContain("Pacotes (preço do pacote inteiro):");
    expect(sec).toMatch(/- Combo Manutenção Método Fiaes: R\$\s8\.000,00 por 4 sessões \(R\$\s2\.000,00 cada\) de Sessão de pacote metodo \+ Finalização Metodo Fiaes; vale 1 ano/);
    expect(sec).toMatch(/- Combo Ritual 4 Sessões: R\$\s1\.432,00 por 4 sessões \(R\$\s358,00 cada\) de Ritual de Tratamento; vale 90 dias: Ganha 4 finalizações\./);
    expect(sec).toMatch(/- Pacote sem preço: preço a confirmar, 1 sessão de Corte/);
    expect(s.indexOf("Combo Manutenção")).toBeLessThan(s.indexOf("Combo Ritual")); // ordem por nome: o texto é o mesmo byte a byte
    expect(buildSystem({ ...casa, packages: [...packages].reverse() })).toBe(s);
  });
  it("sem pacote, nada de pacote", () => {
    expect(buildSystem({ ...casa, packages: [] })).not.toContain("Pacotes (preço");
    expect(buildSystem(casa)).not.toContain("Pacotes (preço");
  });
});

describe("parte da conversa", () => {
  const now = new Date("2026-10-16T17:05:00Z");
  const base = {
    firstName: "Maria", stage: "Em conversa", now, examples: ["Oi, Maria! Tudo bem? 😊 Temos sim."],
    nextAppointment: { startsAt: new Date("2026-10-18T12:00:00Z"), service: "Escova", professional: "Maiara Souza" },
    messages: [
      { direction: "in" as const, kind: "text", body: "Oi! meu cpf 123.456.789-09 e tel 71 99999-1234, email m@x.com", transcript: null, at: new Date("2026-10-16T16:50:00Z") },
      { direction: "out" as const, kind: "text", body: "*SARA - CASA FIAES:*\nOi, Maria! Tudo bem?", transcript: null, at: new Date("2026-10-16T16:52:00Z") },
      { direction: "in" as const, kind: "audio", body: null, transcript: "queria saber o preço do corte", at: new Date("2026-10-16T17:00:00Z") },
    ],
  };
  it("leva primeiro nome, etapa, próximo horário, exemplos e as mensagens (áudio pela transcrição), sem CPF/telefone/e-mail", () => {
    const u = buildUser(base);
    expect(u).toMatch(/^Agora: sexta, 16\/10\/2026, 14:05 \(Salvador\)\. Cliente: Maria\. Etapa: Em conversa\. Próximo horário: .*18\/10.*09:00, Escova com Maiara\./);
    expect(u).not.toContain("Souza");
    expect(u).toContain("Respostas reais da equipe:\n- Oi, Maria! Tudo bem? 😊 Temos sim.");
    expect(u).toContain("Cliente: (áudio) queria saber o preço do corte");
    expect(u).toContain("Casa: Oi, Maria! Tudo bem?");
    expect(u).not.toContain("SARA");
    expect(u).not.toContain("123.456");
    expect(u).not.toContain("99999");
    expect(u).not.toContain("m@x.com");
    expect(u).toContain("[CPF]");
  });
  it("histórico longo (coerência, 20/10): as 30 últimas; as 8 do fim quase inteiras (900), as de antes cortadas em 400; com o resumo anterior, as 24 últimas", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ direction: "in" as const, kind: "text", body: `msg ${i} ${"x".repeat(i === 39 || i === 20 ? 1200 : 1)}`, transcript: null, at: now }));
    const u = buildUser({ ...base, messages: many });
    expect(u).not.toContain("msg 9 ");
    expect(u).toContain("msg 10 ");
    expect(u).toContain("x".repeat(890) + "…"); // a última: até 900
    expect(u).not.toContain("x".repeat(901));
    expect(u).toMatch(/msg 20 x{390,396}…/); // a do meio: até 400
    const r = buildUser({ ...base, messages: many, previousSummary: "Quer escova no sábado." });
    expect(r).toContain("Resumo de uma sugestão anterior (pode estar desatualizado; a conversa abaixo vale mais): Quer escova no sábado.");
    expect(r).not.toContain("msg 15 ");
    expect(r).toContain("msg 16 ");
  });
  it("continuidade: com a cliente por último, a tarefa manda responder ao que ela acabou de dizer, sem repetir nem voltar ao começo", () => {
    const u = buildUser({ ...base, messages: [
      { direction: "out", kind: "text", body: "Às 10h, fica bom para você?", transcript: null, at: now },
      { direction: "in", kind: "text", body: "Fica sim", transcript: null, at: now, quoted: "*SARA - CASA FIAES:*\nÀs 10h, fica bom para você?" },
    ] });
    expect(u).toMatch(/<tarefa>\nEscreva a PRÓXIMA mensagem da Casa nesta conversa[^\n]*"\(respondendo a: "Às 10h, fica bom para você\?"\) Fica sim"/);
    expect(u).toContain("não repita pergunta que ela já respondeu nem informação que a Casa já deu");
    expect(u).toContain("Se ela só agradeceu, concordou ou se despediu, responda curto");
    // A Casa por último: a tarefa é outra (a próxima mensagem natural), sem o bloco de continuar.
    const casa = buildUser({ ...base, messages: [{ direction: "out", kind: "text", body: "Oi!", transcript: null, at: now }] });
    expect(casa).not.toContain("<tarefa>");
  });
  it("Casa por último (Cati 16/10): o que a Casa já mandou vai explícito; há pouco → complemento; horas sem resposta → retomada delicada", () => {
    const valor = { direction: "out" as const, kind: "text", body: "*SARA - CASA FIAES:*\nA escova fica R$ 80.", transcript: null, at: new Date("2026-10-16T16:58:00Z") };
    const agora = buildUser({ ...base, messages: [...base.messages, valor] });
    expect(agora).toContain("A última mensagem é da Casa: escreva a PRÓXIMA mensagem natural da Casa");
    expect(agora).toContain('O que a Casa já mandou depois da última fala da cliente (NÃO repita nem reformule): "A escova fica R$ 80."');
    expect(agora).toContain("COMPLEMENTE");
    expect(agora).not.toContain("RETOME");
    expect(agora).not.toContain("SARA");
    // Dois dias depois, sem resposta dela: retomar com delicadeza, com pergunta fácil, sem copiar.
    const depois = buildUser({ ...base, now: new Date("2026-10-18T13:00:00Z"), messages: [...base.messages, valor] });
    expect(depois).toMatch(/A cliente não respondeu desde .*16\/10.*: RETOME com delicadeza/);
    expect(depois).toContain("UMA pergunta fácil de responder");
    expect(depois).not.toContain("COMPLEMENTE");
    // Duas mensagens seguidas da Casa: as duas entram (a ligação não).
    const duas = buildUser({ ...base, messages: [...base.messages, valor, { ...valor, kind: "call", body: null }, { ...valor, body: "Fica na Alameda das Espatódeas, 10." }] });
    expect(duas).toContain('"A escova fica R$ 80." "Fica na Alameda das Espatódeas, 10."');
  });
  it("citação e mensagem automática aparecem na conversa (a IA sabe a que ela respondeu e o que não foi alguém da equipe)", () => {
    const u = buildUser({ ...base, messages: [
      { direction: "out", kind: "text", body: "Estamos fora do horário de atendimento.", transcript: null, at: now, auto: true },
      { direction: "in", kind: "audio", body: null, transcript: "pode ser às 10h", at: now, quoted: "Às 10h com Thaise?" },
    ] });
    expect(u).toContain("Casa (mensagem automática): Estamos fora do horário de atendimento.");
    expect(u).toContain('Cliente: (respondendo a: "Às 10h com Thaise?") (áudio) pode ser às 10h');
  });
  it("o que ficou antes das mensagens recentes vai resumido numa linha (sem IA)", () => {
    const older = [
      { direction: "in" as const, kind: "text", body: "Oi, queria saber do Método para transição", transcript: null, at: new Date("2026-09-01T12:00:00Z") },
      { direction: "out" as const, kind: "text", body: "*CATI - CASA FIAES:*\nSegue uma estimativa do investimento: entre R$ 16.000,00 e R$ 24.000,00.", transcript: null, at: new Date("2026-09-02T12:00:00Z") },
      { direction: "out" as const, kind: "text", body: "Passando para lembrar seu horário", transcript: null, at: new Date("2026-09-03T12:00:00Z"), auto: true },
      { direction: "in" as const, kind: "image", body: null, transcript: null, at: new Date("2026-09-03T13:00:00Z") },
      { direction: "in" as const, kind: "audio", body: null, transcript: "vou ver com meu marido", at: new Date("2026-09-04T12:00:00Z") },
    ];
    const r = resumoAntes(older)!;
    expect(r).toMatch(/^5 mensagens de 01\/09 a 04\/09: ela começou com "Oi, queria saber do Método para transição"/);
    expect(r).toContain('a Casa já mandou: valor ("Segue uma estimativa do investimento: entre R$ 16.000,00 e R$ 24.000,00.")');
    expect(r).toContain("ela mandou 1 foto e 1 áudio");
    expect(r).toContain('"vou ver com meu marido"');
    expect(resumoAntes([])).toBeNull();
    expect(buildUser({ ...base, antes: r })).toContain(`Antes das mensagens abaixo (resumo automático, para contexto): ${r}`);
  });
  it("no máximo 3 exemplos da equipe, cortados", () => {
    const u = buildUser({ ...base, examples: ["a1", "a2", "a3", "a4", "y".repeat(500)] });
    expect(u).not.toContain("- a1");
    expect(u).toContain("- a3");
    expect(u).not.toContain("y".repeat(201));
  });
  it("no 'Outra', pede uma versão diferente das anteriores", () => {
    expect(buildUser({ ...base, previous: ["Oi, Maria! O corte é R$ 120."] })).toMatch(/versão diferente[\s\S]*- Oi, Maria! O corte é R\$ 120\./);
  });
  it("sem nome, sem horário e sem resposta da equipe", () => {
    const u = buildUser({ ...base, firstName: null, nextAppointment: null, examples: [] });
    expect(u).toContain("Cliente: nome desconhecido.");
    expect(u).toContain("Próximo horário: nenhum.");
    expect(u).not.toContain("Respostas reais");
  });
  it("tipos de mensagem viram rótulos", () => {
    expect(messageText({ direction: "in", kind: "image", body: "esse aqui", transcript: null })).toBe("(foto) esse aqui");
    expect(messageText({ direction: "in", kind: "audio", body: null, transcript: null })).toBe("(áudio sem transcrição)");
    expect(messageText({ direction: "in", kind: "sticker", body: null, transcript: null })).toBe("(figurinha)");
  });
});

describe("cumprimento e horários (pedido do dono, 16/10)", () => {
  const now = new Date("2026-10-20T17:00:00Z"); // ter 14:00 em Salvador
  it("cumprimenta só na 1ª mensagem da Casa, depois de ~8 h ou em outro dia; em andamento, não", () => {
    expect(greetLine({ now, lastCasaAt: null })).toMatch(/^Primeira mensagem da Casa/);
    expect(greetLine({ now, lastCasaAt: new Date("2026-10-20T15:00:00Z") })).toMatch(/^Conversa em andamento: não cumprimente/);
    expect(greetLine({ now, lastCasaAt: new Date("2026-10-20T07:30:00Z") })).toMatch(/pode cumprimentar de leve/);
    expect(greetLine({ now: new Date("2026-10-21T11:30:00Z"), lastCasaAt: new Date("2026-10-21T02:00:00Z") })).toMatch(/pode cumprimentar/); // outro dia
    expect(greetLine({ now })).toBeNull();
    expect(greetState({ now, lastCasaAt: new Date("2026-10-20T15:00:00Z") })).toBe("andamento");
    expect(greetState({ now, lastCasaAt: null })).toBe("primeira");
  });
  it("regras fixas: não cumprimentar em andamento; com horários na linha é proibido 'vou verificar'", () => {
    const sys = buildSystem({ services: [], hours: "seg a sáb", address: null, cancelUntilHours: null });
    expect(sys).toContain("em conversa em andamento NÃO cumprimente de novo");
    expect(sys).toContain('é PROIBIDO dizer "vou verificar"');
    // precisa_humano (remarcação, cancelamento) não manda mais "dizer que vai verificar": com a linha de horários, propõe o horário mesmo assim.
    expect(sys).not.toContain("acolher e dizer que vai verificar");
    expect(sys).toMatch(/precisa_humano=true[^\n]*com a linha "Horários livres" e pedido de horário, proponha o horário da lista mesmo assim/);
    expect(sys).toContain("no máximo, 1 alternativa da lista");
    expect(sys).toContain("horario: o id do horário principal");
    // Datas e prazos (sugestões reais ruins de 16/10: "o horário de ontem" depois da meia-noite; prometeu prazo).
    expect(sys).toContain("só diga \"hoje\", \"amanhã\" ou \"ontem\" depois de conferir com \"Agora\"");
    expect(sys).toContain("prometer prazo ou retorno");
    // Os exemplos não sugerem profissional nenhuma (o exemplo antigo citava o Jackson).
    expect(sys).not.toMatch(/Jackson|Maiara/);
  });
});

describe("IA v3 (17/10): regras, seções novas do manual e o contexto da cliente", () => {
  it("horários sem artigo no exemplo e sem prometer retorno; preço do manual; não oferece Método fora do assunto", () => {
    const s = buildSystem(casa);
    expect(s).toContain("às 15h com <profissional da opção>");
    expect(s).not.toMatch(/com a <profissional/);
    expect(s).toContain("diga que vai ver a agenda para ela, sem prometer retorno nem prazo");
    expect(s).toMatch(/Preço: quando a cliente pede valor.*dê o valor que está na lista de serviços, nos pacotes ou no manual/);
    expect(s).toMatch(/Não ofereça o Método Fiaes® .* a quem pediu outro serviço \(progressiva, luzes/);
    expect(s).toContain("nunca artigo antes do nome de profissional");
  });
  it("seções Cenários e Objeções entram antes de Exemplos (vazias somem)", () => {
    const s = buildSystem({ ...casa, manual: { perguntas: "P → R", cenarios: "Transição: explicar o Método.", objecoes: "Tá caro → perguntar o investimento.", exemplos: "Cliente: oi" } });
    const pos = ["## Perguntas frequentes", "## Cenários", "Transição: explicar", "## Objeções", "Tá caro", "## Exemplos"].map((t) => s.indexOf(t));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(buildSystem(casa)).not.toContain("## Cenários");
  });
  it("só a estimativa (sem fotos): \"A Casa já mandou…\", nunca \"Ela a Casa já mandou\" (20/10)", () => {
    const [l] = clienteLines({ visitas: 0, ultimaVisita: null, ultimaManutencaoMetodo: null, fotos: 0, estimativaMetodo: true });
    expect(l).toBe("Ainda não veio à Casa (cliente nova). A Casa já mandou estimativa de valor do Método (não peça fotos nem dê outro valor; siga a partir dela).");
  });
  it("histórico da cliente, fotos, estimativa e ausências: linhas curtas só quando existem", () => {
    const base = { firstName: "Ana", stage: "Em conversa", nextAppointment: null, now: new Date("2026-10-20T13:00:00Z"), messages: [], examples: [] };
    const u = buildUser({ ...base, cliente: { visitas: 5, ultimaVisita: { dia: "2026-09-12", servico: "Corte" }, ultimaManutencaoMetodo: "2026-09-01", fotos: 3, estimativaMetodo: true },
      ausencias: ["Thaise Fiaes fora de 20 a 22/10", "Ilma fora 24/10 das 13h às 18h"] });
    expect(u).toContain("Já é cliente da Casa: 5 visitas, a última em 12/09/2026 (Corte); última manutenção do Método em 01/09/2026. Ela já mandou 3 fotos aqui (não peça foto de novo); a Casa já mandou estimativa de valor do Método");
    expect(u).toContain("Ausências nos próximos 7 dias (agenda): Thaise Fiaes fora de 20 a 22/10; Ilma fora 24/10 das 13h às 18h.");
    const nova = buildUser({ ...base, cliente: { visitas: 0, ultimaVisita: null, ultimaManutencaoMetodo: null, fotos: 0, estimativaMetodo: false }, ausencias: [] });
    expect(nova).toContain("Ainda não veio à Casa (cliente nova).");
    expect(nova).not.toMatch(/fotos|Ausências/);
    expect(buildUser(base)).not.toMatch(/cliente nova|Já é cliente|Ausências/);
  });
});

describe("Materiais para enviar (respostas prontas com foto/vídeo que a IA pode indicar, 24/10)", () => {
  const materiais = [
    { atalho: "metodo-fiaes", kind: "video" as const, quando: "a cliente perguntar sobre o Método Fiaes", inicio: "Olha que lindo o resultado do nosso Método Fiaes®, assista ao vídeo e veja como funciona do começo ao fim, com todos os detalhes" },
    { atalho: "antes-depois", kind: "image" as const, quando: "pedir foto de resultado", inicio: "Veja este antes e depois" },
  ];
  it("sem material: o bloco fixo não muda nada (nem a seção aparece)", () => {
    expect(buildSystem({ ...casa, materiais: [] })).toBe(buildSystem(casa));
    expect(buildSystem(casa)).not.toContain("Materiais para enviar");
    expect(buildSystem(casa)).not.toContain("[[material");
  });
  it("com material: atalho, o quando, o começo do texto e a instrução da marca (no máximo uma, numa linha separada)", () => {
    const s = buildSystem({ ...casa, materiais });
    expect(s).toContain("## Materiais para enviar");
    expect(s).toContain("- /metodo-fiaes (vídeo): quando a cliente perguntar sobre o Método Fiaes. Texto: \"Olha que lindo o resultado do nosso Método Fiaes®");
    expect(s).toContain("- /antes-depois (foto): quando pedir foto de resultado. Texto: \"Veja este antes e depois\"");
    expect(s).toContain("[[material:/atalho]]");
    expect(s).toMatch(/no máximo um/i);
    expect(s).toMatch(/linha separada/i);
    // O começo do texto vai cortado (economia de tokens).
    expect(s).not.toContain("com todos os detalhes");
    // A seção vem antes do formato da resposta, e a ordem não muda o bloco (cache).
    expect(s.indexOf("## Materiais para enviar")).toBeLessThan(s.indexOf("## Resposta"));
    expect(buildSystem({ ...casa, materiais: [...materiais].reverse() })).toBe(s);
  });
});
