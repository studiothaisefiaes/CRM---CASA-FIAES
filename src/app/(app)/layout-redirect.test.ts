import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "layout.tsx"), "utf8");

it("quem só tem o app da profissional vai para /pro antes da presença, dos avisos e da contagem de atrasados", () => {
  expect(src).toMatch(/if \(isProOnly\(user\.perms\)\) redirect\("\/pro"\);/);
  const at = src.indexOf('redirect("/pro")');
  for (const call of ["beat(", "getMyAlerts(", "countLateLeads("]) expect(src.indexOf(call), call).toBeGreaterThan(at);
});
