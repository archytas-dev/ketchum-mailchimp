import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers";

test.describe("Base de Datos (KET-45)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDev(page);
  });

  test("carga la pestaña, muestra los 4 sub-tabs y los medios reales de BMS", async ({ page }) => {
    await page.goto("/base-datos");
    await expect(page.getByRole("heading", { name: "Base de Datos" })).toBeVisible();

    for (const tab of ["Medios de nicho", "Medios generales", "Palabras clave", "Secciones"]) {
      await expect(page.getByRole("tab", { name: tab })).toBeVisible();
    }

    // Seleccionar BMS y esperar que la tabla de "medios de nicho" traiga datos reales
    // (44 medios monitoreados en la base local, clonados de produccion).
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "BMS" }).click();
    await expect(page.getByRole("cell", { name: "Clarin" }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("sumar un medio nuevo aparece en la tabla sin recargar", async ({ page }) => {
    await page.goto("/base-datos");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "BMS" }).click();
    await expect(page.getByRole("cell", { name: "Clarin" }).first()).toBeVisible({ timeout: 10_000 });

    const dominio = `e2e-${Date.now()}.com.ar`;
    await page.getByRole("button", { name: "Sumar nuevo" }).click();
    await page.getByPlaceholder("ejemplo.com.ar").fill(dominio);
    await page.getByPlaceholder("Nombre del medio").fill("Medio de Prueba E2E");
    await page.getByRole("button", { name: "Sumar" }).click();

    await expect(page.getByText("Medio agregado")).toBeVisible();
    await expect(page.getByRole("cell", { name: dominio })).toBeVisible();
  });

  test("crear una sección sin elegir keywords se rechaza (no puede quedar vacía)", async ({ page }) => {
    await page.goto("/base-datos");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "BMS" }).click();
    await page.getByRole("tab", { name: "Secciones" }).click();

    await page.getByRole("button", { name: "Sumar nueva" }).click();
    await page.getByPlaceholder("ej. Dermatología").fill(`E2E Sección ${Date.now()}`);
    // Sin tildar ninguna keyword: el botón Sumar tiene que quedar deshabilitado.
    await expect(page.getByRole("button", { name: "Sumar" })).toBeDisabled();
  });
});
