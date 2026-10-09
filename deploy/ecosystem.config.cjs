// pm2: `pm2 start deploy/ecosystem.config.cjs` na raiz do projeto (/opt/crm).
// O Next lê o .env da raiz; o worker carrega o mesmo arquivo com dotenv (cwd = raiz do projeto).
const cwd = process.env.CRM_DIR || "/opt/crm";

module.exports = {
  apps: [
    {
      name: "crm-web",
      cwd,
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      env: { NODE_ENV: "production" },
      max_memory_restart: "1G",
      autorestart: true,
      kill_timeout: 10000,
      time: true,
    },
    {
      name: "crm-worker",
      cwd,
      script: "worker/index.ts",
      interpreter: `${cwd}/node_modules/.bin/tsx`,
      env: { NODE_ENV: "production" },
      max_memory_restart: "512M",
      autorestart: true,
      kill_timeout: 10000,
      time: true,
    },
  ],
};
