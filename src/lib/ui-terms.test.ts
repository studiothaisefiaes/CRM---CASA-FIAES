import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * P11 (17/10): "lead" e "follow-up" não aparecem para a equipe em Relatórios, Configurações e no resumo diário. A tela usa os nomes do resto
 * do app (conversa, cliente, retomada). O código, o banco e as rotas continuam com os nomes internos: este teste só olha os textos
 * (strings e texto de JSX com espaço ou começando em maiúscula, que é o que vira rótulo ou frase), nunca chaves como "lead" e "followup"
 * nem SQL (`sql\`...\``).
 */
const ROOT = path.resolve(__dirname, "../..");
const DIRS = ["src/components/reports", "src/components/config", "src/app/(app)/config", "src/app/(app)/relatorios", "src/app/imprimir/relatorio"];
const FILES = [
  "src/app/api/relatorios/[tipo]/route.ts", "src/server/reports/summary-text.ts", "src/server/reports/queries.ts", "src/lib/report-legend.ts",
  "src/lib/metric-copy.ts", "src/lib/permissions.ts", "src/server/rules/types.ts", "src/lib/report-links.ts",
];
const BAD = /\b(leads?|follow-?ups?)\b/i;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** Os textos do arquivo que podem chegar à tela. */
function texts(file: string): string[] {
  const src = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isTaggedTemplateExpression(n) && /^sql/.test(n.tag.getText())) return; // SQL
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    let t: string | null = null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) t = n.text;
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) t = n.text;
    else if (ts.isJsxText(n)) t = n.getText();
    const css = t != null && /\{[^}]*;[^}]*\}/.test(t); // <style> do relatório impresso (a classe .lead é código)
    if (t != null && !css && (/\s/.test(t) || /^[A-ZÀ-Ú]/.test(t.trim())) && !(ts.isStringLiteral(n) && ts.isPropertyAssignment(n.parent) && n.parent.name === n)) out.push(t.trim());
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

describe("textos da tela sem 'lead' nem 'follow-up' (Relatórios, Configurações, resumo diário)", () => {
  const files = [...DIRS.flatMap((d) => walk(path.join(ROOT, d))), ...FILES.map((f) => path.join(ROOT, f))];
  it("confere arquivos de verdade", () => { expect(files.length).toBeGreaterThan(30); });
  for (const f of files) {
    it(path.relative(ROOT, f), () => {
      expect(texts(f).filter((t) => BAD.test(t))).toEqual([]);
    });
  }
});

/**
 * Um nome para cada coisa (spec do fluxo novo, 17/10): a tela usa um nome só. Código, banco e rotas não mudam; o teste olha só os textos
 * (a mesma `texts()` de cima) de tudo que pode chegar à tela: componentes, páginas, `lib` e os textos montados no servidor.
 * "Para retomar" não entra: é a ação Retomar, outra coisa.
 */
const NOMES_UNICOS: { re: RegExp; fica: string }[] = [
  { re: /\bBola com a cliente\b/, fica: "Aguardando a cliente" },
  { re: /\bPara reengajar\b/, fica: "Hora de voltar" },
  { re: /\bRetorno sugerido\b/, fica: "Hora de voltar" },
  { re: /\b[Nn]a hora de voltar\b/, fica: "Hora de voltar" },
  { re: /\b[Pp]róxima ação\b/, fica: "Combinado" },
  { re: /\b[Pp]róximas ações\b/, fica: "Meus combinados" },
  { re: /\bEncerrar\b/, fica: "Resolver" },
  { re: /\bEncerradas?\b/, fica: "Resolvidas" },
  // Título e menu (spec): a tela de conversas é "Conversas". Pega "Atendimento" como lugar ("do/no/ao Atendimento"); a palavra sozinha
  // tem outros sentidos (grupo de regras, serviço padrão, nome antigo de etapa) e não entra.
  { re: /\b(?:d[oa]|n[oa]|ao|o) Atendimento\b/, fica: "Conversas" },
  { re: /\bVer Atendimento\b/, fica: "Ver Conversas" },
  // Plano 5: "encerrar" minúsculo quando é a conversa (o status é Resolvido). "Espera encerrada", horário "encerrado" e pacote "Encerrados" são outra coisa.
  { re: /\bao encerrar\b/, fica: "ao resolver" },
  { re: /\bdo encerramento\b/, fica: "depois de resolver" },
  { re: /\bencerra(?:r)? a conversa\b/, fica: "resolver a conversa" },
  { re: /\bconversas? encerradas?\b/, fica: "conversa resolvida" },
  // QA r58 (M-6): termos internos que ainda chegavam à tela.
  { re: /\bleads?\b/i, fica: "conversa ou cliente" },
  { re: /\bfunil\b/i, fica: "etapas da conversa" },
  { re: /\bp50\b|\bp90\b|\bcoorte\b|(?:^|[\s(·])n =(?:\s|$)/i, fica: "texto da Casa (\"metade das conversas\", \"9 em 10\", \"turma do mês\")" },
  // QA r58 (M-1): comparecimento com um nome só. O serviço fica "Finalizado"; a visita, "Veio" ou "Faltou"; a lista, "Sem desfecho".
  { re: /\bSem baixa\b|\bsem baixa\b/, fica: "Sem desfecho" },
  { re: /\bCompareceu\b|\bcompareceu\b/, fica: "Veio (visita) ou Finalizado (serviço)" },
  { re: /\bFinalizou\b/, fica: "Finalizado" },
  // Fase B (18/10): um nome para cada coisa nova.
  { re: /\bDepartamentos?\b/, fica: "Setor" },
  { re: /\bEquipes\b/, fica: "Setores (a aba Equipe é dos números de funcionária)" },
  { re: /\bNPS\b/, fica: "Pesquisa de satisfação" },
  { re: /\bFavorit(?:o|a|os|as|ar)\b/i, fica: "Acompanhar" },
  { re: /\bChatbot\b|\bRobô\b/i, fica: "Automáticas" },
  { re: /\bFeriados e exceções\b|\bExceções de horário\b/, fica: "Dias especiais" },
  { re: /\bArquivos da equipe\b|\bGaleria da equipe\b/, fica: "Biblioteca" },
  { re: /\bMétodo Fiaes(?!®)/, fica: "Método Fiaes®" },
  // r66 (19/10): termos internos que a recepção não entende.
  { re: /\bVirada\b|\b(?:a|da|na|pela) virada\b/, fica: "Troca do ChatGuru para o CRM" },
  { re: /\bDupla \(CRM e Avec\)/, fica: "Nos dois sistemas" },
  { re: /\b[Cc]ontagem cega\b/, fica: "Contar sem ver o valor esperado" },
  { re: /\bdigit(?:e|ar|ando) CONFIRMAR\b|\bCONFIRMAR\b/, fica: "botão com confirmação em duas etapas" },
  { re: /Chatbot ›|› Diálogos/, fica: "texto da Casa (\"desative o diálogo automático do lembrete no ChatGuru\")" },
  // dsgfix (r68 #7, #11): termos internos em telas vazias e um nome só para o mesmo ato.
  { re: /\bscript de importação\b/i, fica: "texto da Casa (\"crie o primeiro em Novo pacote\")" },
  { re: /\bchegam pelos relatórios do Avec\b/i, fica: "texto da Casa (\"quando a cliente comprar um pacote, ele aparece aqui\")" },
  { re: /^Passo$|^Passo \d+ de \d+$/, fica: "os pontinhos de andamento (StepDots), sem \"Passo 1 de 4\" escrito" },
  { re: /^Novo contato$/, fica: "Nova conversa (o mesmo ato da Fila; \"Novo contato\" é só o nome da etapa)" },
];
/** Exceções, cada uma com o motivo: `arquivo` (relativo à raiz) e o texto exato. */
const PERMITIDOS: { arquivo: string; texto: string; motivo: string }[] = [
  { arquivo: "src/lib/avec-catalog.ts", texto: "Retorno sugerido", motivo: "nome do relatório no próprio Avec (é como ele vem e como a Casa o procura lá)" },
  { arquivo: "src/server/domain/avec/formats.ts", texto: "Retorno sugerido", motivo: "nome do relatório no próprio Avec" },
  { arquivo: "src/server/domain/avec/formats.ts", texto: "Retorno sugerido por categoria", motivo: "nome do relatório no próprio Avec" },
  { arquivo: "src/server/domain/suggested-return.ts", texto: "Retorno sugerido", motivo: "valor gravado em deals.origin (chave); a tela mostra originLabel()" },
  { arquivo: "src/components/config/chatguru-import.tsx", texto: "Funil", motivo: "nome do relatório no próprio ChatGuru (Funis › Exportar em CSV)" },
  { arquivo: "src/server/domain/chatguru-csv.ts", texto: "etapa do funil", motivo: "cabeçalho de coluna do CSV do ChatGuru (sinônimo para ler o arquivo)" },
  { arquivo: "src/server/domain/agenda/funnel-hook.ts", texto: "[agenda → funil]", motivo: "etiqueta de log do servidor (console.error), não chega à tela" },
  { arquivo: "src/server/domain/funnel-migration.ts", texto: "Lead", motivo: "nome antigo da etapa, procurado no banco para renomear (RENAMES)" },
  { arquivo: "src/server/db/seed-data.ts", texto: "Novo contato", motivo: "nome da ETAPA do funil (a coluna do Quadro), não o botão de criar conversa" },
  { arquivo: "src/server/domain/funnel-migration.ts", texto: "Novo contato", motivo: "nome da ETAPA, gravado no banco ao renomear (RENAMES)" },
];

describe("um nome para cada coisa (Hora de voltar, Combinado, Resolver, Aguardando a cliente)", () => {
  const files = ["src/components", "src/app", "src/lib", "src/server"].flatMap((d) => walk(path.join(ROOT, d)));
  it("confere arquivos de verdade", () => { expect(files.length).toBeGreaterThan(200); });
  it("nenhum texto da tela usa um nome que saiu", () => {
    const achados = files.flatMap((f) => {
      const arquivo = path.relative(ROOT, f);
      return texts(f)
        .filter((t) => NOMES_UNICOS.some((n) => n.re.test(t)) && !PERMITIDOS.some((p) => p.arquivo === arquivo && p.texto === t))
        .map((t) => `${arquivo}: "${t}"`);
    });
    expect(achados).toEqual([]);
  });
  it("a aba do navegador da Fila diz Conversas (o título da tela)", () => {
    expect(fs.readFileSync(path.join(ROOT, "src/app/(app)/atendimento/page.tsx"), "utf8")).toMatch(/export const metadata = \{ title: "Conversas" \}/);
  });
});

describe("texto para a cliente", () => {
  // casa-texts.ts nasceu na Task 8: agora os dois arquivos existem e são varridos (arquivo sumido falha, não é pulado).
  const ARTIGO_THAISE = /(?<!\p{L})(?:a|à|da|na|pela|às) Thaise\b/giu;
  it("o regex pega artigo (inclusive à e A maiúsculo) e deixa passar o texto certo", () => {
    for (const ruim of ["à Thaise", "A Thaise", "da Thaise", "pela Thaise"]) expect(ruim.match(ARTIGO_THAISE)).not.toBeNull();
    for (const bom of ["nossa Diretora Técnica, Thaise Fiaes", "com Thaise", "Fala com Thaise Fiaes"]) expect(bom.match(ARTIGO_THAISE)).toBeNull();
  });
  const ARQUIVOS = ["src/lib/casa-texts.ts", "src/lib/reminder-d1.ts"];
  it("os arquivos de texto para a cliente existem (nenhum é pulado)", () => {
    expect(ARQUIVOS.filter((a) => !fs.existsSync(path.join(ROOT, a)))).toEqual([]);
  });
  it("não põe artigo antes de Thaise", () => {
    const achados = ARQUIVOS.map((a) => path.join(ROOT, a))
      .flatMap((f) => fs.readFileSync(f, "utf8").match(ARTIGO_THAISE)?.map((m) => `${path.relative(ROOT, f)}: "${m}"`) ?? []);
    expect(achados).toEqual([]);
  });
});
