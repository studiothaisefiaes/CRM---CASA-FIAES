# Fila e troca de conversa mais rápidas (perf-conversa2) — plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: superpowers:executing-plans (TDD em cada tarefa). Passos com caixinha (`- [ ]`).

**Objetivo:** a Fila e a troca de conversa deixam de esperar por bytes que ninguém vê: foto de perfil pequena e guardada, imagem da conversa em miniatura, nada baixado fora da tela, e a troca de conversa aparece completa em < 300 ms (guardada) e < 800 ms (sem cache).

**Arquitetura:** miniaturas geradas no servidor na primeira vez (sharp, que já vem com o Next) e guardadas no disco (`MEDIA_DIR/thumbs`) e na memória (LRU pequeno); as rotas `/api/avatar/[id]` e `/api/media/[id]` servem a miniatura por padrão (avatar) ou com `?thumb=1` (imagem), com `Cache-Control` imutável pela versão e ETag. No cliente, a foto só é pedida quando chega perto da tela (IntersectionObserver com margem curta) e a URL é sempre a mesma (com versão) em todas as telas, para o navegador reaproveitar.

**Stack:** Next 16.4 (rotas `GET`), sharp 0.35 (dependência opcional do Next, passa a ser direta), Drizzle/Postgres, Vitest, Playwright.

**Spec:** o pedido de 17/10 (perf-conversa2) e a investigação abaixo.

## Investigação (systematic-debugging, fase 1) — medido antes de mudar

Produção (leitura, 17/10, `ssh casafiaes`, nada alterado):
- A rota de foto **não consulta a Evolution**: lê `contacts.avatar_path` e o arquivo do disco (o worker baixa a cada 7 dias). Hipótese "cada avatar consulta a Evolution" descartada.
- No servidor a rota é rápida: `curl 127.0.0.1:3000/api/avatar/<id>` (401) 5–14 ms; `/api/health` 25–87 ms.
- 158 fotos no disco, **média 51 KB, maior 164 KB**, mostradas com 28–44 px. 163 imagens de conversa, **média 140 KB, maior 1,45 MB**, mostradas com no máximo 288 px de altura.
- Do Mac até o servidor (França): ping 227–560 ms, download ~100–120 KB/s, e cada pedido numa conexão já aberta leva 0,55–0,78 s.
- Conta: 40 fotos × 51 KB ≈ 2 MB a 120 KB/s ≈ 17 s de banda, divididos entre os pedidos em paralelo do HTTP/2 → cada foto termina em segundos (os 0,6–6,7 s medidos). Uma imagem de 140 KB sozinha = ~1,2 s (os 1–1,6 s medidos de `/api/media`).
- **Causa raiz:** bytes, não servidor. Fotos e imagens no tamanho original disputam a mesma banda com a conversa; o `loading="lazy"` nativo do navegador baixa tudo a até 1250–2500 px da tela. Agravantes: o cabeçalho da conversa e outras telas pedem a foto sem `?v=` (outra URL = baixa de novo e só fica 1 dia); geração sem limite não existe hoje, mas a miniatura nova precisa de limite de concorrência.

Local (`scripts/perf-conversa.mjs`, build de produção, 220 leads, 158 fotos, 5.944 mensagens, rede emulada 230 ms / 120 KB/s): números do "antes" e "depois" no relatório final e no commit da medição.

## Restrições globais

- Tudo em PT-BR (comentários, textos, commits).
- Nada em produção (sem deploy, sem push, sem escrita no servidor); sem WhatsApp; Evolution sempre endereço morto nos testes.
- Portas proibidas: 3000, 3100, 4321, 4400, 8080. Medição em 3531, e2e em 3530. Sem pkill/killall.
- Banco local `crm_perf2`, testes `crm_perf2_t`, e2e `crm_e2e_perf2`. Sem migration nova.
- Área: `src/app/api/avatar/*`, `src/app/api/media/*`, `src/server/whatsapp/*`, `components/queue/conversation-pane.tsx`, `components/lead/conversation.tsx`, e o mínimo necessário em `components/ui/contact-avatar.tsx` / `avatar-zoom.tsx` / `queue/pane-header.tsx`.
- Metas: foto depois da 1ª vez < 50 ms no servidor; troca guardada < 300 ms; troca sem cache < 800 ms (rede local; com a rede de produção, o que a banda permitir — registrar).

## Foco de revisão

1. Arquivo que não é imagem (ou corrompido) no lugar da foto: a rota não pode quebrar — serve o original como hoje (o `sniffMime`/`mediaHeaders` continuam valendo).
2. Foto trocada pelo worker (mesmo nome, arquivo novo): a miniatura velha não pode ser servida (chave pela ETag do arquivo de origem).
3. Retenção apagando a mídia: a miniatura também some do disco (privacidade).
4. Rajada de 40 fotos ainda sem miniatura: geração com no máximo 4 ao mesmo tempo e um pedido só por arquivo (os outros esperam o mesmo).
5. GIF animado / figurinha: não vira miniatura (perderia a animação) — só JPEG, PNG e WebP.

---

### Tarefa 1: Miniaturas no servidor (`thumbs.ts`)

**Arquivos:**
- Criar: `src/server/whatsapp/thumbs.ts`
- Teste: `src/server/whatsapp/thumbs.test.ts`
- Modificar: `package.json` (sharp `0.35.5` como dependência direta, já está no lock)

**Interfaces (produz):**
- `export const AVATAR_THUMB_PX = 128; export const IMAGE_THUMB_PX = 720;`
- `export const thumbsDir = () => path.join(mediaDir(), "thumbs")`
- `export async function thumbnail(file: string, opts: { px: number; square: boolean }): Promise<{ data: Buffer; etag: string } | null>` — null quando a origem não existe ou não é JPEG/PNG/WebP (quem chama serve o original).
- `export async function removeThumbs(baseName: string): Promise<void>` — apaga as miniaturas de um arquivo de origem.
- `export const __thumbStats` / `__clearThumbMemory()` só para testes.

- [ ] Testes (falham primeiro): gera WebP com no máximo `px` de lado (quadrado com `square`), bem menor que a origem; 2ª chamada não chama o sharp (sai da memória) e com a memória limpa sai do disco; origem regravada → ETag e miniatura novas, a velha apagada; origem que não é imagem / GIF → null; 10 chamadas simultâneas do mesmo arquivo geram 1 vez; `removeThumbs` apaga.
- [ ] Implementar: chave = nome da origem + hash da ETag de `fileEtag` + px; memória LRU (300 itens); disco `thumbs/<origem>.<hash>.<px>.webp` gravado por arquivo temporário + rename; pedidos iguais em andamento juntos; semáforo de 4 gerações; `sharp(file).rotate().resize(px, px, { fit: square ? "cover" : "inside", withoutEnlargement: true }).webp({ quality: 72 })`.
- [ ] Rodar `npx vitest run src/server/whatsapp/thumbs.test.ts` → passa. Commit.

### Tarefa 2: Rota da foto serve a miniatura

**Arquivos:** modificar `src/app/api/avatar/[id]/route.ts`, `route.test.ts`.

**Consome:** `thumbnail(file, { px: AVATAR_THUMB_PX, square: true })`.

- [ ] Testes: sem parâmetro → `image/webp`, ≤ 128 px, menor que o original, `cache-control` igual ao de hoje (versão → `private, max-age=31536000, immutable`; sem → `private, max-age=86400`), ETag própria da miniatura e 304 com ela; `?full=1` → o original (JPEG) como hoje; arquivo não-imagem → original; 2ª chamada < 50 ms.
- [ ] Implementar e rodar o arquivo de teste → passa. Commit.

### Tarefa 3: Imagem da conversa em miniatura

**Arquivos:** `src/app/api/media/[id]/route.ts` (+ teste novo `route.test.ts`), `src/components/lead/conversation.tsx` (+ teste existente), `src/server/whatsapp/retention.ts` (+ teste).

- [ ] Testes da rota: `?thumb=1` numa imagem → WebP ≤ 720 px, `private, max-age=31536000, immutable`, ETag e 304; `?thumb=1` em áudio → o arquivo de sempre (Range continua 206); sem `thumb` → original.
- [ ] Teste do balão: a `<img>` usa `/api/media/<id>?thumb=1` e o link continua no original.
- [ ] Teste da retenção: apagar a mídia apaga a miniatura.
- [ ] Implementar, rodar os três arquivos → passam. Commit.

### Tarefa 4: Foto só perto da tela e mesma URL em todo lugar

**Arquivos:** `src/components/ui/contact-avatar.tsx` (+ teste), `src/components/ui/avatar-zoom.tsx` (`?full=1`), `src/components/queue/pane-header.tsx` (passa `version`), `src/lib/avatar-url.ts` (+ teste).

**Produz:** `export function avatarUrl(contactId: string, version?: string | null, full?: boolean): string` e `export function avatarVersion(checkedAt: Date | string | null | undefined): string | null` (segundos inteiros, o mesmo valor de `avatarV` da Fila).

- [ ] Testes: `avatarUrl` com/sem versão e `full`; `avatarVersion` igual ao `floor(epoch)` da consulta da Fila; `ContactAvatar` sem IntersectionObserver mostra a foto (fallback), com observer só cria a `<img>` quando o item entra (margem 200 px); cabeçalho da conversa usa a mesma URL da Fila.
- [ ] Implementar, rodar → passam. Commit.

### Tarefa 5: Troca de conversa

**Arquivos:** `src/components/queue/conversation-pane.tsx`, `conversation-cache.ts` (se a medição mostrar fila atrás das fotos).

- [ ] Medir com `scripts/perf-conversa.mjs` depois das tarefas 1–4. Se a troca sem cache ainda passar de 800 ms na rede livre, investigar (fase 1 de novo) antes de mexer: tempo do servidor de `GET /api/conversa/[id]` vs. render.
- [ ] Pedido da conversa com `priority: "high"` (fotos e imagens ficam com `fetchPriority="low"` na lista).
- [ ] Commit.

### Tarefa 6: e2e que mede a troca

**Arquivos:** criar `e2e/perf-troca.spec.ts`.

- [ ] 5 conversas semeadas (uma com 200+ mensagens e imagens), troca entre elas 2 voltas; falha se a mediana da 2ª volta (guardada) passar de 300 ms × 2 (tolerância do dev server) ou a pior da 1ª volta passar de 800 ms × 3. Mede também que a foto da Fila vem em WebP pequeno.
- [ ] Rodar com `E2E_PORT=3530 DATABASE_URL=…/crm_e2e_perf2 EVOLUTION_URL=http://127.0.0.1:8080 npx playwright test e2e/perf-troca.spec.ts e2e/fila.spec.ts e2e/conversa.spec.ts`. Commit.

### Tarefa 7: Verificação e revisão final

- [ ] `vitest` completo (`DATABASE_URL=…/crm_perf2_t`), `npx next typegen && npx tsc --noEmit`, `npx eslint .`, e2e de fila e conversa.
- [ ] Medição "depois" com `scripts/perf-conversa.mjs` (rede prod e livre) e tabela antes/depois no relatório.
- [ ] Revisão independente (agente novo) do diff da branch; aplicar o que for procedente.

## Resultado (medido em 17/10, `scripts/perf-conversa.mjs`, rede emulada 230 ms / 120 KB/s)

| | antes | depois |
|---|---|---|
| Fotos baixadas na Fila + 10 trocas | 84 pedidos, 5,96 MB | 49 pedidos, 113 KB |
| Tempo de cada foto (p50 / máx) | 21,8 s / 55 s | 0,9 s / 1,6 s |
| Imagens da conversa | 45 pedidos, 5,1 MB, p50 10,2 s | 50 pedidos, 0,78 MB, p50 0,67 s |
| Troca 1ª vez, conversa completa | 13,3–17,8 s (uma não completou em 20 s) | 3,2–7,9 s |
| Troca já guardada | 0,15–2,6 s | 0,09–0,44 s |
| Foto no servidor depois da 1ª vez | — | 1,7 KB, < 50 ms (teste) |

O Mac estava com carga 30–190 (outros agentes) durante as medições: os tempos absolutos variam; bytes e número de pedidos são exatos.
