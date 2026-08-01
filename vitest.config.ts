import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "e2e/**"],
    // Integration tests share one Postgres; running test files in parallel let
    // them race on shared tables and intermittently fail the deploy gate. Run
    // files serially so DB state is never concurrently mutated. The suite is
    // small enough that the wall-clock cost is negligible.
    fileParallelism: false,
  },
});
