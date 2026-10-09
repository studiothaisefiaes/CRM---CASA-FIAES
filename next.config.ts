import type { NextConfig } from "next";

// cacheComponents desligado: o CRM é 100% dinâmico e autenticado (ver spec §3).
const nextConfig: NextConfig = {
  // Pasta de build separada para o servidor de testes e2e rodar junto do dev.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["pg", "pg-boss", "@node-rs/argon2"],
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
