# Migração para o Contabo (sem deploy feito ainda)

O mesmo desenho do local vai para o servidor. Nada depende de serviço pago além do próprio VPS.

## Servidor

- Contabo **Cloud VPS 6** (6 vCPU, 12 GB RAM, 100 GB NVMe), Ubuntu 24.04.
- Docker + Docker Compose, Node 22 LTS, pm2, Caddy (TLS automático).
- Firewall: abrir só 22 (SSH com chave), 80 e 443. Postgres (5433) e Evolution (8080) **não** ficam expostos: só o app fala com eles pela rede local.

## Passos

Primeira instalação, na ordem:

1. **Código e `.env`.**
   ```bash
   git clone <repo da Casa Fiaes> /opt/crm && cd /opt/crm
   cp .env.example .env   # gerar segredos novos: openssl rand -hex 32
   ```
   Ajustar no `.env`:
   - `DATABASE_URL=postgresql://crm:<senha forte>@localhost:5433/crm` (e `PG_PASSWORD` igual)
   - `APP_URL=https://crm.<dominio>`
   - `WEBHOOK_PUBLIC_URL=http://host.docker.internal:3000` (a Evolution chama o app pela rede do Docker)
   - `DEV_TOOLS=false`
   - `TRUSTED_PROXY_HOPS=1` (o Caddy fica na frente; sem isso o rate limit usa o IP errado. Em dev local, `0`)
   - `BACKUP_DIR` pode ficar sem definir: o padrão é `$HOME/backups/casa-fiaes-crm` (fora do repositório, sem precisar de root). Se definir, use caminho absoluto, sem `$VAR`
   - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` são **opcionais**: sem o par de chaves o push no celular fica desligado, sem erro (o resto dos alertas funciona). Para ligar: `npm run vapid` e colar as três linhas no `.env` (o app e o worker leem o mesmo arquivo)
2. **Infraestrutura.** `docker compose up -d`
3. **Extensão `pg_trgm` (busca).** A migração 0008 faz `CREATE EXTENSION IF NOT EXISTS pg_trgm`. Desde o PG13 ela é "trusted", mas se o papel da aplicação não puder criá-la, crie antes como superusuário (no Docker o `POSTGRES_USER` `crm` já é), senão `db:migrate` falha:
   ```bash
   docker compose exec -T db psql -U crm -d crm -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'
   ```
4. **App.**
   ```bash
   npm ci && npm run db:migrate && npm run db:seed && npm run build
   npm run seed:admin -- --email gestao@<dominio> --name "Gestão"
   ```
5. **Automações que enviam mensagem ficam desligadas.** O seed cria o lembrete na véspera e a confirmação D-1 por enquete **desligados**, e a resposta fora do horário também nasce desligada. Não ligar nenhuma delas (nem envio em massa) sem a aprovação da Casa; os alertas internos (sem mensagem para a cliente) já vêm ligados.
6. **Cadastrar os serviços antes de abrir para a equipe (nomes confirmados pela Casa).** O seed **não** cria serviços: sem nenhum serviço ativo o "Fechar venda" não fecha (a folha avisa e, para a gestão, leva a Configurações › Listas › Serviços). Entre como gestão, cadastre os serviços com os nomes que a Casa confirmou e, nos recorrentes, o "Lembrar retorno em N dias".
7. **Processos (pm2).** `crm-web` (`next start -p 3000`) e `crm-worker` (`tsx worker/index.ts`), com reinício automático por memória:
   ```bash
   pm2 start deploy/ecosystem.config.cjs
   pm2 save && pm2 startup
   ```
   **O worker tem de estar rodando**: é ele que dispara alertas, automações, envios automáticos, push e o reprocessamento de webhooks. Sem ele o app abre normalmente, mas nada avisa ninguém. Smoke test do worker no VPS: `pm2 logs crm-worker --lines 30` sem erro de inicialização e, em até 1 minuto, `worker.ok: true` no `/api/health` (o heartbeat é gravado a cada minuto; `worker.ok: false` com `status: "degraded"` = worker parado). Se o `tsx` não subir sob o pm2, o equivalente é `script: "worker/index.ts", interpreter: "node", interpreter_args: "--import tsx"`.
8. **Caddy.** Copiar `deploy/Caddyfile.example` para `/etc/caddy/Caddyfile`, trocar o domínio e `sudo systemctl reload caddy`. O `flush_interval -1` é necessário para o tempo real (SSE). No DNS do domínio: registro **A** `crm` → IP do VPS.
9. **Checagem de saúde.**
   ```bash
   curl -s https://crm.<dominio>/api/health
   ```
   Esperado: HTTP 200 e `"status":"ok"` com `db: true`, `worker.ok: true` e cada número do WhatsApp em `whatsapp`. `degraded` (200) significa worker parado ou número desconectado; `down` (503) é banco fora. Cadastrar um monitor externo (UptimeRobot ou similar) nessa URL.
10. **Backup diário.** Criar a pasta do log (`mkdir -p ~/backups`), agendar o `scripts/backup.sh` no cron (ver `docs/backup-restauracao.md`) e rodar `bash scripts/restore-test.sh` uma vez para provar que a restauração funciona (ver `docs/backup-restauracao.md`).
11. **Conectar os números do WhatsApp** (QR code) pela tela de canais.

## Rodada de melhorias (migrações 0008 e 0009)

O banco que está no ar (`crm`) ainda **não** tem as migrações desta rodada. No deploy dela, nesta ordem:

1. **Backup antes de tudo** (com o app ainda na versão antiga): `bash scripts/backup.sh` e anote a pasta impressa na última linha. Confira o `SHA256SUMS` da pasta.
2. **`pg_trgm`**: veja o passo 3 da primeira instalação (a 0008 cria a extensão).
3. **Aplicar** `npm run db:migrate`, que roda:
   - `0008_melhorias.sql`: tabelas novas (`tasks`, `lead_sources`, `outbox`, `push_subscriptions`), colunas novas em `alerts`, `channels`, `contacts`, `lists`, `messages` e `deals` (arquivamento, origem, serviço, pagamento, comparecimento; todas aceitam nulo ou têm padrão), índices trigram de busca e a troca do índice único `deals_one_open_per_contact` (passa a ignorar leads arquivados; é o único `DROP`, e é de índice, recriado na mesma migração);
   - `0009_indices.sql`: só índices `IF NOT EXISTS` (relatórios, fila e busca por telefone). Roda dentro de uma transação, sem `CONCURRENTLY`: segura as escritas por segundos nas tabelas desta casa.
4. **Seed** `npm run db:seed` (idempotente: acrescenta automações e listas novas sem sobrescrever o que a gestão editou; as que enviam mensagem entram desligadas). O seed **não** cria serviços.
5. `npm run build`, `pm2 reload crm-web crm-worker` e a checagem de saúde (`status: "ok"`, `worker.ok: true`).

**Volta (rollback) desta rodada:** as duas migrações são aditivas, então o normal é só voltar o código (seção "Rollback", passo 1): a versão antiga ignora as tabelas e colunas novas, e o índice único novo é menos restritivo que o antigo. Ressalva: a versão antiga não conhece o arquivamento, então para ela os leads arquivados ("Não é cliente", triagem) voltam a contar como abertos enquanto ela estiver no ar. Restaurar o backup do passo 1 só se dados foram corrompidos (passo 2 do "Rollback"); tudo que entrou depois dele se perde. Não há migração "para baixo": desfazer o esquema à mão é migração destrutiva e precisa de aprovação.

## Atualizar (cada versão)

Antes de subir, marque a versão atual para poder voltar e faça um backup:

```bash
cd /opt/crm
git tag -f anterior            # ou use a tag da versão que está no ar (ex.: v1.4.0)
bash scripts/backup.sh
git pull
npm ci && npm run db:migrate && npm run build
pm2 reload crm-web crm-worker
curl -s https://crm.<dominio>/api/health   # confere status ok
```

As migrações são só aditivas (sem `DROP` de tabela/coluna), então o código antigo continua funcionando com o banco já migrado.

## Rollback

Se a versão nova falhar na checagem de saúde ou se comportar mal:

1. **Voltar o código** (resolve quase tudo, porque as migrações são aditivas):
   ```bash
   cd /opt/crm
   git checkout <tag anterior>   # a tag marcada antes da atualização
   npm ci && npm run build
   pm2 reload crm-web crm-worker
   curl -s https://crm.<dominio>/api/health
   ```
2. **Só se os dados foram corrompidos** (migração ou script que alterou dados): restaurar o backup feito antes da atualização, com o app parado. O `restore.sh` tira sozinho um backup de segurança do estado atual antes de sobrescrever. Atenção: tudo que entrou depois desse backup (mensagens, leads) é perdido.
   ```bash
   pm2 stop crm-web crm-worker
   bash scripts/restore.sh ~/backups/casa-fiaes-crm/<pasta do backup> --dump crm --yes-overwrite-production
   git checkout <tag anterior> && npm ci && npm run build
   pm2 restart crm-web crm-worker
   ```
   Detalhes (mídia, sessão do WhatsApp, banco da Evolution) em `docs/backup-restauracao.md`.
3. Voltar ao `main`/versão nova depois da correção: `git checkout main && git pull`.

## Migrar os dados do local (opcional)

```bash
pg_dump -Fc -h localhost -p 5433 -U crm crm > crm.dump          # no Mac
pg_restore -h localhost -p 5433 -U crm -d crm --clean crm.dump   # no VPS
```

Os números de WhatsApp precisam ser **conectados de novo** (QR code) no servidor: a sessão do Baileys fica no volume da Evolution.

## Backup e operação

- Backup diário às 03h via cron (`scripts/backup.sh`), 14 dias de retenção, fora do repositório, com cópia fora do VPS. Roteiro completo em `docs/backup-restauracao.md`.
- Testar a restauração uma vez por mês: `bash scripts/restore-test.sh` (restaura banco do CRM, banco da Evolution, mídia e sessão só em alvos temporários: `crm_restore_test`, `crm_restore_evolution` e pastas `mktemp`).
- Logs do Docker com driver `local` (já configurado) para o disco não encher.
- Atualizações e volta: seções "Atualizar" e "Rollback" acima.
- Alerta de falha silenciosa: o CRM já avisa a gestão quando um número desconecta; o monitor externo de `/api/health` cobre o resto.
