"use strict";

/* ===========================================================================
   Alleen-lezen laag voor de publieke website (GitHub Pages)
   ---------------------------------------------------------------------------
   De publieke site draait dezelfde app.js als thuis, maar zonder server. Dit
   bestand wordt vóór app.js geladen en doet twee dingen:

     1. fetch() vervangen: elke GET /api/... wordt bediend uit de JSON die
        bouw_publiek.py in data/ heeft gezet. Schrijfacties (POST/PUT/DELETE)
        krijgen een nette 403 met een Nederlandstalige melding — api() in
        app.js toont die vanzelf in het meldingsvak van het scherm.
     2. de klasse 'leesmodus' op <body> zetten; leesmodus.css verbergt
        daarmee alle invoer (formulieren, ×-knoppen, het tabblad
        Instellingen). De pagina ziet er verder uit als thuis: geen banner,
        geen melding — er is alleen niets te bewerken.

   app.js zelf blijft dus ongewijzigd: hij heeft maar één fetch(), in api().
   =========================================================================== */

// Alles wordt relatief aan de pagina opgehaald, zodat de site ook onder een
// submap werkt (GitHub Pages serveert op /<repo>/).
const BASIS = new URL(".", location.href);
const echteFetch = window.fetch.bind(window);

function antwoord(data, status = 200) {
  return new Response(JSON.stringify(data),
    { status, headers: { "Content-Type": "application/json" } });
}

async function json(bestand) {
  const r = await echteFetch(new URL("data/" + bestand, BASIS));
  if (!r.ok) throw new Error(`data/${bestand} ontbreekt in deze weergave`);
  return r.json();
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

// Eén GET-pad omzetten naar het bijbehorende gebakken bestand.
async function bedien(pad, query) {
  const q = new URLSearchParams(query);
  let m;

  if (pad === "/api/instellingen") return antwoord(await json("instellingen.json"));
  if (pad === "/api/gewicht") return antwoord(await json("gewicht.json"));
  if (pad === "/api/sport") return antwoord(await json("sport.json"));
  if (pad === "/api/afbeeldingen") return antwoord(await json("afbeeldingen.json"));
  if (pad === "/api/voedingsmiddelen") return antwoord(await json("voedingsmiddelen.json"));
  if (pad === "/api/dagen") return antwoord(snijPeriode(await json("dagen.json"), q));
  if (pad === "/api/notities") return antwoord(snijPeriode(await json("notities.json"), q));

  if ((m = pad.match(/^\/api\/dag\/(\d{4}-\d{2}-\d{2})$/))) {
    try {
      return antwoord(await json(`dag/${m[1]}.json`));
    } catch {
      // Een dag zonder data heeft geen bestand; de server geeft dan een lege
      // dag terug, dus dat doen we hier ook (zelfde vorm als api_dag).
      return antwoord({
        datum: m[1], regels: [], sport: [], notitie: "",
        totaal: { kcal: 0, vet: 0, koolhydraten: 0, eiwit: 0, zout: 0, vezels: 0 },
      });
    }
  }
  if ((m = pad.match(/^\/api\/voedingsmiddelen\/(\d+)\/historiek$/)))
    return antwoord(await json(`historiek/${m[1]}.json`));

  return antwoord({ fout: `Onbekend pad ${pad} in de alleen-lezen weergave.` }, 404);
}

window.fetch = function (bron, opties = {}) {
  const url = typeof bron === "string" ? bron : bron.url;
  if (typeof url === "string" && url.startsWith("/api/")) {
    if ((opties.method || "GET").toUpperCase() !== "GET") {
      return Promise.resolve(antwoord(
        { fout: "Dit is een alleen-lezen weergave — aanpassen kan alleen in de app thuis." },
        403));
    }
    const [pad, query = ""] = url.split("?");
    return bedien(pad, query);
  }
  // Andere absolute paden (bv. /afbeeldingen/…) ook relatief maken.
  if (typeof url === "string" && url.startsWith("/"))
    return echteFetch(new URL(url.slice(1), BASIS), opties);
  return echteFetch(bron, opties);
};

document.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("leesmodus");
  // De dagnotitie mag gelezen worden, niet getypt.
  document.getElementById("dag-notitie").readOnly = true;
});
