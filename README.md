# ketchum-mailchimp

Editor web del clipping diario de Ketchum (Booking y BMS), listo para **copiar y pegar en Mailchimp**.

Es un único archivo estático (`index.html`) — no necesita build. Se puede desplegar en Vercel tal cual.

## Uso

Abrir el editor indicando el cliente con el parámetro `?c=`:

- Booking → `?c=booking`
- BMS → `?c=bms`

Ejemplo: `https://TU-DEPLOY.vercel.app/?c=booking`

El editor:
1. Carga el clipping del día desde los webhooks de n8n:
   - `https://archytasai.app.n8n.cloud/webhook/clipping-booking`
   - `https://archytasai.app.n8n.cloud/webhook/clipping-bms`
2. Permite editar/agregar/borrar/reordenar notas y secciones (drag & drop).
3. Con **"Exportar a Mailchimp"** genera el HTML con el diseño del clipping (sin badges), listo para pegar en Mailchimp (Custom HTML / "Pega tu propio código").

> Las ediciones son de sesión (no se guardan). El n8n publica el JSON del día; el editor lo lee al abrir.

## Deploy en Vercel

- Conectar este repo en Vercel (Add New → Project → Import) y deployar; o
- `vercel` por CLI desde la carpeta.

No hay framework ni build: es HTML estático.
