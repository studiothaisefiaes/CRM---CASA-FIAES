import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Builds paralelas (e2e em .next-e2e, conferências em .next-*) e saídas do Playwright: gerados, nunca código-fonte.
    ".next-*/**",
    "test-results/**",
    "playwright-report/**",
  ]),
  // Prefixo "_" = descartado de propósito (ex.: tirar um campo com rest: `const { media: _media, ...cols }`).
  // Foto, figurinha e avatar vêm de /api/media e /api/avatar, que exigem a sessão: o otimizador do next/image busca sem o cookie.
  { files: ["src/components/lead/conversation.tsx", "src/components/ui/contact-avatar.tsx"], rules: { "@next/next/no-img-element": "off" } },
  { rules: { "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", ignoreRestSiblings: true }] } },
]);

export default eslintConfig;
