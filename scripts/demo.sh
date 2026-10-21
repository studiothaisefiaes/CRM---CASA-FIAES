#!/usr/bin/env bash
# Ambiente de DEMONSTRAÇÃO do CRM: dados fictícios no banco crm_demo, app na porta 3200 (rede local) e WhatsApp de mentira.
# Outra cópia, sem apagar o crm_demo de ninguém: DEMO_DB=crm_demo_<nome> (e DEMO_PORT=<porta>) scripts/demo.sh seed
#
#   scripts/demo.sh seed      recria o banco crm_demo do zero (para o demo antes, se estiver rodando)
#   scripts/demo.sh start     builda (se o código mudou) e sobe o app (0.0.0.0:3200) + o worker do demo
#   scripts/demo.sh refresh   refaz os leads em relação ao AGORA (Fila viva) sem derrubar o app nem deslogar ninguém
#   scripts/demo.sh stop      para só os processos que este script iniciou (PIDs em .demo/)
#   scripts/demo.sh status    mostra o que está rodando
#
# Nunca toca no banco crm, no .env nem na Evolution real (8080): as variáveis do demo vão só no ambiente destes processos.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
STATE="$ROOT/.demo"
PORT=${DEMO_PORT:-3200}
DEMO_DB=${DEMO_DB:-crm_demo}
case "$DEMO_DB" in crm_demo|crm_demo_[a-z0-9]*) ;; *) echo "DEMO_DB precisa ser crm_demo ou crm_demo_<nome>"; exit 1 ;; esac
mkdir -p "$STATE"

REAL_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d "\"'")
DEMO_URL=$(node -e 'const u = new URL(process.argv[1]); u.pathname = "/" + process.argv[2]; console.log(u.toString())' "$REAL_URL" "$DEMO_DB")
export DATABASE_URL="$DEMO_URL" DEMO=true DEV_TOOLS=true \
  EVOLUTION_URL=http://127.0.0.1:9 WEBHOOK_PUBLIC_URL=http://127.0.0.1:9 APP_URL="http://localhost:$PORT" \
  NEXT_DIST_DIR=.next-demo PDF_BASE_URL="http://127.0.0.1:$PORT" TRUSTED_PROXY_HOPS=0 MEDIA_DIR="$STATE/media" TZ=America/Bahia
# Opcional: .env.demo (fora do git) sobrescreve algo do demo, nunca o banco.
if [ -f .env.demo ]; then set -a; . ./.env.demo; set +a; export DATABASE_URL="$DEMO_URL"; fi

# Recusa a Evolution real antes de qualquer coisa.
guard() { npx tsx e2e/evolution-guard.ts; }

# Só mata um PID que este script gravou E que ainda é o processo esperado (PID pode ser reaproveitado pelo sistema).
ours() { local pid=$1 pat=$2; [ -n "$pid" ] && ps -p "$pid" -o command= 2>/dev/null | grep -q -- "$pat"; }
stop_one() {
  local name=$1 pat=$2 file="$STATE/$1.pid"
  [ -f "$file" ] || return 0
  for pid in $(cat "$file"); do
    if ours "$pid" "$pat"; then
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 30); do ours "$pid" "$pat" || break; sleep 0.5; done
      ours "$pid" "$pat" && kill -9 "$pid" 2>/dev/null || true
      echo "parado: $name ($pid)"
    fi
  done
  rm -f "$file"
}
stop_web() { stop_one web "next"; }
stop_worker() { stop_one worker "worker/index.ts"; }

start_worker() {
  if [ -f "$STATE/worker.pid" ] && ours "$(cat "$STATE/worker.pid")" "worker/index.ts"; then echo "worker do demo já está rodando"; return; fi
  nohup node --import tsx worker/index.ts >> "$STATE/worker.log" 2>&1 &
  echo $! > "$STATE/worker.pid"
  echo "worker do demo: PID $(cat "$STATE/worker.pid") (banco crm_demo; log em .demo/worker.log)"
}

build_if_needed() {
  # Carimbo pelo CONTEÚDO (diff + arquivos novos), não só pela lista de arquivos mudados: editar um arquivo já modificado também rebuilda.
  local stamp; stamp="$(git rev-parse HEAD)-$({ git diff HEAD -- src public next.config.ts package.json; git ls-files -o --exclude-standard -z -- src public | xargs -0 cat 2>/dev/null; } | shasum | cut -c1-12)"
  if [ -f .next-demo/BUILD_ID ] && [ "$(cat "$STATE/build-stamp" 2>/dev/null)" = "$stamp" ]; then return; fi
  echo "buildando o app do demo (.next-demo)…"
  # O build reescreve o next-env.d.ts (fora do git) para apontar para .next-demo: devolve o do usuário depois.
  cp next-env.d.ts "$STATE/next-env.d.ts.bak" 2>/dev/null || true
  node node_modules/next/dist/bin/next build > "$STATE/build.log" 2>&1 || { cp "$STATE/next-env.d.ts.bak" next-env.d.ts 2>/dev/null || true; tail -40 "$STATE/build.log"; exit 1; }
  cp "$STATE/next-env.d.ts.bak" next-env.d.ts 2>/dev/null || true
  echo "$stamp" > "$STATE/build-stamp"
}

start_web() {
  if [ -f "$STATE/web.pid" ] && ours "$(head -1 "$STATE/web.pid")" "next"; then echo "app do demo já está rodando"; return; fi
  if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then echo "A porta $PORT já está em uso por outro processo. Nada foi iniciado."; exit 1; fi
  build_if_needed
  nohup node node_modules/next/dist/bin/next start -H 0.0.0.0 -p $PORT >> "$STATE/web.log" 2>&1 &
  local pid=$!
  echo $pid > "$STATE/web.pid"
  for _ in $(seq 1 60); do curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 1; done
  # Se o next start abrir um processo filho para servir, ele também fica registrado (e só ele, se for nosso).
  for l in $(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null); do [ "$l" != "$pid" ] && ours "$l" "next" && echo "$l" >> "$STATE/web.pid" || true; done
  echo "app do demo: http://localhost:$PORT  (celular: http://$(ipconfig getifaddr en0 2>/dev/null || echo IP-da-rede):$PORT)"
}

case "${1:-}" in
  seed)
    guard; stop_worker; stop_web
    npx tsx scripts/seed-demo.ts ;;
  refresh)
    guard
    had_worker=0; [ -f "$STATE/worker.pid" ] && ours "$(cat "$STATE/worker.pid")" "worker/index.ts" && had_worker=1
    stop_worker
    npx tsx scripts/seed-demo.ts --refresh
    [ $had_worker = 1 ] && start_worker || true ;;
  start)
    guard; start_web; start_worker
    echo "login: demo@casafiaes.com.br / demo1234 · simulador: http://localhost:$PORT/dev/simulador" ;;
  stop)
    stop_worker; stop_web ;;
  restart)
    stop_worker; stop_web; guard; start_web; start_worker ;;
  status)
    for n in web worker; do
      f="$STATE/$n.pid"; pat=$([ $n = web ] && echo next || echo worker/index.ts)
      if [ -f "$f" ] && ours "$(head -1 "$f")" "$pat"; then echo "$n: rodando (PID $(tr '\n' ' ' < "$f"))"; else echo "$n: parado"; fi
    done
    curl -fsS "http://127.0.0.1:$PORT/api/health" 2>/dev/null && echo || true ;;
  *)
    sed -n '2,10p' "$0"; exit 1 ;;
esac
