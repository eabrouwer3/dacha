// Connectivity check via DNS resolution.

/**
 * Check if the machine has internet connectivity by attempting
 * a DNS resolution. Returns true if online, false otherwise.
 */
export async function isOnline(): Promise<boolean> {
  try {
    await Deno.resolveDns("dns.google", "A");
    return true;
  } catch {
    return false;
  }
}
