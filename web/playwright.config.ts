import { defineConfig, devices } from "@playwright/test";

// Runs against an already-built `out/` (npm run build first).
export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://localhost:4173" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx serve out -l 4173",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
});
