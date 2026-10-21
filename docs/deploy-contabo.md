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
6. **Retenção de mídia nasce desligada.** Configurações › WhatsApp › "Guardar fotos, áudios e documentos" vem em **Não apagar**: o job diário `retencao-midia` não apaga nada e só registra no log `[retenção de mídia] desligada`. Escolher 6, 12 ou 24 meses só com a aprovação da Casa (apagar mídia de clientes não tem volta; o backup é a única cópia).
7. **Cadastrar os serviços antes de abrir para a equipe (nomes confirmados pela Casa).** O seed **não** cria serviços: sem nenhum serviço ativo o "Fechar venda" não fecha (a folha avisa e, para a gestão, leva a Configurações › Listas › Serviços). Entre como gestão, cadastre os serviços com os nomes que a Casa confirmou e, nos recorrentes, o "Lembrar retorno em N dias".
8. **Processos (pm2).** `crm-web` (`next start -p 3000`) e `crm-worker` (`tsx worker/index.ts`), com reinício automático por memória:
   ```bash
   pm2 start deploy/ecosystem.config.cjs
   pm2 save && pm2 startup
   ```
   **O worker tem de estar rodando**: é ele que dispara alertas, automações, envios automáticos, push e o reprocessamento de webhooks. Sem ele o app abre normalmente, mas nada avisa ninguém. Smoke test do worker no VPS: `pm2 logs crm-worker --lines 30` sem erro de inicialização e, em até 1 minuto, `status: "ok"` no `/api/health` (o heartbeat é gravado a cada minuto; `status: "degraded"` = worker parado ou número desconectado). Desde 17/10 o `curl` sem sessão mostra só o `status`; `worker`, `whatsapp` e `db` aparecem para quem entra com `config.sistema`. Se o `tsx` não subir sob o pm2, o equivalente é `script: "worker/index.ts", interpreter: "node", interpreter_args: "--import tsx"`.
9. **Caddy.** Copiar `deploy/Caddyfile.example` para `/etc/caddy/Caddyfile`, trocar o domínio e `sudo systemctl reload caddy`. O `flush_interval -1` é necessário para o tempo real (SSE). No DNS do domínio: registro **A** `crm` → IP do VPS.
10. **Checagem de saúde.**
   ```bash
   curl -s https://crm.<dominio>/api/health
   ```
   Esperado: HTTP 200 e `"status":"ok"` com `db: true`, `worker.ok: true` e cada número do WhatsApp em `whatsapp`. `degraded` (200) significa worker parado ou número desconectado; `down` (503) é banco fora. Cadastrar um monitor externo (UptimeRobot ou similar) nessa URL.
11. **Backup diário.** Criar a pasta do log (`mkdir -p ~/backups`), agendar o `scripts/backup.sh` no cron (ver `docs/backup-restauracao.md`) e rodar `bash scripts/restore-test.sh` uma vez para provar que a restauração funciona (ver `docs/backup-restauracao.md`).
12. **Conectar os números do WhatsApp** (QR code) pela tela de canais.

## Rodada de melhorias (migrações 0008, 0009 e 0010)

O banco que está no ar (`crm`) ainda **não** tem as migrações desta rodada. No deploy dela, nesta ordem:

1. **Ensaio numa cópia, antes do dia** (cronometrado). A 0008 cria índices trigram (GIN) em `messages.body` e a 0009 cria índices sem `CONCURRENTLY` (o drizzle roda todas as migrações pendentes numa transação só: os travamentos da 0008 ficam até a 0010 terminar): enquanto cada índice é criado, as escritas na tabela ficam travadas. Medir numa cópia restaurada do backup mais recente, nunca no `crm`:
   ```bash
   bash scripts/restore.sh ~/backups/casa-fiaes-crm/<pasta do backup> --into-db crm_restore_test
   time DATABASE_URL=postgresql://crm:<senha>@localhost:5433/crm_restore_test npm run db:migrate
   docker compose exec -T db psql -U crm -d postgres -c 'drop database if exists crm_restore_test with (force)'
   ```
   Anote o tempo: somado ao seed e ao `npm run build` (que também rodam com o app parado), é a janela em que o CRM fica parado no dia (passo 3). Se passar de alguns minutos, marque o deploy para fora do expediente. Apague a cópia no fim (é cópia de dados de clientes).
2. **Backup antes de tudo** (com o app ainda na versão antiga): `bash scripts/backup.sh` e anote a pasta impressa na última linha. Confira o `SHA256SUMS` da pasta.
3. **Parar o app e o worker antes de migrar**: `pm2 stop crm-web crm-worker`. Nada pode escrever no banco enquanto os índices são criados: as escritas ficariam esperando o cadeado (tela travada, webhook estourando o tempo) e o worker antigo continuaria rodando regras contra um esquema pela metade. Com o app parado, mensagens que chegarem nessa janela podem não entrar no CRM na hora (continuam no WhatsApp): por isso a janela tem de ser curta (o tempo medido no passo 1) e, de preferência, fora do expediente.
4. **`pg_trgm`**: veja o passo 3 da primeira instalação (a 0008 cria a extensão).
5. **Aplicar** `npm run db:migrate` (com tudo parado), que roda:
   - `0008_melhorias.sql`: tabelas novas (`tasks`, `lead_sources`, `outbox`, `push_subscriptions`), colunas novas em `alerts`, `channels`, `contacts`, `lists`, `messages` e `deals` (arquivamento, origem, serviço, pagamento, comparecimento; todas aceitam nulo ou têm padrão), índices trigram de busca e a troca do índice único `deals_one_open_per_contact` (passa a ignorar leads arquivados; é o único `DROP`, e é de índice, recriado na mesma migração);
   - `0009_indices.sql`: só índices `IF NOT EXISTS` (relatórios, fila e busca por telefone). Roda dentro de uma transação, sem `CONCURRENTLY`;
   - `0010_wait_key_legado.sql`: os alertas "sem resposta" que estão abertos desde antes da 0008 não têm `wait_key`, então não contariam como atraso nem escalariam para a gestão (e o motor não cria outro no lugar, porque a chave de deduplicação é a mesma). A 0010 preenche o `wait_key` deles com a espera atual do lead (um por espera, só quem ainda espera resposta) e marca `pushed_at` para não disparar push de alerta antigo. Só preenche coluna nula; rodar de novo não muda nada.
6. **Seed** `npm run db:seed` (idempotente: acrescenta automações e listas novas sem sobrescrever o que a gestão editou; as que enviam mensagem entram desligadas). O seed **não** cria serviços. A retenção de mídia fica em "Não apagar" até a gestão escolher um prazo (nada é apagado no primeiro job depois do deploy).
7. `npm run build`, `pm2 start crm-web crm-worker` e a checagem de saúde (`status: "ok"`, `worker.ok: true`).
8. **Antes de abrir para a equipe** (só leitura, nada é alterado):
   ```bash
   docker compose exec -T db psql -U crm -d crm -c "select key, enabled from automations where actions::text like '%enviar_%'"
   ```
   Toda linha tem de estar com `enabled = f`. Se alguma estiver `t`, desligue em Configurações › Automações e só religue com a aprovação da Casa. Depois, cadastre os serviços (passo 7 da primeira instalação).

**Volta (rollback) desta rodada:** as três migrações são aditivas, então o normal é só voltar o código (seção "Rollback", passo 1): a versão antiga ignora as tabelas e colunas novas, e o índice único novo é menos restritivo que o antigo. **Ressalva: a versão antiga não conhece o arquivamento**, então os leads arquivados ("Não é cliente", triagem) **voltam a aparecer** na Fila, no Quadro e nos números como abertos enquanto ela estiver no ar (nada se perde: ao voltar para a versão nova eles somem de novo). Restaurar o backup do passo 2 só se dados foram corrompidos (passo 2 do "Rollback"); tudo que entrou depois dele se perde. Não há migração "para baixo": desfazer o esquema à mão é migração destrutiva e precisa de aprovação.

## Atualizar (cada versão)

Antes de subir, marque a versão atual para poder voltar e faça um backup:

```bash
cd /opt/crm
git tag -f anterior            # ou use a tag da versão que está no ar (ex.: v1.4.0)
bash scripts/backup.sh
git pull
npm ci
pm2 stop crm-web crm-worker    # nada escreve no banco durante a migração
npm run db:migrate && npm run build
pm2 start crm-web crm-worker
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

## Rodada 2 (perfis, distribuição, atendimento B, relatórios em PDF)

- **Migrações 0011 a 0016**, todas aditivas: perfis e gatilho de perfil padrão, distribuição (disponibilidade, nível, ausente manual), palavras-chave, PDFs (report_files, report_print_tokens). Ensaiar numa cópia antes (0011–0013 levaram 5 s na cópia de 13/10).
- **Chromium para o PDF** (uma vez no VPS, como o usuário `crm`, na pasta do app): `npx playwright install chromium --with-deps` (precisa de sudo para as dependências do sistema; sem custo). Sem ele, "Baixar PDF" responde "PDF indisponível neste servidor" e o resto funciona.
- **PDF_BASE_URL** (opcional): endereço interno que o Chromium abre; padrão `http://127.0.0.1:3000`.
- **Pasta `data/relatorios/`**: fechamentos mensais (job `relatorio-mensal`, 06:00); entra no backup (`relatorios.tgz`).
- **Distribuição automática nasce desligada**: a gestão liga em Configurações › Distribuição.

## Áudio: tocar no iPhone e transcrever (migração 0025)

O WhatsApp manda áudio em ogg/opus, que o Safari/iPhone não toca (o player fica em 0:00). O worker (fila `audio-transcricao`, todo minuto) faz uma cópia `.m4a` (AAC) ao lado do original em `MEDIA_DIR`, mede a duração e transcreve em português com faster-whisper, **um áudio por vez** (até 5 por rodada; áudio de mais de 10 min: só os 10 primeiros minutos; falha tenta mais 2 vezes). Sem ffmpeg ou sem o transcritor nada quebra: o worker registra `[áudio] … não instalado` uma vez no log e o original continua tocando onde o navegador aceita ogg.

- **Migração 0025**, aditiva (colunas em `messages` + 1 índice parcial).
- **Instalar no VPS** (uma vez; não precisa de GPU):
  ```bash
  sudo apt install -y ffmpeg python3-venv
  # como o usuário crm:
  python3 -m venv /home/crm/whisper-venv
  /home/crm/whisper-venv/bin/pip install "faster-whisper==1.2.1" "av<16"   # av 16+ quebra o decode_audio do faster-whisper 1.2.1
  mkdir -p /home/crm/whisper-modelos
  # baixa o modelo uma vez (small ≈ 500 MB; teste rápido com um áudio qualquer do MEDIA_DIR):
  WHISPER_DIR=/home/crm/whisper-modelos /home/crm/whisper-venv/bin/python /opt/crm/scripts/transcrever.py /caminho/um-audio.ogg
  ```
- **`.env`** (o worker lê; reiniciar com `pm2 restart crm-worker --update-env`):
  ```bash
  TRANSCRIBE_CMD=/home/crm/whisper-venv/bin/python /opt/crm/scripts/transcrever.py
  WHISPER_MODEL=small                 # medium transcreve melhor, ~2x mais lento e ~1,5 GB de RAM
  WHISPER_DIR=/home/crm/whisper-modelos
  WHISPER_THREADS=2                   # núcleos que a transcrição pode usar
  TRANSCRIBE_TIMEOUT_MS=480000        # opcional: teto por áudio (padrão 8 min)
  ```
  Sem `TRANSCRIBE_CMD` o padrão é `python3 scripts/transcrever.py` (python do sistema, que não tem o faster-whisper). Caminhos sem espaço.
- **Conferir**: `pm2 logs crm-worker --lines 50 | grep áudio` mostra `{ converted, transcribed, … }`; um áudio novo aparece na conversa com a duração e "Transcrevendo…" e, em até 1–2 min, com a transcrição.
- **Áudios antigos** (opcional, depois de instalado): `npx tsx scripts/transcrever-antigos.ts --dry-run --dias 30` (quantos e o tempo total), depois `--aplicar` (só enfileira; o worker processa aos poucos).
- **Retenção de mídia** apaga a cópia `.m4a` junto com o original. A cópia entra no backup com o resto de `MEDIA_DIR`.

## Backup e operação

- Backup diário às 03h via cron (`scripts/backup.sh`), 14 dias de retenção, fora do repositório, com cópia fora do VPS. Roteiro completo em `docs/backup-restauracao.md`.
- Testar a restauração uma vez por mês: `bash scripts/restore-test.sh` (restaura banco do CRM, banco da Evolution, mídia e sessão só em alvos temporários: `crm_restore_test`, `crm_restore_evolution` e pastas `mktemp`).
- Logs do Docker com driver `local` (já configurado) para o disco não encher.
- Atualizações e volta: seções "Atualizar" e "Rollback" acima.
- Alerta de falha silenciosa: o CRM já avisa a gestão quando um número desconecta; o monitor externo de `/api/health` cobre o resto.

## Lotes 1A, 1B e 1C (15/10): publicar e acertar os dados (só com o ok do dono)

Publicação por pacote em pasta nova (`/opt/crm-rN`; aqui, r14) e troca de pasta, como desde 14/10: `/opt/crm` não é repositório git e nunca guarda estado
(mídia em `MEDIA_DIR=/home/crm/crm-media`, relatórios em `REPORTS_DIR=/home/crm/crm-relatorios`). Fora do expediente (a Casa abre ter–sáb, 9–18h).
Nada aqui envia WhatsApp. Ordem: código → assinaturas → acerto do 1A → tarefas do 1B → funil do 1C → ensaio do motor → worker.

1. No Mac, com tudo verde (`npm test && npm run typecheck && npm run lint && npm run build && npx playwright test`):
   ```bash
   git archive --format=tar.gz -o /tmp/crm-r14.tgz HEAD && scp /tmp/crm-r14.tgz casafiaes:~/ && rm /tmp/crm-r14.tgz
   ```
2. No servidor (`ssh casafiaes`): pasta nova, `.env` copiado e build sem parar o que está no ar.
   ```bash
   ls -d /opt/crm*                                    # confere o número: no ar é a r13 → a nova é r14 (se for outro, troque 14/13 em todos os comandos)
   sudo mkdir /opt/crm-r14 && sudo tar -xzf ~/crm-r14.tgz -C /opt/crm-r14 && sudo chown -R crm:crm /opt/crm-r14 && rm ~/crm-r14.tgz
   sudo -u crm cp /opt/crm/.env /opt/crm-r14/.env && grep -E "MEDIA_DIR|REPORTS_DIR" /opt/crm-r14/.env
   diff -rq --exclude=node_modules --exclude=.next --exclude=.env /opt/crm /opt/crm-r14 | grep "^Only in /opt/crm:"   # esperado: vazio (nada no ar que não esteja no repositório)
   cd /opt/crm-r14 && sudo -u crm npm ci && sudo -u crm npm run build
   ```
3. Backup e parada: `cd /opt/crm && sudo -u crm bash scripts/backup.sh` (anote a pasta) e `sudo -u crm pm2 stop crm-web crm-worker`.
4. Banco, com o código novo: `cd /opt/crm-r14 && sudo -u crm npm run db:migrate && sudo -u crm npm run db:seed` (aplica `0023_quem_atende` e `0024_funil_novo`; o seed cria Orçamento enviado, Atendida, Retorno sugerido, `casa_falou_4h` e `parado_etapa`).
5. Troca de pasta e só a web de volta (o worker fica parado até o fim do passo 9):
   ```bash
   sudo mv /opt/crm /opt/crm-anterior-r13 && sudo mv /opt/crm-r14 /opt/crm
   cd /opt/crm && sudo -u crm pm2 start crm-web && curl -s https://crm.217-76-54-18.sslip.io/api/health   # web no ar; status "degraded" é esperado aqui (worker ainda parado)
   ```
6. Assinaturas, pela tela (Configurações › Equipe): SARA em "Daniela Rezende" e CATI em "Natália Campos".
7. Lote 1A: `cd /opt/crm && sudo -u crm npx tsx scripts/autoria-assinaturas.ts --dry-run` → mostrar as tabelas ao dono → `sudo -u crm npx tsx scripts/autoria-assinaturas.ts --aplicar` (tem de terminar em "Conferência: nada pendente.").
8. Lote 1B: `sudo -u crm npx tsx scripts/tarefas-sem-responsavel.ts --dry-run` → ok do dono → `sudo -u crm env BACKUP_DIR=/home/crm/backups npx tsx scripts/tarefas-sem-responsavel.ts --aplicar`.
9. Lote 1C: `sudo -u crm npx tsx scripts/migrar-funil-lote1c.ts --dry-run` (comparar com a tabela "Migração" da spec; até 3 de diferença por linha é normal) → ok do dono →
   `sudo -u crm npx tsx scripts/migrar-funil-lote1c.ts --aplicar --backup /home/crm/backups/funil-lote1c-$(date +%F)-antes.json` (tem de terminar em "Conferência OK").
10. Ensaio do motor no próximo dia de expediente: `sudo -u crm npx tsx scripts/simular-motor.ts`. Mais de 60 avisos previstos: não ligar o worker, revisar com o dono.
11. Worker: `sudo -u crm pm2 start crm-worker && sudo -u crm pm2 save` e `curl -s https://crm.217-76-54-18.sslip.io/api/health` com `status: "ok"` em até 1 minuto (sem sessão, o `/api/health` mostra só o `status`).
12. No dia seguinte (só leitura):
    ```bash
    docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select a.key, count(*) from automation_runs r join automations a on a.id = r.automation_id where r.created_at > now() - interval '1 day' group by 1 order by 2 desc"
    docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select s.name, count(d.id) from stages s left join deals d on d.stage_id = s.id and d.closed_at is null and d.archived_at is null where s.active group by s.id order by s.position"
    ```
    Esperado: nenhum `followup_diario` nem `parado_1dia`; Em conversa perto de 5 (era 92).

Voltar o código: `sudo -u crm pm2 stop crm-web crm-worker && sudo mv /opt/crm /opt/crm-r14-falhou && sudo mv /opt/crm-anterior-r13 /opt/crm && sudo -u crm pm2 start crm-web crm-worker`.
As migrações são aditivas, então a versão anterior funciona com o banco novo; mas as conversas já movidas para Orçamento enviado/Atendida/Retorno
aparecem nessas colunas sem as ações novas. Dados: `autoria-assinaturas.ts --desfazer <backup>` desfaz o 1A; os JSON do 1B e do 1C guardam o estado
de antes de cada linha (restaurar à mão, com aprovação). Restaurar o backup do passo 3 só se houver dano: perde o que entrou depois.

## Lote 2: ficha e contatos (só com o ok do dono)

Só depois das Tarefas 1 a 15 commitadas, do worktree juntado à `rodada-2` e com o ok do dono para cada passo que grava em produção. Fora do expediente da Casa (ter–sáb, 9h–18h). Nada aqui envia WhatsApp. Mesmo procedimento de pacote em pasta nova dos lotes anteriores (`/opt/crm-rN`).

**I0. Junção e testes (no Mac)**

```bash
git merge --no-ff lote-2                  # na rodada-2, com 1A–1C e a outra frente já juntados
ls drizzle/*.sql | tail -4                 # se outra frente também criou uma 0025: apague drizzle/0025_ficha_contatos.sql e o snapshot dela,
                                           # tire a entrada dela do drizzle/meta/_journal.json e rode de novo: npx drizzle-kit generate --name ficha_contatos
grep -nE "DROP|ALTER COLUMN|RENAME" drizzle/*ficha_contatos.sql   # vazio
npm test && npm run typecheck && npm run lint && npm run build && npx playwright test
```
Esperado: tudo PASS.

**I1–I4. Pacote, build em pasta nova, backup e parada** (igual aos lotes anteriores; `N` = o número seguinte ao da pasta no ar, visto com `ls -d /opt/crm*` no servidor; troque `N` em todos os comandos)

```bash
git archive --format=tar.gz -o /tmp/crm-rN.tgz HEAD && scp /tmp/crm-rN.tgz casafiaes:~/ && rm /tmp/crm-rN.tgz
# no servidor: pasta /opt/crm-rN, .env copiado, npm ci, npm run build (sem parar o que está no ar)
cd /opt/crm && sudo -u crm bash scripts/backup.sh        # anote a pasta do backup
sudo -u crm pm2 stop crm-web crm-worker
```

**I5. Migrar e semear com o código novo**

```bash
cd /opt/crm-rN && sudo -u crm npm run db:migrate && sudo -u crm npm run db:seed
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select count(*) from contact_stats"   # 0 (a tabela nasceu vazia)
```

**I6. Troca de pasta e só a web de volta** (o worker fica parado até o I8)

```bash
sudo mv /opt/crm /opt/crm-anterior && sudo mv /opt/crm-rN /opt/crm && cd /opt/crm && sudo -u crm pm2 start crm-web
curl -s https://crm.217-76-54-18.sslip.io/api/health
```

**I7. Visão por contato (ensaio → aplicar)**

```bash
sudo -u crm npx tsx scripts/visao-contatos.ts            # ENSAIO: nada gravado
```
Esperado, perto da auditoria de 15/10: visitas 1 ≈ 2.363 · 2–4 ≈ 1.110 · 5–11 ≈ 513 · 12+ ≈ 167; com ritmo ≈ 1.163 e mediana ≈ 62 dias; preferida ≈ 752; sumidas ≈ 199; na hora ≈ 118; aniversário mês ≈ 292; nunca voltou ≈ 2.363. Diferença grande (mais de 10%): parar e conferir antes de aplicar.

```bash
sudo -u crm npx tsx scripts/visao-contatos.ts --aplicar  # grava só a tabela derivada (refeita toda noite)
```

**I8. Anotações num campo só (ensaio → ok do dono → aplicar) e worker**

```bash
sudo -u crm npx tsx scripts/unificar-anotacoes.ts       # ENSAIO: ~109 anotações de leads
sudo -u crm env BACKUP_DIR=/home/crm/backups npx tsx scripts/unificar-anotacoes.ts --aplicar
```
Esperado: "Gravado: N contatos. Backup: /home/crm/backups/anotacoes-…-antes.json" e "Conferência: nada pendente.". Para voltar: `--desfazer <esse arquivo>`.

```bash
sudo -u crm pm2 start crm-worker && sudo -u crm pm2 save
curl -s https://crm.217-76-54-18.sslip.io/api/health      # status ok em até 1 min (só o status, sem sessão)
```

**I9. Retorno sugerido (fica DESLIGADO; ligar só com o ok do dono)**

```bash
sudo -u crm npx tsx scripts/retorno-sugerido.ts           # ENSAIO: quem entraria hoje (até 20)
```
Mostrar ao dono a lista e o número. Com o ok: a gestão liga em Configurações › Automações › "Retorno sugerido automático". No próximo dia de expediente, às 08:00, o worker cria os cartões (ou, se o dono quiser ver na hora: `sudo -u crm npx tsx scripts/retorno-sugerido.ts --aplicar`). Para parar: desligar a chave (os cartões já criados ficam; dá para fechar pelo Quadro em massa).

**I10. Conferir (só leitura)**

```bash
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select (select count(*) from contacts) as contatos, (select count(*) from contact_stats) as na_visao"
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select count(*) as anotacoes_presas from deals d join contacts c on c.id = d.contact_id where nullif(trim(d.observations), '') is not null and position(trim(d.observations) in coalesce(c.notes, '')) = 0"
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select count(*) as cartoes_retorno from deals d join stages s on s.id = d.stage_id where s.kind = 'retorno' and d.closed_at is null"
```
Esperado: `na_visao` = `contatos` (menos os criados depois do I7); `anotacoes_presas` = 0; `cartoes_retorno` = 0 até a chave ser ligada.

**I11. Prints** (navegador headless em segundo plano, gestão e atendente; 1440 px e 390 px): ficha de uma cliente frequente (blocos em ordem, frase, retorno, visitas com observação, financeiro só na gestão), painel da conversa (frase, visitas do Avec, "Ver ficha completa"), lista de Contatos com um filtro ligado e a barra de ações em massa, Configurações › Automações com a chave. Salvar numa pasta só (`~/ClaudeGerado/casa-fiaes-crm-lote-2-AAAA-MM-DD/`), mandar ao usuário e apagar a pasta depois de entregue.

**Voltar, se precisar**
- Código: parar web e worker, devolver `/opt/crm-anterior` para `/opt/crm` e subir de novo. A migration é aditiva: a versão anterior ignora `contact_stats`, `alert_notes` e `preferred_professional_id`.
- Anotações: `scripts/unificar-anotacoes.ts --desfazer <backup>`.
- Retorno sugerido: desligar a chave.
- Banco inteiro: o backup do I1–I4, só se houver dano (perde o que entrou depois).

## Lotes 3 e 4 (relatórios do salão e configurações): publicar (só com o ok do dono)

Só depois das tarefas 0 a 4.9 commitadas, de juntar com a `rodada-2` (ver "Riscos da junção" abaixo) e com o ok do dono em cada passo que grava em produção. Fora do expediente da Casa (ter–sáb, 9h–18h). Nada aqui envia WhatsApp: as mensagens automáticas novas sobem desligadas. O procedimento de publicação é o mesmo do plano dos Lotes 1 (tarball, pasta nova `/opt/crm-rN`, backup, migrate + seed com tudo parado, troca de pasta); abaixo, só o que muda.

**J0. Testes verdes na `rodada-2` já juntada**

```bash
npm test && npm run typecheck && npm run lint && npm run build && E2E_PORT=$E2E_PORT npx playwright test
npx vitest run test/evolution-guard.test.ts
```

**J1. Pacote e build em pasta nova** (I1 e I2 do plano dos Lotes 1, com o próximo número de pasta).

**J2. Backup** com a versão antiga no ar: `cd /opt/crm && sudo -u crm bash scripts/backup.sh` (anotar a pasta).

**J3. Retrato das permissões antes** (só leitura):

```bash
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select key, name, permissions from profiles order by key nulls last, name"
```

**J4. Parar, migrar e semear**

```bash
sudo -u crm pm2 stop crm-web crm-worker
cd /opt/crm-rN && sudo -u crm npm run db:migrate && sudo -u crm npm run db:seed
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select key, permissions from profiles order by key nulls last, name"
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "select key from settings where key = 'migracao_permissoes_config' or key like 'msg_%'"
docker exec casa-fiaes-crm-db-1 psql -U crm -d crm -c "\d sales_items" | grep commission
```

Esperado:
- a migration `0025_relatorios_config` (ou o número da junção) aplicada;
- Gestão com `config.diaadia` e `config.sistema`; Atendente e Recepção com `config.diaadia`; nenhum perfil com `config.editar` (perfis criados pela gestão que tinham `config.editar` ficam com as duas);
- em `settings`, só `migracao_permissoes_config` (nenhuma `msg_%`: as mensagens novas estão desligadas);
- `commission_pct` e `commission_cents` em `sales_items`.

**J5. Troca de pasta, web e worker de volta** (I6 do plano dos Lotes 1; aqui o worker pode voltar junto: nada novo roda nele).

**J6. Conferência do faturamento (só leitura; mostrar ao dono)**

```bash
cd /opt/crm && sudo -u crm npx tsx scripts/conferir-faturamento.ts
```

Esperado: por ano, o faturamento (sem as sessões de pacote) perto dos pagamentos (spec: diferença menor que 5%; a auditoria de 15/10 tinha 2024 ≈ R$ 2,57 mi × R$ 2,43 mi, 2025 ≈ R$ 3,06 mi × R$ 2,88 mi, 2026 ≈ R$ 3,12 mi × R$ 3,01 mi, contando as sessões). Se algum ano ficar em 5% ou mais, **não mexer na conta**: mostrar ao dono as duas colunas (com e sem sessões) e decidir com ele.

**J7. Comissão histórica (ensaio → aplicar)**

```bash
sudo -u crm npx tsx scripts/comissao-avec.ts --dry-run
```

Esperado: os relatórios usados ("Itens de comanda", "Comissão por item"), quantos itens ganham comissão (perto dos 25.9 mil itens; os que o Avec escreveu de outro jeito aparecem em "sem o item no CRM") e a tabela por profissional do último mês fechado. O dono confere 2 profissionais com o relatório "Comissão por profissional" do Avec do mesmo mês. Com o ok:

```bash
sudo -u crm npx tsx scripts/comissao-avec.ts --aplicar --backup /home/crm/backups/comissao-avec-$(date +%F)-antes.json
```

Esperado: "Conferência: nada pendente." e a tabela "Como ficou". Para voltar: `--desfazer <esse arquivo>`.

**J8. Conferir nas telas (sem clicar em nada que envie)**
- Gestão: Relatórios › Salão (mês passado), Análise (Retorno por coorte com números, Financeiro com "Fonte: Avec até …", Tempo de resposta por atendente com Sara e Cati), Relatórios do Avec (11 cartões, assuntos recolhidos, "Vazios (N)" no fim).
- Atendente (pedir para a Sara abrir, ou usar um acesso de teste): Configurações mostra Etiquetas, Listas, Profissionais, Origens e links e Distribuição; não mostra WhatsApp, Etapas, Mensagens nem Automações.
- Avisar a equipe: quem atende passa a ajustar etiquetas, respostas prontas, serviços, profissionais e origens.

**J9. Voltar, se precisar**
- Código: trocar a pasta de volta (`/opt/crm-anterior-rN`). A migration é aditiva: o código antigo ignora as colunas novas. No próximo seed do código antigo a Gestão volta a ter `config.editar`; a Atendente fica sem Configurações, como era.
- Comissão: `scripts/comissao-avec.ts --desfazer <backup>`.
- Etapas criadas pela tela continuam no banco (o código antigo as mostra como etapas comuns).

## Lote 5 (paridade ChatGuru): publicar e conferir

**I0. Junção.**
- O lote tem duas migrations aditivas: `0025_lote5_chatguru` e `0026_lote5_ligacoes` (dados da ligação em `messages.call`; `contact_notes.message_id` e `subject`). Se outra frente já usou esses números, apague as duas `.sql` e os snapshots deste lote e rode de novo `npm run db:generate -- --name lote5_chatguru` sobre o schema juntado (uma migration só basta).
- Confira que o SQL novo é o mesmo (só `CREATE TABLE`/`ADD COLUMN`/índices).
- Depois: `npm test && npm run typecheck && npm run lint` verdes na `rodada-2`.

**I1. Backup do banco de produção** pelo procedimento de `docs/backup-restauracao.md`, com o nome `bkp_lote5_AAAAMMDD`.

**I2. Publicar** pelo procedimento de `docs/deploy-contabo.md`: tarball em `/opt/crm-rN` e troca de pasta. Em seguida:
- `npm run db:migrate`: só aditiva; o ensaio é ler o `.sql` antes;
- `npm run db:seed`: idempotente. Não liga nada nem dá `mensagem.massa` a ninguém;
- reiniciar app e worker (pm2).

**I3. Conferir que nasceu tudo desligado** (só SELECT):

```sql
select key, value from settings where key in ('envio_massa', 'menu_boas_vindas');           -- esperado: 0 linhas
select count(*) from profiles where 'mensagem.massa' = any(permissions);                     -- esperado: 0
select count(*) from campaigns;                                                              -- esperado: 0
```

**I4. Evolution: pedir o evento das ligações.**
1. `npx tsx scripts/sincronizar-webhook.ts --dry-run` mostra os números e a lista de eventos.
2. Com o ok do dono, rode `--aplicar`. O comando só reaplica a lista de eventos, sem mexer em `rejectCall`/`msgCall` e sem enviar nada.
3. Confira em Configurações › WhatsApp que o número segue conectado.
4. Teste com ligações feitas **do celular de quem cuida do sistema** (nunca de cliente): uma sem atender aparece como "Ligação perdida"; uma atendida aparece como "Ligação recebida · atendida · N min" (a duração só quando a Evolution mandou o atender e o terminar), com "Anotar o que foi falado" e o lembrete "Anote a ligação de…" para a dona da conversa.

**I5. Conferência na tela** com o usuário da gestão:
- nota interna com @ numa conversa de teste;
- agendar e **cancelar** uma mensagem;
- "Resolvido" e Desfazer;
- as respostas prontas com `{data_horario}` bloqueiam o envio sem horário;
- Configurações mostra "Mensagem em massa" e "Menu de boas-vindas" **desligados**.

**I6. Importação do ChatGuru** (só quando a Casa mandar os CSVs). Para cada arquivo:
1. Copie o arquivo para o servidor (fora do repositório).
2. Rode `BACKUP_DIR=/home/crm/backups npx tsx scripts/importar-chatguru-csv.ts --dry-run arquivo.csv` e mostre a prévia ao dono: linhas, novos, etiquetas, colunas não usadas e descartadas.
3. Com o ok, rode `--aplicar`. Ele grava o backup JSON dos contatos tocados e confere a contagem.
4. Confira 20 clientes conhecidas pela recepção (etiquetas e ficha).

Se a prévia mostrar uma coluna importante em "Não usadas", pare: acrescente o sinônimo com teste e publique antes de importar.

**I7. Mensagem em massa e menu** ficam desligados até o dono pedir. Quando ele pedir:
1. A gestão liga a chave em Configurações (confirmação "Isto vai enviar mensagens reais").
2. A permissão `mensagem.massa` vai só para o perfil que o dono indicar.
3. A primeira mensagem em massa é pequena: até 20 clientes que já escreveram, com intervalo de 3 min, acompanhada.
4. Depois de usar, desligue a chave se não houver outra prevista.

**I8. Desfazer.**
- O código volta pela troca de pasta (`/opt/crm-r(N-1)`). A migration é aditiva e pode ficar.
- Para parar qualquer envio do lote na hora, basta desligar as chaves (`envio_massa`, `menu_boas_vindas`) ou cancelar as agendadas na conversa.
- A importação do ChatGuru tem o backup JSON por arquivo, para conferir e voltar a ficha à mão se preciso.
