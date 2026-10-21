# Rodada 2, Parte D: relatórios explicados e PDFs (plano)

> **Para agentes:** a sub-skill obrigatória é superpowers:executing-plans. Execução nativa e um revisor no fim.

**Objetivo:** os relatórios se explicam sozinhos e saem em PDF bonito em três formatos: do período, fechamento mensal (gerado sozinho) e por atendente.

**Spec:** `docs/superpowers/specs/2026-10-13-crm-rodada-2-design.md`, Parte D.

**Arquitetura:**
- **Textos:** `src/lib/metric-copy.ts`, funções puras com o texto de cada número e a frase "como ler" a partir de `atual`, `anterior` e `n`.
- **Página de impressão:** `/relatorios/imprimir`, que reaproveita os componentes da tela com CSS `@page`/`@media print`.
- **Motor do PDF:** `src/server/reports/pdf.ts` abre essa página num Chromium headless (`playwright-core`, que já vem com o `@playwright/test`; no VPS, `npx playwright install chromium --with-deps`). O acesso é por um token de uso único, e a geração tem cadeado e tempo limite de 60 s.
- **Fechamento mensal:** job `relatorio-mensal` no dia 1º às 06:00. Grava `data/relatorios/AAAA-MM.pdf` e uma linha em `report_files`.

**Migração `0015`, só aditiva:**
- `report_files(id, kind, period_label, path, created_at, created_by)`;
- `report_print_tokens(token_hash pk, user_id, expires_at, used_at)`.

## Restrições globais
- **Nada inventado:**
  - "Bom ou ruim" só aparece quando o sentido é óbvio: tempo de resposta menor é melhor; leads, agendamentos e vendas maiores é melhor.
  - Sem meta inventada.
  - Com base pequena (n < 20, o `MIN_SAMPLE` de hoje) o texto diz "poucos casos para comparar".
- **Permissões:**
  - o PDF exige `relatorios.exportar`;
  - o PDF "por atendente" mostra todas as pessoas só com `relatorios.equipe`;
  - os valores em R$ só aparecem com `valores.ver`, igual à tela.
- **Token do PDF:** guardado só em hash, vale 5 min, é de uso único e fica ligado a quem pediu. A página de impressão lê as permissões dessa pessoa.
- **Sem custo novo:** o Chromium roda no próprio VPS. O e-mail só sai se o `SMTP_*` estiver configurado; sem ele, o PDF fica guardado na lista.
- **Backup:** `scripts/backup.sh` passa a incluir `data/relatorios/`.

## Foco da revisão
1. **Gerar dois PDFs ao mesmo tempo.** O segundo recebe "Já tem um PDF sendo gerado" e não trava o servidor.
2. **Período sem nenhum dado.** O PDF sai com "Sem dados no período", não quebra e não mostra 0% enganoso.
3. **Token reutilizado ou de outra pessoa.** A página de impressão recusa com 403.
4. **Fechamento do dia 1º com o worker parado.** O job da manhã seguinte gera o mês que faltou, sem duplicar.
5. **Chromium ausente no servidor.** O botão mostra "PDF indisponível neste servidor" em vez de um erro técnico.

---

### D1: Textos dos números (`metric-copy.ts`)
```ts
export type MetricKey = "leadsNovos" | "pctPrimeiraRespostaNoSla" | "agendamentosMarcados" | "vendas" | "ticketMedio" | "primeiraResposta" | "parados" | "canal" | "origem" | "perdas";
export const METRIC_COPY: Record<MetricKey, { what: string; how: string; better: "up" | "down" | null }>;
export function readDelta(key: MetricKey, atual: number | null, anterior: number | null, n: number, periodLabel: string): string;
// ex.: "Subiu de 12 para 18 em relação a ontem até a mesma hora. Bom sinal." / "Poucos casos para comparar (n = 7)."
```
**Testes:**
- subiu, desceu e igual;
- sem número anterior ("primeiro período com dados");
- n pequeno;
- "melhor" respeita o sentido (tempo menor é melhor);
- nunca menciona meta.

**Na tela:** cada número grande de `executive-numbers.tsx` ganha a linha `what` abaixo do valor e a leitura `readDelta`.

### D2: Visual da tela de Relatórios
- **Cabeçalho do período:** o período por extenso e "comparado com …".
- **Números grandes:** uma faixa com 5 cartões no computador e 2 colunas no celular, com a explicação embaixo de cada um.
- **Seções:** continuam como estão, com o "Como é calculado".
- **Botão:** "Baixar PDF" ao lado de "Exportar".
- **Verificação:** axe sem violações, 390 px sem rolagem lateral e capturas de antes e depois.

### D3: Página de impressão e motor do PDF
**Página `/relatorios/imprimir?tipo=periodo|mensal|equipe&periodo=…&t=<token>`:**
- fica fora do layout `(app)`, sem menu;
- A4 com margens de 14 mm;
- capa com "Casa Fiaes", o tipo, o período e "Gerado em … por …";
- o resumo de 5 números com a leitura;
- as seções da tela, com quebra de página antes de cada uma;
- rodapé com a página.

**Funções em `pdf.ts`:**
- `issuePrintToken(userId)`;
- `consumePrintToken(token)`, que devolve o usuário;
- `renderPdf({ tipo, periodo, userId })`, com `pg_try_advisory_lock` e 60 s de limite, que devolve um `Buffer`.

**Rota:** `GET /api/relatorios/pdf?tipo=&periodo=` com `assertPerm("relatorios.exportar")`. Devolve `application/pdf` com o nome `casa-fiaes-<tipo>-<periodo>.pdf`.

**Testes:**
- token: de uso único, expira, é de outra pessoa;
- renderização (integração, com o Chromium local): PDF com mais de 1 página, contendo "Os números do período" e o nome da Casa. O texto é conferido com `pdf-parse`, que já vem no projeto pela skill; se não vier, o tamanho e a assinatura `%PDF` bastam.

### D4: Por atendente (`tipo=equipe`)
Por pessoa:
- conversas recebidas;
- tempo médio de resposta (no horário de expediente);
- % respondidas no prazo;
- agendamentos, vendas e conversão, com valor só com `valores.ver`.

Em ordem alfabética, **sem ranking**, e a base pequena aparece marcada. Sem `relatorios.equipe`, só a própria linha. Consulta `teamPerformance(filter)` com teste.

### D5: Fechamento mensal
- **Job do worker:** `relatorio-mensal`, diário às 06:00. Gera o mês anterior se ainda não existe em `report_files` (idempotente).
- **Lista:** "Fechamentos" na aba Visão geral, para quem tem `relatorios.exportar`, com download por rota protegida.
- **E-mail:** só se `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` estiverem definidos (nodemailer, já é dependência? se não for, adiar com uma nota).
- **Teste:** o job gera uma vez e na segunda rodada não duplica.

### D6: Verificação
- e2e: baixar o PDF do período (status 200, `%PDF`); a Recepção recebe 403; a lista de fechamentos aparece.
- A suíte inteira, o revisor e o deploy no VPS (o Chromium entra no `docs/deploy-contabo.md`).
