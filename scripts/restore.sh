#!/usr/bin/env bash
# Restaura um dump de uma pasta de backup em um banco do Postgres do docker compose.
#   restore.sh <pasta> [--into-db nome] [--dump crm|evolution] [--yes-overwrite-production]
# Sem --into-db o destino é o banco de produção "crm", que exige --yes-overwrite-production.
# Nunca restaura em crm_test / crm_e2e. Mídia e volume da Evolution: veja docs/backup-restauracao.md.
set -euo pipefail
umask 077

# shellcheck source=scripts/lib-ops.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib-ops.sh"

usage() { sed -n '2,5p' "${BASH_SOURCE[0]}" >&2; exit 2; }

folder="" into="" which="crm" overwrite=0
while [ $# -gt 0 ]; do
  case "$1" in
    --into-db) [ $# -ge 2 ] || usage; into="$2"; shift 2 ;;
    --dump) [ $# -ge 2 ] || usage; which="$2"; shift 2 ;;
    --yes-overwrite-production) overwrite=1; shift ;;
    -h | --help) usage ;;
    -*) die "opção desconhecida: $1" ;;
    *) [ -z "$folder" ] || usage; folder="$1"; shift ;;
  esac
done
[ -n "$folder" ] || usage
[ -d "$folder" ] || die "pasta de backup não encontrada: $folder"
case "$which" in crm | evolution) ;; *) die "--dump deve ser crm ou evolution" ;; esac
into="${into:-$which}"
[[ "$into" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || die "nome de banco inválido: $into"

never_restore_db "$into" && die "recusado: $into nunca recebe restauração"
if is_production_db "$into" && [ "$overwrite" -ne 1 ]; then
  die "recusado: $into é banco de produção. Use --yes-overwrite-production (pare o app e o worker antes)"
fi
if is_production_db "$into" && [ "$into" != "$which" ]; then
  die "recusado: não restaura o dump de $which no banco $into"
fi
if ! is_production_db "$into" && [ "$overwrite" -eq 1 ]; then
  die "--yes-overwrite-production só vale para crm ou evolution"
fi

log "conferindo SHA256SUMS"
(cd "$folder" && sha_check SHA256SUMS >&2) || die "checksum não confere: backup corrompido"
dump="$folder/$which.dump"
[ -f "$dump" ] || die "arquivo ausente: $dump"

exists="$(psql_db postgres -Atc "select 1 from pg_database where datname = '$into'")"
if [ -z "$exists" ]; then
  log "criando banco $into"
  psql_db postgres -qc "create database \"$into\""
elif is_production_db "$into"; then
  log "ATENÇÃO: sobrescrevendo $into (produção)"
else
  log "banco $into já existe: limpando objetos antes de restaurar"
fi

log "pg_restore de $which.dump em $into"
dc exec -T db pg_restore -U "$PG_USER" -d "$into" --clean --if-exists --no-owner --exit-on-error <"$dump"
log "restauração concluída em $into"
