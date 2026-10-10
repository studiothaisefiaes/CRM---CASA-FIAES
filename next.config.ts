import type { NextConfig } from "next";

// Datas sempre no fuso da Casa (o VPS roda em UTC).
process.env.TZ ??= "America/Bahia";

// cacheComponents desligado: o CRM é 100% dinâmico e autenticado (ver spec §3).
const nextConfig: NextConfig = {
  // Pasta de build separada para o servidor de testes e2e rodar junto do dev.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["pg", "pg-boss", "@node-rs/argon2"],
  // 16 MB de arquivo (anexo/gravação) + folga do multipart; o proxy corta em 10 MB se não for elevado.
  experimental: { proxyClientMaxBodySize: "20mb", serverActions: { bodySizeLimit: "20mb" } },
  // A CSP (com nonce por requisição) fica no src/proxy.ts; aqui só o que vale igual para tudo.
  async headers() {
    return [{
      // O navegador confere o service worker a cada abertura; nunca pode vir de cache.
      source: "/sw.js",
      headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
    }, {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        // Microfone liberado só para o próprio CRM gravar áudio.
        { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
      ],
    }];
  },
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
