import { it, expect } from "vitest";
import { originChoices } from "./origin-choices";

it("fixas primeiro, depois as cadastradas, sem repetir nem canal", () => {
  const out = originChoices(
    [{ id: "a", label: "instagram", active: true }, { id: "b", label: "Panfleto", active: true }, { id: "c", label: "Antigo", active: false }],
    [{ label: "WhatsApp" }, { label: "Anúncio" }, { label: "Indicacao" }, { label: "Já é cliente" }, { label: "Site" }],
  );
  expect(out.map((o) => o.label)).toEqual(["Indicação", "instagram", "Google", "Passou na frente", "Anúncio", "Panfleto", "Site"]);
  // a origem de link guarda o sourceId (vence a lista e a fixa)
  expect(out.find((o) => o.label === "instagram")).toMatchObject({ sourceId: "a" });
  expect(out.find((o) => o.label === "Indicação")?.sourceId).toBeUndefined();
});
