import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * A marca da página da cliente para imagens (next/og): a prévia do WhatsApp (1200×630) e o ícone. Só a marca, nunca dado da cliente.
 * Cores do CRM (papel, tinta, dourado) e Inter (OFL, arquivos .woff aqui do lado: o satori não lê woff2).
 */
export const C = { paper: "#fdfdfc", paper2: "#f4f2ee", ink: "#121212", graphite: "#5c5c5c", gold: "#b8863f", goldInk: "#7a5524", goldSoft: "#f3e9d8", line: "#e4e1db" };

export async function interFonts() {
  const dir = path.join(process.cwd(), "src/app/c/_marca");
  const [regular, semibold] = await Promise.all([readFile(path.join(dir, "inter-latin-400-normal.woff")), readFile(path.join(dir, "inter-latin-600-normal.woff"))]);
  return [
    { name: "Inter", data: regular, weight: 400 as const, style: "normal" as const },
    { name: "Inter", data: semibold, weight: 600 as const, style: "normal" as const },
  ];
}

/** Um arco (meia circunferência de cima), o desenho dos arcos dourados do ícone da Casa. */
export function Arch({ size, stroke, color, style }: { size: number; stroke: number; color: string; style?: React.CSSProperties }) {
  return (
    <div style={{ display: "flex", width: size, height: size / 2, overflow: "hidden", ...style }}>
      <div style={{ width: size, height: size, borderRadius: size, border: `${stroke}px solid ${color}` }} />
    </div>
  );
}

/** A prévia do link no WhatsApp: "Casa Fiaes" + "Seu horário". */
export function OgArt() {
  const pill = (label: string, filled: boolean) => (
    <div style={{ display: "flex", alignItems: "center", height: 64, padding: "0 30px", borderRadius: 16, fontSize: 28, fontWeight: 600,
      background: filled ? C.ink : C.paper, color: filled ? C.paper : C.ink, border: `2px solid ${filled ? C.ink : C.line}` }}>{label}</div>
  );
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", background: C.paper, fontFamily: "Inter", color: C.ink, position: "relative" }}>
      {/* os arcos da Casa, grandes, nascendo do pé da imagem à direita */}
      <div style={{ display: "flex", position: "absolute", right: -120, bottom: 0, alignItems: "flex-end" }}>
        <Arch size={300} stroke={12} color={C.gold} />
        <Arch size={300} stroke={12} color={C.gold} style={{ marginLeft: -12 }} />
      </div>
      {/* o monograma (mesmo desenho do ícone) */}
      <div style={{ display: "flex", flexDirection: "column", position: "absolute", right: 96, top: 88, width: 140, height: 140, borderRadius: 34, background: C.ink, alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: C.paper, fontSize: 56, fontWeight: 600, letterSpacing: -3, lineHeight: 1 }}>CF</div>
        <div style={{ display: "flex", marginTop: 8 }}>
          <Arch size={40} stroke={4} color={C.gold} />
          <Arch size={40} stroke={4} color={C.gold} style={{ marginLeft: -4 }} />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 92px", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 56, height: 5, borderRadius: 4, background: C.gold }} />
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: 7, color: C.goldInk, textTransform: "uppercase" }}>Seu horário</div>
        </div>
        <div style={{ fontSize: 150, fontWeight: 600, letterSpacing: -6, lineHeight: 1, marginTop: 26 }}>Casa Fiaes</div>
        <div style={{ fontSize: 36, color: C.graphite, marginTop: 30 }}>Confirme, remarque ou cancele com um toque.</div>
        <div style={{ display: "flex", gap: 16, marginTop: 52 }}>{pill("Confirmar", true)}{pill("Remarcar", false)}{pill("Cancelar", false)}</div>
      </div>
    </div>
  );
}

/** O ícone (aba do navegador e "Adicionar à tela de início"): "CF" com os arcos dourados, sem serifa. */
export function IconArt() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", background: C.ink, fontFamily: "Inter" }}>
      <div style={{ color: C.paper, fontSize: 210, fontWeight: 600, letterSpacing: -10, lineHeight: 1 }}>CF</div>
      <div style={{ display: "flex", marginTop: 26 }}>
        <Arch size={150} stroke={14} color={C.gold} />
        <Arch size={150} stroke={14} color={C.gold} style={{ marginLeft: -14 }} />
      </div>
    </div>
  );
}
