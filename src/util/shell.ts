// Shell command execution helper wrapping Deno.Command.

import { debug } from "./log.ts";

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** Timeout in milliseconds. Process is killed if it exceeds this. */
  timeout?: number;
  /** Pass stdin through to the child process (needed for interactive installers). */
  stdin?: "inherit" | "null";
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Execute a shell command. Accepts either a single command string
 * (split via shell) or an array of args where args[0] is the binary.
 */
export async function exec(
  cmd: string | string[],
  opts: ExecOptions = {},
): Promise<ExecResult> {
  const args = typeof cmd === "string"
    ? ["sh", "-c", cmd]
    : cmd;

  const [bin, ...rest] = args;

  debug(`exec: ${args.join(" ")}${opts.cwd ? ` (cwd: ${opts.cwd})` : ""}`);

  const command = new Deno.Command(bin, {
    args: rest,
    cwd: opts.cwd,
    env: opts.env,
    stdin: opts.stdin ?? "null",
    stdout: "piped",
    stderr: "piped",
  });

  const process = command.spawn();

  let timedOut = false;

  if (opts.timeout && opts.timeout > 0) {
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill("SIGTERM");
      } catch {
        // Process may have already exited
      }
    }, opts.timeout);

    const result = await process.output();
    clearTimeout(timer);

    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);

    if (timedOut) {
      return {
        code: result.code,
        stdout,
        stderr: stderr
          ? `${stderr}\nProcess timed out after ${opts.timeout}ms`
          : `Process timed out after ${opts.timeout}ms`,
      };
    }

    return { code: result.code, stdout, stderr };
  }

  const result = await process.output();
  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}
