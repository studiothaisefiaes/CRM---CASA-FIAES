import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

it("manifest do app da profissional: id e início em /pro, escopo / (o login não abre em outra janela) e tela cheia", () => {
  const m = JSON.parse(readFileSync(join(process.cwd(), "public/pro.webmanifest"), "utf8"));
  expect(m).toMatchObject({ id: "/pro", start_url: "/pro", scope: "/", display: "standalone", lang: "pt-BR" });
  expect(m.icons.length).toBeGreaterThanOrEqual(2);
});
