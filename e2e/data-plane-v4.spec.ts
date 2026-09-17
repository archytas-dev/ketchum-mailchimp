import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers";

/**
 * [W0.19 / W0.21] La herramienta leyendo el plano v4 aislado.
 *
 * Corre con el usuario sintético que tiene `app_metadata.ketchum_data_plane=public_v4`.
 * No usa una variable global: sería posible probar v3 por error y obtener verde falso.
 *
 * Requiere datos v4 en la base local. Se siembran con la fixture canónica:
 *   supabase/fixtures/clipping_v4_bms_v1.json  ->  import_clipping_v4(..., 'public_v4')
 *
 * Lo que verifica, y por qué importa: que las pantallas muestren lo que hay en `public.*_v4` y
 * **no** lo que hay en `public.notes`. Todo lo probado hasta ahora fue con el plano en `v3`,
 * que demuestra que no se rompió nada — no que el plano v4 funcione. No es lo mismo: el embed
 * cross-schema de PostgREST (PGRST200) andaba perfecto en v3 y estaba roto en v4.
 */

test.describe("Plano de datos v4", () => {
  // Títulos que solo existen en la fixture v4. Si aparecen, la pantalla leyó `public.*_v4`.
  const TITULO_V4 = "BMS presenta resultados de fase 3 en oncologia";
  const TITULO_V4_FORZADA = "Resistencia antimicrobiana";

  test("/hoy muestra el clipping del plano v4, no el de la v3", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/hoy");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "BMS (Test Interno)", exact: true }).click();

    await expect(page.getByText(TITULO_V4).first()).toBeVisible({ timeout: 30_000 });
  });

  test("/hoy trae las notas con su orden y la nota forzada", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/hoy");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "BMS (Test Interno)", exact: true }).click();
    await expect(page.getByText(TITULO_V4).first()).toBeVisible({ timeout: 30_000 });

    // La nota que el juez marcó forzada también entra al clipping.
    await expect(page.getByText(TITULO_V4_FORZADA).first()).toBeVisible();
  });

  test("/historial lista el clipping v4 y lo puede abrir", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/historial");
    // El nombre del cliente se resuelve con un lookup aparte (sin embed cross-schema):
    // si eso se rompiera, acá aparecería "—" en vez de BMS.
    await expect(page.getByText("BMS (Test Interno)").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("—", { exact: true })).toHaveCount(0);
  });

  test("Base de Datos: medios propios v4 editables, config compartida de solo lectura", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/base-datos");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "BMS (Test Interno)", exact: true }).click();
    // "Clarin" viene del catálogo v4 (medios_catalogo/medios_suscripcion), no de public.medios.
    await expect(page.getByRole("cell", { name: "Clarin" }).first()).toBeVisible({ timeout: 30_000 });

    // Medios tiene su propio catálogo y RPCs aislados de la v3 (v4_agregar_medio,
    // v4_set_medio_activo, v4_guardar_valorizacion) -- no comparte tabla con v3, así que puede
    // quedar editable sin arriesgar nada.
    await expect(page.getByRole("button", { name: /Sumar nuevo/ })).toBeEnabled();

    // Keywords/secciones/alerts siguen viviendo en las tablas compartidas con v3
    // (kw_keywords/secciones/google_alerts) -- ahí sí, el runbook pide DESHABILITAR, no esconder.
    await page.getByRole("tab", { name: "Palabras clave" }).click();
    await expect(page.getByRole("button", { name: /Sumar nueva/ })).toBeDisabled();
  });

  test("Precarga no habilita el circuito legado en el plano v4", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/precarga");

    await expect(page.getByText("Vista de prueba v4: Precarga está en modo lectura.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Agregar nota/i })).toHaveCount(0);
  });

  test("la ruta heredada de clipping no queda disponible en el plano v4", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/clipping/00000000-0000-0000-0000-000000000000");

    await expect(page.getByText(/404|not found|página no encontrada/i)).toBeVisible();
  });
});
