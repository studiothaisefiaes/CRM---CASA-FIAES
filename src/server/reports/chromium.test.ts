import { expect, it } from "vitest";
import { browserDirs, CHROMIUM_MISSING, findChromium, PROD_BROWSERS_DIR } from "./chromium";

const REL = "chromium-1248/chrome-linux/chrome";

it("a pasta de produção (/home/crm/.cache/ms-playwright) está entre as procuradas, depois da do ambiente e da do HOME", () => {
  expect(browserDirs({ PLAYWRIGHT_BROWSERS_PATH: "/opt/pw" }, "/root")).toEqual(["/opt/pw", "/root/.cache/ms-playwright", PROD_BROWSERS_DIR]);
  expect(browserDirs({}, "/home/crm")).toEqual(["/home/crm/.cache/ms-playwright"]);
  expect(browserDirs({ PLAYWRIGHT_BROWSERS_PATH: "0" }, "/root")).toEqual(["/root/.cache/ms-playwright", PROD_BROWSERS_DIR]);
});

it("usa o caminho que o Playwright espera quando existe", () => {
  const p = `/home/crm/.cache/ms-playwright/${REL}`;
  expect(findChromium({ expectedPath: p, dirs: [PROD_BROWSERS_DIR], exists: (x) => x === p })).toBe(p);
});

it("worker com outro HOME: acha o mesmo Chromium (mesma revisão) na pasta de produção", () => {
  const found = `${PROD_BROWSERS_DIR}/${REL}`;
  expect(findChromium({ expectedPath: `/root/.cache/ms-playwright/${REL}`, dirs: ["/root/.cache/ms-playwright", PROD_BROWSERS_DIR], exists: (x) => x === found })).toBe(found);
});

it("revisão errada instalada (outra versão) não serve: falha com mensagem clara que diz o que falta e onde", () => {
  const expected = `/root/.cache/ms-playwright/${REL}`;
  const outra = `${PROD_BROWSERS_DIR}/chromium-1100/chrome-linux/chrome`;
  expect(() => findChromium({ expectedPath: expected, dirs: ["/root/.cache/ms-playwright", PROD_BROWSERS_DIR], exists: (x) => x === outra }))
    .toThrow(CHROMIUM_MISSING(expected, ["/root/.cache/ms-playwright", PROD_BROWSERS_DIR]));
  expect(CHROMIUM_MISSING(expected, [PROD_BROWSERS_DIR])).toMatch(/PDF indisponível neste servidor: falta o Chromium do Playwright.*playwright install chromium/);
});
