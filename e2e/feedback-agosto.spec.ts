import { test, expect } from "@playwright/test";
import { loginAsDev } from "./helpers";

// Cubre el feedback de Fede (11/08) y el doc de Fedra (FeedbackKetchum.html).
// Corre contra el Supabase LOCAL, con el usuario dev sintetico.

const SHOTS = "test-results/shots";

test.describe("Feedback Fede — Base de Datos", () => {
  test("estado Activo/Inactivo se distingue por color, no solo por la palabra", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/base-datos");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "BMS", exact: true }).click();
    await expect(page.getByRole("cell", { name: "Clarin" }).first()).toBeVisible({ timeout: 30_000 });

    const activo = page.getByRole("button", { name: "Activo" }).first();
    await expect(activo).toBeVisible();
    const clases = await activo.getAttribute("class");
    expect(clases).toContain("green");

    await page.screenshot({ path: `${SHOTS}/01-base-datos-estado-color.png`, fullPage: false });
  });

  test("los dominios son links que abren en pestaña nueva", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/base-datos");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "BMS", exact: true }).click();
    await expect(page.getByRole("cell", { name: "Clarin" }).first()).toBeVisible({ timeout: 30_000 });

    const link = page.getByRole("link").filter({ hasText: /\./ }).first();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^https?:\/\//);
  });

  test("volver a una pestaña ya visitada no vuelve a pedir los datos al servidor", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/base-datos");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "BMS", exact: true }).click();
    await expect(page.getByRole("cell", { name: "Clarin" }).first()).toBeVisible({ timeout: 30_000 });

    // Las Server Actions viajan como POST a la misma ruta: se cuentan para saber si hubo refetch.
    let llamadas = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/base-datos")) llamadas++;
    });

    await page.getByRole("tab", { name: "Palabras clave" }).click();
    await expect(page.getByRole("tab", { name: "Palabras clave" })).toHaveAttribute("aria-selected", "true");
    await page.waitForTimeout(1500);
    const trasPrimeraVisita = llamadas;
    expect(trasPrimeraVisita).toBeGreaterThan(0); // la primera vez SI consulta

    await page.getByRole("tab", { name: "Medios de nicho" }).click();
    await page.waitForTimeout(500);
    await page.getByRole("tab", { name: "Palabras clave" }).click();
    await page.waitForTimeout(1500);

    expect(llamadas).toBe(trasPrimeraVisita); // al volver, ni una consulta mas
  });
});

test.describe("Base de Datos — qué cliente se configura", () => {
  // La version nueva del clipping LEE la config del cliente real (verificado en los 4
  // workflows v3: get_config_clipping con p_slug 'booking'|'bms'|'mars'|'msd'). Por eso las
  // dos entradas del par muestran la MISMA config: lo que cambia es si se puede editar.
  test("aparecen las dos versiones de cada cliente", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/base-datos");
    await page.getByRole("combobox").first().click();
    const opciones = await page.getByRole("option").allInnerTexts();
    expect(opciones.some((o) => /^booking$/i.test(o.trim()))).toBe(true);
    expect(opciones.some((o) => /booking - versión nueva/i.test(o))).toBe(true);
  });

  test("la versión que se envía hoy se ve pero no se edita", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/base-datos");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "BMS", exact: true }).click();
    await expect(page.getByRole("cell", { name: "Clarin" }).first()).toBeVisible({ timeout: 30_000 });

    await expect(page.getByText("Solo lectura")).toBeVisible();
    await expect(page.getByText(/se administran por fuera de esta pantalla/i)).toBeVisible();
    // El estado se sigue viendo (con su color) pero no se puede tocar.
    await expect(page.getByRole("button", { name: "Activo" }).first()).toBeDisabled();
    await expect(page.getByRole("button", { name: /Sumar nuevo/ })).toBeDisabled();
  });

  test("la Versión Nueva muestra la misma config y sí se edita", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/base-datos");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "BMS - Versión Nueva" }).click();
    await expect(page.getByRole("cell", { name: "Clarin" }).first()).toBeVisible({ timeout: 30_000 });

    await expect(page.getByText("Se puede editar")).toBeVisible();
    await expect(page.getByText(/Estás editando la nueva versión/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Activo" }).first()).toBeEnabled();
    await expect(page.getByRole("button", { name: /Sumar nuevo/ })).toBeEnabled();
  });
});

test.describe("Feedback Fede — Panel PM", () => {
  // En la base local el unico cliente con editor_state guardado (o sea, con diff real que
  // comparar) es BMS - Versión Nueva. Los clientes reales no bajan a local -- mandamiento #4.
  async function abrirPanelConDatos(page: import("@playwright/test").Page) {
    await page.goto("/panel-pm");
    await expect(page.getByRole("heading", { name: "Panel PM" })).toBeVisible();
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "BMS - Versión Nueva" }).click();
    await expect(page.getByText("Diff del clipping")).toBeVisible({ timeout: 30_000 });
  }

  test("filtra por categoría, acota el alto y muestra el diff en dos columnas", async ({ page }) => {
    await loginAsDev(page);
    await abrirPanelConDatos(page);

    const eliminadas = page.getByRole("button", { name: /Eliminadas/ });
    await expect(eliminadas).toBeVisible();
    await expect(eliminadas).toHaveAttribute("aria-pressed", "false");
    await eliminadas.click();
    await expect(eliminadas).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /Ver todas/ })).toBeVisible();
    await eliminadas.click();
    await expect(eliminadas).toHaveAttribute("aria-pressed", "false");

    // La lista vive en un contenedor con scroll propio, no estira la pagina.
    const lista = page.locator("ul.overflow-y-auto").first();
    if (await lista.count()) {
      const clases = await lista.getAttribute("class");
      expect(clases).toContain("max-h-");
    }

    // Si hay alguna editada, se despliega y muestra las dos columnas.
    const editada = page.getByRole("button", { expanded: false }).filter({ hasText: "Editada" }).first();
    if (await editada.count()) {
      await editada.click();
      // Regex case-insensitive: los encabezados van en uppercase por CSS y innerText devuelve
      // el texto ya transformado.
      await expect(page.getByText(/lo que mandamos/i).first()).toBeVisible();
      await expect(page.getByText(/como quedó/i).first()).toBeVisible();
      // El diff palabra por palabra marca lo que se saco y lo que se agrego.
      await expect(page.locator("span.line-through").first()).toBeVisible();
    }

    await page.screenshot({ path: `${SHOTS}/02-panel-pm.png`, fullPage: true });
  });

  test("los títulos no muestran HTML crudo", async ({ page }) => {
    await loginAsDev(page);
    await abrirPanelConDatos(page);
    await expect(page.getByText("<span", { exact: false })).toHaveCount(0);
    await expect(page.getByText("color:rgb", { exact: false })).toHaveCount(0);
  });
});

test.describe("Feedback Fedra — Actividad", () => {
  test("Casi entraron va primero, con links, y los medios rebotados tienen su propia tarjeta", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/actividad");
    await expect(page.getByRole("heading", { name: "Actividad" })).toBeVisible();

    const titulos = await page.getByRole("heading", { level: 2 }).allInnerTexts();
    expect(titulos[0]).toContain("Casi entraron");
    expect(titulos[1]).toContain("Medios que nos rebotaron");

    await page.screenshot({ path: `${SHOTS}/03-actividad.png`, fullPage: true });
  });

  test("el medio rebotado es clickeable", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/actividad");
    const tarjeta = page.locator("div").filter({ hasText: "Medios que nos rebotaron" }).last();
    const link = tarjeta.getByRole("link").first();
    if (await link.count()) {
      await expect(link).toHaveAttribute("target", "_blank");
      expect(await link.getAttribute("href")).toMatch(/^https?:\/\//);
    }
  });
});

test.describe("Feedback Fedra — Reporte de errores (KET-49)", () => {
  test("carga un reporte y aparece en el historial", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/reportes");
    await expect(page.getByRole("heading", { name: "Reporte de errores" })).toBeVisible();

    const descripcion = `E2E ${Date.now()} — faltó una nota de prueba`;
    await page.getByRole("combobox").nth(1).click(); // tipo de error
    await page.getByRole("option", { name: "Noticia que no entró" }).click();
    await page.getByLabel("Descripción").fill(descripcion);
    await page.screenshot({ path: `${SHOTS}/04-reportes-form.png`, fullPage: true });

    await page.getByRole("button", { name: "Enviar reporte" }).click();
    await expect(page.getByRole("cell", { name: descripcion })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("cell", { name: "Noticia que no entró" }).first()).toBeVisible();

    await page.screenshot({ path: `${SHOTS}/05-reportes-historial.png`, fullPage: true });
  });

  test("sin descripción no deja enviar", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/reportes");
    await expect(page.getByRole("button", { name: "Enviar reporte" })).toBeDisabled();
  });

  test("está en el menú, y Actividad va antes que Estadísticas", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/hoy");
    const menu = await page.locator("aside nav a").allInnerTexts();
    expect(menu).toContain("Reporte de errores");
    expect(menu.indexOf("Actividad")).toBeLessThan(menu.indexOf("Estadísticas"));
  });
});

test.describe("Las dos versiones en todas las pantallas", () => {
  for (const ruta of ["/hoy", "/precarga", "/historial", "/estadisticas", "/actividad", "/reportes"]) {
    test(`${ruta} ofrece la versión actual y la nueva`, async ({ page }) => {
      await loginAsDev(page);
      await page.goto(ruta);
      // Segun la pantalla el selector es tabs (ya visibles) o un combobox que hay que abrir.
      const combo = page.getByRole("combobox").first();
      if (await combo.count()) await combo.click();
      await expect(page.getByText(/versión nueva/i).first()).toBeVisible({ timeout: 30_000 });
    });
  }

  test("Actividad ya no muestra “Próximamente”", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/actividad");
    await expect(page.getByText("Próximamente")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Actividad" })).toBeVisible();
  });
});

test.describe("Reporte de errores — versión vieja vs nueva", () => {
  test("avisa en rojo cuando el reporte es sobre la versión que se envía hoy", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/reportes");
    await expect(page.getByText(/versión anterior del clipping/i)).toBeVisible({ timeout: 30_000 });
  });

  test("sobre la Versión Nueva no aparece el aviso", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/reportes");
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /- Versión Nueva/ }).first().click();
    await expect(page.getByText(/versión anterior del clipping/i)).toHaveCount(0);
  });
});

test.describe("Feedback Fedra — Tier en Precarga", () => {
  test("al escribir el medio muestra su tier y se puede cambiar", async ({ page }) => {
    await loginAsDev(page);
    await page.goto("/precarga");
    await expect(page.getByRole("heading", { name: "Precargar notas" })).toBeVisible();

    // Sin medio escrito, el selector de tier esta deshabilitado.
    const tier = page.getByRole("combobox").filter({ hasText: /Sin tier|Tier/ }).first();
    await expect(tier).toBeVisible();

    await page.getByPlaceholder("Medio").first().fill("Clarin");
    await page.getByPlaceholder("URL").first().click(); // dispara el blur
    await page.waitForTimeout(1500);

    await tier.click();
    await page.getByRole("option", { name: "Tier 2" }).click();
    await expect(page.getByText(/quedó como Tier 2/)).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: `${SHOTS}/06-precarga-tier.png`, fullPage: true });
  });
});
