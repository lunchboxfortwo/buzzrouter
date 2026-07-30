import type { MetadataRoute } from "next";

import { listDirectoryCommunities } from "../src/db/directory";
import { getDatabasePool } from "../src/db/pool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SITE_URL = "https://buzzrouter.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const communities = await listDirectoryCommunities(getDatabasePool(), {
    limit: 200,
  });

  return [
    {
      url: SITE_URL,
      changeFrequency: "daily",
      priority: 1,
    },
    ...communities.flatMap((community) =>
      community.slug
        ? [
            {
              url: `${SITE_URL}/communities/${encodeURIComponent(community.slug)}`,
              lastModified: new Date(community.lastVerifiedAt),
              changeFrequency: "daily" as const,
              priority: 0.8,
            },
          ]
        : [],
    ),
  ];
}
