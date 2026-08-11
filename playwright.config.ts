import { defineConfig, devices } from "@playwright/test";

// Corre SIEMPRE contra el Supabase local (ver .env.local / reference_supabase_local_clone_sin_password),
// nunca contra produccion — mandamiento #4, no se prueba contra datos del cliente.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // los tests comparten el mismo usuario dev y la misma base local
  // ...y por el mismo motivo, un solo worker: `fullyParallel: false` serializa dentro de cada
  // archivo, pero los archivos entre si seguian corriendo en paralelo contra el mismo dev
  // server y la misma base, y se pisaban (timeouts intermitentes en los tests de Base de Datos).
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx next dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
