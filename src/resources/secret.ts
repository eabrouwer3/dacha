// Secret resource — decrypt age-encrypted files and place with permissions.
// Also provides encrypt() and edit() helpers for the CLI.

import { Resource } from "../resource.ts";
import type { Machine } from "../app.ts";
import type { OutputStore, Platform, ResourceResult } from "../types.ts";
import { exec } from "../util/shell.ts";
import { debug, info } from "../util/log.ts";
import { dirname } from "@std/path";
import { ensureBrew } from "./package.ts";

export interface SecretProps {
  source: string;
  destination: string;
  permissions?: string;
  dependsOn?: Resource[];
}

/** Resolve `~` prefix to the user's home directory. */
function resolveHome(path: string): string {
  if (path.startsWith("~/")) {
    const home = Deno.env.get("HOME") ?? "/tmp";
    return home + path.slice(1);
  }
  return path;
}

/** Get the age identity file path from env or default. */
function identityPath(): string {
  const fromEnv = Deno.env.get("DACHA_AGE_IDENTITY");
  if (fromEnv) return resolveHome(fromEnv);
  const home = Deno.env.get("HOME") ?? "/tmp";
  return `${home}/.ssh/id_rsa`;
}

/** Ensure the `age` binary is available, installing via brew on macOS if needed. */
async function ensureAge(): Promise<void> {
  const check = await exec("command -v age");
  if (check.code === 0) return;

  if (Deno.build.os === "darwin") {
    info("age not found — installing via brew…");
    await ensureBrew();
    const install = await exec("brew install age");
    if (install.code !== 0) {
      throw new Error(
        `Failed to install age via brew: ${install.stderr.trim() || `exit code ${install.code}`}`,
      );
    }
  } else {
    throw new Error(
      "age is not installed. Please install it manually before running dacha.",
    );
  }
}

export class Secret extends Resource {
  static readonly resourceType = "secret";

  readonly source: string;
  readonly destination: string;
  readonly permissions?: string;

  constructor(scope: Resource | Machine, id: string, props: SecretProps) {
    super(scope, id, props);
    this.source = props.source;
    this.destination = props.destination;
    this.permissions = props.permissions;
  }

  async check(_platform: Platform): Promise<boolean> {
    const dest = resolveHome(this.destination);
    try {
      await Deno.stat(dest);
      debug(`secret check: ${this.id} destination exists`);
      return true;
    } catch {
      debug(`secret check: ${this.id} destination missing`);
      return false;
    }
  }

  async apply(_platform: Platform, _outputs: OutputStore): Promise<ResourceResult> {
    await ensureAge();

    const dest = resolveHome(this.destination);
    const identity = identityPath();
    const permissions = this.permissions ?? "0600";

    // Decrypt the source file using age
    const cmd = ["age", "-d", "-i", identity, this.source];
    info(`decrypting ${this.source} → ${this.destination}`);
    const result = await exec(cmd);

    if (result.code !== 0) {
      return {
        status: "failed",
        error: result.stderr.trim() || `age decrypt failed with exit code ${result.code}`,
      };
    }

    // Create parent directories
    const parentDir = dirname(dest);
    await Deno.mkdir(parentDir, { recursive: true });

    // Write decrypted content to destination
    const content = new TextEncoder().encode(result.stdout);
    await Deno.writeFile(dest, content, { mode: parseInt(permissions, 8) });

    return { status: "applied" };
  }

  protected toProps(): Record<string, unknown> & { id: string } {
    return {
      id: this.id,
      source: this.source,
      destination: this.destination,
      permissions: this.permissions,
      dependsOn: this.dependsOn,
    };
  }
}


/** Encrypt a file using age with a recipients file. Writes to `<file>.age`. */
export async function encrypt(file: string, recipientsFile: string): Promise<void> {
  const outFile = `${file}.age`;
  info(`encrypting ${file} → ${outFile}`);
  const result = await exec(["age", "-e", "-R", recipientsFile, "-o", outFile, file]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `age encrypt failed with exit code ${result.code}`);
  }
}

/** Decrypt an age file to a temp file, open $EDITOR, re-encrypt, and clean up. */
export async function edit(ageFile: string, identity?: string): Promise<void> {
  const id = identity ?? identityPath();
  const recipientsFile = `${dirname(id)}/recipients.txt`;
  const tmpFile = await Deno.makeTempFile({ prefix: "dacha-secret-" });

  try {
    // Decrypt to temp file
    info(`decrypting ${ageFile} for editing`);
    const dec = await exec(["age", "-d", "-i", id, "-o", tmpFile, ageFile]);
    if (dec.code !== 0) {
      throw new Error(dec.stderr.trim() || `age decrypt failed with exit code ${dec.code}`);
    }

    // Open editor
    const editor = Deno.env.get("EDITOR") ?? "vi";
    debug(`opening ${editor} on ${tmpFile}`);
    const editorCmd = new Deno.Command(editor, {
      args: [tmpFile],
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const editorResult = await editorCmd.output();
    if (!editorResult.success) {
      throw new Error(`editor exited with code ${editorResult.code}`);
    }

    // Re-encrypt back to the original age file
    info(`re-encrypting ${ageFile}`);
    const enc = await exec(["age", "-e", "-R", recipientsFile, "-o", ageFile, tmpFile]);
    if (enc.code !== 0) {
      throw new Error(enc.stderr.trim() || `age encrypt failed with exit code ${enc.code}`);
    }
  } finally {
    // Always clean up the plaintext temp file
    try {
      await Deno.remove(tmpFile);
      debug(`removed temp file ${tmpFile}`);
    } catch {
      // File may already be gone
    }
  }
}
