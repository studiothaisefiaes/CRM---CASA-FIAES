import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppMotion } from "@/components/shell/motion-config";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "CRM Casa Fiaes", template: "%s · CRM Casa Fiaes" },
  description: "Atendimento e vendas da Casa Fiaes",
  robots: { index: false, follow: false },
  // Manifesto estático em public/: a rota dinâmica (app/manifest.ts) fazia o dev server recompilar e recarregar a página em loop.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Casa Fiaes", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

// viewport-fit=cover: sem isto o env(safe-area-inset-*) vale 0 no Safari (barra inferior, composer). resizes-content: com o teclado aberto a página encolhe (em vez de o teclado cobrir o campo e o botão Enviar da conversa).
export const viewport: Viewport = { themeColor: "#fdfdfc", viewportFit: "cover", interactiveWidget: "resizes-content" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Ler os cabeçalhos deixa a renderização dinâmica: o Next aplica o nonce da CSP (src/proxy.ts) nos scripts.
  await headers();
  return (
    <html lang="pt-BR" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full"><AppMotion>{children}</AppMotion></body>
    </html>
  );
}
