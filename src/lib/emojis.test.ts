import { describe, expect, it } from "vitest";
import { EMOJI_CATEGORIES, insertAt, pushRecent, searchEmojis } from "./emojis";

describe("emojis", () => {
  it("põe o emoji onde está o cursor, trocando o que estiver selecionado", () => {
    expect(insertAt("Oi Rita", "😊", 2, 2)).toEqual({ text: "Oi😊 Rita", caret: 4 });
    expect(insertAt("Oi Rita", "❤️", 3, 7)).toEqual({ text: "Oi ❤️", caret: 5 });
    expect(insertAt("", "🎉", 9, 9)).toEqual({ text: "🎉", caret: 2 });
  });
  it("busca em português, sem acento", () => {
    expect(searchEmojis("coracao")).toContain("❤️");
    expect(searchEmojis("unha")).toContain("💅");
    expect(searchEmojis("aniversário")).toContain("🎂");
    expect(searchEmojis("   ")).toEqual([]);
  });
  it("recentes: o último na frente, sem repetir, até 16", () => {
    expect(pushRecent(["😊", "❤️"], "❤️")).toEqual(["❤️", "😊"]);
    expect(pushRecent(Array.from({ length: 16 }, (_, i) => String(i)), "x")).toHaveLength(16);
  });
  it("nenhum emoji repetido entre as categorias", () => {
    const all = EMOJI_CATEGORIES.flatMap((c) => c.items.map(([e]) => e));
    expect(new Set(all).size).toBe(all.length);
  });
});
