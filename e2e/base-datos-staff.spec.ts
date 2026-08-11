import { test, expect } from "@playwright/test";
import { loginAsDev, loginAsCliente } from "./helpers";

test.describe("Base de Datos — vista staff (KET-46)", () => {
  test("dev ve Google Alerts y Seguimiento, y puede sumar una alerta", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/base-datos");

    await expect(page.getByRole("tab", { name: "Google Alerts" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Seguimiento" })).toBeVisible();

    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "BMS", exact: true }).click();
    await page.getByRole("tab", { name: "Google Alerts" }).click();

    const tema = `E2E Alert ${Date.now()}`;
    await page.getByRole("button", { name: "Sumar nueva" }).click();
    await page.getByPlaceholder("ej. Bristol Myers Squibb Argentina").fill(tema);
    await page.getByPlaceholder("https://www.google.com/alerts/feeds/...").fill(`https://example.com/feed/${Date.now()}`);
    await page.getByRole("button", { name: "Sumar" }).click();

    await expect(page.getByText("Alerta agregada")).toBeVisible();
    await expect(page.getByRole("cell", { name: tema })).toBeVisible();
  });

  test("cliente NO ve Google Alerts ni Seguimiento (RLS + UI)", async ({ page }) => {
    await loginAsCliente(page);
    await page.goto("/base-datos");

    await expect(page.getByRole("heading", { name: "Base de Datos" })).toBeVisible();
    // Desde el commit 6488e7e el cliente ve "Proximamente" en vez de las pestañas: v2 (lo que
    // hoy le arma su clipping real) lee la config de un Google Sheet, no de estas tablas, asi
    // que editar aca no haria nada. Lo que este test protege sigue siendo lo mismo: que las
    // pestañas staff-only no aparezcan por ningun lado.
    await expect(page.getByText("Próximamente")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Google Alerts" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Seguimiento" })).toHaveCount(0);
  });
});
