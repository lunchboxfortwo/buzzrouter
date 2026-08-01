export type DesktopPlatform = "linux" | "macos" | "unknown" | "windows";

/**
 * Coarse OS detection from a request's User-Agent header. Mirrors the
 * substring checks Buzz's own desktop-download picker uses (verified against
 * their shipped bundle), minus architecture — that needs client-side signals
 * we don't have on the server.
 */
export function detectPlatform(
  userAgent: string | null | undefined,
): DesktopPlatform {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "unknown";
  if (ua.includes("macintosh") || ua.includes("mac os x")) return "macos";
  if (ua.includes("windows nt")) return "windows";
  if (ua.includes("linux") && !ua.includes("android")) return "linux";
  return "unknown";
}
