// Secret resource executor — decrypt age-encrypted files and place with permissions.
// Also provides encrypt() and edit() helpers for the CLI.

import type {
  OutputStore,
  Platform,
  ResourceExecutor,
  ResourceResult,
  SecretResource,
} from "../types.ts";
import { exec } from "../util/shell.ts";
import { debug, info } from "../util/log.ts";
import { dirname } from "@std/path";

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
  return `${home}/.config/age/identity.txt`;
}

export const SecretExecutor: ResourceExecutor<SecretResource> = {
  async check(resource, _platform: Platform): Promise<boolean> {
    const dest = resolveHome(resource.destination);
    try {
      await Deno.stat(dest);
      debug(`secret check: ${resource.id} destination exists`);
      return true;
    } catch {
      debug(`secret check: ${resource.id} destination missing`);
      return false;
    }
  },

  async apply(resource, _platform: Platform, _outputs: OutputStore): Promise<ResourceResult> {
    const dest = resolveHome(resource.destination);
    const identity = identityPath();
    const permissions = resource.permissions ?? "0600";

    // Decrypt the source file using age
    const cmd = ["age", "-d", "-i", identity, resource.source];
    info(`decrypting ${resource.source} → ${resource.destination}`);
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
  },
};


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
