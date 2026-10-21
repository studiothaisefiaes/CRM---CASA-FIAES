import { ImageResponse } from "next/og";
import { interFonts, OgArt } from "../_marca/marca";

// Igual para todo link (sem dado da cliente): gerada uma vez no build.
export const dynamic = "force-static";
const OG_SIZE = { width: 1200, height: 630 };

/** A imagem da prévia do link no WhatsApp (Open Graph). */
export async function GET() {
  return new ImageResponse(<OgArt />, { ...OG_SIZE, fonts: await interFonts() });
}
