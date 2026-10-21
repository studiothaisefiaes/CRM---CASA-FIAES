# Rodada 2, Parte C: tela de atendimento (protótipo B) (plano)

> **Para agentes:** a sub-skill obrigatória é superpowers:executing-plans. Execução nativa e um revisor novo no fim da parte.

**Objetivo:** aplicar o protótipo **B · Três colunas arrumadas**, escolhido pela Casa em 13/10/2026 (https://claude.ai/artifact/MFF1nNFgxuuMLf4nqSa66E). Junto vêm o cartão de contexto da cliente e as palavras-chave.

**Arquitetura:** reforma, não reescrita. A tela já tem três colunas a partir de 1280 px (`ConversationPane` com subgrid; `ClientPane` à direita). Mudam o cabeçalho, a coluna da cliente, a Fila no celular e os sinais. Os dados novos saem de uma consulta só, `clientContext`.

**Spec:** `docs/superpowers/specs/2026-10-13-crm-rodada-2-design.md`, Parte C. **Migração:** `0014`, só aditiva.

## Restrições globais
- **Valores em R$:** "Já gastou" e o valor de cada visita só aparecem com `valores.ver`. Sem a permissão o campo **some**, nem aparece "—".
- **Sem dado inventado:** sem venda registrada aparece "Sem vendas registradas no CRM". Antes do Avec, aparece "Histórico do Avec: bloqueado".
- **Testes que já existem:** os e2e da conversa (abas Conversa/Dados/Histórico no celular, "Transferir para…", "Assumir", rótulos) continuam passando. Mudar um rótulo exige atualizar o teste no mesmo commit, com a razão no ledger.
- **Celular:** alvos de 44 px, campos com 16 px e nenhuma rolagem lateral em 390 px. O axe não pode acusar nada sério.
- **Movimento:** só com os tokens `T` e `SPRING_UI`. Nenhuma biblioteca nova.

## Foco da revisão
1. **Cliente sem nome, sem venda, sem lead anterior.** O cartão diz "Primeiro contato" e não quebra (C1).
2. **Perfil sem `valores.ver`.** Nenhum R$ aparece no cartão nem nos blocos (C1).
3. **Palavra-chave da gestão com acento, maiúscula ou pontuação.** Ela casa do mesmo jeito; frase parcial dentro de outra palavra não casa (C2).
4. **Serviço cadastrado com nome curto ("Corte").** Não pode casar com "cortesia". A comparação é por palavra inteira (C2).
5. **Fila no celular com 7 para conferir.** A primeira conversa aparece na primeira tela sem rolar (C3, e2e).

---

### Tarefa C1: Contexto da cliente (`clientContext`)
**Arquivos:** criar `src/server/queries/client-context.ts` e o teste; incluir `context` no retorno de `getDealDetail` (opção `money`).

```ts
export type ClientContext = {
  firstContactAt: string;                 // primeira mensagem ou o lead mais antigo do contato
  isFirstContact: boolean;                // nenhum lead anterior a este
  lastVisit: { at: string; service: string | null; by: string | null } | null; // último agendamento com Compareceu
  visits: number;                         // agendamentos com Compareceu
  lastSales: { at: string; service: string | null; valueCents: number | null }[]; // 3 últimas vendas fechadas (valor null sem money)
  totalCents: number | null;              // soma das vendas fechadas; null sem money
  previousOwner: string | null;           // nome da dona do último lead fechado
};
export async function clientContext(contactId: string, dealId: string, opts: { money: boolean }): Promise<ClientContext>;
```
**Testes:**
- cliente nova dá `isFirstContact` e listas vazias;
- cliente com 2 vendas mostra o total e as 2 últimas, com `money: false` sem valores;
- compareceu conta visita e a última traz o serviço;
- a dona anterior é a do último lead fechado.

### Tarefa C2: Sinais novos, interesse por serviço e palavras-chave da gestão
**Arquivos:**
- `src/server/domain/signals.ts` (sinais novos e `matchService`, `matchKeywords` puras);
- `drizzle/0014_palavras_chave.sql`: `ALTER TYPE list_kind ADD VALUE 'keyword'` e a coluna `lists.meta jsonb`;
- `schema.ts`, `seed-data.ts` (sem palavras-chave semeadas: é a gestão que cria);
- `src/server/queries/queue.ts` (os sinais da linha incluem interesse e palavras-chave).

**Sinais embutidos novos** (regex como os de hoje, com `fold()`):
- `pediu_desconto`
- `remarcar_cancelar`
- `reclamacao`
- `evento`
- `urgente`
- `indicacao`

Os rótulos estão na spec. A ordem de prioridade em `SIGNAL_ORDER` é: `reclamacao`, `urgente`, `sumiu_apos_preco`, `remarcar_cancelar`, `pediu_preco`, `pediu_horario`, `evento`, `pediu_desconto`, `indicacao`, `respondeu_rapido`.

**Comparação:**
- `matchService(body, services)` devolve o primeiro serviço cujo nome casa como palavra inteira, sem acento nem caixa.
- `matchKeywords(body, items)`: cada item tem `{ label, phrases[], boost }`. A frase casa inteira (com `\b` nas pontas).

**Testes de falso positivo:**
- "corte" × "cortesia";
- "noiva" dentro de "noivado" (este casa, por ser começo de palavra; a regra fica escrita no teste);
- "cancelar" × "cancelamento do cartão" (este casa, e o teste documenta isso);
- "reclamação" casa;
- "não gostei do preço" casa como reclamação? **Não:** a reclamação pede "não gostei" sem a palavra "preço" logo depois, e o teste fixa isso.

**Na Fila:** `QueueItem.signals` passa a incluir `{ kind: "servico", label: "Interesse: Coloração" }` e as palavras-chave. No máximo 2 por linha, na ordem. A palavra-chave com `boost` e os sinais `reclamacao` e `urgente` sobem **dentro da seção**, nunca acima de atrasados.

### Tarefa C3: Fila arrumada (celular e computador)
- **"Conferir comparecimento":** vira um chip "✓ Conferir N" nos filtros. Tocar no chip abre a lista (a mesma `AttendanceStrip`), recolhida por padrão. Assim a primeira conversa aparece na primeira tela do celular.
- **Chips de foco:** ganham "Reclamação" e "Evento" (`?foco=reclamacao|evento`).
- **Cabeçalho do celular:** a etiqueta "Demonstração" e o "Toque para ativar o som" não ficam mais um em cima do outro. No celular a dica de som vai para uma linha própria, abaixo da barra.
- **e2e:** no celular (390×844), com 7 itens para conferir, o primeiro `option` da Fila fica visível sem rolar (`boundingBox().y + height <= 844 - barra de baixo`).

### Tarefa C4: Conversa e coluna da cliente no formato B
- **Cabeçalho, uma linha:** nome, chip da etapa e pílula do prazo. Telefone, origem e os botões Ligar/WhatsApp/@ saem do cabeçalho e vão para o bloco **Quem é**. No celular continuam ← nome · prazo · ⋯.
- **Coluna da cliente, em blocos:**
  - **Quem é**, aberto: telefone com Ligar/WhatsApp/@, "Veio de", "Cliente desde", "Já gastou" (com `valores.ver`), última visita e visitas, quem atendeu antes, sinais e observações.
  - **O que fazer**, aberto: responsável, uma **ação principal** em botão cheio e as outras como links. A ação principal é: Assumir e responder, se não é dela; Agendar, se é dela e está em Lead/Atendimento; Conferir comparecimento, se está Agendado e o horário passou; Fechar venda, se compareceu.
  - **Próxima ação**, aberto.
  - **Etapa**, recolhido: o caminho de etapas de hoje.
  - **Histórico**, recolhido: a lista de hoje.

  Os blocos recolhidos lembram o estado por pessoa (localStorage, com try/catch).
- **Cartão de contexto no topo da conversa:** só abaixo de 1280 px, quando a coluna da cliente não aparece. Fica recolhido em uma linha ("Cliente desde mar/2025 · 3 visitas · Pediu horário ▾") e abre ao tocar.
- **Mensagens:** mensagens seguidas da mesma pessoa em até 5 min se agrupam (o canto do balão muda e o horário aparece só na última). O separador por dia continua.
- **Celular:** botão da ação principal fixo acima do campo de texto, quando há uma.

### Tarefa C5: Configurações › Listas › Palavras-chave
Aba nova na tela de Listas, com:
- Etiqueta;
- Frases (uma por linha);
- "Subir na Fila" (sim ou não);
- Ativa.

Usa `addListItem`/`updateListItem` com `kind: "keyword"` e `meta: { boost }`. Teste de domínio: a lista salva e `matchKeywords` lê as ativas.

### Tarefa C6: Verificação
- e2e novos: o cartão de contexto mostra visitas e esconde R$ para a Recepção; uma palavra-chave criada pela tela etiqueta a mensagem seguinte; o chip Conferir no celular.
- Capturas de antes e depois (computador, 1280 e 1440, e celular), suíte inteira, revisor novo e ledger.
