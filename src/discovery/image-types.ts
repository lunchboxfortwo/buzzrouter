/**
 * The single allowlist for community icons, whether they arrive from a
 * relay's NIP-11 `icon` data URI (src/discovery/nip11.ts) or a submitter's
 * direct upload (app/api/submissions/route.ts). No SVG: it's executable
 * content, and this is a public directory.
 * Kept import-free so it's safe to use from a client component too.
 */
export const MAX_PUBLIC_ICON_BYTES = 256 * 1024;

export const IMAGE_CONTENT_TYPES = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];

export function isImageContentType(value: string): value is ImageContentType {
  return (IMAGE_CONTENT_TYPES as readonly string[]).includes(value);
}
