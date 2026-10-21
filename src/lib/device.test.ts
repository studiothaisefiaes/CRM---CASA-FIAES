import { expect, it } from "vitest";
import { isMobileUserAgent } from "./device";

it("reconhece celular pelo User-Agent e deixa desktop e tablet de fora", () => {
  expect(isMobileUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Version/15.0 Mobile/15E148 Safari/604.1")).toBe(true);
  expect(isMobileUserAgent("Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36")).toBe(true);
  expect(isMobileUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15")).toBe(false);
  expect(isMobileUserAgent("Mozilla/5.0 (Linux; Android 12; SM-T500) AppleWebKit/537.36 Chrome/120 Safari/537.36")).toBe(false); // tablet
  expect(isMobileUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36")).toBe(false);
  expect(isMobileUserAgent(null)).toBe(false);
});
