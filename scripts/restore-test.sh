#!/usr/bin/env bash
# Teste de restauração: faz um backup novo, restaura o dump do crm no banco temporário
# crm_restore_test e compara count(*) de deals, messages e contacts com o banco original.
# Só cria/apaga crm_restore_test; nenhum outro banco é alterado. Sai com código != 0 se divergir.
set -euo pipefail
umask 077

# shellcheck source=scripts/lib-ops.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib-ops.sh"

TEST_DB="crm_restore_test"
TABLES=(deals messages contacts)

drop_test_db() { psql_db postgres -qc "drop database if exists $TEST_DB" >/dev/null 2>&1 || true; }
trap drop_test_db EXIT

backup="$(bash "$REPO_DIR/scripts/backup.sh" | tail -n 1)"
[ -d "$backup" ] || die "backup não gerou pasta"

drop_test_db
bash "$REPO_DIR/scripts/restore.sh" "$backup" --into-db "$TEST_DB"

fail=0
for t in "${TABLES[@]}"; do
  src="$(psql_db crm -Atc "select count(*) from $t")"
  dst="$(psql_db "$TEST_DB" -Atc "select count(*) from $t")"
  if [ "$src" = "$dst" ]; then
    printf '  %-9s original=%s restaurado=%s  ok\n' "$t" "$src" "$dst"
  else
    printf '  %-9s original=%s restaurado=%s  DIVERGE\n' "$t" "$src" "$dst"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  die "restauração divergiu do original (backup em $backup)"
fi
printf 'restauração OK (backup testado: %s)\n' "$backup"
