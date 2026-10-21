import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { TELAS_CONGELADAS, isFrozenPath } from "./design-frozen";

/**
 * Sistema de design (dsgfix, r68): uma escala de tipo de 6 tamanhos, nada abaixo de 12 px, pesos 400/500/600.
 * As telas aprovadas pelo dono (Conversas, Hoje, grade da Agenda, página da cliente e login) ficam congeladas: só ganham o mínimo de 12 px
 * e os tokens que não mudam de valor; o resto do sistema usa só as classes da escala.
 */
const ROOT = path.resolve(__dirname, "../..");
const css = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}
const files = walk(path.join(ROOT, "src")).map((f) => path.relative(ROOT, f));
const congelado = (f: string) => TELAS_CONGELADAS.some((p) => f === p || f.startsWith(p));
const ler = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

describe("escala de tipo", () => {
  it("6 tamanhos: 12, 13, 15, 18, 24 e 32 px (corpo 15)", () => {
    const tema = css.slice(css.indexOf("@theme static"), css.indexOf(".ds-congelada"));
    const escala = Object.fromEntries([...tema.matchAll(/--text-(xs|sm|base|lg|xl|2xl):\s*(\d+)px/g)].map((m) => [m[1], Number(m[2])]));
    expect(escala).toEqual({ xs: 12, sm: 13, base: 15, lg: 18, xl: 24, "2xl": 32 });
    expect(css).not.toMatch(/--text-3xl:/);
    expect(css).toMatch(/body \{[^}]*font-size: var\(--text-base\)/);
  });
  it("as telas congeladas guardam os valores de antes (troca invisível)", () => {
    const bloco = css.match(/\.ds-congelada \{([^}]*)\}/)?.[1] ?? "";
    expect(bloco).toMatch(/--text-base:\s*14px/);
    expect(bloco).toMatch(/--text-xl:\s*22px/);
    expect(bloco).toMatch(/--text-2xl:\s*28px/);
  });
  it("confere arquivos de verdade", () => { expect(files.length).toBeGreaterThan(300); });
  it("nada abaixo de 12 px em lugar nenhum", () => {
    const achados = files.flatMap((f) => [...ler(f).matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)].filter((m) => Number(m[1]) < 12).map((m) => `${f}: ${m[0]}`));
    expect(achados).toEqual([]);
  });
  it("fora das telas congeladas, nenhum tamanho solto (text-[Npx]): só as classes da escala", () => {
    const achados = files.filter((f) => !congelado(f)).flatMap((f) => [...ler(f).matchAll(/text-\[\d+(?:\.\d+)?px\]/g)].map((m) => `${f}: ${m[0]}`));
    expect(achados).toEqual([]);
  });
  it("fora das telas congeladas, só pesos 400, 500 e 600", () => {
    const achados = files.filter((f) => !congelado(f)).flatMap((f) => [...ler(f).matchAll(/\bfont-(thin|extralight|light|bold|extrabold|black)\b/g)].map((m) => `${f}: ${m[0]}`));
    expect(achados).toEqual([]);
  });
  it("text-3xl saiu (o maior é o título de página, text-2xl)", () => {
    expect(files.filter((f) => /\btext-3xl\b/.test(ler(f)))).toEqual([]);
  });
  it("a moldura congela só as rotas aprovadas", () => {
    for (const p of ["/", "/ao-vivo", "/atendimento", "/atendimento/programadas", "/funil", "/agenda", "/conversa/x"]) expect(isFrozenPath(p)).toBe(true);
    for (const p of ["/caixa", "/contatos", "/relatorios", "/config/funcoes", "/servicos", "/agendamentos"]) expect(isFrozenPath(p)).toBe(false);
  });
});
