# A Tavola — foto dalle pagine originali

Le immagini mostrate dall'app provengono dal sito della ricetta collegata. Non sono generate e non viene usata un'API fotografica.

1. Il flusso esistente prepara il dettaglio della ricetta e trova il suo link originale.
2. Una normale richiesta HTTP legge quella pagina. Il server cerca prima l'immagine della `Recipe` nei dati JSON-LD, poi `og:image` o `twitter:image`.
3. L'indirizzo trovato viene salvato in D1. La foto viene mostrata nel dettaglio, nelle ricette salvate e nel menù, con un collegamento visibile al sito sorgente.

La lettura dei metadati non esegue chiamate AI. La ricerca del link originale resta quella già prevista dal flusso ricette. La generazione del menù rimane separata: se il dettaglio di un piatto non è ancora stato preparato e il link non è disponibile, la sua scheda può ancora non avere una foto.

Si riutilizza il risultato per sette giorni; dopo un tentativo senza immagine si attende un giorno. In caso di errore, assenza di metadati o immagine bloccata, la ricetta resta utilizzabile senza foto. Le immagini remote sono caricate dal browser dal loro sito, senza copia locale e senza inviare il referrer. Non si eliminano filigrane e non si aggirano blocchi dei siti.

Le pagine lette appartengono ai siti di ricette già supportati (`RECIPE_DOMAINS`), con redirect controllati, timeout di sei secondi e limite di 2 MiB. Non vengono contattati indirizzi locali o host arbitrari indicati da una pagina.

Migrazione richiesta: `0007_foto_ricette.sql`. Applicata al database locale durante il collaudo; per la pubblicazione va applicata anche al database remoto prima di aggiornare il Worker.

Il nuovo nome visibile è **A Tavola**, con un tema chiaro anche sui dispositivi impostati in modalità scura. I nomi tecnici delle risorse Cloudflare restano quelli già configurati.

Verifiche: 75 test superati, controllo TypeScript e build completati. Nel browser sono state recuperate e visualizzate le foto del [risotto alla zucca di GialloZafferano](https://ricette.giallozafferano.it/Risotto-alla-zucca.html) e delle [trofie al pesto di Cucchiaio d'Argento](https://www.cucchiaio.it/ricetta/ricetta-trofie-pesto/), quindi riutilizzate nel menù. Il collaudo locale usa un account dedicato e non richiede generazioni AI.

## Ricette dai siti, AI solo se mancano (16 ottobre)

Per ogni piatto generato il server cerca una ricetta vera, senza AI e senza API a pagamento:

1. **Ricerca diretta** sulla ricerca interna di GialloZafferano, poi di Fatto in casa da Benedetta (due risultati per sito). Cucchiaio d'Argento blocca le richieste automatiche (403); Misya non ha dati strutturati.
2. **Stesso piatto o niente**: la prima parola del risultato deve stare nel titolo, almeno il 75% delle parole del titolo deve comparire, al massimo due parole in più, nessuna delle quali è un ingrediente noto (`ingredients_ref`) o un metodo di cottura diverso. "Penne ai carciofi e pomodoro" non vale per "Penne al pomodoro".
3. **Dalla pagina** (Recipe JSON-LD): foto, procedimento senza i rimandi numerici alle foto, ingredienti e porzioni.
4. **Ingredienti convertiti in grammi** (`src/domain/recipeIngredients.ts`): unità (kg, cucchiai, spicchi, bicchieri…) e pezzi (uova, cipolle…) con pesi medi; le voci "q.b." e l'acqua non vanno nella spesa. Si scalano dalle porzioni del sito a quelle della ricetta del menù; i nomi si riconducono a quelli canonici (alias in cache, Haiku per i nuovi).
5. **Allergie e divieti**: se la ricetta del sito contiene qualcosa di vietato a un membro del nucleo, si scarta e si prova la successiva.
6. Gli ingredienti del menù si sostituiscono solo se nessuna settimana con quel piatto ha già fatto la spesa; la lista della spesa in bozza si ricalcola da sola.

Se nessun sito ha il piatto, il procedimento lo scrive l'AI (Sonnet) e il piatto resta senza foto. Non si usa più la ricerca web a pagamento di Claude. I compiti semplici (sostituzioni, nomi degli ingredienti, stime) usano Haiku.

- Dopo la generazione e a ogni apertura della settimana, i piatti si preparano in background (`waitUntil`). Se un sito non risponde, il background non paga l'AI e riprova dopo un giorno; all'apertura del piatto si ripiega subito sull'AI. Il menù si aggiorna da solo due volte per mostrare le foto.
- Prova sui siti reali con i 14 piatti del menù di prova: 6 trovati (risotto alla zucca, minestrone, spaghetti aglio olio e peperoncino, frittata di zucchine, insalata di ceci e tonno, vellutata di carote), gli altri all'AI.

## Piatti con contorno e disegno di riserva (16 ottobre)

- Se il titolo intero non trova la ricetta e ha la forma "X con Y", si cerca solo "X" (serve un piatto di almeno due parole: "Piadina con prosciutto" o "Pasta con le sarde" restano interi). Prova sui siti veri: Saltimbocca alla romana, Brasato di manzo, Petto di pollo al limone, Merluzzo in padella, Arrosto di maiale, Salmone al forno e Cotoletta alla milanese ora trovano la ricetta.
- Procedimento: quello del sito, seguito da "Contorno: Y" con 1-4 passaggi scritti da Haiku (compito `side`, frazioni di centesimo). Senza AI, una riga semplice con gli ingredienti del contorno.
- Spesa: ingredienti del sito scalati sulle porzioni, più gli ingredienti del menù che la ricetta del sito non usa (il contorno).
- Nelle schede (menù, ricette) i piatti senza foto mostrano un disegno di riserva: un'icona del tipo di piatto ricavata dal titolo. La pagina della ricetta resta senza immagine.
