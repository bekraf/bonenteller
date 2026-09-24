"use strict";

/* ===========================================================================
   Publieke weergave (GitHub Pages): alleen het dashboard, alleen lezen
   ---------------------------------------------------------------------------
   De publieke site draait dezelfde app.js als thuis, maar zonder server.
   Wat publiek is, beslist bouw_publiek.py: die zet alleen het dashboard in
   de pagina en alleen de data die het dashboard toont in data/. Wat daar
   niet staat, bestaat online niet — ook niet voor wie de URL's zelf typt of
   in de console aan de slag gaat.

   Dit bestand wordt vóór app.js geladen en doet twee dingen:
     1. fetch() vervangen: de aanvragen die het dashboard doet (ROUTES)
        worden bediend uit data/; elke andere aanvraag en elke schrijfactie
        krijgt een 403. Opslaan kan online sowieso nergens: GitHub Pages
        serveert alleen bestanden en weigert zelf elke POST/PUT/DELETE.
     2. de URL-hash leeg houden: app.js opent thuis een tabblad op basis van
        de hash (#dagboek, …), en een klik op een kcal-staaf zet er één. Hier
        bestaat alleen het dashboard.

   app.js zelf blijft ongewijzigd: hij heeft maar één fetch(), in api().
   =========================================================================== */

// Alles wordt relatief aan de pagina opgehaald, zodat de site ook onder een
// submap werkt (GitHub Pages serveert op /<repo>/).
const BASIS = new URL(".", location.href);
const echteFetch = window.fetch.bind(window);

const GEWEIGERD = "Niet beschikbaar in de publieke weergave.";

function antwoord(data, status = 200) {
  return new Response(JSON.stringify(data),
    { status, headers: { "Content-Type": "application/json" } });
}

// GitHub Pages laat browsers elk bestand 10 minuten bewaren (max-age=600).
// Voor de data is dat te lang: net na een publicatie zou je nog de vorige
// stand zien. 'no-cache' laat de browser telkens even navragen of het
// bestand veranderd is — ongewijzigd kost dat een leeg 304-antwoord.
async function json(bestand) {
  const r = await echteFetch(new URL("data/" + bestand, BASIS), { cache: "no-cache" });
  if (!r.ok) throw new Error(`data/${bestand} ontbreekt in deze weergave`);
  return r.json();
}

// Vandaag als ISO-datum, in lokale tijd (net als app.js).
function vandaagIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    + `-${String(d.getDate()).padStart(2, "0")}`;
}

// De server filtert ?van=&tot= in SQL; hier snijden we dezelfde periode uit
// het volledige bestand. Werkt voor een lijst met datum-veld (dagen) en voor
// een {datum: waarde}-object (notities).
function snijPeriode(data, query) {
  const van = query.get("van") || "0001-01-01";
  const tot = query.get("tot") || "9999-12-31";
  if (Array.isArray(data)) return data.filter((r) => r.datum >= van && r.datum <= tot);
  return Object.fromEntries(
    Object.entries(data).filter(([datum]) => datum >= van && datum <= tot));
}

/* --- 1. de enige GET-aanvragen die beantwoord worden -------------------
   Precies wat het dashboard en het opstarten van app.js opvragen; zie
   laadDashboard() en start() in app.js. Al de rest krijgt een 403. */
const ROUTES = {
  "/api/instellingen": () => json("instellingen.json"),
  "/api/gewicht": async () => {
    // bouw_publiek.py zet de wekelijkse weging klaar, en apart de meting van
    // de bouwdag. Die laatste hoort er alleen bij zolang het vandaag is: tot
    // de nachtelijke herbouw kan het bestand nog die van gisteren bevatten.
    const { weegdagen, vandaag } = await json("gewicht.json");
    const reeks = vandaag && vandaag.datum === vandaagIso() ? [...weegdagen, vandaag] : weegdagen;
    return reeks.sort((a, b) => a.datum.localeCompare(b.datum));
  },
  "/api/dagen": async (q) => snijPeriode(await json("dagen.json"), q),
  "/api/notities": async (q) => snijPeriode(await json("notities.json"), q),
  // Weegschaalfoto's en de voedingscatalogus gaan niet online. app.js vraagt
  // beide wel op (de catalogus bij het opstarten), dus: een leeg antwoord.
  "/api/afbeeldingen": () => ({}),
  "/api/voedingsmiddelen": () => [],
};

window.fetch = async function (bron, opties = {}) {
  const url = typeof bron === "string" ? bron : bron.url;
  if (typeof url === "string" && url.startsWith("/api/")) {
    const [pad, query = ""] = url.split("?");
    const route = Object.hasOwn(ROUTES, pad) ? ROUTES[pad] : null;
    if (!route || (opties.method || "GET").toUpperCase() !== "GET") {
      return antwoord({ fout: GEWEIGERD }, 403);
    }
    try {
      return antwoord(await route(new URLSearchParams(query)));
    } catch (fout) {
      return antwoord({ fout: fout.message }, 404);
    }
  }
  // Andere absolute paden ook relatief aan de pagina maken.
  if (typeof url === "string" && url.startsWith("/"))
    return echteFetch(new URL(url.slice(1), BASIS), opties);
  return echteFetch(bron, opties);
};

/* --- 2. de hash leeg houden --------------------------------------------
   Moet top-level blijven: app.js leest location.hash zodra hij geladen is
   en opent dan dat tabblad — hier zou dat een leeg scherm geven, want de
   andere tabbladen bestaan niet. Een klik op een kcal-staaf zet thuis
   #dagboek/<datum>; hier doet die klik niets en wissen we de hash meteen. */
function wisHash() {
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}
wisHash();
window.addEventListener("hashchange", wisHash);
