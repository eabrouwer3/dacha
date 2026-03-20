// Colored terminal output helper using raw ANSI escape codes.
// Supports quiet/verbose modes via a global log level.

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const GRAY = "\x1b[90m";

export type LogLevel = "quiet" | "normal" | "verbose";

let currentLevel: LogLevel = "normal";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export function info(msg: string): void {
  if (currentLevel === "quiet") return;
  console.log(`${BLUE}${BOLD}info${RESET}  ${msg}`);
}

export function success(msg: string): void {
  if (currentLevel === "quiet") return;
  console.log(`${GREEN}${BOLD}ok${RESET}    ${msg}`);
}

export function warn(msg: string): void {
  console.warn(`${YELLOW}${BOLD}warn${RESET}  ${msg}`);
}

export function error(msg: string): void {
  console.error(`${RED}${BOLD}error${RESET} ${msg}`);
}

export function debug(msg: string): void {
  if (currentLevel !== "verbose") return;
  console.log(`${GRAY}debug ${msg}${RESET}`);
}
