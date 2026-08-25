import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginAsDev } from "./helpers";

// [25/08] Feedback de Cami (Ketchum): "En la precarga tengo este tema, no me deja poner millones
// la valoración. Si es de $ 7.000.000 no puedo cargarlo".
//
// Los campos Alcance/Ad Value eran `type="number"`, que sólo acepta el formato numérico del
// estándar HTML: el punto es separador DECIMAL y los separadores de miles no existen. Al escribir
// "7.000.000" el navegador daba el valor por inválido y el commit se descartaba en silencio.
// Ver src/lib/numero.ts.

// Medio sintético: `setAlcanceAdValue` crea la fila en `tiers` si no existe, así que no hace
// falta pisar un medio real de la base local.
const MEDIO = "E2E Ad Value";

/** Escribe el medio y espera a que se habiliten Alcance/Ad Value (arrancan deshabilitados). */
async function traerMedio(page: Page): Promise<Locator> {
  await page.goto("/precarga");
  await expect(page.getByRole("heading", { name: "Precargar notas" })).toBeVisible();
  const medioInput = page.getByPlaceholder("Medio").first();
  await medioInput.fill(MEDIO);
  await medioInput.blur(); // el blur dispara el lookup de tier/alcance/ad value
  const adValue = page.getByPlaceholder("Ad Value").first();
  await expect(adValue).toBeEnabled({ timeout: 15_000 });
  return adValue;
}

test.describe("Feedback Cami — Ad Value con separador de miles", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDev(page);
  });

  test("un Ad Value en millones escrito con puntos se guarda y queda formateado", async ({ page }) => {
    const adValue = await traerMedio(page);

    await adValue.fill("7.000.000");
    await adValue.blur();

    await expect(page.getByText(/actualizado para este cliente/)).toBeVisible({ timeout: 15_000 });
    // Se reescribe con el formato canónico: le confirma al usuario qué se entendió.
    await expect(adValue).toHaveValue("7.000.000");

    // Y persistió de verdad: al recargar y volver a traer el medio sigue estando.
    const adValue2 = await traerMedio(page);
    await expect(adValue2).toHaveValue("7.000.000");
  });

  test("escribirlo sin puntos sigue funcionando igual", async ({ page }) => {
    const adValue = await traerMedio(page);

    await adValue.fill("5000000");
    await adValue.blur();

    await expect(page.getByText(/actualizado para este cliente/)).toBeVisible({ timeout: 15_000 });
    await expect(adValue).toHaveValue("5.000.000");
  });

  test("texto sin dígitos revierte al valor guardado en vez de borrarlo", async ({ page }) => {
    const adValue = await traerMedio(page);

    // Primero se deja un valor conocido...
    await adValue.fill("4.200.000");
    await adValue.blur();
    await expect(adValue).toHaveValue("4.200.000");

    // ...y después se escribe basura encima: no se puede perder el dato que ya estaba.
    await adValue.fill("abc");
    await adValue.blur();
    await expect(adValue).toHaveValue("4.200.000");
  });

  test("vaciar el campo a propósito sí lo deja sin asignar", async ({ page }) => {
    const adValue = await traerMedio(page);

    await adValue.fill("3.000.000");
    await adValue.blur();
    await expect(adValue).toHaveValue("3.000.000");

    await adValue.fill("");
    await adValue.blur();
    await expect(adValue).toHaveValue("");
  });
});
