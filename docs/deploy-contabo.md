# Migração para o Contabo (sem deploy feito ainda)

O mesmo desenho do local vai para o servidor. Nada depende de serviço pago além do próprio VPS.

## Servidor

- Contabo **Cloud VPS 6** (6 vCPU, 12 GB RAM, 100 GB NVMe), Ubuntu 24.04.
- Docker + Docker Compose, Node 22 LTS, pm2, Caddy (TLS automático).
- Firewall: abrir só 22 (SSH com chave), 80 e 443. Postgres (5433) e Evolution (8080) **não** ficam expostos: só o app fala com eles pela rede local.

## Passos

```bash
# 1. código
git clone <repo da Casa Fiaes> /opt/crm && cd /opt/crm
cp .env.example .env   # gerar segredos novos: openssl rand -hex 32
#   DATABASE_URL=postgresql://crm:<senha forte>@localhost:5433/crm
#   APP_URL=https://crm.<dominio>
#   WEBHOOK_PUBLIC_URL=http://host.docker.internal:3000   (Evolution chama o app pela rede do Docker)
#   DEV_TOOLS=false
# 2. infraestrutura
docker compose up -d
# 3. app
npm ci && npm run db:migrate && npm run db:seed && npm run build
npm run seed:admin -- --email gestao@<dominio> --name "Gestão"
pm2 start "npm run start" --name crm-app
pm2 start "npm run worker" --name crm-worker
pm2 save && pm2 startup
```

Caddy (`/etc/caddy/Caddyfile`):

```
crm.<dominio> {
  encode zstd gzip
  reverse_proxy localhost:3000 {
    flush_interval -1   # necessário para o tempo real (SSE)
  }
}
```

No DNS do domínio: registro **A** `crm` → IP do VPS.

## Migrar os dados do local (opcional)

```bash
pg_dump -Fc -h localhost -p 5433 -U crm crm > crm.dump          # no Mac
pg_restore -h localhost -p 5433 -U crm -d crm --clean crm.dump   # no VPS
```

Os números de WhatsApp precisam ser **conectados de novo** (QR code) no servidor: a sessão do Baileys fica no volume da Evolution.

## Backup e operação

- Backup diário: `pg_dump -Fc` às 03h via cron, guardando 7 diários + 4 semanais, e cópia fora do VPS.
- Testar restauração uma vez por mês num banco temporário.
- Logs do Docker com driver `local` (já configurado) para o disco não encher.
- Atualizações: `git pull && npm ci && npm run db:migrate && npm run build && pm2 restart crm-app crm-worker`.
- Alerta de falha silenciosa: o CRM já avisa a gestão quando um número desconecta; adicionar um monitor externo de `/api/health`.
