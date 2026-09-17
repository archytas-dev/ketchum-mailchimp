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
    // Puerto exclusivo: 3000 puede pertenecer a otra app local.
    baseURL: "http://localhost:3017",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx next dev -p 3017",
    url: "http://localhost:3017",
    // [W0.19 · 15/09] No se puede reusar un servidor que quizas no tiene KETCHUM_DATA_PLANE.
    // Paso: la suite del plano v4 corrio contra un dev server levantado en v3 y los 4 tests
    // fallaron por eso. El modo de falla peligroso es el inverso — que PASEN sin haber probado
    // nunca el plano v4 — y ese no se nota.
    // La suite gobierna su propio Next; nunca reutiliza una app ajena o vieja.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
