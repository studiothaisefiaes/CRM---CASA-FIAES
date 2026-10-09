# shellcheck shell=bash
# Funções comuns de backup/restauração. Não executar direto: é carregado por backup.sh, restore.sh e restore-test.sh.

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR" || exit 1

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die() { printf 'ERRO: %s\n' "$*" >&2; exit 1; }

# Lê CHAVE do ambiente ou do .env (sem executar o arquivo).
env_get() {
  local key="$1" def="${2:-}" val
  val="${!key:-}"
  if [ -z "$val" ] && [ -f "$REPO_DIR/.env" ]; then
    val="$(grep -E "^${key}=" "$REPO_DIR/.env" | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')" || true
  fi
  printf '%s' "${val:-$def}"
}

PG_USER="$(env_get PG_USER crm)"
# shellcheck disable=SC2034  # usado por backup.sh
BACKUP_DIR="$(env_get BACKUP_DIR "$HOME/backups/casa-fiaes-crm")"
MEDIA_DIR="$(env_get MEDIA_DIR "$REPO_DIR/data/media")"
case "$MEDIA_DIR" in /*) ;; *) MEDIA_DIR="$REPO_DIR/$MEDIA_DIR" ;; esac

# Bancos que nunca recebem restauração (dev/testes automatizados e sistema).
never_restore_db() {
  case "$1" in crm_test | crm_e2e | postgres | template0 | template1) return 0 ;; *) return 1 ;; esac
}
# Bancos reais: só com --yes-overwrite-production.
is_production_db() {
  case "$1" in crm | evolution) return 0 ;; *) return 1 ;; esac
}

dc() { docker compose "$@"; }
psql_db() { local db="$1"; shift; dc exec -T db psql -U "$PG_USER" -d "$db" -v ON_ERROR_STOP=1 "$@"; }

# Soma de verificação: sha256sum (Linux) ou shasum (macOS).
if command -v sha256sum >/dev/null 2>&1; then
  sha_make() { sha256sum -- "$@"; }
  sha_check() { sha256sum -c "$1"; }
else
  sha_make() { shasum -a 256 -- "$@"; }
  sha_check() { shasum -a 256 -c "$1"; }
fi

# Nome real do volume da Evolution (prefixo do projeto compose varia: casa-fiaes-crm_ aqui, outro no servidor).
evolution_volume() {
  local cid project vol
  cid="$(dc ps -q db)"
  [ -n "$cid" ] || die "serviço db do docker compose não está rodando (npm run infra:up)"
  project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$cid")"
  vol="$(docker volume ls -q \
    --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.volume=evolution_instances" | head -n 1)"
  [ -n "$vol" ] || vol="${COMPOSE_PROJECT_NAME:-$project}_evolution_instances"
  docker volume inspect "$vol" >/dev/null 2>&1 || die "volume da Evolution não encontrado ($vol)"
  printf '%s' "$vol"
}

# Imagem já presente no host (a do próprio db) para empacotar volumes sem baixar nada.
helper_image() {
  docker inspect -f '{{.Config.Image}}' "$(dc ps -q db)"
}
