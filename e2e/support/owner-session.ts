import { expect, type Page } from "@playwright/test";
import type { Pool } from "pg";

import { mintOwnerSession } from "../../src/shared-channels/owner-session";

export async function openOwnerSessionWorkspace(
  page: Page,
  pool: Pool,
  input: {
    communityId: string;
    displayName: string;
    ownerPubkey: string;
    relayUrl: string;
  },
): Promise<void> {
  const minted = await mintOwnerSession(pool, input);
  await page.unroute("**/api/community-connections/begin-from-invite");
  await page.route(
    "**/api/community-connections/begin-from-invite",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: {
          communityId: input.communityId,
          displayName: input.displayName,
          expiresAt: minted.expiresAt,
          relayUrl: input.relayUrl,
          session: minted.session,
        },
        status: 201,
      });
    },
  );
  await page.goto("/shared-channels");
  await page
    .getByLabel("Invite link from your Buzz app")
    .fill("https://relay.example/invite/test");
  await page.getByRole("button", { name: "Add your community" }).click();
  await expect(
    page.getByRole("heading", { name: `Connected: ${input.displayName}` }),
  ).toBeVisible();
}
