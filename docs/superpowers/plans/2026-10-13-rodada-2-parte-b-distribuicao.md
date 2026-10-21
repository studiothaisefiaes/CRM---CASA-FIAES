# Rodada 2, Parte B: distribuição automática por disponibilidade (plano)

> **Para agentes:** a sub-skill obrigatória é superpowers:executing-plans. Execução nativa e um revisor novo no fim da parte. Os passos usam `- [ ]`.

**Objetivo:** a conversa nova cai sozinha com a atendente livre de maior prioridade. Se ela não responde no prazo, a próxima pessoa livre recebe a oferta "Pode assumir?" e assume com um clique. Quem entra em pausa ou fica ausente devolve os leads que ainda não foram respondidos.

**Arquitetura:**
- **Escolha pura:** `chooseAssignee` (em `src/server/domain/routing.ts`).
- **Adaptador de banco:** `freeCandidates(tx, now)`, que trava as linhas dos candidatos com `FOR UPDATE`.
- **Entrega na chegada:** `pickOwner` chama a distribuição quando ela está ligada.
- **Presença:** o stream SSE grava `last_seen_at` a cada 60 s.
- **Worker:** um job novo, `distribuicao`, roda a cada minuto. Ele marca como ausente quem sumiu, faz as devoluções e cria as ofertas.

**Spec:** `docs/superpowers/specs/2026-10-13-crm-rodada-2-design.md`, Parte B.

## Restrições globais
- **Migração 0013, só aditiva** (a 0012 já foi usada pelo gatilho de perfil, ver o ledger da Parte A):
  - `users`: `availability text not null default 'ausente'`, `availability_at timestamptz`, `last_seen_at timestamptz`, `priority_level smallint not null default 1` e `last_assigned_at timestamptz`;
  - `settings.distribuicao = { enabled: false, limit: 3 }`, criada pelo seed sem sobrescrever.
- **A distribuição nasce desligada.** Desligada, vale o `pickOwner` de hoje (Parte A).
- **Importação de histórico (`messages.set`) não distribui.**
- **Constantes:** `PRESENCE_TIMEOUT_MIN = 5` e `PRESENCE_BEAT_MS = 60_000`.
- **A oferta é um alerta** `type 'oferta'`, com `wait_key = 'oferta:<dealId>:<awaitingSinceISO>:<n>'`. Assim ela se resolve sozinha quando a cliente é respondida (a resolução existente pega qualquer `wait_key` que não seja `task:`), recebe push e respeita o índice `alerts_wait_uq`, porque cada `n` é uma chave diferente.
- **A dona só perde a conversa quando alguém clica em Assumir.**

## Foco da revisão
1. **Duas mensagens ao mesmo tempo com uma vaga só.** A trava `FOR UPDATE` nas linhas dos candidatos impede passar do limite (teste de concorrência na B2).
2. **Atendente fecha o CRM no meio.** Depois de 5 min sem sinal ela vira ausente e os leads sem resposta voltam para a fila. Nenhum lead fica preso com dona ausente sem ninguém saber (B3).
3. **Oferta para quem já é a dona, ou para a mesma pessoa duas vezes.** Isso é excluído (B4).
4. **Oferta fora do expediente.** O worker não oferece com a Casa fechada, pela mesma regra do motor (B4).
5. **Distribuição ligada sem ninguém disponível.** O lead fica sem dona e o alerta de hoje vai para todas, nunca para uma pessoa ausente (B2).

---

### Tarefa B1: Modelo, migração 0013 e a escolha pura
**Arquivos:**
- Criar: `src/server/domain/routing.ts`, `src/server/domain/routing.test.ts` e `drizzle/0013_distribuicao.sql` (gerado)
- Modificar: `schema.ts` (as colunas de `users`) e `seed.ts` (`settings.distribuicao`)

**Interfaces:**
```ts
export type Availability = "disponivel" | "pausa" | "ausente";
export type Candidate = { id: string; priority: number; load: number; lastAssignedAt: Date | null };
export function chooseAssignee(cands: Candidate[], opts?: { preferId?: string | null; excludeIds?: string[] }): string | null;
export type DistributionSettings = { enabled: boolean; limit: number };
export async function getDistributionSettings(tx?: Tx | typeof db): Promise<DistributionSettings>; // padrão { enabled: false, limit: 3 }
```
**Regra de `chooseAssignee`** (os candidatos já chegam filtrados como livres):
1. `preferId` está entre os candidatos e não está excluído: devolve ele.
2. Senão, ordena por `priority` (crescente), depois por `load` (crescente), depois por `lastAssignedAt` (nulo primeiro, depois o mais antigo) e por fim por `id`, para o resultado ser determinístico.
3. Lista vazia ou todos excluídos: devolve `null`.

- [ ] Testes que falham:
  - preferência;
  - o nível 1 ganha do nível 2 mesmo com carga maior;
  - mesmo nível: ganha a menor carga;
  - empate: ganha quem está há mais tempo sem receber (o nulo primeiro);
  - os excluídos ficam de fora;
  - lista vazia dá `null`.
- [ ] Implementar e ver PASSAR.
- [ ] Schema e `drizzle-kit generate --name distribuicao`, seed de `settings`, teste de `getDistributionSettings` (padrão desligado, lê o que foi salvo e limita `limit` entre 1 e 20) e commit.

### Tarefa B2: Entregar a conversa nova
**Arquivos:** modificar `src/server/domain/deals.ts` (`pickOwner` recebe `{ contactId, history }`); criar `src/server/domain/distribution.ts` (adaptador); teste em `src/server/domain/distribution.test.ts`.

**Interfaces:**
```ts
export async function freeCandidates(tx: Tx, now: Date, limit: number): Promise<Candidate[]>;
// ativos, com senha, perfil com 'distribuicao.receber', availability='disponivel', last_seen_at > now-5min, carga < limit; trava as linhas (FOR UPDATE OF u)
export async function routeNewLead(tx: Tx, contactId: string, now: Date): Promise<string | null>;
// desligada → null (quem chama usa a regra antiga); ligada → preferência pela dona do último lead fechado do contato; grava last_assigned_at
```
**Carga:** leads do usuário com `closed_at is null`, `archived_at is null` e `awaiting_reply_since is not null`.

**Testes (banco):**
- desligada: mantém a regra antiga (o teste da Parte A continua passando);
- ligada: a Ana (nível 1) recebe antes da Bia (nível 1, com carga maior);
- a Carla (nível 2) só recebe quando a Ana e a Bia estão cheias;
- pessoa ausente ou sem sinal há 6 min não recebe;
- cliente que volta cai com a dona anterior, se ela estiver livre;
- ninguém livre: `ownerId` nulo;
- histórico (`history: true`) nunca distribui;
- **concorrência:** com limite 1, uma pessoa livre e duas `recordInbound` simultâneas, uma fica com ela e a outra fica sem dona.

Evento `distribuido` em `deal_events` com `{ para, motivo: "retorno" | "prioridade" }`.

- [ ] RED, GREEN, a suíte de domínio e commit.

### Tarefa B3: Presença, pausa e devolução
**Arquivos:** criar `src/server/domain/presence.ts`; modificar `src/app/api/stream/route.ts` (batida), `src/app/login/actions.ts` (logout vira ausente) e `worker/index.ts` (job `distribuicao` a cada minuto); teste em `src/server/domain/presence.test.ts`.

**Interfaces:**
```ts
export async function beat(userId: string, now?: Date): Promise<void>;          // last_seen_at = now; se 'ausente' (ou 'pausa' de outro dia) e tem distribuicao.receber → 'disponivel'
export async function setAvailability(userId: string, a: Availability, now?: Date): Promise<{ returned: number }>; // grava availability(_at); pausa/ausente → devolve
export async function sweepPresence(now?: Date): Promise<{ away: number; returned: number }>; // sem sinal há 5 min → ausente + devolve
export async function returnUnanswered(tx: Tx, userId: string, reason: string, now: Date): Promise<number>;
// leads dele abertos e sem last_outbound_at → redistribui (routeNewLead) ou fica sem dona; evento 'devolvido_a_fila' { de, motivo }
```
**Testes:**
- a batida liga a disponibilidade;
- uma pausa de ontem vira disponível na batida, e uma pausa de hoje continua pausa;
- a varredura marca ausente depois de 5 min, e só depois disso;
- a devolução leva só os leads sem resposta e os entrega para outra pessoa livre, ou deixa sem dona.

O stream chama `beat` ao conectar e a cada `PRESENCE_BEAT_MS`, num `setInterval` limpo no `cleanup`, sem derrubar o stream se falhar (`catch` com `console.error`).

- [ ] RED, GREEN e commit.

### Tarefa B4: Oferta quando o prazo estoura
**Arquivos:** criar `src/server/domain/offers.ts` e `offers.test.ts`; modificar `worker/index.ts` (o mesmo job `distribuicao`) e `src/server/domain/assign.ts` (`claimDeal` resolve as ofertas do lead e avisa a dona anterior).

**Interfaces:**
```ts
export async function offerOverdue(now?: Date): Promise<{ offered: number }>;
// só com a distribuição ligada e a Casa aberta (isOpen). Para cada lead aberto com dona, esperando resposta, com alerta de espera (não task, não oferta) aberto:
//   n = ofertas já feitas para esta espera; se n == 0, ou se a última oferta tem mais que o prazo da etapa (sla) e segue aberta → nova oferta para
//   chooseAssignee(freeCandidates, { excludeIds: [dona, ...já ofertadas] }). A anterior fica resolvida.
```
**`claimDeal`:**
- se havia dona diferente, cria o alerta `assumiu_sua_conversa` para ela ("{quem} assumiu a {cliente}"), com `wait_key` nulo e `dedupeKey` único;
- resolve as ofertas abertas do lead (`wait_key like 'oferta:%'`);
- grava o evento `assumido_por_oferta` quando quem assume tinha uma oferta aberta para o lead.

**Testes:**
- oferece para a próxima livre, sem incluir a dona;
- não repete a mesma pessoa;
- passado mais um prazo, a oferta vai para a seguinte;
- Casa fechada ou distribuição desligada: não oferece;
- responder a cliente resolve a oferta (com a resolução existente);
- assumir passa a dona, avisa a anterior e resolve.

- [ ] RED, GREEN e commit.

### Tarefa B5: Transferência que avisa e mostra quem está livre
**Arquivos:**
- `src/server/domain/updates.ts` ou onde está `transfer` (o `transferAction` usa ...; localizar). Ao transferir, cria o alerta `transferido_para_voce` para quem recebe ("{quem} transferiu a {cliente} para você").
- `src/server/queries/deal.ts`: `people` passa a trazer `availability`, `load` e `priority`.
- `client-pane.tsx`: o menu Transferir mostra "Ana · disponível · 2 esperando" e põe primeiro quem está livre.

**Testes:** o domínio cria o alerta para quem recebe e não cria quando a pessoa transfere para si mesma. O teste de componente mostra o estado e ordena quem está livre primeiro.

- [ ] RED, GREEN e commit.

### Tarefa B6: Telas (estado, configuração) e e2e
**Arquivos:**
- Sidebar: o nome vira um menu com Disponível / Em pausa / Ausente, com uma bolinha de cor e uma action `setAvailabilityAction` (`assertUser`, só a própria pessoa, em `ACTION_SESSION_ONLY` com o motivo).
- Configurações: aba nova **Distribuição** (`/config/distribuicao`, `config.editar`), com:
  - o liga/desliga (confirmação: "Conversas novas vão cair sozinhas com quem está disponível");
  - o limite;
  - a tabela da equipe que recebe (nível 1, 2 e 3 por pessoa, estado ao vivo e carga).
- **Alerta de oferta no sino:** botão "Assumir" que chama `claimAction` e abre a conversa.

**e2e** (computador e celular, com axe):
1. A gestão liga a distribuição. A Ana fica disponível sozinha ao abrir o CRM. Uma mensagem simulada cai com a Ana.
2. A Ana entra em pausa e a próxima mensagem fica sem dona. O alerta segue a regra de hoje.
3. Com dono e o prazo estourado (`ageLead` + worker do motor via `envelhecer`), a gestão recebe a oferta no sino, clica em Assumir e vira a dona. A Ana recebe "Thaíse assumiu…".

- [ ] Implementar, rodar a suíte e2e inteira e commit.

### Tarefa B7: Fechamento
- [ ] A suíte toda.
- [ ] O ensaio da 0013 numa cópia de produção.
- [ ] Um revisor novo com o "Foco da revisão".
- [ ] O ledger.
