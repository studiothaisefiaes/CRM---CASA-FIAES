import type { Metadata, Viewport } from "next";
import { Inter, Newsreader } from "next/font/google";
import "./globals.css";
import { AppMotion } from "@/components/shell/motion-config";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const newsreader = Newsreader({ variable: "--font-newsreader", subsets: ["latin"], style: ["normal", "italic"], weight: ["300", "400", "500"] });

export const metadata: Metadata = {
  title: { default: "CRM Casa Fiaes", template: "%s · CRM Casa Fiaes" },
  description: "Atendimento e funil de vendas da Casa Fiaes",
  robots: { index: false, follow: false },
  // Manifesto estático em public/: a rota dinâmica (app/manifest.ts) fazia o dev server recompilar e recarregar a página em loop.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Casa Fiaes", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#fdfdfc" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${newsreader.variable} h-full antialiased`}>
      <body className="min-h-full"><AppMotion>{children}</AppMotion></body>
    </html>
  );
}
