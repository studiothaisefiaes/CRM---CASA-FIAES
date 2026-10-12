import { it, expect } from "vitest";
import { isDemoDatabaseUrl } from "./demo";

it("o banco do demo é só o crm_demo", () => {
  expect(isDemoDatabaseUrl("postgres://crm:x@localhost:5433/crm_demo")).toBe(true);
  expect(isDemoDatabaseUrl("postgres://crm:x@localhost:5433/crm_demo?sslmode=disable")).toBe(true);
});
it("recusa o banco real, os de teste e nomes parecidos", () => {
  for (const url of ["postgres://crm:x@localhost:5433/crm", "postgres://crm:x@localhost:5433/crm_e2e", "postgres://crm:x@localhost:5433/crm_demo2",
    "postgres://crm:x@localhost:5433/xcrm_demo", "", undefined, "não é url"]) expect(isDemoDatabaseUrl(url)).toBe(false);
});
