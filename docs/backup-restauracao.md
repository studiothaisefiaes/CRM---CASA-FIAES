# Backup e restauração

## O que entra no backup

`scripts/backup.sh` cria uma pasta `AAAA-MM-DD_HHMM/` dentro de `BACKUP_DIR` (padrão `$HOME/backups/casa-fiaes-crm`, **fora do repositório**; permissão 700/600) com:

| Arquivo | Conteúdo |
| --- | --- |
| `crm.dump` | `pg_dump -Fc` do banco `crm` (leads, mensagens, contatos, usuários, automações) |
| `evolution.dump` | `pg_dump -Fc` do banco `evolution` (instâncias e histórico da Evolution API) |
| `media.tgz` | fotos, áudios e figurinhas baixados do WhatsApp (`MEDIA_DIR`, padrão `./data/media`) |
| `evolution_instances.tgz` | volume `evolution_instances` (sessão do WhatsApp; sem ele é preciso ler o QR code de novo) |
| `SHA256SUMS` | soma de verificação de cada arquivo acima |

Pastas com mais de **14 dias** são apagadas ao fim de cada backup (só as que seguem o nome `AAAA-MM-DD_HHMM`). O nome do volume da Evolution é descoberto pelo Docker Compose, então o mesmo script serve no Mac e no Contabo.

Variáveis (no `.env` ou no ambiente): `BACKUP_DIR`, `MEDIA_DIR`, `PG_USER` (padrão `crm`).

## Agendar (Contabo)

Crie antes a pasta do log (senão o cron falha na primeira noite): `mkdir -p ~/backups`.

```cron
# crontab -e   (usuário que roda o docker compose, com o projeto em /opt/crm)
0 3 * * * cd /opt/crm && bash scripts/backup.sh >> $HOME/backups/backup.log 2>&1
```

## Cópia fora do VPS (decisão do dono)

Backup só no mesmo servidor não protege contra perda do VPS. Opções, a escolher:

- **rclone** para um armazenamento externo (Google Drive, Backblaze B2, S3): `rclone copy ~/backups/casa-fiaes-crm remoto:casa-fiaes-crm --max-age 2d`, num cron às 03h30.
- `rsync` para outra máquina de confiança.

Os dumps contêm dados pessoais de clientes: se o destino for de terceiros, criptografe antes (rclone `crypt`) ou use um destino privado.

## Restaurar

`scripts/restore.sh <pasta> [--into-db nome] [--dump crm|evolution] [--yes-overwrite-production]`

- Confere o `SHA256SUMS` antes de qualquer coisa; se não bater, nada é restaurado.
- Sem a flag, só bancos com prefixo `crm_restore` são aceitos (ex.: `crm_restore_test`, `crm_restore_conferencia`); eles são criados se não existirem. Qualquer outro nome (`crm_test`, `crm_e2e`, etc.) é recusado.
- `crm` e `evolution` (produção) só com `--yes-overwrite-production`, e cada dump só vale para o banco de mesmo nome. Nesse caso o script **faz um backup de segurança do estado atual (`scripts/backup.sh`) antes** de sobrescrever e aborta, sem tocar no banco, se esse backup falhar.
- A pasta do backup pode ser relativa ao diretório de onde você chamou o script.

### Inspecionar um backup sem risco

```bash
bash scripts/restore.sh ~/backups/casa-fiaes-crm/2026-10-09_0300 --into-db crm_restore_conferencia
docker compose exec -T db psql -U crm -d crm_restore_conferencia -c 'select count(*) from deals'
docker compose exec -T db psql -U crm -d postgres -c 'drop database crm_restore_conferencia'
```

### Recuperar a produção (desastre ou rollback)

```bash
cd /opt/crm
pm2 stop crm-web crm-worker                      # nada escreve no banco durante a restauração
docker compose stop evolution                    # idem para o banco evolution
PASTA=~/backups/casa-fiaes-crm/2026-10-09_0300   # o backup escolhido
bash scripts/restore.sh "$PASTA" --dump crm --yes-overwrite-production
bash scripts/restore.sh "$PASTA" --dump evolution --yes-overwrite-production
```

Cada `restore.sh --yes-overwrite-production` tira antes um backup de segurança do estado atual (pasta nova em `BACKUP_DIR`), então dá para desfazer a restauração; se esse backup falhar, nada é sobrescrito.

Mídia e sessão do WhatsApp (só se foram perdidas):

```bash
mkdir -p data/media && tar xzf "$PASTA/media.tgz" -C data/media
VOL=$(docker volume ls -q --filter label=com.docker.compose.volume=evolution_instances | head -n 1)
docker run --rm -v "$VOL":/v -v "$PASTA":/b:ro --entrypoint sh postgres:17 -c 'cd /v && tar xzf /b/evolution_instances.tgz'
```

Depois: `docker compose start evolution && pm2 restart crm-web crm-worker` e conferir `/api/health`.

## Testar a restauração (todo mês)

```bash
bash scripts/restore-test.sh
```

Faz um backup novo, restaura o `crm.dump` no banco temporário `crm_restore_test`, compara `count(*)` de `deals`, `messages` e `contacts` com o banco original, imprime `restauração OK` e apaga o banco temporário. Sai com erro se algo divergir. Só esse banco é criado e apagado. O backup gerado fica em `BACKUP_DIR` (é um backup válido).
