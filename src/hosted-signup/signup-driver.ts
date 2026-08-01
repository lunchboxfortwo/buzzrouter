import { randomBytes } from "node:crypto";

import { ApiError } from "../http/api-error";

import {
  BuilderlabClient,
  DEFAULT_BUILDERLAB_ORIGIN,
  resolveLiveBuilderlabConfig,
  type BuilderlabClientOptions,
  type BuilderlabSession,
} from "./builderlab-client";

/**
 * Acquires an authenticated Builderlab session for a fresh, self-provisioned
 * account. This is the ONE step that needs a real browser server-side: Block's
 * signup is a hosted Auth0 UI. Everything after (challenge → sign → verify →
 * create) is pure HTTP in `createHostedCommunity`.
 *
 * The live implementation drives the signup UI with Playwright, then obtains the
 * bearer `session_credential` by running the documented CLI-login exchange
 * inside the now-authenticated browser (see the live-proof report §3 step 1:
 * `GET /api/goose/v1/auth/login?type=cli&product=buzz&returnTo=…` → `?code=…` →
 * `POST /v1/auth/login/exchange`). Tests inject a fake driver and never launch a
 * browser or touch the real service.
 */
export interface SignupDriver {
  /**
   * Provision a new account for `email` and return its session credential.
   * Throws an `ApiError` with a stable code on ANY failure — the caller turns
   * that into a legible "we couldn't create it, here's how to do it yourself".
   */
  acquireSession(input: { email: string }): Promise<BuilderlabSession>;
}

export interface PlaywrightSignupDriverOptions extends BuilderlabClientOptions {
  /** Base URL of the signup site (defaults to the real hosted app). */
  signupUrl?: string;
  /** Launch the browser headless (default true). */
  headless?: boolean;
  /** Overall budget for the whole browser dance, ms (default 90s). */
  timeoutMs?: number;
}

/** Minimal structural view of the Playwright surface we use — keeps this file's
 * types independent of whether `playwright` ships its own and avoids bundling
 * the browser package until the flag actually turns the live path on. */
interface PwPage {
  goto(url: string, opts?: { timeout?: number; waitUntil?: string }): Promise<unknown>;
  fill(selector: string, value: string, opts?: { timeout?: number }): Promise<void>;
  click(selector: string, opts?: { timeout?: number }): Promise<void>;
  waitForURL(
    url: string | RegExp | ((url: string) => boolean),
    opts?: { timeout?: number },
  ): Promise<void>;
  url(): string;
  waitForSelector(selector: string, opts?: { timeout?: number }): Promise<unknown>;
}
interface PwContext {
  newPage(): Promise<PwPage>;
}
interface PwBrowser {
  newContext(opts?: Record<string, unknown>): Promise<PwContext>;
  close(): Promise<void>;
}
interface PwChromium {
  launch(opts?: { headless?: boolean }): Promise<PwBrowser>;
}

/** A strong random password for a write-once account the user takes ownership of
 * afterwards. Not stored by us in plaintext — the account is handed over via the
 * export in the response. */
export function generateSignupPassword(): string {
  // 24 url-safe bytes + fixed classes so it satisfies any Auth0 policy.
  return `Bz1!${randomBytes(24).toString("base64url")}`;
}

/**
 * Build the CLI-login URL that, hit from an ALREADY-authenticated browser,
 * bounces straight back to `returnTo` with a `?code=` (no re-prompt). Pure so
 * it is unit-testable without a browser.
 */
export function buildCliLoginUrl(origin: string, returnTo: string): string {
  const url = new URL("/api/goose/v1/auth/login", origin);
  url.searchParams.set("type", "cli");
  url.searchParams.set("product", "buzz");
  url.searchParams.set("returnTo", returnTo);
  return url.toString();
}

/** Extract the OAuth `code` from a returnTo callback URL, or throw. Pure. */
export function extractLoginCode(callbackUrl: string): string {
  let code: string | null = null;
  try {
    code = new URL(callbackUrl).searchParams.get("code");
  } catch {
    code = null;
  }
  if (!code) {
    throw new ApiError(
      "signup_no_login_code",
      "The hosted signup did not return a login code.",
      502,
    );
  }
  return code;
}

/** Sentinel returnTo the browser is redirected to; we intercept it to read the
 * code and never actually load it. */
const CALLBACK_RETURN_TO = "http://127.0.0.1:1/buzzrouter/callback";

/**
 * Live driver. Gated: it refuses to launch a browser unless
 * `BUZZROUTER_HOSTED_SIGNUP_ALLOW_LIVE=1` (same flag as `resolveLiveBuilderlabConfig`).
 *
 * The signup DOM steps are best-effort against a third-party UI that WILL change
 * and may show a CAPTCHA/bot gate. Every failure raises `signup_automation_failed`
 * (or a more specific code) so the caller can fail loudly with a self-serve
 * fallback rather than hang or half-create an account. It never logs the
 * password or the session credential.
 */
export class PlaywrightSignupDriver implements SignupDriver {
  private readonly signupUrl: string;
  private readonly origin: string;
  private readonly headless: boolean;
  private readonly timeoutMs: number;
  private readonly client: BuilderlabClient;

  constructor(options: PlaywrightSignupDriverOptions = {}) {
    // Reuse the same live-egress gate + client config the binding path uses.
    const config = resolveLiveBuilderlabConfig(options);
    this.client = new BuilderlabClient(config);
    this.origin = config.origin;
    this.signupUrl = options.signupUrl ?? DEFAULT_BUILDERLAB_ORIGIN;
    this.headless = options.headless ?? true;
    this.timeoutMs = options.timeoutMs ?? 90_000;
  }

  async acquireSession(input: {
    email: string;
  }): Promise<BuilderlabSession> {
    const password = generateSignupPassword();
    const chromium = await loadChromium();
    const browser = await chromium.launch({ headless: this.headless });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await this.driveSignup(page, input.email, password);
      const code = await this.captureLoginCode(page);
      // Exchange server-side for the bearer session credential.
      return await this.client.exchangeLoginCode(code);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        "signup_automation_failed",
        "Automated signup at the hosted Buzz service failed.",
        502,
        { cause: error },
      );
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  /**
   * Best-effort drive of the hosted signup form. Selectors target a standard
   * Auth0 Universal Login signup (email + password). The proof run confirmed
   * signup needs NO email verification to reach an authenticated session, so we
   * do not wait on a mailbox. A CAPTCHA or a changed form surfaces as a timeout,
   * which the caller reports as a clear failure.
   */
  private async driveSignup(
    page: PwPage,
    email: string,
    password: string,
  ): Promise<void> {
    const t = this.timeoutMs;
    await page.goto(`${this.signupUrl}/signup`, {
      timeout: t,
      waitUntil: "domcontentloaded",
    });
    await page.fill('input[name="email"], input[type="email"]', email, {
      timeout: t,
    });
    await page.fill(
      'input[name="password"], input[type="password"]',
      password,
      { timeout: t },
    );
    await page.click(
      'button[type="submit"], button[name="action"][value="default"]',
      { timeout: t },
    );
    // Land on the authenticated app. The proof run observed signup dropping
    // straight into an authenticated session with a provisioned workspace.
    await page.waitForURL(/\/buzz\b|app\.builderlab\.xyz\/(?!signup|login)/u, {
      timeout: t,
    });
  }

  /**
   * From the authenticated page, run the CLI-login flow and intercept the
   * redirect to our sentinel returnTo to read the `?code`. The sentinel points
   * at an unroutable localhost URL so the browser never actually loads it — we
   * only need its query string.
   */
  private async captureLoginCode(page: PwPage): Promise<string> {
    await page
      .goto(buildCliLoginUrl(this.origin, CALLBACK_RETURN_TO), {
        timeout: this.timeoutMs,
        waitUntil: "commit",
      })
      .catch(() => undefined);
    await page.waitForURL((url: string) => url.startsWith(CALLBACK_RETURN_TO), {
      timeout: this.timeoutMs,
    });
    return extractLoginCode(page.url());
  }
}

async function loadChromium(): Promise<PwChromium> {
  try {
    const mod = (await import("playwright")) as unknown as {
      chromium: PwChromium;
    };
    return mod.chromium;
  } catch (error) {
    throw new ApiError(
      "signup_browser_unavailable",
      "A server-side browser is not available for hosted signup.",
      503,
      { cause: error },
    );
  }
}
