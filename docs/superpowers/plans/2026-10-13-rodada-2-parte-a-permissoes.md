# Rodada 2, Parte A: Permissões por perfil (plano de implementação)

> **Para agentes:** a sub-skill obrigatória é superpowers:executing-plans. Execução nativa (decidida: poucos agentes), com um revisor novo no fim da parte. Os passos usam `- [ ]`.

**Objetivo:** trocar os dois papéis fixos (gestor/atendente) por perfis editáveis com permissões, aplicadas no servidor, sem mudar o comportamento de ninguém na virada (com uma exceção decidida, ver "Mudança deliberada").

**Arquitetura:**
- **Banco:** tabela `profiles`, com `permissions text[]`, e a coluna `users.profile_id`.
- **Sessão:** carrega `perms` junto com o usuário.
- **Regra:** uma função pura `can(perms, perm)` em `src/lib/permissions.ts`. Os guardas `requirePerm` (páginas) e `assertPerm` (actions e API) ficam em `src/server/auth/session.ts`.
- **Tipos:** o campo `role` some do `SessionUser`, para o `tsc` apontar cada ponto que precisa migrar.

**Stack:** Next 16 (App Router, server actions), Drizzle + Postgres 17, Vitest e Playwright.

**Spec:** `docs/superpowers/specs/2026-10-13-crm-rodada-2-design.md`, Parte A.

## Restrições globais
- Migrações **só aditivas**: `users.role` continua no banco e é mantida em sincronia: `gestor` se o perfil tem `equipe.gerir`, senão `atendente`. Assim o código antigo funciona se for preciso voltar.
- Nenhum dado inventado. Os textos ficam em português do Brasil, no tom do CRM.
- Toda tela, action e rota `/api` nova ou alterada passa por `requirePerm` ou `assertPerm`.

## Permissões (constante `PERMS`, ordem de exibição)

| Chave | Rótulo | Grupo | Substitui hoje |
|---|---|---|---|
| `atendimento.ver` | Ver Atendimento | Atendimento | qualquer usuário logado |
| `atendimento.todas` | Ver conversas de todas | Atendimento | `role === "gestor"` nos escopos de queue, late-count, today, board, bulk, alerts e journey |
| `atendimento.transferir` | Transferir e atribuir conversas | Atendimento | `transferAction`, `bulkAssignAction`, troca de dono no funil, `canAssign` |
| `atendimento.fechar` | Fechar venda, Perdido e Não é cliente | Atendimento | (todos podiam) |
| `distribuicao.receber` | Receber leads da distribuição | Atendimento | `pickOwner` filtrava `role = 'atendente'` |
| `alertas.escalada` | Receber escaladas (avisos da gestão) | Atendimento | audiência `gestao` em `alerts.ts`, `funil/actions.ts:112` e `push.ts:40` |
| `quadro.ver` | Ver Quadro | Visões | (todos podiam) |
| `jornada.ver` | Ver Jornada | Visões | `jornada/page.tsx:13` e `journey={gestor}` |
| `contatos.ver` | Ver Contatos | Contatos | (todos podiam) |
| `valores.ver` | Ver valores de vendas e financeiro | Contatos | `contatos/[id]` `withValues`, `canManage` da folha de venda, exportações financeiras |
| `relatorios.ver` | Ver Relatórios | Relatórios | (todos podiam, com escopo próprio) |
| `relatorios.equipe` | Ver números de toda a equipe | Relatórios | `scopedFilter`, `screen.ts`, `summary-text.ts`, resumo diário do Hoje, `GESTAO_ONLY` |
| `relatorios.exportar` | Exportar CSV e PDF | Relatórios | (todos exportavam o próprio escopo) |
| `config.editar` | Configurações | Gestão | `config/layout`, `origens`, `quiet/actions`, importação de contatos, simulador, link do banner |
| `equipe.gerir` | Gerir equipe e perfis | Gestão | `config/equipe` e as actions de membro |

**Perfis de sistema:**
- **Gestão:** todas as permissões. Não pode ser apagado, e `equipe.gerir` não pode ser removida dele.
- **Atendente:**
  - `atendimento.ver`, `atendimento.transferir`, `atendimento.fechar` e `distribuicao.receber`;
  - `quadro.ver` e `contatos.ver`;
  - `relatorios.ver` e `relatorios.exportar`.
- **Recepção:** `atendimento.ver` e `distribuicao.receber`.

**Mudança deliberada:** pedido da Casa, registrado na spec, de que a atendente possa redirecionar o chat. O perfil Atendente ganha `atendimento.transferir`; hoje só a gestão transfere. Todo o resto mantém o comportamento atual.

## Foco da revisão
1. **Rota ou action esquecida sem guarda.** O teste de cobertura da Tarefa A5 falha se aparecer uma rota ou action sem `requirePerm`/`assertPerm` e fora da lista de exceções.
2. **Gestão trancada para fora.** Não pode tirar o próprio `equipe.gerir`, desativar a última pessoa com `equipe.gerir` nem apagar o perfil Gestão. Os testes ficam na Tarefa A3.
3. **Perfil apagado com gente usando.** Deve ser recusado com uma mensagem clara (A3).
4. **Sessão antiga depois de trocar o perfil.** As permissões são lidas a cada requisição, e o teste de integração confere que a próxima chamada já reflete a troca (A2).
5. **Usuário sem `atendimento.ver` que abre `/` ou `/atendimento/<id>` por link de alerta ou push.** O Hoje abre só com os blocos permitidos e o link redireciona com aviso (A4 e e2e A6).

---

### Tarefa A1: Modelo, migração 0011 e regra pura

**Arquivos:**
- Criar: `src/lib/permissions.ts`, `src/lib/permissions.test.ts`, `drizzle/0011_perfis.sql` (gerado pelo drizzle-kit e completado à mão com o seed dos perfis e o backfill)
- Modificar: `src/server/db/schema.ts` (tabela `profiles` e `users.profileId`), `src/server/db/seed.ts` (perfis de sistema idempotentes), `e2e/reset.ts` e `test/db.ts`, se semearem usuários com `role`

**Interfaces produzidas:**
```ts
export const PERMS = [/* chaves da tabela acima, na ordem */] as const;
export type Perm = (typeof PERMS)[number];
export const PERM_LABEL: Record<Perm, string>;
export const PERM_GROUP: Record<Perm, "Atendimento" | "Visões" | "Contatos" | "Relatórios" | "Gestão">;
export const SYSTEM_PROFILES: { key: "gestao" | "atendente" | "recepcao"; name: string; permissions: Perm[] }[];
export function can(perms: readonly string[] | undefined | null, perm: Perm): boolean;
export function isPerm(x: string): x is Perm;
export function legacyRoleOf(perms: readonly string[]): "gestor" | "atendente"; // equipe.gerir => gestor
```
**Schema:** `profiles(id uuid pk, key text unique null, name text not null, permissions text[] not null default '{}', is_system boolean not null default false, created_at)` e o índice único `lower(name)`. Também `users.profile_id uuid references profiles(id)`, que aceita nulo.

- [ ] **Teste que falha** (`permissions.test.ts`):
  - `can(["atendimento.ver"], "atendimento.ver")` é true;
  - `can([], "relatorios.ver")` é false;
  - `can(undefined, …)` é false;
  - `can(["x.desconhecida"], …)` é false;
  - `legacyRoleOf(gestao.permissions)` dá `"gestor"` e `legacyRoleOf(atendente.permissions)` dá `"atendente"`;
  - o perfil Gestão contém todos os `PERMS`;
  - nenhum perfil de sistema tem uma permissão fora de `PERMS`;
  - o perfil Atendente é **exatamente** o conjunto da tabela acima.
- [ ] Rodar `npx vitest run src/lib/permissions.test.ts` e ver FALHAR.
- [ ] Implementar `permissions.ts`.
- [ ] Rodar de novo e ver PASSAR.
- [ ] **Schema e migração:**
  - editar `schema.ts`;
  - `npx drizzle-kit generate --name perfis`;
  - acrescentar ao SQL gerado: `INSERT INTO profiles (key,name,permissions,is_system) VALUES (...) ON CONFLICT (key) DO NOTHING` para os três perfis;
  - `UPDATE users SET profile_id = (select id from profiles where key = case role when 'gestor' then 'gestao' else 'atendente' end) WHERE profile_id IS NULL`.
- [ ] **Seed:** os três perfis em modo upsert por `key`, sem sobrescrever as permissões já editadas de um perfil existente. Só o perfil Gestão é sempre forçado a ter todas.
- [ ] **Teste de integração** (`src/server/auth/profiles-migration.test.ts`, no banco de teste): depois do `migrate`, cada usuário tem `profile_id`. Gestor aponta para `gestao` e atendente para `atendente`.
- [ ] `npx tsc --noEmit` (ainda passa: nada lê o perfil) e commit `feat(permissões): perfis com permissões (tabela, migração 0011, regra pura)`.

### Tarefa A2: Sessão carrega permissões e guardas

**Arquivos:**
- Modificar: `src/server/auth/sessions-store.ts` e `src/server/auth/session.ts`
- Teste: `src/server/auth/session-perms.test.ts`

**Interfaces:**
```ts
export type SessionUser = { id: string; name: string; email: string; profileId: string; profileName: string; perms: Perm[] };
export async function requirePerm(perm: Perm): Promise<SessionUser>;      // página: sem perm → redirect(firstAllowedPath(perms) + "?aviso=sem-permissao")
export async function assertPerm(perm: Perm): Promise<SessionUser>;       // action: lança UserFacingError("Você não tem permissão para isso.")
export async function assertUser(): Promise<SessionUser>;                 // continua (sessão), SEM o parâmetro role
export function firstAllowedPath(perms: readonly string[]): string;       // "/" sempre permitido
```
- `findSessionUser` faz a junção com `profiles`. Usuário sem perfil (que não deveria existir depois da 0011) recebe `perms: []`.
- `requireGestor` é removido. O `role` sai do tipo, e o `tsc` passa a listar os pontos que a Tarefa A4 corrige.

- [ ] **Teste que falha:**
  - um usuário com o perfil Recepção tem `perms` igual ao do perfil;
  - trocar o `profile_id` no banco muda o resultado da próxima chamada a `findSessionUser` (sem cache entre requisições);
  - um usuário inativo dá `null`.
- [ ] Implementar e ver PASSAR.
- [ ] Commit (o `tsc` ainda quebra: segue a Tarefa A4 no mesmo bloco, sem empurrar para o servidor).

### Tarefa A3: Domínio de perfis e equipe (com as travas)

**Arquivos:**
- Criar: `src/server/domain/profiles.ts` e `src/server/domain/profiles.test.ts`
- Modificar: `src/server/domain/config.ts` (`inviteMember` e `setMember` passam a usar `profileId`), `src/server/auth/users.ts` (`createInvite` com `profileId`)

**Interfaces:**
```ts
export async function listProfiles(): Promise<{ id: string; key: string | null; name: string; permissions: Perm[]; isSystem: boolean; members: number }[]>;
export async function saveProfile(input: { id?: string; name: string; permissions: string[] }, actorId: string): Promise<{ id: string }>;
export async function deleteProfile(id: string, actorId: string): Promise<void>;
export async function duplicateProfile(id: string, actorId: string): Promise<{ id: string }>;
export async function setMemberProfile(userId: string, profileId: string, actorId: string): Promise<void>;
```
**Regras**, todas com `UserFacingError` em português e todas testadas:
- `saveProfile`: nome de 2 a 40 caracteres e único sem diferenciar maiúscula ("Já existe um perfil com esse nome"). Permissões fora de `PERMS` são descartadas.
- Perfil `gestao`: sempre fica com todas as permissões. Tentar remover alguma dá "O perfil Gestão sempre tem acesso a tudo".
- `deleteProfile`: recusado se `isSystem` ("Perfis padrão não podem ser apagados") ou se `members > 0` ("Mova as N pessoas deste perfil antes de apagar").
- `setMemberProfile` e salvar um perfil: não podem deixar **zero** usuários ativos com `equipe.gerir` ("Precisa sobrar pelo menos uma pessoa que gerencia a equipe"). Ninguém tira o próprio `equipe.gerir` ("Você não pode tirar o próprio acesso de gerir a equipe").
- Toda mudança grava em `audit_log` (`perfil_criado`, `perfil_editado`, `perfil_apagado`, `perfil_trocado`) e atualiza `users.role` com `legacyRoleOf`.
- `inviteMember`: troca `role` por `profileId` (validado). O convite (`convite/[token]`) mostra "como {profileName}".

- [ ] Testes que falham, cobrindo cada regra acima.
- [ ] Implementar e ver PASSAR.
- [ ] Commit.

### Tarefa A4: Trocar os pontos que liam o papel por permissões
Guiado pelo `npx tsc --noEmit`, troque **cada** uso conforme a coluna "Substitui hoje" da tabela.

**Pontos conhecidos:**
- páginas `(app)/page.tsx`, `funil/page.tsx`, `jornada/page.tsx`, `atendimento/page.tsx`, `atendimento/[id]/page.tsx`, `atendimento/[id]/cliente/page.tsx`, `contatos/page.tsx`, `contatos/[id]/page.tsx`, `relatorios/page.tsx`, `config/layout.tsx`, `config/origens/page.tsx` e `config/equipe/page.tsx`;
- actions `config/actions.ts`, `funil/actions.ts`, `contatos/actions.ts`, `quiet/actions.ts`, `atendimento/actions.ts` e `dev/simulador/actions.ts`;
- `api/relatorios/[tipo]/route.ts`;
- queries `today`, `late-count`, `board`, `queue`, `alerts` e `journey`;
- domínio `bulk.ts` e `deals.ts` (`pickOwner` passa a usar `profiles.permissions @> '{distribuicao.receber}'`; o *fallback* "se não há ninguém que recebe, todos" continua) e `push.ts` (escalada para quem tem `alertas.escalada`);
- relatórios `screen.ts` e `summary-text.ts`;
- componentes `sidebar`, `connection-banner`, `client-pane`, `use-lead-actions`, `export-menu`, `overview` e `team`.

**Regras de troca:**
- **Tipo do visualizador:** `Viewer = { id; role }` passa a ser `Viewer = { id: string; perms: Perm[] }`, e os componentes usam `can(viewer.perms, …)`.
- **Escopo:** onde se lia "gestor vê tudo", agora se lê `can(perms,"atendimento.todas")`. Nos relatórios, a permissão é `relatorios.equipe`.
- **Páginas:**
  - `/atendimento*` usa `requirePerm("atendimento.ver")`;
  - `/funil` usa `quadro.ver`;
  - `/jornada` usa `jornada.ver` (antes era `notFound`, agora redireciona com aviso);
  - `/contatos*` usa `contatos.ver`;
  - `/relatorios` usa `relatorios.ver`;
  - `/config/*` usa `config.editar`;
  - `/config/equipe` usa `equipe.gerir`.
- **Actions:** cada action exportada começa com `assertPerm(...)`. As de leitura e de operação do lead usam `atendimento.ver`. Fechar venda, Perdido e Não é cliente usam `atendimento.fechar`. Transferir e atribuir usam `atendimento.transferir`.
- **Menu:**
  - `sidebar` monta `NAV` filtrado por `can`, e Configurações aparece com `config.editar` ou `equipe.gerir`;
  - o rodapé mostra o `profileName` no lugar de "Gestão"/"Atendimento";
  - a `WorkspaceBar` recebe `journey={can(perms,"jornada.ver")}` e esconde "Quadro" sem `quadro.ver`.
- **Configurações com só `equipe.gerir`:** o `config/layout` aceita `config.editar` **ou** `equipe.gerir`, e cada subpágina exige a dela.
- **Hoje:** abre para todos. O resumo diário exige `relatorios.equipe`. Os blocos de leads só aparecem com `atendimento.ver`, e sem ela aparece "Seu acesso não inclui o Atendimento".

**Passos:**
- [ ] `npx tsc --noEmit` até zerar os erros.
- [ ] `npx eslint .`
- [ ] `npx vitest run`, consertando os testes que montavam `{ role }`. Os helpers de teste ganham `asUser(profileKey)`.
- [ ] Commit `refactor(permissões): telas, ações e consultas usam permissões do perfil`.

### Tarefa A5: Teste de cobertura de guardas

**Arquivo:** `src/server/auth/guard-coverage.test.ts`

- **Páginas:** lê todos os `src/app/**/page.tsx`, `layout.tsx` e `route.ts` e todos os arquivos com `"use server"`. Para cada página e layout em `(app)`, exige `requirePerm(` no arquivo ou num layout ancestral. As exceções são `/` (só `requireUser`), `login`, `convite` e `api/health`.
- **Rotas `route.ts`:** exige `assertPerm(` ou `requireUserApi`. As exceções são `api/webhooks/evolution` (segredo), `api/health`, `api/media/[id]` (com checagem própria de sessão; confirmar que ela existe) e `api/live` (sessão).
- **Server actions:** para cada `export async function` em arquivo `"use server"`, exige `assertPerm(` ou `assertUser(` no corpo. Quando é `assertUser`, a função precisa estar em `ACTION_SESSION_ONLY`, uma lista explícita e comentada (por exemplo, marcar alerta como lido, inscrever push, sair).
- [ ] Escrever o teste, ver se ele aponta alguma falha real, corrigir e ver PASSAR.
- [ ] Commit.

### Tarefa A6: Tela de perfis e e2e

**Arquivos:**
- Criar: `src/app/(app)/config/equipe/perfis/page.tsx` e `src/components/config/profiles-editor.tsx`
- Modificar: `src/components/config/team.tsx` (seletor de perfil por pessoa e no convite), `src/app/(app)/config/actions.ts` (actions de perfil com `assertPerm("equipe.gerir")`) e a navegação de Configurações (aba "Perfis" dentro de Equipe)
- Teste: `e2e/permissoes.spec.ts`; ajustar `e2e/helpers.ts` (login por perfil) e `e2e/global-setup.ts`/`reset.ts` (usuário "recepcao@e2e.local")

**Tela:**
- lista de perfis (nome, nº de pessoas, "padrão"), com os botões Novo, Duplicar e Apagar;
- editor com nome e caixinhas agrupadas por `PERM_GROUP`, cada uma com o rótulo e uma linha explicando o que libera (`PERM_HELP` em `permissions.ts`);
- no perfil Gestão, as caixinhas aparecem marcadas e desabilitadas, com a nota "Gestão sempre tem acesso a tudo";
- Salvar mostra um toast; os erros de domínio aparecem como mensagem amigável.

Componentes existentes: `Field`, `Select`, `Button`, `Sheet` e toast. Alvos de 44 px no celular, e cada checkbox é um `<label>` clicável.

**e2e (computador e celular, com axe):**
1. A gestão cria o perfil "Só fila" com `atendimento.ver`, o atribui à atendente do e2e e entra como ela. O menu mostra só Hoje e Atendimento. `/relatorios`, `/contatos` e `/config` redirecionam com o aviso. `GET /api/relatorios/resumo` dá 403. A action `transferAction` chamada pela UI não aparece.
2. Tentar apagar o perfil Gestão aparece desabilitado. Apagar um perfil em uso mostra o erro. Tirar o próprio `equipe.gerir`, trocando o próprio perfil para "Só fila", mostra o erro.
3. A atendente padrão vê "Transferir para…" (a mudança deliberada).

- [ ] Implementar, rodar `npx playwright test e2e/permissoes.spec.ts` e passar a suíte e2e inteira (`npx playwright test`).
- [ ] Commit.

### Tarefa A7: Fechamento da parte
- [ ] A suíte completa: `tsc`, `eslint`, `vitest` e `playwright`.
- [ ] Ensaio da migração 0011 numa cópia do banco de produção:
  1. `ssh casafiaes` e `backup.sh`;
  2. restaurar em `crm_restore_test` e rodar o `migrate`, cronometrando;
  3. apagar a cópia.
- [ ] Revisor novo (um agente, com contexto limpo) para a parte inteira, com foco na lista de "Foco da revisão". Corrigir o que ele achar.
- [ ] Anotar no ledger (`.superpowers/sdd/2026-10-13-rodada-2/progress.md`).
