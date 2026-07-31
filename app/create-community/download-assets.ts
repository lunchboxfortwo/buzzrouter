export const BUZZ_RELEASES_URL = "https://github.com/block/buzz/releases/latest";
const BUZZ_RELEASES_API_URL =
  "https://api.github.com/repos/block/buzz/releases?per_page=10";

export type DesktopArch = "arm64" | "x64";

interface ReleaseAsset {
  browser_download_url: string;
  name: string;
}

interface Release {
  assets: ReleaseAsset[];
  draft: boolean;
  prerelease: boolean;
}

const ASSET_PATTERNS: Record<string, RegExp> = {
  "macos:arm64": /_aarch64\.dmg$/i,
  "macos:x64": /_x64\.dmg$/i,
  "windows:x64": /_x64-setup[^/]*\.exe$/i,
  "linux:x64": /_amd64\.AppImage$/i,
};

/**
 * Picks the newest non-draft, non-prerelease asset matching the given
 * platform+arch, mirroring the asset-naming convention Buzz's own installer
 * picker uses against github.com/block/buzz releases.
 */
export function findMatchingAsset(
  releases: Release[],
  platform: string,
  arch: DesktopArch,
): string | undefined {
  const pattern = ASSET_PATTERNS[`${platform}:${arch}`];
  if (!pattern) return undefined;
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    const asset = release.assets.find((candidate) => pattern.test(candidate.name));
    if (asset) return asset.browser_download_url;
  }
  return undefined;
}

/**
 * Resolves the direct download URL for a platform+arch by asking GitHub's
 * releases API, falling back to the releases page (never a fabricated file
 * URL) if the API is unreachable or no matching asset is published.
 */
export async function resolveDownloadUrl(
  platform: string,
  arch: DesktopArch,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  try {
    const response = await fetchImpl(BUZZ_RELEASES_API_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return BUZZ_RELEASES_URL;
    const releases = (await response.json()) as Release[];
    return findMatchingAsset(releases, platform, arch) ?? BUZZ_RELEASES_URL;
  } catch {
    return BUZZ_RELEASES_URL;
  }
}
