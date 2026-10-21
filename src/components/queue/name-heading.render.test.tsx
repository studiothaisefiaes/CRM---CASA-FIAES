// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { NameHeading } from "./name-heading";
afterEach(cleanup);

it("nome do cabeçalho e do painel não é cortado com reticências (quebra a linha)", () => {
  const { container } = render(<><NameHeading as="h2" name="Thamires Souza Bastos" contactId="c" /><NameHeading as="h3" name="Thamires Souza Bastos" /></>);
  for (const h of container.querySelectorAll("h2, h3")) {
    expect(h.textContent).toBe("Thamires Souza Bastos");
    expect(h.className).not.toContain("truncate");
    expect(h.className).toContain("break-words");
  }
  expect(container.querySelector("h2 a")!.getAttribute("href")).toContain("c");
});
