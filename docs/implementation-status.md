# Stato implementazione — 15 ottobre 2026

La specifica di riferimento è `superpowers/specs/2026-10-12-app-cibo-design.md`.

Il codice delle prime tre fasi è stato recuperato dal worktree locale `feat/v1`, preservando il worktree originale. L'implementazione si trova ora nel checkout principale. Sono state completate le API e le schermate per spesa, confronto provider e dispensa.

| Fase | Stato del codice | Verifica |
|---|---|---|
| Fondamenta | Implementata | Test D1 + login e onboarding nel browser |
| Menù | Implementato | Provider finti, gruppi allergeni, assenze, preferiti, ricette e fallback |
| Non mi piace | Implementato | Rifiuti, apprendimento, sostituzione e vincoli più forti |
| Spesa | Implementata | Aggregazione, freschi, spunte conservate, congelamento quantità, separazione nuclei |
| Confronto | Implementato | Accesso admin, input uguali, violazioni, nessuna modifica alla settimana |
| Dispensa | Implementata | FIFO, correzioni, acquisti successivi, retry concorrenti idempotenti |

## Correzioni durante il recupero

- Un piatto fissato deve appartenere al nucleo e rispettare allergie e divieti dei presenti prima di avviare la generazione.
- In produzione il login richiede un segreto configurato e un servizio email; il codice OTP nel terminale è limitato a sviluppo/test.
- Le API autenticate rifiutano modifiche con un'origine diversa da quella dell'app.
- Le risposte di caricamenti superati non sovrascrivono la pagina dopo un cambio di percorso.

## Configurazione e verifiche ancora necessarie

- ~~D1 remoto~~ fatto il 15/10: database `app-cibo` (WEUR) sull'account personale, migrazioni 0001–0007 applicate.
- Configurare i secret di produzione: Better Auth, Resend e almeno un provider AI. Per il mittente Resend va usato un dominio verificato. Configurare `ADMIN_EMAIL` e, se serve per Workers AI, Brave Search.
- Eseguire una generazione con i provider reali e verificare recapito email e ricerca delle fonti. La suite automatica usa fixture, non certifica i servizi esterni.
- Rivedere i valori iniziali di nutrizione e conservazione prima dell'uso regolare: il riferimento è modificabile dall'admin.
- Pubblicata il 16/10 su https://app-cibo.lorenzo-dambrosio-2004.workers.dev (secret impostati, mittente `onboarding@resend.dev`: accesso solo per l'admin finché manca un dominio). Collaudo con i servizi reali da fare.
- Installazione PWA su dispositivi reali; Capacitor e pubblicazione iOS restano fuori dall'attuale consegna, come da specifica.

Le credenziali di sviluppo sono in `.dev.vars` (ignorato da Git). I dati di collaudo nel D1 locale sono separati dal database remoto.

## Esito dei controlli

- `npm test`: 66 test superati in 10 file.
- `npm run typecheck`: completato senza errori.
- `npm run build`: frontend e Worker compilati.
- Migrazioni D1 locali: tutte e sei applicate.
- Collaudo browser: OTP locale, onboarding, lista aggregata, spunte, conferma acquisti, trasferimento in dispensa e correzione quantità. Usate fixture soltanto nell'account `collaudo@example.com` sul database locale.
- Accesso Cloudflare già presente per l'account personale; nessuna risorsa remota creata o pubblicata durante questo lavoro.

## Prossimi passi (dopo il collaudo in famiglia)

Idee annotate il 17/10/2026, da fare solo quando la v1 è collaudata. In ordine di priorità:

1. **Stagione** — il menù preferisce frutta e verdura di stagione in Italia. Tabella "mese → prodotti" nel codice, passata al prompt e usata anche per segnalare in lista prodotti fuori stagione. Modifica piccola, solo AI e spesa.
2. **Meteo** — città nelle impostazioni del nucleo, previsioni a 7 giorni da Open-Meteo (gratis, senza chiave). Solo indizio leggero: caldo → piatti freddi, freddo/pioggia → zuppe e forno. Non scavalca mai allergie, gusti e varietà.
3. **Mercato** (inserimento manuale) — giorni del mercato del nucleo (es. martedì e sabato): pesce e verdura fresca nei giorni subito dopo, lista spesa divisa in "al mercato" e "al supermercato".
4. **Supermercato** (inserimento manuale) — catena abituale e lista ordinata per reparto. Niente prezzi/disponibilità automatici: in Italia non ci sono API pubbliche affidabili e leggere i volantini dai siti è fragile.

Restano fuori ambito anche le voci della spec (foto→calorie, Whisper, login Apple, App Store, più nuclei).
