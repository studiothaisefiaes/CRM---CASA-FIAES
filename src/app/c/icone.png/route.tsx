import { ImageResponse } from "next/og";
import { IconArt, interFonts } from "../_marca/marca";

export const dynamic = "force-static";

/** O ícone da página da cliente (aba e tela de início). */
export async function GET() {
  return new ImageResponse(<IconArt />, { width: 512, height: 512, fonts: await interFonts() });
}
