import type { NextConfig } from "next";

// Datas sempre no fuso da Casa (o VPS roda em UTC).
process.env.TZ ??= "America/Bahia";

// cacheComponents desligado: o CRM é 100% dinâmico e autenticado (ver spec §3).
const nextConfig: NextConfig = {
  // Pasta de build separada para o servidor de testes e2e rodar junto do dev.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["pg", "pg-boss", "@node-rs/argon2"],
  experimental: { serverActions: { bodySizeLimit: "16mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
