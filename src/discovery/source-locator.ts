export function sanitizeSourceLocator(locator: string | undefined):
  | string
  | null {
  if (!locator) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(locator);
  } catch {
    throw new Error("Source locator must be a public HTTPS URL.");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Source locator must be a public HTTPS URL.");
  }

  const inviteIndex = parsed.pathname.toLowerCase().indexOf("/invite/");
  if (inviteIndex >= 0) {
    parsed.pathname = parsed.pathname.slice(0, inviteIndex) || "/";
  }

  parsed.search = "";
  parsed.hash = "";

  return parsed.toString();
}
