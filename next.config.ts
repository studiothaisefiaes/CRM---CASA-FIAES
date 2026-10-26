import type { NextConfig } from "next";

// Datas sempre no fuso da Casa (o VPS roda em UTC).
process.env.TZ ??= "America/Bahia";

// cacheComponents desligado: o CRM é 100% dinâmico e autenticado (ver spec §3).
const nextConfig: NextConfig = {
  // Pasta de build separada para o servidor de testes e2e rodar junto do dev.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Só dev: o e2e abre o domínio dos links da cliente (CLIENT_LINK_URL) por 127.0.0.1 no mesmo servidor.
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["pg", "pg-boss", "@node-rs/argon2"],
  // Vídeo bruto da resposta pronta e da Biblioteca até 64 MB (comprimido no servidor, 24/10) + folga do multipart; o proxy corta em 10 MB
  // se não for elevado. Cada ação confere o seu limite (envio pela conversa continua 16 MB em sendMediaFromCrm/sendMediaAction) e o
  // src/proxy.ts recusa, pelo tamanho declarado, corpo acima de 20 MB fora de Respostas prontas e Biblioteca (inclusive nas telas sem login).
  experimental: { proxyClientMaxBodySize: "70mb", serverActions: { bodySizeLimit: "70mb" } },
  // A CSP (com nonce por requisição) fica no src/proxy.ts; aqui só o que vale igual para tudo.
  // "Contatos" virou "Clientes" na tela: o endereço novo leva ao antigo (os links que já existem continuam valendo).
  async redirects() {
    return [
      { source: "/clientes", destination: "/contatos", permanent: false },
      { source: "/clientes/:path*", destination: "/contatos/:path*", permanent: false },
    ];
  },
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
        // HSTS (revisão 17/10, B2): o Caddy do deploy não manda (deploy/Caddyfile.example). Em http (dev, e2e) o navegador ignora.
        { key: "Strict-Transport-Security", value: "max-age=31536000" },
        // Microfone liberado só para o próprio CRM gravar áudio.
        { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
      ],
    }, {
      // Lote 7B: página pública do link da cliente e do agendamento online. O token está no endereço: nada de Referer (Maps, wa.me),
      // nada de cache e nada de indexar (seção 9.4.9).
      source: "/c/:path*",
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
        { key: "Cache-Control", value: "no-store" },
      ],
    }, {
      source: "/agendar",
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
        { key: "Cache-Control", value: "no-store" },
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
