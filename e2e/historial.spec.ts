import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers";

/**
 * [W0.12 · 15/09] Este archivo nace de una regresión que la suite no atrapó.
 *
 * Al sacar el embed `clients(nombre)` de /historial —necesario porque PostgREST no resuelve
 * embeds cross-schema y en el plano v4 la tabla vive en `test`— el reemplazo del lookup no se
 * aplicó (el archivo usa CRLF y el parche buscaba `\n`). Resultado: la consulta dejó de traer
 * el nombre y el código seguía leyéndolo del embed inexistente, así que **todas las filas del
 * historial mostraban "—" en lugar del cliente**.
 *
 * La suite completa pasó igual, 30 de 30: ningún test miraba el contenido de las filas de
 * /historial, sólo el selector de arriba. Un test que no mira lo que la pantalla muestra no
 * protege la pantalla.
 */

test.describe("Historial — contenido de las filas", () => {
  test("lista clippings con el nombre del cliente resuelto", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/historial");
    await expect(page.getByRole("heading", { name: "Historial" })).toBeVisible();

    // Tiene que haber al menos una fila con un cliente real. El "—" es el fallback de cuando
    // el nombre no se pudo resolver: si aparece, el lookup se rompió.
    const nombres = ["BMS", "Booking", "MARS", "MSD Salud Animal"];
    const alguno = page.getByText(new RegExp(nombres.join("|")));
    await expect(alguno.first()).toBeVisible({ timeout: 30_000 });
  });

  test("ninguna fila queda con el cliente sin resolver", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/historial");
    await expect(page.getByRole("heading", { name: "Historial" })).toBeVisible();
    await expect(page.getByText("—", { exact: true })).toHaveCount(0);
  });
});
