import { it, expect } from "vitest";
import { cn } from "./cn";

it("tamanhos de texto do design system conflitam entre si (a última vence)", () => {
  expect(cn("text-md md:text-base", "text-sm")).toBe("md:text-base text-sm");
  expect(cn("text-sm", "text-lg")).toBe("text-lg");
  expect(cn("text-3xl", "text-xs")).toBe("text-xs");
});
it("cor e tamanho não conflitam", () => {
  expect(cn("text-gold", "text-md")).toBe("text-gold text-md");
  expect(cn("text-md", "text-gold")).toBe("text-md text-gold");
  expect(cn("text-ink", "text-alert")).toBe("text-alert");
});
