# Gusti al primo accesso

Il login presenta i vantaggi senza prefissi numerici decorativi. Nel primo accesso la scelta della colazione spiega che si può cambiare dal profilo.

Dopo i vincoli alimentari compare una selezione facoltativa di 24 piatti con foto: pasta e riso, carne e pesce, verdure e legumi, piatti unici. Si può saltare senza scegliere niente. Dal profilo si possono modificare o cancellare tutte le selezioni. Per chi ha già un account, il percorso resta disponibile nella sezione «I miei gusti».

Le scelte sono salvate per persona nella tabella `taste_dishes`, con identificativi convalidati contro il catalogo condiviso. Non diventano ingredienti vietati o preferiti obbligatori. I titoli vengono inclusi nei prompt esistenti di generazione e sostituzione dei pasti, per le persone interessate. Il prompt chiarisce che i gusti servono da orientamento e che varietà, tempi, allergie e divieti mantengono la priorità. I controlli alimentari nel codice restano attivi anche quando la ricetta corrisponde a un piatto gradito. I piatti non selezionati non sono trattati come sgraditi.

Il catalogo usa URL fotografici verificati nei metadati delle pagine originali di GialloZafferano il 16 ottobre 2026. Le foto restano remote, conservano le filigrane e ogni scheda mostra un collegamento alla fonte. Il caricamento è differito e senza referrer; se una foto diventa indisponibile, il piatto resta selezionabile con il suo nome. La selezione non invoca servizi AI e al modello non vengono inviate immagini, pagine o URL: solo i titoli selezionati. Aumentano leggermente i token di input delle chiamate già previste; non si aggiunge una chiamata per analizzare i gusti.

Migrazione: `0008_gusti.sql`, applicata e verificata in locale. Prima di pubblicare questa versione, applicarla anche al database remoto. Nessun deploy eseguito per questa modifica.

Verifiche: TypeScript, build, 79 test superati. I nuovi casi coprono persistenza, cancellazione, validazione atomica, separazione tra familiari, filtro dei presenti, assenza di AI al salvataggio e sostituzione di un piatto gradito che viola un divieto. Collaudo browser con account locale dedicato, senza invio email o generazioni AI reali.
