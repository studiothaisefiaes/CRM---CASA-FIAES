import { it, expect } from "vitest";
import { demoDatabaseName, isDemoDatabaseUrl } from "./demo";

it("o banco do demo é o crm_demo ou um crm_demo_<nome> (QA r58, I-17: uma cópia por pasta, sem apagar o demo de ninguém)", () => {
  expect(isDemoDatabaseUrl("postgres://crm:x@localhost:5433/crm_demo")).toBe(true);
  expect(isDemoDatabaseUrl("postgres://crm:x@localhost:5433/crm_demo?sslmode=disable")).toBe(true);
  expect(isDemoDatabaseUrl("postgres://crm:x@localhost:5433/crm_demo_avecfix")).toBe(true);
  expect(demoDatabaseName("postgres://crm:x@localhost:5433/crm_demo_avecfix?sslmode=disable")).toBe("crm_demo_avecfix");
});
it("recusa o banco real, os de teste e nomes parecidos", () => {
  for (const url of ["postgres://crm:x@localhost:5433/crm", "postgres://crm:x@localhost:5433/crm_e2e", "postgres://crm:x@localhost:5433/crm_demo2",
    "postgres://crm:x@localhost:5433/xcrm_demo", "postgres://crm:x@localhost:5433/crm_demo_", "postgres://crm:x@localhost:5433/crm_demo_x;drop",
    "postgres://crm:x@localhost:5433/crm_demo_Maiusc", "", undefined, "não é url"]) expect(isDemoDatabaseUrl(url)).toBe(false);
  expect(demoDatabaseName("postgres://crm:x@localhost:5433/crm")).toBeNull();
});
