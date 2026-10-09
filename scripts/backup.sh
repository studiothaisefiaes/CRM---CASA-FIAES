#!/usr/bin/env bash
# Backup do CRM: bancos crm e evolution (pg_dump -Fc), mídia baixada e volume da Evolution.
# Saída: $BACKUP_DIR/AAAA-MM-DD_HHMM/ (padrão ~/backups/casa-fiaes-crm, fora do repositório).
# Guarda 14 dias. O caminho da pasta criada é a última linha impressa em stdout.
set -euo pipefail
umask 077

# shellcheck source=scripts/lib-ops.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib-ops.sh"

RETENTION_DAYS=14
case "$BACKUP_DIR" in "$REPO_DIR" | "$REPO_DIR"/*) die "BACKUP_DIR não pode ficar dentro do repositório ($BACKUP_DIR)" ;; esac

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
stamp="$(date +%Y-%m-%d_%H%M)"
dest="$BACKUP_DIR/$stamp"
[ ! -e "$dest" ] || dest="$dest-$$"
work="$dest.partial"
mkdir "$work"
cleanup() { [ -d "$work" ] && rm -rf -- "$work"; return 0; }
trap cleanup EXIT

dc ps -q db | grep -q . || die "serviço db do docker compose não está rodando (npm run infra:up)"

for db in crm evolution; do
  log "pg_dump do banco $db"
  dc exec -T db pg_dump -U "$PG_USER" -Fc "$db" >"$work/$db.dump"
  # Confere que o dump é legível (lista o conteúdo; falha se estiver truncado).
  dc exec -T db pg_restore -l <"$work/$db.dump" >/dev/null || die "dump de $db ilegível"
done

if [ -d "$MEDIA_DIR" ]; then
  log "mídia: $MEDIA_DIR"
  tar czf "$work/media.tgz" -C "$MEDIA_DIR" .
else
  log "pasta de mídia inexistente ($MEDIA_DIR): media.tgz vazio"
  empty="$(mktemp -d)"
  tar czf "$work/media.tgz" -C "$empty" .
  rmdir "$empty"
fi

vol="$(evolution_volume)"
log "volume da Evolution: $vol"
docker run --rm -v "$vol":/v:ro --entrypoint tar "$(helper_image)" czf - -C /v . >"$work/evolution_instances.tgz"

(cd "$work" && sha_make crm.dump evolution.dump media.tgz evolution_instances.tgz >SHA256SUMS)

mv "$work" "$dest"
trap - EXIT

# Rotação: só pastas de backup com o nome AAAA-MM-DD_HHMM*, mais antigas que 14 dias.
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??_????*' -mtime +"$RETENTION_DAYS" -exec rm -rf -- {} + || true

log "backup pronto: $dest ($(du -sh "$dest" | cut -f1))"
printf '%s\n' "$dest"
