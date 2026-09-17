import { Page } from "@playwright/test";

// Usuarios sinteticos del Supabase LOCAL (ver supabase/seed_dev_user.sql / seed_cliente_user.sql).
// No existen en produccion.
export const DEV_EMAIL = "dev@archytas.local";
export const DEV_PASSWORD = "devlocal123";
export const CLIENTE_EMAIL = "cliente-e2e@archytas.local";
export const CLIENTE_PASSWORD = "clientelocal123";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  // El copy actual del login es "Ingresar". Se acepta el texto anterior para
  // que un ajuste meramente editorial no convierta la suite en un falso rojo.
  await page.getByRole("button", { name: /entrar|ingresar/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

export async function loginAsDev(page: Page) {
  await login(page, DEV_EMAIL, DEV_PASSWORD);
}

export async function loginAsCliente(page: Page) {
  await login(page, CLIENTE_EMAIL, CLIENTE_PASSWORD);
}
