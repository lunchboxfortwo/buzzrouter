import { configDefaults, defineConfig } from "vitest/config";

// *.integration.test.ts files share tables in one Postgres database via
// TRUNCATE/DELETE fixtures. Vitest runs test files in parallel by default,
// so two such files executing at once can wipe rows out from under each
// other mid-test. Keep this group serialized relative to itself while the
// rest of the suite still runs in parallel.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "e2e/**"],
    projects: [
      {
        test: {
          exclude: [
            ...configDefaults.exclude,
            "e2e/**",
            "**/*.integration.test.ts",
          ],
          name: "unit",
        },
      },
      {
        test: {
          exclude: [...configDefaults.exclude, "e2e/**"],
          fileParallelism: false,
          include: ["**/*.integration.test.ts"],
          name: "integration",
        },
      },
    ],
  },
});
