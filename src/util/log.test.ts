import { assertEquals } from "@std/assert";
import {
  debug,
  error,
  getLogLevel,
  info,
  setLogLevel,
  success,
  warn,
} from "./log.ts";

Deno.test("default log level is normal", () => {
  setLogLevel("normal");
  assertEquals(getLogLevel(), "normal");
});

Deno.test("setLogLevel changes the level", () => {
  setLogLevel("verbose");
  assertEquals(getLogLevel(), "verbose");
  setLogLevel("quiet");
  assertEquals(getLogLevel(), "quiet");
  setLogLevel("normal");
});

Deno.test("quiet mode suppresses info, success, debug", () => {
  setLogLevel("quiet");
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (msg: string) => logs.push(msg);
  try {
    info("should not appear");
    success("should not appear");
    debug("should not appear");
  } finally {
    console.log = origLog;
    setLogLevel("normal");
  }
  assertEquals(logs.length, 0);
});

Deno.test("quiet mode still shows warn and error", () => {
  setLogLevel("quiet");
  const warns: string[] = [];
  const errors: string[] = [];
  const origWarn = console.warn;
  const origError = console.error;
  console.warn = (msg: string) => warns.push(msg);
  console.error = (msg: string) => errors.push(msg);
  try {
    warn("a warning");
    error("an error");
  } finally {
    console.warn = origWarn;
    console.error = origError;
    setLogLevel("normal");
  }
  assertEquals(warns.length, 1);
  assertEquals(errors.length, 1);
});

Deno.test("normal mode shows info, success, warn, error but not debug", () => {
  setLogLevel("normal");
  const logs: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (msg: string) => logs.push(msg);
  console.warn = (msg: string) => warns.push(msg);
  console.error = (msg: string) => errors.push(msg);
  try {
    info("info msg");
    success("ok msg");
    debug("debug msg");
    warn("warn msg");
    error("error msg");
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    setLogLevel("normal");
  }
  assertEquals(logs.length, 2); // info + success
  assertEquals(warns.length, 1);
  assertEquals(errors.length, 1);
});

Deno.test("verbose mode enables debug output", () => {
  setLogLevel("verbose");
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (msg: string) => logs.push(msg);
  try {
    debug("debug msg");
  } finally {
    console.log = origLog;
    setLogLevel("normal");
  }
  assertEquals(logs.length, 1);
});

Deno.test("output includes ANSI color codes", () => {
  setLogLevel("normal");
  let captured = "";
  const origLog = console.log;
  console.log = (msg: string) => { captured = msg; };
  try {
    info("test");
  } finally {
    console.log = origLog;
  }
  // Should contain ANSI escape sequence
  assertEquals(captured.includes("\x1b["), true);
  assertEquals(captured.includes("test"), true);
});
