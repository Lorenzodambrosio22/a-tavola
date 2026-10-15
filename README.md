# A Tavola

Webapp (PWA mobile-first, in italiano) per una persona o una famiglia: menù settimanale generato con l'AI nel rispetto di allergie e preferenze dei presenti, lista della spesa unica con "da comprare dopo", "non mi piace" che impara, ricette proprie, dispensa automatica.

Specifica: [`docs/superpowers/specs/2026-10-12-app-cibo-design.md`](docs/superpowers/specs/2026-10-12-app-cibo-design.md).

## Stack

- Un solo **Cloudflare Worker** (Hono) che serve API (`/api/*`) e frontend statico (Workers Static Assets).
- **React + Vite + TypeScript** per il frontend (PWA).
- **Cloudflare D1** con migrazioni SQL in [`migrations/`](migrations).
- **Better Auth** su D1, login con codice via email (invio con **Resend**).
- AI intercambiabile: **Claude** (`@anthropic-ai/sdk`) e **Workers AI** (binding `AI`).
- Test: **Vitest** + `@cloudflare/vitest-pool-workers` (D1 locale, provider AI finto, nessuna chiamata AI reale).

## Struttura

```
src/domain/     logica pura (vincoli, porzioni, calorie, spesa, apprendimento, dispensa)
src/server/     Worker Hono: auth, routes, servizi, query D1, provider AI
src/shared/     tipi condivisi API/frontend
src/web/        frontend React
migrations/     schema D1 + seed ingredienti/allergeni
test/           test Vitest (domain + route)
```

## Sviluppo locale

```bash
npm install
cp .dev.vars.example .dev.vars         # poi imposta BETTER_AUTH_SECRET
npm run db:migrate:local               # crea il DB D1 locale e applica le migrazioni
npm run dev                            # http://localhost:5173
```

Con `APP_ENV=development`, senza `RESEND_API_KEY` il codice di accesso viene stampato nel terminale (`[A Tavola] Codice di accesso per …`). In produzione sono obbligatori `BETTER_AUTH_SECRET` e `RESEND_API_KEY`: non viene usato il recapito nel log.

Workers AI è disponibile solo in remoto: per provarlo in locale serve `npx wrangler login` e `CF_REMOTE=1 npm run dev`. Senza, usa il provider Claude (imposta `ANTHROPIC_API_KEY` in `.dev.vars`).

Controlli:

```bash
npm run typecheck
npm test
npm run build
```

## Deploy su workers.dev

> Prerequisito: account Cloudflare (piano Workers Paid consigliato per i tempi delle chiamate AI) e `npx wrangler login`.

1. **Crea il database D1** e copia l'`database_id` restituito in `wrangler.jsonc` (al posto di `00000000-0000-0000-0000-000000000000`):

   ```bash
   npx wrangler d1 create app-cibo
   ```

2. **Applica le migrazioni** (schema + seed di ~300 ingredienti e gruppi allergeni):

   ```bash
   npm run db:migrate:remote      # = npx wrangler d1 migrations apply app-cibo --remote
   ```

3. **Imposta i secret**:

   ```bash
   npx wrangler secret put BETTER_AUTH_SECRET    # stringa casuale lunga (es. openssl rand -base64 32)
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put ADMIN_EMAIL           # email che può aprire /admin/confronto
   # opzionali
   npx wrangler secret put BRAVE_SEARCH_API_KEY  # ricerca link ricetta per il provider Workers AI
   npx wrangler secret put BETTER_AUTH_URL       # es. https://app-cibo.<tuo-sottodominio>.workers.dev (default: origin della richiesta)
   ```

   Per Resend: verifica un dominio mittente e imposta `EMAIL_FROM` in `wrangler.jsonc` (il default `onboarding@resend.dev` invia solo all'indirizzo del tuo account Resend).

4. **Deploy**:

   ```bash
   npm run deploy                 # vite build && wrangler deploy
   ```

## Configurazione (`vars` in `wrangler.jsonc`)

| Variabile | Default | Uso |
|---|---|---|
| `AI_PROVIDER_DEFAULT` | `claude` | provider usato se il nucleo non ne sceglie uno |
| `CLAUDE_MODEL_WEEK` | `claude-sonnet-5-5` | `generateWeek` |
| `CLAUDE_MODEL_RECIPE` | `claude-sonnet-5-5` | `writeRecipe`, `findSourceUrl` |
| `CLAUDE_MODEL_FAST` | `claude-haiku-5-5` | `replaceMeal`, `mapIngredient` |
| `WORKERS_AI_MODEL` | `@cf/meta/llama-4-scout-17b-16e-instruct` | modello Workers AI |
| `EMAIL_FROM` | `A Tavola <onboarding@resend.dev>` | mittente email |
| `APP_ENV` | `production` | `development` in `.dev.vars` abilita il recapito OTP nel terminale |

## Funzioni implementate

- Login email con OTP salvato come hash, onboarding, nucleo personale, inviti monouso, profilo e assenze ricorrenti.
- Scelta facoltativa di 24 piatti con foto al primo accesso e nel profilo: orienta i suggerimenti senza chiamate AI aggiuntive. [Flusso, immagini e migrazione](docs/taste-onboarding.md).
- Menù settimanale con Claude / Workers AI, fallback, controllo allergie nel codice (anche sui pasti fissati), porzioni, preferiti, ricette proprie e link da risultati di ricerca.
- Foto ricette recuperate dai metadati della pagina originale, senza generazione immagini, chiavi fotografiche o chiamate AI aggiuntive. [Flusso e limiti](docs/recipe-images.md).
- Rifiuti e apprendimento per persona, con sostituzione del pasto.
- Spesa aggregata per reparto e data d'acquisto, voci manuali, spunte condivise con aggiornamento ogni 5 secondi mentre la pagina è visibile. Il ricalcolo conserva le spunte.
- «Spesa fatta» conferma le quantità e carica gli acquisti in dispensa una sola volta. Le voci ancora da acquistare possono essere spuntate successivamente e vengono caricate senza duplicati.
- Dispensa con scadenze stimate, correzioni manuali e consumo FIFO notturno. Il Cron elabora il giorno precedente nel fuso `Europe/Rome`; un registro impedisce il doppio consumo in caso di retry. I prodotti scaduti e quelli comprati dopo il pasto sono esclusi dal consumo.
- Confronto provider per l'admin: input identico, latenza, token, pasti mancanti e violazioni; non modifica il menù. Dal profilo admin si può correggere il riferimento ingredienti.

## Stato e verifica

Implementazione locale: [stato lavori](docs/implementation-status.md). Non ancora pubblicata su Cloudflare: il database remoto e le credenziali di AI/email devono essere configurati prima del deploy. Non ci sono risposte AI simulate nel percorso di produzione; i provider finti sono usati soltanto dai test.

I test eseguono il Worker con D1 locale. Coprono autenticazione, isolamento dei nuclei, allergie, sostituzioni, spesa, acquisti ripetuti e consumo concorrente della dispensa. Non chiamano servizi AI o Resend reali.
