import { test, expect } from "bun:test";
import { hashGuestCode, verifyGuestCode } from "./guest-code";

test("verifyGuestCode accepts the exact code that was hashed", () => {
  const hash = hashGuestCode("Trondheim1948");
  expect(verifyGuestCode("Trondheim1948", hash)).toBe(true);
});

test("verifyGuestCode rejects a wrong code", () => {
  const hash = hashGuestCode("Trondheim1948");
  expect(verifyGuestCode("wrong-code", hash)).toBe(false);
});

test("verifyGuestCode is case-insensitive and trims whitespace", () => {
  const hash = hashGuestCode("Trondheim1948");
  expect(verifyGuestCode("  trondheim1948  ", hash)).toBe(true);
});

test("hashGuestCode produces a different hash each time (random salt)", () => {
  const a = hashGuestCode("Trondheim1948");
  const b = hashGuestCode("Trondheim1948");
  expect(a).not.toBe(b);
  expect(verifyGuestCode("Trondheim1948", a)).toBe(true);
  expect(verifyGuestCode("Trondheim1948", b)).toBe(true);
});

test("verifyGuestCode rejects a malformed stored value", () => {
  expect(verifyGuestCode("anything", "not-a-valid-hash")).toBe(false);
});
