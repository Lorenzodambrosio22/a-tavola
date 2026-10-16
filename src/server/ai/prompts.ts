import type { RecipeRequest, ReplaceRequest, SideRequest, WeekRequest, PersonPrefs } from "./types";
import { QUICK_MAX_MINUTES } from "../../domain/week";

const SLOT_IT = { breakfast: "colazione", lunch: "pranzo", dinner: "cena" } as const;

export const SYSTEM_PLANNER = `Sei un cuoco di casa italiano che pianifica i pasti di una famiglia.
Regole obbligatorie:
- Proponi esattamente un piatto per ogni pasto richiesto, con la stessa data (YYYY-MM-DD) e lo stesso slot.
- "quick" = pronto in al massimo ${QUICK_MAX_MINUTES} minuti in totale; "long" = anche 60 minuti o più.
- Non usare MAI gli ingredienti vietati (allergie o "mai") delle persone presenti a quel pasto, nemmeno come ingrediente secondario o in prodotti che li contengono.
- Evita gli ingredienti "evita"; usa solo in piccola quantità quelli "poco".
- Non proporre piatti delle famiglie bloccate dei presenti.
- I piatti graditi sono soltanto indizi di gusto: ispirati anche a sapori e preparazioni simili, ma proponi anche piatti diversi. Non limitare il menù alle selezioni e non interpretare i piatti non selezionati come sgraditi. Bilancia i gusti di tutti i presenti; allergie, divieti, varietà e tempi hanno sempre priorità.
- Non ripetere titoli o famiglie di piatto delle ultime settimane (i preferiti sono esclusi da questa regola) e varia durante la settimana.
- "servings" = numero di persone presenti al pasto; i grammi degli ingredienti sono per quelle porzioni, crudi e come si comprano.
- Ingredienti con nomi generici italiani al plurale quando si contano (es. "cipolle", "uova", "pomodori"), niente marche, includi olio e sale.
- "dish_family" è la famiglia del piatto in 1-3 parole minuscole (es. "lasagne", "risotto", "pasta al pesto", "frittata", "zuppa di legumi").
- La colazione è semplice e italiana.
- Se usi una ricetta del nucleo, metti il suo id in "recipe_id" e i suoi ingredienti; altrimenti "recipe_id" è null.
Rispondi solo con il JSON richiesto.`;

function peopleBlock(people: PersonPrefs[]): string {
  if (!people.length) return "Nessun vincolo.";
  return people
    .map((p) => {
      const parts = [
        `- ${p.name}:`,
        `  vietati: ${p.forbidden.join(", ") || "nessuno"}`,
        `  evita: ${p.dislike.join(", ") || "nessuno"}`,
        `  poco: ${p.little.join(", ") || "nessuno"}`,
        `  famiglie di piatto bloccate: ${p.blocked_dishes.join(", ") || "nessuna"}`,
        ...(p.liked_dishes.length ? [`  esempi di piatti graditi (indicativi): ${p.liked_dishes.join(", ")}`] : []),
      ];
      return parts.join("\n");
    })
    .join("\n");
}

export function weekPrompt(req: WeekRequest): string {
  const meals = req.meals
    .map((m) => `- ${m.date} ${m.slot} (${SLOT_IT[m.slot]}), ${m.speed}, presenti: ${m.present.join(", ")}`)
    .join("\n");
  const recipes = req.household_recipes.length
    ? req.household_recipes
        .map((r) => `- id=${r.id} | ${r.title} | ${r.minutes} min | ${r.ingredients.join(", ")}`)
        .join("\n") + `\nInseriscine almeno ${Math.min(2, req.household_recipes.length)} nella settimana, dove la velocità lo permette.`
    : "Nessuna.";
  const recent = req.recent.length ? req.recent.map((r) => `- ${r.title} (${r.dish_family})`).join("\n") : "Nessuno.";
  const favs = req.favorites.length
    ? req.favorites.map((f) => `- id=${f.id} | ${f.title}`).join("\n") + "\nPuoi riproporli (usa il loro id come recipe_id)."
    : "";
  const pantry = req.pantry.length
    ? "Ingredienti in dispensa da usare, prima quelli in scadenza:\n" +
      req.pantry.map((p) => `- ${p.ingredient} (scade ${p.expires_at})`).join("\n")
    : "";
  return [
    `Pasti da pianificare:\n${meals}`,
    `Vincoli delle persone (valgono solo ai pasti in cui sono presenti):\n${peopleBlock(req.people)}`,
    `Ricette del nucleo:\n${recipes}`,
    `Piatti delle ultime 2 settimane (non ripetere):\n${recent}`,
    favs && `Preferiti:\n${favs}`,
    pantry,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function replacePrompt(req: ReplaceRequest): string {
  const m = req.meal;
  const recipes = req.household_recipes.length
    ? req.household_recipes.map((r) => `- id=${r.id} | ${r.title} | ${r.minutes} min | ${r.ingredients.join(", ")}`).join("\n")
    : "Nessuna.";
  return [
    `Proponi UN piatto per: ${m.date} ${m.slot} (${SLOT_IT[m.slot]}), ${m.speed}, presenti: ${m.present.join(", ")}.`,
    req.reason ? `Motivo della sostituzione: ${req.reason}` : "",
    `Vincoli dei presenti:\n${peopleBlock(req.people)}`,
    `Non riproporre questi piatti: ${req.avoid_titles.join("; ") || "nessuno"}`,
    req.avoid_dish_families.length ? `Evita queste famiglie di piatto: ${req.avoid_dish_families.join(", ")}` : "",
    req.prefer_ingredients.length ? `Preferisci ingredienti che ci sono già: ${req.prefer_ingredients.join(", ")}` : "",
    `Ricette del nucleo (puoi usarne una):\n${recipes}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const SYSTEM_RECIPE = `Sei un cuoco italiano. Scrivi il procedimento di una ricetta di casa, in italiano, chiaro e numerato (1., 2., ...), con tempi e temperature quando servono. Usa solo gli ingredienti indicati (sale, pepe e acqua sono sempre disponibili). Niente introduzioni né consigli finali. Rispondi solo con il JSON richiesto.`;

export function recipePrompt(req: RecipeRequest): string {
  return `Ricetta: ${req.title}\nPorzioni: ${req.servings}\nIngredienti:\n${req.ingredients.map((i) => `- ${i.name}: ${i.grams} g`).join("\n")}`;
}

export const SYSTEM_SIDE = `Sei un cuoco italiano. Il piatto principale ha già la sua ricetta: scrivi solo come preparare il contorno indicato, in italiano, in 1-4 passaggi numerati (1., 2., ...), brevi e pratici, con tempi quando servono. Usa gli ingredienti indicati (sale, pepe, olio e acqua sono sempre disponibili). Niente introduzioni né consigli finali. Rispondi solo con il JSON richiesto.`;

export function sidePrompt(req: SideRequest): string {
  const list = req.ingredients.length ? req.ingredients.map((i) => `- ${i.name}: ${i.grams} g`).join("\n") : "- (scegli tu, pochi ingredienti semplici)";
  return `Piatto: ${req.dish}\nContorno: ${req.side}\nPorzioni: ${req.servings}\nIngredienti del contorno:\n${list}`;
}

export const SYSTEM_MAP = `Normalizzi nomi di ingredienti italiani. Per ogni input restituisci il nome canonico: se corrisponde a un elemento dell'elenco noto usa esattamente quel nome, altrimenti un nome generico italiano breve, minuscolo, senza quantità, marche o preparazioni (es. "cipolla tritata finemente" → "cipolle"). Rispondi solo con il JSON richiesto.`;

export function mapPrompt(names: string[], known: string[]): string {
  return `Elenco noto:\n${known.join(", ")}\n\nDa normalizzare:\n${names.map((n) => `- ${n}`).join("\n")}`;
}

export const SYSTEM_ESTIMATE = `Sei un cuoco di casa italiano. Data una ricetta per titolo, stima gli ingredienti necessari con i grammi crudi per il numero di porzioni indicato, il tempo totale in minuti e la famiglia del piatto (1-3 parole minuscole). Ingredienti con nomi generici italiani. Rispondi solo con il JSON richiesto.`;

export function estimatePrompt(title: string, servings: number): string {
  return `Ricetta: ${title}\nPorzioni: ${servings}`;
}

/** Domini di siti di ricette italiani affidabili, usati per scegliere tra i risultati di ricerca. */
export const RECIPE_DOMAINS = [
  "giallozafferano.it",
  "cucchiaio.it",
  "misya.info",
  "fattoincasadabenedetta.it",
  "cookist.it",
  "lacucinaitaliana.it",
  "salepepe.it",
  "buonissimo.it",
  "ricette.giallozafferano.it",
  "tavolartegusto.it",
  "ricettedellanonna.net",
  "cucina.corriere.it",
  "agrodolce.it",
  "ilcucchiaioverde.com",
  "primochef.it",
];
