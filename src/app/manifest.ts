import type { MetadataRoute } from "next";

// Permite instalar o CRM na tela inicial do celular (abre como aplicativo, sem barra do navegador).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CRM Casa Fiaes", short_name: "Casa Fiaes", description: "Atendimento e funil da Casa Fiaes",
    start_url: "/", display: "standalone", background_color: "#fdfdfc", theme_color: "#121212", lang: "pt-BR",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
