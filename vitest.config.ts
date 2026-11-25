import { defineConfig } from "vitest/config";

// Resolve workspace packages to their TypeScript source (the "source"
// export condition), never to a possibly stale dist/ build. Tests run in
// Vite's SSR environment, which reads ssr.resolve, not the top-level
// resolve.conditions.
const conditions = ["source"];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    globals: false,
  },
});
