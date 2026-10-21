import { describe, expect, it } from "vitest";
import { generateMetadata } from "./page";

describe("prévia do link (Open Graph)", () => {
  it("título, descrição e imagem 1200x630 da marca; nada da cliente nem o código no OG; base = CLIENT_LINK_URL", async () => {
    process.env.CLIENT_LINK_URL = "https://agenda.casafiaes.com.br";
    try {
      const m = generateMetadata();
      expect(m.title).toEqual({ absolute: "Seu horário na Casa Fiaes" });
      expect(m.openGraph).toMatchObject({ title: "Seu horário na Casa Fiaes", description: "Confirme, remarque ou cancele com um toque.", siteName: "Casa Fiaes",
        images: [{ url: "/c/marca.png", width: 1200, height: 630 }] });
      expect(String(m.metadataBase)).toBe("https://agenda.casafiaes.com.br/");
      // A função não recebe o token nem os dados: o que a prévia mostra é igual para todo link.
      expect(generateMetadata.length).toBe(0);
      expect(JSON.stringify(m)).not.toMatch(/\/c\/[A-Za-z0-9_-]{8,}|Oi,|com a /);
    } finally { delete process.env.CLIENT_LINK_URL; }
  });
});
