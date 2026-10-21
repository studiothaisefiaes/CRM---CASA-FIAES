import type { Metadata } from "next";
import { headers } from "next/headers";
import { clientIp } from "@/server/auth/client-ip";
import { openClientLink } from "@/server/domain/client-link/links";
import { getCasaInfo } from "@/server/domain/client-link/settings";
import { clientLinkBase } from "@/lib/client-host";
import { isLinkPreviewBot, LINK_OG, waLink } from "@/lib/client-link";
import { LinkPage } from "@/components/client-link/link-page";
import { LinkUnavailable } from "@/components/client-link/unavailable";

/**
 * Prévia do link (WhatsApp e afins): só a marca, igual para todo link. Nada da cliente (nome, dia, serviço) nem o token no Open Graph.
 * A base é o domínio dos links da cliente (CLIENT_LINK_URL) ou o APP_URL.
 */
export function generateMetadata(): Metadata {
  const image = { url: "/c/marca.png", width: 1200, height: 630, alt: "Casa Fiaes · Seu horário", type: "image/png" };
  return {
    metadataBase: new URL(clientLinkBase() || "http://localhost"),
    title: { absolute: LINK_OG.title },
    description: LINK_OG.description,
    applicationName: "Casa Fiaes",
    robots: { index: false, follow: false },
    manifest: null,
    icons: { icon: [{ url: "/c/icone.png", type: "image/png", sizes: "512x512" }], apple: "/c/icone.png" },
    openGraph: { type: "website", siteName: "Casa Fiaes", locale: "pt_BR", title: LINK_OG.title, description: LINK_OG.description, images: [image] },
    twitter: { card: "summary_large_image", title: LINK_OG.title, description: LINK_OG.description, images: [image.url] },
  };
}

/** Página da cliente (seção 9.1): aberta pelo link, sem login. Vencido ou inválido: a mesma página genérica, sem dizer qual dos dois. */
export default async function ClientLinkPage({ params }: PageProps<"/c/[token]">) {
  const { token } = await params;
  const h = await headers();
  // O robô que monta a prévia no WhatsApp não é a cliente: não conta como "abriu o link".
  const r = await openClientLink(token, { ip: clientIp(h), count: !isLinkPreviewBot(h.get("user-agent")) });
  if (r.kind === "ok") return <LinkPage token={token} view={r.view} />;
  const wa = waLink((await getCasaInfo()).whatsapp, "Oi! Preciso falar sobre meu horário.");
  return <LinkUnavailable title={r.kind === "limite" ? "Calma, só um instante" : "Vamos resolver pelo WhatsApp"}
    text={r.kind === "limite" ? "Muitas tentativas. Espere alguns minutos." : "Este link não vale mais. Fale com a Casa pelo WhatsApp."} waHref={wa} />;
}
