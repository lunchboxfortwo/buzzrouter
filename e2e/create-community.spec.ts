import { expect, test } from "@playwright/test";

const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

test("is reachable from the masthead and links to the hosted signup", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/create-community$/);

  const signupLink = page.getByRole("link", {
    name: "Sign up at app.builderlab.xyz",
  });
  await expect(signupLink).toHaveAttribute(
    "href",
    "https://app.builderlab.xyz",
  );

  await expect(page.getByText(/Buzz desktop app/)).toBeVisible();
  await expect(page.getByText(/134MB/)).toBeVisible();

  await expect(
    page.getByRole("link", { name: "List your community" }),
  ).toHaveAttribute("href", "/submit");
  await expect(
    page.getByRole("link", { name: "Link it" }),
  ).toHaveAttribute("href", "/shared-channels");
});

test.describe("platform-specific download", () => {
  test.use({ userAgent: WINDOWS_UA });

  test("detects Windows from the user agent", async ({ page }) => {
    await page.goto("/create-community");
    await expect(page.getByText(/Detected Windows/)).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Download for Windows (.exe)" }),
    ).toBeVisible();
  });
});

test.describe("unknown platform", () => {
  test.use({ userAgent: "curl/8.4.0" });

  test("offers every platform's choices", async ({ page }) => {
    await page.goto("/create-community");
    await expect(
      page.getByText(/couldn't detect your platform/),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Download for Windows (.exe)" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Download for Linux (.AppImage)" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Apple Silicon Mac (.dmg)" }),
    ).toBeVisible();
  });
});
