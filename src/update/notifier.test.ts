import { assertEquals } from "@std/assert";
import { formatBody } from "./notifier.ts";

Deno.test("formatBody — empty list", () => {
  assertEquals(formatBody([]), "No files changed.");
});

Deno.test("formatBody — single file", () => {
  assertEquals(formatBody(["README.md"]), "README.md");
});

Deno.test("formatBody — several files within limit", () => {
  const files = ["a.ts", "b.ts", "c.ts"];
  assertEquals(formatBody(files), "a.ts, b.ts, c.ts");
});

Deno.test("formatBody — truncates beyond limit", () => {
  const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts"];
  assertEquals(formatBody(files), "a.ts, b.ts, c.ts, d.ts, e.ts (+2 more)");
});

Deno.test("formatBody — exactly at limit", () => {
  const files = ["1.ts", "2.ts", "3.ts", "4.ts", "5.ts"];
  assertEquals(formatBody(files), "1.ts, 2.ts, 3.ts, 4.ts, 5.ts");
});
