#!/usr/bin/env bash
# Teste de restauração (spec §12, critério 11): faz um backup novo e restaura TUDO em alvos temporários, sem tocar no que está no ar.
#   - crm.dump        → banco temporário crm_restore_test; compara deals, messages e contacts com o crm
#   - evolution.dump  → banco temporário crm_restore_evolution; confere as tabelas da Evolution (Instance, Message, Contact…)
#   - media.tgz       → pasta temporária (mktemp); confere que todos os arquivos saem do pacote
#   - evolution_instances.tgz (sessão do WhatsApp) → pasta temporária; confere que a sessão está no pacote
# Só cria/apaga os dois bancos crm_restore_* e as pastas temporárias. Os bancos crm e evolution são só LIDOS (pg_dump/count);
# o volume da Evolution é montado só para leitura (:ro) pelo backup. A Evolution não é parada nem reiniciada.
# Sai com código != 0 se algo divergir ou se um banco temporário (cópia de dados de clientes) não puder ser apagado.
#   restore-test.sh              o backup gerado fica em BACKUP_DIR (é um backup válido)
#   restore-test.sh --descartar  o backup vai para uma pasta temporária, apagada no fim (só testar, sem guardar cópia)
set -euo pipefail
umask 077

discard=0
case "${1:-}" in
  --descartar) discard=1 ;;
  "") ;;
  *) printf 'uso: %s [--descartar]\n' "$0" >&2; exit 2 ;;
esac
# Antes de carregar a lib: o BACKUP_DIR dela (e o do backup.sh, que roda em outro processo) vem do ambiente.
[ "$discard" -eq 0 ] || export BACKUP_DIR="$(mktemp -d)"

# shellcheck source=scripts/lib-ops.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib-ops.sh"

TEST_DB="crm_restore_test"
EVO_DB="crm_restore_evolution"
TABLES=(deals messages contacts)
EVO_TABLES=(Instance Message Contact)

work_dir="$(mktemp -d)"
# Apaga os bancos temporários e confere que sumiram: uma cópia de dados de clientes não pode ficar para trás em silêncio.
drop_test_dbs() {
  local db left=0 still
  for db in "$TEST_DB" "$EVO_DB"; do
    psql_db postgres -q -c "set client_min_messages = warning" -c "drop database if exists $db with (force)" >/dev/null || true
    if ! still="$(psql_db postgres -Atc "select 1 from pg_database where datname = '$db'")"; then
      printf 'ERRO: não deu para conferir se o banco temporário %s foi apagado. Confira e apague à mão:\n  docker compose exec -T db psql -U %s -d postgres -c "drop database if exists %s with (force)"\n' "$db" "$PG_USER" "$db" >&2
      left=1
    elif [ -n "$still" ]; then
      printf 'ERRO: o banco temporário %s (cópia de dados de clientes) continua existindo. Apague à mão:\n  docker compose exec -T db psql -U %s -d postgres -c "drop database %s with (force)"\n' "$db" "$PG_USER" "$db" >&2
      left=1
    fi
  done
  return "$left"
}
cleanup() {
  local rc=$?
  drop_test_dbs || rc=1
  rm -rf -- "$work_dir"
  [ "$discard" -eq 0 ] || rm -rf -- "$BACKUP_DIR"
  exit "$rc"
}
trap cleanup EXIT

backup="$(bash "$REPO_DIR/scripts/backup.sh" | tail -n 1)"
[ -d "$backup" ] || die "backup não gerou pasta"

drop_test_dbs || die "bancos temporários de uma execução anterior não puderam ser apagados"
fail=0

log "1/4 banco do CRM → $TEST_DB"
bash "$REPO_DIR/scripts/restore.sh" "$backup" --into-db "$TEST_DB"
for t in "${TABLES[@]}"; do
  dst="$(psql_db "$TEST_DB" -Atc "select count(*) from $t")"
  # O CRM continua recebendo mensagens durante o teste: compara só o que já existia até a linha mais nova do backup.
  bound="$(psql_db "$TEST_DB" -Atc "select coalesce(max(created_at), 'epoch')::text from $t")"
  src="$(psql_db crm -Atc "select count(*) from $t where created_at <= '$bound'::timestamptz")"
  if [ "$src" = "$dst" ]; then
    printf '  %-9s original=%s restaurado=%s  ok\n' "$t" "$src" "$dst"
  else
    printf '  %-9s original=%s restaurado=%s  DIVERGE\n' "$t" "$src" "$dst"
    fail=1
  fi
done

log "2/4 banco da Evolution → $EVO_DB"
bash "$REPO_DIR/scripts/restore.sh" "$backup" --dump evolution --into-db "$EVO_DB"
# As tabelas da Evolution ficam num schema próprio (evolution_api na v2); descobre pelo banco no ar, só lendo o catálogo.
evo_schema="$(psql_db evolution -Atc "select schemaname from pg_tables where tablename = 'Instance' limit 1")"
[ -n "$evo_schema" ] || die "tabela Instance não encontrada no banco evolution"
for t in "${EVO_TABLES[@]}"; do
  dst="$(psql_db "$EVO_DB" -Atc "select count(*) from \"$evo_schema\".\"$t\"")"
  src="$(psql_db evolution -Atc "select count(*) from \"$evo_schema\".\"$t\"")"
  # A Evolution grava o tempo todo: o restaurado pode ter menos linhas que o vivo, nunca mais; e não pode vir vazio se o vivo tem dados.
  if [ "$dst" -le "$src" ] && { [ "$src" -eq 0 ] || [ "$dst" -gt 0 ]; }; then
    printf '  %-9s no ar=%s restaurado=%s  ok\n' "$t" "$src" "$dst"
  else
    printf '  %-9s no ar=%s restaurado=%s  DIVERGE\n' "$t" "$src" "$dst"
    fail=1
  fi
done

log "3/4 mídia → pasta temporária"
mkdir "$work_dir/media"
listed="$(tar tzf "$backup/media.tgz" | grep -cv '/$' || true)"
tar xzf "$backup/media.tgz" -C "$work_dir/media"
extracted="$(find "$work_dir/media" -type f | wc -l | tr -d ' ')"
live="$( [ -d "$MEDIA_DIR" ] && find "$MEDIA_DIR" -type f | wc -l | tr -d ' ' || echo 0)"
if [ "$listed" = "$extracted" ] && [ "$extracted" -le "$live" ] && { [ "$live" -eq 0 ] || [ "$extracted" -gt 0 ]; }; then
  printf '  %-9s no ar=%s no pacote=%s restaurados=%s  ok\n' "arquivos" "$live" "$listed" "$extracted"
else
  printf '  %-9s no ar=%s no pacote=%s restaurados=%s  DIVERGE\n' "arquivos" "$live" "$listed" "$extracted"
  fail=1
fi

log "4/4 sessão do WhatsApp (volume da Evolution) → pasta temporária"
mkdir "$work_dir/evolution"
tar xzf "$backup/evolution_instances.tgz" -C "$work_dir/evolution" 2>/dev/null || tar xzf "$backup/evolution_instances.tgz" -C "$work_dir/evolution"
# Cada instância guarda a sessão numa pasta do volume com o id da instância. Instância sem pasta = QR code de novo depois de restaurar.
files="$(find "$work_dir/evolution" -type f | wc -l | tr -d ' ')"
instances=0 missing=()
while IFS='|' read -r iid iname; do
  [ -n "$iid" ] || continue
  instances=$((instances + 1))
  if [ -z "$(find "$work_dir/evolution/$iid" -type f -print -quit 2>/dev/null)" ]; then missing+=("$iname ($iid)"); fi
done < <(psql_db "$EVO_DB" -Atc "select id, name from \"$evo_schema\".\"Instance\" order by name")
if [ "${#missing[@]}" -eq 0 ]; then
  printf '  %-9s instâncias=%s todas com pasta de sessão, arquivos=%s  ok\n' "sessão" "$instances" "$files"
else
  printf '  %-9s instâncias=%s sem pasta de sessão: %s  DIVERGE\n' "sessão" "$instances" "${missing[*]}"
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  die "restauração divergiu do original (backup em $backup)"
fi
if [ "$discard" -eq 1 ]; then printf 'restauração OK: banco do CRM, banco da Evolution, mídia e sessão (backup temporário, apagado ao sair)\n'
else printf 'restauração OK: banco do CRM, banco da Evolution, mídia e sessão (backup testado: %s)\n' "$backup"; fi
