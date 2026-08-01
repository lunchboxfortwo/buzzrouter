import { expect, test } from "@playwright/test";

const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

test("leads with the one-page create form and normalizes the name", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("link", { name: "Create a community", exact: true })
    .click();
  await expect(page).toHaveURL(/\/create-community$/);

  await expect(
    page.getByRole("heading", { name: "Create a community" }),
  ).toBeVisible();

  const nameInput = page.getByPlaceholder("my-community");
  await expect(nameInput).toBeVisible();
  await expect(page.getByPlaceholder("you@example.com")).toBeVisible();

  // The live name preview normalizes to the hosted host.
  await nameInput.fill("My Cool Community!!");
  await expect(
    page.getByText("my-cool-community.communities.buzz.xyz"),
  ).toBeVisible();

  // The desktop app remains available as a self-serve fallback, and the
  // downstream CTAs still point where they should.
  await expect(page.getByText(/Buzz desktop app/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "List your community" }),
  ).toHaveAttribute("href", "/submit");
  await expect(
    page.getByRole("link", { name: "Link it" }),
  ).toHaveAttribute("href", "/shared-channels");
});

test("fails loudly with a self-serve fallback when live provisioning is off", async ({
  page,
}) => {
  // The live path is flag-gated OFF by default, so a real submit must surface a
  // legible failure with a "do it yourself" link — never a silent hang.
  await page.goto("/create-community");
  await page.getByPlaceholder("my-community").fill("e2e-offpath");
  await page.getByPlaceholder("you@example.com").fill("owner@example.com");
  await page.getByRole("button", { name: /Create my community/ }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(
    alert.getByRole("link", { name: "app.builderlab.xyz" }),
  ).toHaveAttribute("href", "https://app.builderlab.xyz");
});

test.describe("platform-specific download fallback", () => {
  test.use({ userAgent: WINDOWS_UA });

  test("detects Windows for the desktop fallback", async ({ page }) => {
    await page.goto("/create-community");
    await expect(page.getByText(/detected Windows/)).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Download for Windows (.exe)" }),
    ).toBeVisible();
  });
});
