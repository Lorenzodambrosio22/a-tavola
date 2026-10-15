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
