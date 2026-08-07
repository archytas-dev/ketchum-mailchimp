import { defineConfig, devices } from "@playwright/test";

// Corre SIEMPRE contra el Supabase local (ver .env.local / reference_supabase_local_clone_sin_password),
// nunca contra produccion — mandamiento #4, no se prueba contra datos del cliente.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // los tests comparten el mismo usuario dev y la misma base local
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
