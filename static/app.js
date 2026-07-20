"use strict";

/* ===========================================================================
   Gezondheidsdashboard — frontend
   ---------------------------------------------------------------------------
   Eén pagina met zes tabbladen (Dashboard, Dagboek, Weekoverzicht,
   Voedingsmiddelen, Gegevens, Instellingen). Geen frameworks: alles is
   gewone DOM-manipulatie en handgetekende SVG-grafieken.

   Opbouw van dit bestand:
     1. hulpfuncties (DOM bouwen, API praten, datums, notatie)
     2. tabbladen
     3. grafiek-bouwstenen (lijngrafiek, staafgrafiek, zweefinfo)
     4. Dashboard
     5. Dagboek
     6. Weekoverzicht
     7. Voedingsmiddelen (catalogus)
     8. Gegevens (gewicht en sport rechtstreeks bewerken)
     9. Instellingen
    10. opstarten

   Belangrijk principe: tekst uit de database gaat ALTIJD via textContent in
   de pagina (nooit innerHTML), zodat een rare naam nooit als HTML kan worden
   uitgevoerd.
   =========================================================================== */

/* ================= 1. Hulpjes ================= */

// De zes voedingswaarden, altijd in deze vaste volgorde (zelfde volgorde als
// in de database en zoals je die gewend bent uit het rekenblad).
const NUTRIENTEN = ["kcal", "vet", "koolhydraten", "eiwit", "zout", "vezels"];
const NUTRIENT_LABELS = ["kcal", "Vet", "Koolhydraten", "Eiwit", "Zout", "Vezels"];
const DAG_MS = 24 * 3600 * 1000; // één dag in milliseconden

// Belgische getalnotatie (komma als decimaalteken, punt als duizendtal).
const fmt = new Intl.NumberFormat("nl-BE", { maximumFractionDigits: 1 });
const fmt0 = new Intl.NumberFormat("nl-BE", { maximumFractionDigits: 0 });

// el("td", {class: "getal"}, "12") — kort hulpje om HTML-elementen te bouwen.
// Kinderen die geen DOM-knoop zijn worden tekstknopen (veilig voor rare tekens).
function el(tag, attrs = {}, ...kinderen) {
  const knoop = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") knoop.className = v;
    else if (k.startsWith("on")) knoop.addEventListener(k.slice(2), v); // bv. onclick
    else knoop.setAttribute(k, v);
  }
  for (const kind of kinderen) {
    knoop.append(kind instanceof Node ? kind : document.createTextNode(kind));
  }
  return knoop;
}

// Zelfde idee, maar voor SVG-elementen (die hebben een eigen namespace nodig).
function svgEl(tag, attrs = {}, tekst) {
  const knoop = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) knoop.setAttribute(k, v);
  if (tekst !== undefined) knoop.textContent = tekst;
  return knoop;
}

// Praat met de server. Bij een fout gooit dit een Error met de
// Nederlandstalige melding uit het "fout"-veld van de API.
async function api(pad, opties = {}) {
  const antwoord = await fetch(pad, opties);
  const gegevens = await antwoord.json();
  if (!antwoord.ok) throw new Error(gegevens.fout || antwoord.statusText);
  return gegevens;
}

// Korte hulpjes voor POST en PUT met JSON-body.
function post(pad, gegevens) {
  return api(pad, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(gegevens),
  });
}

function put(pad, gegevens) {
  return api(pad, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(gegevens),
  });
}

/* --- datums -----------------------------------------------------------
   Datums zijn overal tekst in ISO-vorm ("2026-07-03"): dat sorteert goed en
   is precies wat de API verwacht. De functies hieronder rekenen bewust in
   lokale tijd (geen UTC), zodat "vandaag" altijd jouw kalenderdag is. */

function isoDatum(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function naarDatum(iso) {
  const [j, m, d] = iso.split("-").map(Number);
  return new Date(j, m - 1, d);
}

function plusDagen(iso, n) {
  const d = naarDatum(iso);
  d.setDate(d.getDate() + n);
  return isoDatum(d);
}

// Datums overal in ISO-notatie (yyyy-mm-dd), ook in labels en zweefvensters.
function datumKort(iso) {   // "2026-07-03"
  return iso;
}

function datumLang(iso) {   // "vrijdag 2026-07-03"
  const weekdag = naarDatum(iso).toLocaleDateString("nl-BE", { weekday: "long" });
  return `${weekdag} ${iso}`;
}

function vandaag() { return isoDatum(new Date()); }

/* Datumvelden: een native <input type="date"> toont zijn waarde in het
   formaat van de browserlocale (bv. 12/07/2026) en dat valt niet om te
   zetten naar yyyy-mm-dd. Elk vast datumveld wordt daarom bij het opstarten
   omgebouwd tot een tekstveld met de ISO-notatie, plus een kalenderknopje
   dat de native kiezer van een verborgen date-veld opent. Het tekstveld
   behoudt zijn id, dus code die .value leest/zet of op 'change' luistert
   blijft gewoon werken. */
function isoDatumveld(veld) {
  veld.type = "text";
  veld.placeholder = "yyyy-mm-dd";
  veld.pattern = "\\d{4}-\\d{2}-\\d{2}";
  veld.autocomplete = "off";
  veld.classList.add("datumtekst");

  // Ongeldige invoer terugdraaien naar de waarde die het veld had toen het
  // focus kreeg. Deze listener is vóór alle andere geregistreerd, dus de
  // rest van de code ziet altijd een geldige (genormaliseerde) datum.
  let terugval = veld.value;
  veld.addEventListener("focus", () => { terugval = veld.value; });
  veld.addEventListener("change", () => {
    veld.value = /^\d{4}-\d{2}-\d{2}$/.test(veld.value)
      ? isoDatum(naarDatum(veld.value))   // normaliseert bv. 2026-02-31
      : terugval;
  });

  // Het knopje opent de kalender van een onzichtbaar date-veld dat erover
  // ligt (zo verschijnt de kalender op die plek); een keuze daarin stroomt
  // als 'change' terug het tekstveld in.
  const kiezer = el("input", { type: "date", class: "kalenderkiezer", tabindex: "-1", "aria-hidden": "true" });
  const knop = el("button", { type: "button", class: "kalenderknop", title: "Kies een datum in de kalender" }, "📅");
  knop.addEventListener("click", () => {
    kiezer.value = /^\d{4}-\d{2}-\d{2}$/.test(veld.value) ? veld.value : vandaag();
    try { kiezer.showPicker(); } catch { kiezer.focus(); }
  });
  kiezer.addEventListener("change", () => {
    if (!kiezer.value) return;
    veld.value = kiezer.value;
    veld.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const groep = el("span", { class: "datumgroep" });
  veld.replaceWith(groep);
  groep.append(veld, el("span", { class: "kalenderwrap" }, knop, kiezer));
}
document.querySelectorAll('input[type="date"]').forEach(isoDatumveld);

// Toon een melding onder een formulier; verdwijnt vanzelf na 4 seconden.
function toonMelding(id, tekst, ok = false) {
  const knoop = document.getElementById(id);
  knoop.textContent = tekst;
  knoop.classList.toggle("ok", ok);
  if (tekst) setTimeout(() => { knoop.textContent = ""; }, 4000);
}

/* --- 'Ongedaan maken' na verwijderen ------------------------------------
   Verwijderen toont onderaan kort een melding met een herstelknop. Het
   DELETE-antwoord van de server bevat de verwijderde rij; de knop zet die
   terug via POST /api/herstel/<soort> (met een nieuw id). */
const ongedaanBalk = el("div", { class: "ongedaan" });
document.body.append(ongedaanBalk);
let ongedaanTimer = null;

function verbergOngedaan() {
  clearTimeout(ongedaanTimer);
  ongedaanBalk.classList.remove("zichtbaar");
}

function toonOngedaanBalk(inhoud, ms) {
  ongedaanBalk.replaceChildren(...inhoud);
  ongedaanBalk.classList.add("zichtbaar");
  clearTimeout(ongedaanTimer);
  ongedaanTimer = setTimeout(verbergOngedaan, ms);
}

// Verwijder een rij en bied 'ongedaan maken' aan. De aanroeper herlaadt
// zelf na het verwijderen; 'herlaad' wordt gebruikt na een herstel.
async function verwijderMetUndo(soort, id, tekst, herlaad) {
  const antwoord = await api(`/api/${soort}/${id}`, { method: "DELETE" });
  const knop = el("button", {}, "Ongedaan maken");
  knop.addEventListener("click", async () => {
    verbergOngedaan();
    try {
      await post(`/api/herstel/${soort}`, antwoord.rij);
      herlaad();
    } catch (fout) {
      toonOngedaanBalk([el("span", {}, `Herstellen mislukt: ${fout.message}`)], 4000);
    }
  });
  toonOngedaanBalk([el("span", {}, tekst), knop], 6000);
}

// "52 min hardlopen 11,6 km/u" — leesbare samenvatting van een activiteit.
function sportTekst(s) {
  let t = `${fmt0.format(s.duur_minuten)} min ${s.type}`;
  if (s.snelheid_kmh) t += ` ${fmt.format(s.snelheid_kmh)} km/u`;
  return t;
}

// Tabelcel voor een voedingswaarde, getoetst aan de richtlijnen uit de
// instellingen: boven het maximum = rood, onder het minimum = amber, netjes
// binnen het bereik = groen. In het dagboek komt er een pijltje (↑/↓) bij
// zodat het verschil ook zonder kleur leesbaar is; het weekoverzicht toont
// alleen de kleur (pijl = false).
function nutrientCel(k, waarde, notatie = fmt, pijl = true) {
  const min = instellingen[k + "_min"], max = instellingen[k + "_max"];
  if (max != null && waarde > max) return el("td", { class: "getal boven" }, notatie.format(waarde) + (pijl ? " ↑" : ""));
  if (min != null && waarde < min) return el("td", { class: "getal onder" }, notatie.format(waarde) + (pijl ? " ↓" : ""));
  if (min == null && max == null) return el("td", { class: "getal" }, notatie.format(waarde));
  return el("td", { class: "getal binnen" }, notatie.format(waarde));
}

// Onderrapportage: je logt onbewust een paar procent kcal te weinig. Deze
// factor rekent gelogde kcal om naar de geschatte echte inname. Bewust alleen
// toegepast op de kcal-grafiek van het dashboard en het weekgemiddelde;
// het dagboek en alle andere getallen tonen de ruwe logwaarden.
function metOnderrapportage(kcal) {
  return kcal * (1 + (instellingen.onderrapportage_pct || 0) / 100);
}

// Getalvelden: zodra een veld focus heeft kun je er ook met het muiswiel
// over scrollen om de waarde te verhogen/verlagen — typen blijft gewoon
// werken. De stap volgt het step-attribuut ("any" of leeg telt als 1);
// min en max worden gerespecteerd.
document.addEventListener("wheel", (e) => {
  const veld = e.target;
  if (!(veld instanceof HTMLInputElement) || veld.type !== "number") return;
  if (document.activeElement !== veld) return;   // alleen het actieve veld
  e.preventDefault();                            // niet ook de pagina scrollen
  const stap = Number(veld.step) > 0 ? Number(veld.step) : 1;
  let w = (Number(veld.value) || 0) + (e.deltaY < 0 ? stap : -stap);
  if (veld.min !== "" && w < Number(veld.min)) w = Number(veld.min);
  if (veld.max !== "" && w > Number(veld.max)) w = Number(veld.max);
  veld.value = Math.round(w * 1000) / 1000;      // geen zwevendekommarestjes
  veld.dispatchEvent(new Event("input", { bubbles: true }));
}, { passive: false });

/* Tabelrij met bewerkbare cellen (zelfde gedrag als de voedingstabel in het
   dagboek): klik op een bewerkbare waarde en de rij gaat in bewerkmodus —
   alle bewerkbare cellen worden invoervelden en de ×-knop (verwijderen)
   wordt een ✓ (opslaan). Enter slaat ook op, Esc annuleert door te herladen.
     cellen   — één beschrijving per cel, in tabelvolgorde. {tekst, klasse?}
                is een vaste cel; met 'naam' en 'maak' (functie die het
                invoerveld maakt) erbij is de cel klik-bewerkbaar, en zet
                'nadien' een tekstje achter het invoerveld (bv. " min")
     opslaan  — async (invoer) => ...; 'invoer' heeft per 'naam' het
                invoerveld; daarna wordt herladen
     verwijder — async () => ...; daarna wordt herladen
     herlaad  — laadt de tabel opnieuw (ook gebruikt voor Esc)
     melding  — id van het meldingsvak voor foutteksten */
function bewerkbareRij({ cellen, opslaan, verwijder, herlaad, melding }) {
  const knop = el("button", { class: "klein", title: "Verwijder" }, "×");
  let invoer = null;   // {naam: invoerveld} zodra de rij bewerkt wordt

  async function bewaar() {
    try {
      await opslaan(invoer);
      herlaad();
    } catch (fout) { toonMelding(melding, fout.message); }
  }

  function startBewerken(focusNaam) {
    if (!invoer) {
      invoer = {};
      for (const c of cellen) {
        if (!c.maak) continue;
        const veld = c.maak();
        veld.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); bewaar(); }
          if (e.key === "Escape") herlaad();   // annuleren = vers herladen
        });
        invoer[c.naam] = veld;
        tds.get(c).replaceChildren(veld, c.nadien || "");
      }
      knop.textContent = "✓";
      knop.title = "Opslaan";
    }
    invoer[focusNaam].focus();
  }

  // Per celbeschrijving de bijhorende td, zodat startBewerken de juiste
  // cellen kan vervangen door invoervelden.
  const tds = new Map(cellen.map((c) => [c, c.maak
    ? el("td", { class: `${c.klasse || ""} klik-bewerk`, title: "Klik om te bewerken",
                 onclick: () => startBewerken(c.naam) }, c.tekst)
    : el("td", { class: c.klasse || "" }, c.tekst)]));

  knop.addEventListener("click", async () => {
    if (invoer) { bewaar(); return; }
    try {
      await verwijder();
      herlaad();
    } catch (fout) { toonMelding(melding, fout.message); }
  });

  return el("tr", {}, ...tds.values(), el("td", { class: "acties" }, knop));
}

/* ================= 2. Tabbladen ================= */

// Wissel naar een tabblad en laad meteen de data ervan. De keuze komt ook in
// de URL-hash (#dagboek, #week, ...) zodat je een tabblad kunt bookmarken.
function activeerTab(naam) {
  const knop = document.querySelector(`#tabs button[data-paneel="${naam}"]`);
  if (!knop) return;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("actief", b === knop));
  document.querySelectorAll(".paneel").forEach((p) =>
    p.classList.toggle("actief", p.id === "paneel-" + naam));
  location.hash = naam === "dashboard" ? "" : naam;
  if (naam === "dashboard") laadDashboard();
  if (naam === "dagboek") laadDag();
  if (naam === "week") laadWeek();
  if (naam === "voedingsmiddelen") laadCatalogus();
  if (naam === "gegevens") laadGegevens();
  if (naam === "instellingen") laadInstellingen();
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const knop = e.target.closest("button");
  if (knop) activeerTab(knop.dataset.paneel);
});

/* ================= 3. Grafiek-bouwstenen =================
   Beide grafieken zijn met de hand getekende SVG. Vormgeving volgt een vaste
   set regels: dunne lijnen (2px), staven met afgeronde top, haarlijn-grid,
   gedempte astekst, en een zweefvenster (tooltip) dat de waarde toont. */

// Eén gedeeld zweefvenster voor alle grafieken (absoluut gepositioneerde div).
const zweefinfo = document.getElementById("zweefinfo");

// Toon het zweefvenster naast de muis. 'regels' is een lijst
// [tekst, css-klasse]; de waarde staat bovenaan (vet), het label eronder.
function toonZweefinfo(x, y, regels) {
  zweefinfo.replaceChildren(
    ...regels.map(([tekst, klasse]) => el("div", { class: klasse }, tekst)));
  zweefinfo.style.display = "block";
  const b = zweefinfo.getBoundingClientRect();
  // Niet buiten het venster laten vallen.
  const links = Math.min(x + 14, window.innerWidth - b.width - 8);
  zweefinfo.style.left = `${links + window.scrollX}px`;
  zweefinfo.style.top = `${y - b.height - 10 + window.scrollY}px`;
}

// Vastgeklikt punt (voor aanraakschermen, waar hover onhandig is): de
// gewichtsgrafiek kan het zweefvenster op een aangeklikt meetpunt vastzetten.
// verbergZweefinfo valt dan terug op dat punt in plaats van te sluiten, zodat
// het venster blijft staan tot een ander punt wordt aangeklikt of gehoverd —
// ook als tussendoor een andere grafiek het zweefvenster even overnam.
let zweefVast = null;   // { houder, toon(), laatLos() } of null

function verbergZweefinfo() {
  if (zweefVast) { zweefVast.toon(); return; }
  zweefinfo.style.display = "none";
}

// Kies een "nette" stapgrootte voor de y-as (1, 2, 2.5, 5, 10, 20, 500, ...)
// zodat de aslabels ronde getallen zijn.
function nietteStappen(maxW, aantal = 5) {
  const ruw = maxW / aantal;
  const macht = 10 ** Math.floor(Math.log10(ruw || 1));
  for (const f of [1, 2, 2.5, 5, 10]) {
    if (macht * f >= ruw) return macht * f;
  }
  return macht * 10;
}

/* Lijngrafiek (voor het gewicht).
   punten = [{datum, waarde}], opties:
     doel       — tekent een horizontale stippellijn (doelgewicht)
     doelLabel  — tekstje rechts naast die lijn
     eenheid    — bv. "kg", voor in het zweefvenster
     minNul     — as vanaf 0 laten beginnen (voor gewicht niet gewenst)
     zones      — [{van, tot, kleur, opaciteit}] achtergrondbanden in dezelfde
                  eenheid als de waarden (hier: de BMI-zones omgerekend naar kg)
     lengte     — lichaamslengte in m; toont de BMI van elk punt in het
                  zweefvenster
     fotos      — {datum: [bestandsnaam, ...]}: weegschaalfoto's per datum;
                  bij hover verschijnt de foto van die dag in het zweefvenster
     sindsWeging — {kcalPerDag: {datum: kcal}, sportPerDag: {datum: minuten},
                  vanaf, kcalMin, kcalMax}: toont in het zweefvenster de
                  gemiddelde kcal en sportminuten per dag sinds de vorige
                  weging; 'vanaf' is de eerste datum waarvoor de maps compleet
                  zijn (eerder = niet tonen). Met kcalMin/kcalMax kleurt het
                  kcal-gemiddelde t.o.v. de richtlijn, net als de kcal-grafiek
     vastBereik — {min, max}: dwing het y-bereik (voor de 'Alles'-weergave,
                  zodat de BMI-grenzen altijd in beeld zijn)
     grenzen    — [{waarde, label}] rode grenslijnen met tekst (onder-/overgewicht)
     bereik     — {van, tot}: het datumbereik van de x-as; zonder bereik loopt
                  de as van het eerste tot het laatste punt
     vorige     — {datum, waarde}: laatste meting vóór 'bereik'; de lijn wordt
                  vanaf de y-as doorgetrokken richting die (buiten beeld
                  liggende) meting, zodat ze niet pas bij de eerste meting
                  binnen beeld begint */
function lijnGrafiek(houder, punten, opties = {}) {
  houder.replaceChildren();
  // Een vastgeklikt punt uit de vorige tekening van deze grafiek hoort bij de
  // net vervangen SVG: loslaten, anders blijft het venster op een spookpunt staan.
  if (zweefVast && zweefVast.houder === houder) {
    zweefVast = null;
    verbergZweefinfo();
  }
  if (!punten.length) {
    houder.append(el("p", { class: "subtitel" }, "Geen gegevens in deze periode."));
    return;
  }

  // Afmetingen: volle breedte van de kaart, vaste hoogte, marges voor de
  // assen. De marges zijn in alle drie de grafieken gelijk, zodat de x-assen
  // onder elkaar uitlijnen.
  const B = Math.max(houder.clientWidth, 320), H = 260;
  const m = { l: 64, r: 56, t: 12, b: 28 };
  const bw = B - m.l - m.r, bh = H - m.t - m.b;

  // Datumbereik van de x-as (al hier nodig: het instappunt op de y-as moet
  // meetellen in het y-bereik).
  const bereik = opties.bereik || { van: punten[0].datum, tot: punten[punten.length - 1].datum };
  const t0 = naarDatum(bereik.van).getTime();

  // Meting net vóór het bereik ('vorige'): bereken waar de lijn van die
  // meting naar het eerste zichtbare punt de y-as snijdt. x = 0 komt overeen
  // met een halve dag vóór het begin van het bereik (elk punt staat immers
  // in het midden van zijn dagband).
  let voorpunt = null;   // {waarde}: instapwaarde van de lijn op de y-as
  if (opties.vorige) {
    const tAs = t0 - 0.5 * DAG_MS;
    const tV = naarDatum(opties.vorige.datum).getTime();
    const tE = naarDatum(punten[0].datum).getTime();
    if (tV < tAs && tAs < tE) {
      const frac = (tAs - tV) / (tE - tV);
      voorpunt = { waarde: opties.vorige.waarde + frac * (punten[0].waarde - opties.vorige.waarde) };
    }
  }

  // y-bereik: van net onder het minimum tot net boven het maximum, afgerond
  // op nette stappen. De doellijn telt mee zodat die altijd zichtbaar is.
  // Met 'vastBereik' (de 'Alles'-weergave) staat het bereik vast, zodat de
  // BMI-grenzen in beeld blijven ook al ligt het gewicht daar ver vandaan.
  const waarden = punten.map((p) => p.waarde);
  if (voorpunt) waarden.push(voorpunt.waarde);
  const extra = opties.doel != null ? [opties.doel] : [];
  if (opties.vastBereik) {
    extra.push(opties.vastBereik.min, opties.vastBereik.max);
  }
  let yMin = Math.min(...waarden, ...extra), yMax = Math.max(...waarden, ...extra);
  if (opties.minNul) yMin = 0;
  const stap = nietteStappen(yMax - yMin || 1, 5);
  yMin = Math.floor(yMin / stap) * stap;
  yMax = Math.ceil(yMax / stap) * stap;
  if (yMin === yMax) yMax += stap;

  // Schalen: datum -> x-pixel, waarde -> y-pixel. De x-as werkt met één band
  // per kalenderdag (net als de staafgrafieken) en elk punt staat in het
  // midden van zijn dagband — zo staat een meting recht boven de staven van
  // dezelfde dag in de andere grafieken.
  const nDagen = Math.round((naarDatum(bereik.tot).getTime() - t0) / DAG_MS) + 1;
  const band = bw / nDagen;
  const xVan = (iso) => ((naarDatum(iso).getTime() - t0) / DAG_MS + 0.5) * band;
  const yVan = (w) => bh - ((w - yMin) / (yMax - yMin)) * bh;

  const svg = svgEl("svg", { viewBox: `0 0 ${B} ${H}`, width: B, height: H });
  const g = svgEl("g", { transform: `translate(${m.l},${m.t})` });
  svg.append(g);

  // Achtergrondzones (de BMI-banden): zachte kleurvlakken achter alles,
  // afgeknipt op het zichtbare bereik van de grafiek. De zones buiten het
  // gezonde BMI-bereik krijgen een hogere dekking (donkerrood).
  for (const zone of opties.zones || []) {
    const van = Math.max(zone.van, yMin), tot = Math.min(zone.tot, yMax);
    if (tot <= van) continue;   // zone valt buiten het zichtbare bereik
    g.append(svgEl("rect", {
      x: 0, y: yVan(tot), width: bw, height: yVan(van) - yVan(tot),
      fill: zone.kleur, opacity: zone.opaciteit ?? 0.13,
    }));
  }

  // Harde grenslijnen (overgang naar onder-/overgewicht) met beschrijving.
  for (const grens of opties.grenzen || []) {
    if (grens.waarde < yMin || grens.waarde > yMax) continue;
    const y = yVan(grens.waarde);
    g.append(svgEl("line", { x1: 0, x2: bw, y1: y, y2: y, class: "grenslijn" }));
    // Label net boven de lijn bij overgewicht, net eronder bij ondergewicht.
    const boven = grens.waarde > (yMin + yMax) / 2;
    g.append(svgEl("text", {
      x: 6, y: boven ? y - 5 : y + 13, class: "grenstekst",
    }, grens.label));
  }

  // Horizontale gridlijnen + y-aslabels.
  for (let w = yMin; w <= yMax + 1e-9; w += stap) {
    const y = yVan(w);
    g.append(svgEl("line", { x1: 0, x2: bw, y1: y, y2: y, class: "gridlijn" }));
    g.append(svgEl("text", { x: -8, y: y + 4, "text-anchor": "end", class: "astekst" }, fmt.format(w)));
  }
  g.append(svgEl("line", { x1: 0, x2: bw, y1: bh, y2: bh, class: "aslijn" }));

  // Maximaal 6 datumlabels op de x-as, gelijkmatig over het bereik verdeeld —
  // dezelfde formule als in de staafgrafieken, zodat de labels uitlijnen.
  // Op smalle schermen (telefoon) passen er minder ISO-datums naast elkaar:
  // reken op ±80px per label. Op desktopbreedte blijft dit gewoon 6.
  const tickAantal = Math.min(6, nDagen, Math.max(2, Math.floor(bw / 80)));
  for (let i = 0; i < tickAantal; i++) {
    const idx = Math.round((i * (nDagen - 1)) / Math.max(tickAantal - 1, 1));
    g.append(svgEl("text", {
      x: (idx + 0.5) * band, y: bh + 18, "text-anchor": "middle", class: "astekst",
    }, datumKort(plusDagen(bereik.van, idx))));
  }

  // Doellijn (gestippeld, gedempt) met label rechts.
  if (opties.doel != null) {
    const y = yVan(opties.doel);
    g.append(svgEl("line", { x1: 0, x2: bw, y1: y, y2: y, class: "doellijn" }));
    g.append(svgEl("text", { x: bw + 6, y: y + 4, class: "doeltekst" }, opties.doelLabel || ""));
  }

  // De datalijn zelf: 2px, ronde hoeken/uiteinden. Met een 'vorige'-meting
  // begint de lijn op de y-as (het snijpunt richting die meting) in plaats
  // van pas bij het eerste punt.
  let pad = punten.map((p, i) => `${i ? "L" : "M"}${xVan(p.datum).toFixed(1)},${yVan(p.waarde).toFixed(1)}`).join("");
  if (voorpunt) pad = `M0,${yVan(voorpunt.waarde).toFixed(1)}L` + pad.slice(1);
  g.append(svgEl("path", {
    d: pad, fill: "none", stroke: "var(--reeks-1)", "stroke-width": 2,
    "stroke-linejoin": "round", "stroke-linecap": "round",
  }));

  // Eindpunt krijgt een bolletje (met witte ring zodat het loskomt van de
  // lijn) en het laatste getal ernaast — zo is de recentste waarde direct
  // leesbaar zonder te hoveren.
  const laatste = punten[punten.length - 1];
  g.append(svgEl("circle", {
    cx: xVan(laatste.datum), cy: yVan(laatste.waarde), r: 5,
    fill: "var(--reeks-1)", stroke: "var(--oppervlak)", "stroke-width": 2,
  }));
  g.append(svgEl("text", {
    x: xVan(laatste.datum) + 9, y: yVan(laatste.waarde) + 4,
    class: "astekst", style: "fill:var(--inkt);font-weight:600;font-size:12px",
  }, fmt.format(laatste.waarde)));

  // Weegschaalfoto's: per meetdag met foto('s) alvast de <img>-knopen maken,
  // zodat de browser ze meteen op de achtergrond binnenhaalt — bij hover
  // staat de foto dan al klaar. Bewust geen aparte thumbnails: het
  // "thumbnail" ís het volledige bestand, dat gaat vlot genoeg over het LAN.
  const fotoImgs = {};
  if (opties.fotos) {
    for (const p of punten) {
      const namen = opties.fotos[p.datum];
      if (namen) {
        fotoImgs[p.datum] = namen.map((naam) =>
          el("img", { src: "/afbeeldingen/" + encodeURIComponent(naam),
                      alt: `weegschaalfoto ${p.datum}` }));
      }
    }
  }

  // Zweeflaag: een verticale kruisdraad springt naar het dichtstbijzijnde
  // meetpunt; je hoeft dus nooit precies op de lijn te mikken.
  const kruis = svgEl("line", { y1: 0, y2: bh, class: "kruisdraad", visibility: "hidden" });
  const punt = svgEl("circle", {
    r: 5, fill: "var(--reeks-1)", stroke: "var(--oppervlak)", "stroke-width": 2, visibility: "hidden",
  });
  g.append(kruis, punt);
  const vlak = svgEl("rect", { x: 0, y: 0, width: bw, height: bh, fill: "transparent" });
  g.append(vlak);

  // Het meetpunt dat het dichtst bij een schermpositie (clientX) ligt. De SVG
  // schaalt mee met de kaartbreedte, vandaar de omrekening via de echte rect.
  const dichtsteBij = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const mx = ((clientX - rect.left) / rect.width) * B - m.l;
    let best = punten[0], bestAfstand = Infinity;
    for (const p of punten) {
      const afstand = Math.abs(xVan(p.datum) - mx);
      if (afstand < bestAfstand) { bestAfstand = afstand; best = p; }
    }
    return best;
  };

  // Kruisdraad + bolletje op meetpunt p zetten en het zweefvenster bij
  // schermpositie (x, y) tonen.
  const toonPunt = (p, x, y) => {
    const px = xVan(p.datum), py = yVan(p.waarde);
    kruis.setAttribute("x1", px); kruis.setAttribute("x2", px);
    kruis.setAttribute("visibility", "visible");
    punt.setAttribute("cx", px); punt.setAttribute("cy", py);
    punt.setAttribute("visibility", "visible");
    const regels = [
      [`${fmt.format(p.waarde)} ${opties.eenheid || ""}`, "zw-waarde"],
      [datumLang(p.datum), "zw-label"],
    ];
    // Bij gewicht: ook de BMI van dit punt tonen (gewicht / lengte²).
    if (opties.lengte) {
      regels.push([`BMI ${fmt.format(p.waarde / (opties.lengte * opties.lengte))}`, "zw-label"]);
    }
    // Gemiddelde kcal en sportminuten per dag sinds de vorige weging: van de
    // dag van die weging t/m de dag vóór deze meting — er wordt 's ochtends
    // gewogen, dus wat op de weegdag zelf gebeurt zit pas in de vólgende
    // meting. Voor kcal tellen alleen dagen met gelogd eten mee (net als in
    // de Gem. kcal-tegel); voor sport tellen alle dagen mee, want een rustdag
    // is een echte nul (zelfde conventie als de Sport-tegel).
    let sportRegel = null;   // als laatste tekstregel, ná het gewichtsverschil
    if (opties.sindsWeging) {
      const { kcalPerDag, sportPerDag, vanaf, kcalMin, kcalMax } = opties.sindsWeging;
      const i = punten.indexOf(p);
      const vorigePunt = i > 0 ? punten[i - 1] : opties.vorige;
      if (vorigePunt && vorigePunt.datum >= vanaf) {
        let som = 0, eetdagen = 0, sportMin = 0, nDagen = 0;
        for (let d = vorigePunt.datum; d < p.datum; d = plusDagen(d, 1)) {
          const kcal = kcalPerDag[d] || 0;
          if (kcal > 0) { som += kcal; eetdagen++; }
          sportMin += sportPerDag[d] || 0;
          nDagen++;
        }
        if (eetdagen) {
          // Zelfde kleurbetekenis als de kcal-grafiek: rood boven het
          // maximum, amber onder het minimum, groen binnen de richtlijn —
          // zonder richtlijn blijft de regel ongekleurd.
          const gem = som / eetdagen;
          const klasse = kcalMin == null && kcalMax == null ? ""
            : kcalMax != null && gem > kcalMax ? " zw-boven"
            : kcalMin != null && gem < kcalMin ? " zw-onder" : " zw-goed";
          regels.push([`gem. ${fmt0.format(gem)} kcal/dag`, "zw-label" + klasse]);
        }
        if (nDagen) {
          sportRegel = [`gem. ${fmt0.format(sportMin / nDagen)} min/dag gesport`, "zw-label"];
        }
      }
      // Gewichtsverschil t.o.v. de vorige weging: groen eraf, rood erbij.
      // Dit heeft de dagtotalen niet nodig, dus ook zonder complete
      // kcal-/sportdata (vorige weging vóór 'vanaf') blijft dit zichtbaar.
      if (vorigePunt) {
        const d = p.waarde - vorigePunt.waarde;
        regels.push([`${d >= 0 ? "+" : ""}${fmt.format(d)} kg sinds vorige weging`,
                     "zw-label " + (d <= 0 ? "zw-goed" : "zw-slecht")]);
      }
    }
    // De weegschaalfoto('s) van deze dag, naast elkaar in één strook. Via een
    // fragment komen de (al geladen) img-knopen samen in één zw-foto-regel.
    if (sportRegel) regels.push(sportRegel);
    if (fotoImgs[p.datum]) {
      const strook = document.createDocumentFragment();
      strook.append(...fotoImgs[p.datum]);
      regels.push([strook, "zw-foto"]);
    }
    toonZweefinfo(x, y, regels);
  };

  // Vastklikken (vooral voor de telefoon, waar hover onhandig is): een klik
  // zet het zweefvenster vast op dat punt, verankerd aan het punt zelf in
  // plaats van aan de aanwijzer. Het blijft staan tot een ander punt wordt
  // aangeklikt of gehoverd, of tot dezelfde klik het weer loslaat.
  let vastPunt = null;
  const toonVast = () => {
    const rect = svg.getBoundingClientRect();
    toonPunt(vastPunt,
      rect.left + ((m.l + xVan(vastPunt.datum)) / B) * rect.width,
      rect.top + ((m.t + yVan(vastPunt.waarde)) / H) * rect.height);
  };
  const laatLos = () => {
    vastPunt = null;
    kruis.setAttribute("visibility", "hidden");
    punt.setAttribute("visibility", "hidden");
    if (zweefVast && zweefVast.houder === houder) zweefVast = null;
  };

  vlak.addEventListener("pointermove", (e) => {
    const best = dichtsteBij(e.clientX);
    // Hover over een ánder punt laat het vastgeklikte punt los.
    if (vastPunt && best !== vastPunt) laatLos();
    if (vastPunt) toonVast();
    else toonPunt(best, e.clientX, e.clientY);
  });
  vlak.addEventListener("click", (e) => {
    const best = dichtsteBij(e.clientX);
    if (best === vastPunt) {          // zelfde punt nogmaals: weer loslaten
      laatLos();
      verbergZweefinfo();
    } else {
      // Eén vastgezet venster tegelijk over alle grafieken heen.
      if (zweefVast && zweefVast.houder !== houder) zweefVast.laatLos();
      vastPunt = best;
      zweefVast = { houder, toon: toonVast, laatLos };
      toonVast();
    }
  });
  vlak.addEventListener("pointerleave", () => {
    if (vastPunt) { toonVast(); return; }
    kruis.setAttribute("visibility", "hidden");
    punt.setAttribute("visibility", "hidden");
    verbergZweefinfo();
  });

  houder.append(svg);
}

/* Staafgrafiek (voor kcal per dag).
   punten = [{datum, waarde, detail}] — 'detail' (bv. de sport van die dag)
   komt als extra regel in het zweefvenster. opties:
     maxLijn / maxLabel — horizontale richtlijn boven (bv. max 2.600 kcal)
     minLijn / minLabel — horizontale richtlijn onder (bv. min 1.800 kcal)
     kleurVan           — functie waarde -> kleur, om elke staaf te kleuren
                          naargelang de waarde (anders de standaardblauw)
     bijKlik            — functie (punt) => ...; maakt elke dagband klikbaar
                          (handwijzer + hintregel in het zweefvenster) */
function staafGrafiek(houder, punten, opties = {}) {
  houder.replaceChildren();
  if (!punten.length) {
    houder.append(el("p", { class: "subtitel" }, "Geen gegevens in deze periode."));
    return;
  }
  const B = Math.max(houder.clientWidth, 320), H = 260;
  const m = { l: 64, r: 56, t: 12, b: 28 };   // zelfde marges in alle grafieken
  const bw = B - m.l - m.r, bh = H - m.t - m.b;

  // y-as begint bij staven altijd op 0 (anders liegt de staafhoogte). De top
  // ligt vlak boven de hoogste staaf (of de richtlijn): maximum + 200 kcal,
  // zodat er geen lap lege ruimte boven de grafiek gaapt. De gridlijnen
  // blijven wel op ronde getallen staan.
  const yMax = Math.max(...punten.map((p) => p.waarde), opties.maxLijn || 0) + 200;
  const stap = nietteStappen(yMax, 5);
  const yVan = (w) => bh - (w / yMax) * bh;

  // Elke dag krijgt een 'band'; de staaf is maximaal 24px dik en laat
  // minstens 2px ruimte tot zijn buur, zodat staven nooit aan elkaar plakken.
  const band = bw / punten.length;
  const dikte = Math.max(1, Math.min(24, band - 2));

  const svg = svgEl("svg", { viewBox: `0 0 ${B} ${H}`, width: B, height: H });
  const g = svgEl("g", { transform: `translate(${m.l},${m.t})` });
  svg.append(g);

  // Grid + y-aslabels.
  for (let w = 0; w <= yMax + 1e-9; w += stap) {
    const y = yVan(w);
    g.append(svgEl("line", { x1: 0, x2: bw, y1: y, y2: y, class: "gridlijn" }));
    g.append(svgEl("text", { x: -8, y: y + 4, "text-anchor": "end", class: "astekst" }, fmt0.format(w)));
  }
  g.append(svgEl("line", { x1: 0, x2: bw, y1: bh, y2: bh, class: "aslijn" }));

  // Maximaal 6 datumlabels op de x-as.
  const tickAantal = Math.min(6, punten.length, Math.max(2, Math.floor(bw / 80)));
  for (let i = 0; i < tickAantal; i++) {
    const idx = Math.round((i * (punten.length - 1)) / Math.max(tickAantal - 1, 1));
    g.append(svgEl("text", {
      x: idx * band + band / 2, y: bh + 18, "text-anchor": "middle", class: "astekst",
    }, datumKort(punten[idx].datum)));
  }

  punten.forEach((p, i) => {
    const x = i * band + (band - dikte) / 2;
    const y = yVan(p.waarde);
    const hoogte = bh - y;
    let staaf;
    const rond = Math.min(4, dikte / 2, hoogte);
    // De staafkleur kan afhangen van de waarde (bv. groen binnen de
    // kcal-richtlijn, rood erboven, amber eronder).
    const kleur = opties.kleurVan ? opties.kleurVan(p.waarde) : "var(--reeks-1)";
    if (hoogte <= 0) {
      // Dag zonder data: ministreepje op de basislijn zodat je ziet dat de
      // dag bestaat maar leeg is.
      staaf = svgEl("rect", { x, y: bh - 1, width: dikte, height: 1, fill: "var(--gridlijn)" });
    } else {
      // Staaf met afgeronde bovenhoeken en vlakke onderkant (basislijn).
      staaf = svgEl("path", {
        d: `M${x},${bh} V${y + rond} Q${x},${y} ${x + rond},${y} H${x + dikte - rond} ` +
           `Q${x + dikte},${y} ${x + dikte},${y + rond} V${bh} Z`,
        fill: kleur,
      });
    }
    g.append(staaf);

    // Onzichtbaar aanwijsvlak over de volledige band(hoogte): veel makkelijker
    // te raken dan een dun staafje. Bij hover licht de staaf op en verschijnt
    // het zweefvenster; met 'bijKlik' is de band ook klikbaar (handwijzer).
    const hit = svgEl("rect", { x: i * band, y: 0, width: band, height: bh, fill: "transparent" });
    if (opties.bijKlik) {
      hit.setAttribute("cursor", "pointer");
      hit.addEventListener("click", () => opties.bijKlik(p));
    }
    hit.addEventListener("pointermove", (e) => {
      staaf.setAttribute("opacity", "0.75");
      const regels = [[`${fmt0.format(p.waarde)} kcal`, "zw-waarde"], [datumLang(p.datum), "zw-label"]];
      if (p.detail) regels.push([p.detail, "zw-label"]);
      if (opties.bijKlik) regels.push(["klik voor het dagboek", "zw-label"]);
      toonZweefinfo(e.clientX, e.clientY, regels);
    });
    hit.addEventListener("pointerleave", () => {
      staaf.removeAttribute("opacity");
      verbergZweefinfo();
    });
    g.append(hit);
  });

  // Richtlijnen (bv. min 1.800 en max 2.600 kcal) als gestippelde lijnen.
  if (opties.maxLijn) {
    const y = yVan(opties.maxLijn);
    g.append(svgEl("line", { x1: 0, x2: bw, y1: y, y2: y, class: "doellijn" }));
    g.append(svgEl("text", { x: bw + 6, y: y + 4, class: "doeltekst" }, opties.maxLabel || ""));
  }
  if (opties.minLijn) {
    const y = yVan(opties.minLijn);
    g.append(svgEl("line", { x1: 0, x2: bw, y1: y, y2: y, class: "doellijn" }));
    g.append(svgEl("text", { x: bw + 6, y: y + 4, class: "doeltekst" }, opties.minLabel || ""));
  }

  houder.append(svg);
}

/* Sportgrafiek: gestapelde staven, minuten per dag, kleur per type.
   Elke activiteit houdt altijd zijn eigen kleur (hardlopen is altijd blauw,
   ook als er die periode niet gelopen is) — zo leer je de kleuren één keer.
   dagen = de dagarray van /api/dagen (elke dag heeft een sport-lijst). */
// De kleur per type komt uit een CSS-variabele (standaard in stijl.css,
// aanpasbaar op het Instellingen-tabblad); de legende en het zweefvenster
// benoemen de types.
const SPORT_KLEUREN = {
  lopen: "var(--sport-lopen)",
  krachttraining: "var(--sport-krachttraining)",
  fietsen: "var(--sport-fietsen)",
  zwemmen: "var(--sport-zwemmen)",
  overig: "var(--sport-overig)",   // onherkende oude invoer
};
const SPORT_VOLGORDE = ["lopen", "krachttraining", "fietsen", "zwemmen", "overig"];

function sportGrafiek(houder, dagen) {
  houder.replaceChildren();
  if (!dagen.length) {
    houder.append(el("p", { class: "subtitel" }, "Geen gegevens in deze periode."));
    return;
  }
  const B = Math.max(houder.clientWidth, 320), H = 220;
  const m = { l: 64, r: 56, t: 12, b: 28 };   // zelfde marges in alle grafieken
  const bw = B - m.l - m.r, bh = H - m.t - m.b;

  // Per dag de minuten optellen per type (meerdere activiteiten kunnen).
  const punten = dagen.map((d) => {
    const perType = {};
    for (const s of d.sport) perType[s.type] = (perType[s.type] || 0) + s.duur_minuten;
    return { datum: d.datum, perType, totaal: d.sport.reduce((t, s) => t + s.duur_minuten, 0), sport: d.sport };
  });

  // y-as: van 0 tot het drukste sportmoment, in nette stappen.
  let yMax = Math.max(...punten.map((p) => p.totaal), 30);
  const stap = nietteStappen(yMax, 4);
  yMax = Math.ceil(yMax / stap) * stap;
  const yVan = (w) => bh - (w / yMax) * bh;

  const band = bw / punten.length;
  const dikte = Math.max(1, Math.min(24, band - 2));

  const svg = svgEl("svg", { viewBox: `0 0 ${B} ${H}`, width: B, height: H });
  const g = svgEl("g", { transform: `translate(${m.l},${m.t})` });
  svg.append(g);

  // Grid + y-aslabels, met de eenheid erbij ("20 min", "40 min", ...).
  for (let w = 0; w <= yMax + 1e-9; w += stap) {
    const y = yVan(w);
    g.append(svgEl("line", { x1: 0, x2: bw, y1: y, y2: y, class: "gridlijn" }));
    g.append(svgEl("text", { x: -8, y: y + 4, "text-anchor": "end", class: "astekst" },
      w === 0 ? "0" : `${fmt0.format(w)} min`));
  }
  g.append(svgEl("line", { x1: 0, x2: bw, y1: bh, y2: bh, class: "aslijn" }));

  // Datumlabels op de x-as (maximaal 6).
  const tickAantal = Math.min(6, punten.length, Math.max(2, Math.floor(bw / 80)));
  for (let i = 0; i < tickAantal; i++) {
    const idx = Math.round((i * (punten.length - 1)) / Math.max(tickAantal - 1, 1));
    g.append(svgEl("text", {
      x: idx * band + band / 2, y: bh + 18, "text-anchor": "middle", class: "astekst",
    }, datumKort(punten[idx].datum)));
  }

  punten.forEach((p, i) => {
    const x = i * band + (band - dikte) / 2;
    const groep = svgEl("g", {});   // alle segmenten van deze dag samen

    if (p.totaal <= 0) {
      // Rustdag: ministreepje op de basislijn.
      groep.append(svgEl("rect", { x, y: bh - 1, width: dikte, height: 1, fill: "var(--gridlijn)" }));
    } else {
      // Segmenten stapelen van onder naar boven, in vaste typevolgorde.
      // Tussen twee segmenten blijft 2px oppervlaktekleur open (het "gat"),
      // zodat de types visueel loskomen van elkaar.
      const types = SPORT_VOLGORDE.filter((t) => p.perType[t]);
      let cum = 0;
      types.forEach((t, ti) => {
        const bodem = yVan(cum);
        const top = yVan(cum + p.perType[t]);
        const bovenste = ti === types.length - 1;
        if (bovenste) {
          // Bovenste segment: 4px afgeronde top, vlakke onderkant.
          const rond = Math.min(4, dikte / 2, bodem - top);
          groep.append(svgEl("path", {
            d: `M${x},${bodem} V${top + rond} Q${x},${top} ${x + rond},${top} H${x + dikte - rond} ` +
               `Q${x + dikte},${top} ${x + dikte},${top + rond} V${bodem} Z`,
            fill: SPORT_KLEUREN[t],
          }));
        } else {
          groep.append(svgEl("rect", {
            x, y: top + 2, width: dikte, height: Math.max(bodem - top - 2, 1),
            fill: SPORT_KLEUREN[t],
          }));
        }
        cum += p.perType[t];
      });
    }
    g.append(groep);

    // Aanwijsvlak over de hele band: zweefvenster met totaal + elke activiteit.
    const hit = svgEl("rect", { x: i * band, y: 0, width: band, height: bh, fill: "transparent" });
    hit.addEventListener("pointermove", (e) => {
      groep.setAttribute("opacity", "0.75");
      const regels = p.totaal > 0
        ? [[`${fmt0.format(p.totaal)} min sport`, "zw-waarde"], [datumLang(p.datum), "zw-label"],
           ...p.sport.map((s) => [sportTekst(s), "zw-label"])]
        : [["Geen sport", "zw-waarde"], [datumLang(p.datum), "zw-label"]];
      toonZweefinfo(e.clientX, e.clientY, regels);
    });
    hit.addEventListener("pointerleave", () => {
      groep.removeAttribute("opacity");
      verbergZweefinfo();
    });
    g.append(hit);
  });

  houder.append(svg);
}

/* ================= 4. Dashboard ================= */

let instellingen = {};   // doelgewicht, lengte, richtlijnen — geladen bij start
let filterDagen = "jaar"; // actieve periodefilter (0 = alles, "jaar" = sinds 1 januari)

// Periodeknoppen: één filterrij die alles op het dashboard herschaalt.
document.getElementById("bereikfilters").addEventListener("click", (e) => {
  const knop = e.target.closest("button");
  if (!knop) return;
  filterDagen = knop.dataset.dagen === "jaar" ? "jaar" : Number(knop.dataset.dagen);
  document.querySelectorAll("#bereikfilters button").forEach((b) =>
    b.classList.toggle("actief", b === knop));
  laadDashboard();
});

/* --- BMI-hulpjes -------------------------------------------------------
   Het gezonde BMI-bereik is 18,5 – 24,9 met 21,7 als midden. Vanuit dat
   midden naar buiten lopen vijf kleurbanden (heel groen -> donker oranje);
   buiten het gezonde bereik is het donkerrood. Dezelfde schaal kleurt de
   achtergrond van de gewichtsgrafiek én de tegels bovenaan. */
// Zelfde groen/geel/rood als de kcal-grafiek (via de gedeelde
// --grafiek-*-variabelen, instelbaar op het Instellingen-tabblad), zodat het
// hele dashboard één palet spreekt: groen rond het midden, geel verder weg,
// rood aan de rand.
const BMI_ONDER = 18.5, BMI_MIDDEN = 21.7, BMI_BOVEN = 24.9;
const BMI_BANDKLEUREN = ["var(--grafiek-goed)", "var(--grafiek-goed)",
  "var(--grafiek-onder)", "var(--grafiek-onder)", "var(--grafiek-boven)"];
const BMI_BANDBREEDTE = (BMI_MIDDEN - BMI_ONDER) / BMI_BANDKLEUREN.length; // 0,64 BMI
const BMI_BUITEN = "var(--grafiek-boven)";   // onder-/overgewicht (vol aangezet)

function bmiKleur(bmi) {
  if (bmi < BMI_ONDER || bmi > BMI_BOVEN) return "var(--slecht)"; // leesbaar rood als tekst
  const band = Math.min(
    Math.floor(Math.abs(bmi - BMI_MIDDEN) / BMI_BANDBREEDTE),
    BMI_BANDKLEUREN.length - 1);
  return BMI_BANDKLEUREN[band];
}

async function laadDashboard() {
  // Alle statistieken lopen t/m GISTEREN: vandaag is nog niet af (na het
  // ontbijt lijkt de dag anders maar 400 kcal), en zo'n halve dag zou alle
  // gemiddelden, kleuren en grafieken scheeftrekken. De periode "laatste 7
  // dagen" betekent dus: de 7 volledige dagen t/m gisteren.
  const einde = plusDagen(vandaag(), -1);
  const van = filterDagen === "jaar" ? `${new Date().getFullYear()}-01-01`
    : filterDagen ? plusDagen(einde, -filterDagen + 1) : "0001-01-01";

  // Gewichten, dagtotalen en de lijst weegschaalfoto's parallel ophalen.
  // De dagtotalen komen een stukje ruimer binnen dan de periode zelf: het
  // zweefvenster van de gewichtsgrafiek toont de gemiddelde kcal sinds de
  // vórige weging, en voor de eerste meting binnen beeld ligt die weging
  // vóór de periode. 35 dagen extra dekt ruim een maand tussen twee wegingen.
  const dagenVan = filterDagen ? plusDagen(van, -35) : van;
  const [gewichten, dagenRuim, fotos] = await Promise.all([
    api("/api/gewicht"),
    api(`/api/dagen?van=${dagenVan}&tot=${einde}`),
    api("/api/afbeeldingen"),
  ]);
  // Alles behalve dat zweefvenster rekent op de gekozen periode zelf.
  const dagen = dagenRuim.filter((d) => d.datum >= van);
  // Mét onderrapportage-correctie: het zweefvenster van de gewichtsgrafiek
  // kleurt het weekgemiddelde t.o.v. de richtlijn, en die vergelijking moet
  // dezelfde zijn als in de kcal-grafiek (die de gecorrigeerde waarden toont).
  const kcalPerDag = Object.fromEntries(dagenRuim.map((d) => [d.datum, metOnderrapportage(d.kcal)]));
  const sportPerDag = Object.fromEntries(dagenRuim.map(
    (d) => [d.datum, d.sport.reduce((t, s) => t + s.duur_minuten, 0)]));
  // Gewichtmetingen zijn wél compleet op het moment van wegen, dus die van
  // vandaag telt gewoon mee.
  const gewichtBereik = gewichten.filter((g) => g.datum >= van);

  /* --- statustegels bovenaan ---
     Gewicht/doel/BMI tonen altijd de recentste meting, maar het
     gewichtsverschil en de kcal-/sporttegels volgen de gekozen periode. */
  const tegels = document.getElementById("tegels");
  tegels.replaceChildren();
  const doel = instellingen.doelgewicht_kg;
  const lengte = instellingen.lengte_m;

  if (gewichten.length) {
    const laatste = gewichten[gewichten.length - 1];
    const bmi = lengte ? laatste.gewicht / (lengte * lengte) : null;
    const kleur = bmi ? `color:${bmiKleur(bmi)}` : "";

    // Tegel: huidig gewicht, gekleurd volgens de BMI-zone, met het verschil
    // t.o.v. de eerste meting binnen de gekozen periode.
    const tegel = el("div", { class: "tegel" },
      el("div", { class: "label" }, "Huidig gewicht"),
      el("div", { class: "waarde", style: kleur }, `${fmt.format(laatste.gewicht)} kg`));
    const eerste = gewichtBereik[0];
    if (eerste && eerste.datum !== laatste.datum) {
      const d = laatste.gewicht - eerste.gewicht;
      tegel.append(el("div", { class: "delta " + (d <= 0 ? "goed" : "slecht") },
        `${d >= 0 ? "+" : ""}${fmt.format(d)} kg t.o.v. ${datumKort(eerste.datum)}`));
    }
    tegels.append(tegel);

    // Tegel: doelgewicht en hoeveel er nog af moet.
    if (doel) {
      tegels.append(el("div", { class: "tegel" },
        el("div", { class: "label" }, "Doelgewicht"),
        el("div", { class: "waarde" }, `${fmt.format(doel)} kg`),
        el("div", { class: "delta" }, `nog ${fmt.format(Math.max(laatste.gewicht - doel, 0))} kg te gaan`)));
    }

    // Tegel: BMI, in dezelfde zonekleur als de gewichtsgrafiek.
    if (bmi) {
      tegels.append(el("div", { class: "tegel" },
        el("div", { class: "label" }, "BMI"),
        el("div", { class: "waarde", style: kleur }, fmt.format(bmi)),
        el("div", { class: "delta" }, "gezond: 18,5 – 24,9")));
    }
  }

  // Tegel: gemiddelde kcal over de gekozen periode (alleen dagen waarop
  // gegeten is tellen mee), gekleurd t.o.v. de richtlijn.
  const eetDagen = dagen.filter((d) => d.kcal > 0);
  const kcalGem = eetDagen.length ? eetDagen.reduce((s, d) => s + d.kcal, 0) / eetDagen.length : 0;
  const kcalTegelKleur =
    instellingen.kcal_max != null && kcalGem > instellingen.kcal_max ? "var(--boven-max)"
    : instellingen.kcal_min != null && kcalGem < instellingen.kcal_min ? "var(--onder-min)"
    : "var(--goed)";
  tegels.append(el("div", { class: "tegel" },
    el("div", { class: "label" }, "Gem. kcal"),
    el("div", { class: "waarde", style: `color:${kcalTegelKleur}` }, fmt0.format(kcalGem)),
    el("div", { class: "delta" },
      instellingen.kcal_max ? `richtlijn: ${fmt0.format(instellingen.kcal_min || 0)} – ${fmt0.format(instellingen.kcal_max)}` : "")));

  // Tegel: gemiddelde sport per dag over de gekozen periode, met daaronder
  // het gemiddelde per week. De kleur volgt de WHO-richtlijn van 150–300
  // minuten beweging per week (>= 150 groen, 75–150 amber, minder rood).
  const sportMin = dagen.reduce((s, d) => s + d.sport.reduce((t, a) => t + a.duur_minuten, 0), 0);
  // Aantal dagen in de periode: vast bij een dagenfilter, sinds 1 januari bij
  // "van begin jaar", en anders (Alles) sinds de eerste dag met gegevens.
  const periodeStart = filterDagen === "jaar" ? van : dagen.length ? dagen[0].datum : null;
  const periodeDagen = typeof filterDagen === "number" && filterDagen ? filterDagen
    : periodeStart ? Math.round((naarDatum(einde) - naarDatum(periodeStart)) / DAG_MS) + 1 : 1;
  const minPerDag = sportMin / periodeDagen;
  const minPerWeek = minPerDag * 7;
  const sportKleur = minPerWeek >= 150 ? "var(--goed)" : minPerWeek >= 75 ? "var(--onder-min)" : "var(--slecht)";
  tegels.append(el("div", { class: "tegel" },
    el("div", { class: "label" }, "Sport"),
    el("div", { class: "waarde", style: `color:${sportKleur}` }, `${fmt0.format(minPerDag)} min/dag`),
    el("div", { class: "delta" }, `${fmt0.format(minPerWeek)} min/week`)));

  // Tegel: totaal gelopen kilometers binnen de gekozen periode:
  // afstand = snelheid × duur.
  const kmGelopen = dagen
    .flatMap((d) => d.sport)
    .filter((s) => s.type === "lopen" && s.snelheid_kmh)
    .reduce((som, s) => som + s.snelheid_kmh * s.duur_minuten / 60, 0);
  tegels.append(el("div", { class: "tegel" },
    el("div", { class: "label" }, "Gelopen"),
    el("div", { class: "waarde", style: "color:var(--sport-lopen)" }, `${fmt0.format(kmGelopen)} km`),
    el("div", { class: "delta" }, "in deze periode")));

  /* --- gedeelde x-as voor de drie grafieken ---
     Alle grafieken krijgen hetzelfde datumbereik en één band per kalenderdag,
     zodat dezelfde datum overal recht onder elkaar staat en je waardes
     verticaal kunt vergelijken. Het bereik loopt van het begin van de periode
     (bij 'Alles': de eerste dag met gegevens) tot gisteren, of tot vandaag
     als er vandaag al gewogen is (die meting telt immers mee). */
  const laatsteMeting = gewichtBereik[gewichtBereik.length - 1];
  const domeinTot = laatsteMeting && laatsteMeting.datum > einde ? laatsteMeting.datum : einde;
  const eersteData = [gewichtBereik[0] && gewichtBereik[0].datum,
                      dagen[0] && dagen[0].datum].filter(Boolean).sort()[0];
  const bereik = { van: filterDagen ? van : (eersteData || domeinTot), tot: domeinTot };

  // De dagenlijst van de API bevat alleen dagen mét gegevens; hier vullen we
  // de gaten op met lege dagen zodat elke kalenderdag exact één band inneemt.
  const dagPerDatum = Object.fromEntries(dagen.map((d) => [d.datum, d]));
  const alleDagen = [];
  for (let d = bereik.van; d <= bereik.tot; d = plusDagen(d, 1)) {
    alleDagen.push(dagPerDatum[d] || { datum: d, kcal: 0, sport: [] });
  }

  /* --- gewichtsgrafiek met BMI-zones op de achtergrond --- */
  // De BMI-schaal wordt omgerekend naar kilogram via gewicht = BMI × lengte².
  // Vanuit het midden naar buiten: heel groen -> lichter groen -> geel ->
  // licht oranje -> donker oranje, en donkerrood buiten 18,5 – 24,9.
  let zones = [], grenzen = [], vastBereik = null;
  if (lengte) {
    const kg = (bmi) => bmi * lengte * lengte;
    BMI_BANDKLEUREN.forEach((kleur, i) => {
      // Elke kleur bestaat twee keer: één band onder en één boven het midden.
      // Opaciteit 0.28: helder genoeg om op de donkere achtergrond te lezen.
      zones.push({ van: kg(BMI_MIDDEN + i * BMI_BANDBREEDTE), tot: kg(BMI_MIDDEN + (i + 1) * BMI_BANDBREEDTE), kleur, opaciteit: 0.28 });
      zones.push({ van: kg(BMI_MIDDEN - (i + 1) * BMI_BANDBREEDTE), tot: kg(BMI_MIDDEN - i * BMI_BANDBREEDTE), kleur, opaciteit: 0.28 });
    });
    // Buiten het gezonde bereik (tot ver buiten beeld): hetzelfde rood, maar
    // duidelijk zwaarder aangezet dan de banden erbinnen.
    zones.push({ van: kg(BMI_BOVEN), tot: kg(BMI_BOVEN) + 100, kleur: BMI_BUITEN, opaciteit: 0.5 });
    zones.push({ van: kg(BMI_ONDER) - 100, tot: kg(BMI_ONDER), kleur: BMI_BUITEN, opaciteit: 0.5 });

    // Bij 'Alles' en 'Van begin jaar' zoomen we uit tot de volledige gezonde
    // BMI-schaal, met de grenslijnen naar onder- en overgewicht in beeld. Bij
    // kortere periodes blijft de grafiek strak inzoomen op de metingen zelf.
    if (filterDagen === 0 || filterDagen === "jaar") {
      vastBereik = { min: kg(BMI_ONDER) - 2, max: kg(BMI_BOVEN) + 2 };
      grenzen = [
        { waarde: kg(BMI_ONDER), label: `ondergewicht — BMI ${fmt.format(BMI_ONDER)} (${fmt.format(kg(BMI_ONDER))} kg)` },
        { waarde: kg(BMI_BOVEN), label: `overgewicht — BMI ${fmt.format(BMI_BOVEN)} (${fmt.format(kg(BMI_BOVEN))} kg)` },
      ];
    }
  }

  document.getElementById("gewicht-subtitel").textContent =
    (doel ? `kg per meting, doellijn op ${fmt.format(doel)} kg` : "kg per meting") +
    " — achtergrond = BMI-zones (groen in het midden, donkerrood buiten 18,5–24,9)";
  // Laatste meting vóór de periode: daarmee trekt de grafiek de lijn door
  // tot de y-as in plaats van pas bij de eerste meting binnen beeld.
  const vorigeMeting = gewichten.filter((g) => g.datum < van).at(-1);
  lijnGrafiek(document.getElementById("grafiek-gewicht"),
    gewichtBereik.map((g) => ({ datum: g.datum, waarde: g.gewicht })),
    { doel, doelLabel: doel ? `doel ${fmt.format(doel)}` : "", eenheid: "kg",
      zones, lengte, vastBereik, grenzen, bereik, fotos,
      sindsWeging: { kcalPerDag, sportPerDag, vanaf: dagenVan,
                     kcalMin: instellingen.kcal_min, kcalMax: instellingen.kcal_max },
      vorige: vorigeMeting && { datum: vorigeMeting.datum, waarde: vorigeMeting.gewicht } });

  /* --- kcal-grafiek: staafkleur volgens de richtlijn --- */
  const kcalMin = instellingen.kcal_min, kcalMax = instellingen.kcal_max;
  // Zelfde betekenis als in de tabellen: groen binnen de richtlijn,
  // rood boven het maximum, amber onder het minimum.
  const kcalKleur = (w) => {
    if (kcalMax != null && w > kcalMax) return "var(--grafiek-boven)";
    if (kcalMin != null && w < kcalMin) return "var(--grafiek-onder)";
    return "var(--grafiek-goed)";
  };
  // De subtitel meldt de correctie, anders lijkt de grafiek het dagboek
  // (dat de ruwe logwaarden toont) tegen te spreken.
  const onderrapportagePct = instellingen.onderrapportage_pct || 0;
  document.getElementById("kcal-subtitel").textContent =
    (onderrapportagePct
      ? `kcal per dag incl. ${fmt.format(onderrapportagePct)}% onderrapportage`
      : "kcal gegeten per dag") + ", gekleurd t.o.v. de richtlijn";
  staafGrafiek(document.getElementById("grafiek-kcal"),
    alleDagen.map((d) => ({
      datum: d.datum, waarde: metOnderrapportage(d.kcal),
      detail: d.sport.map(sportTekst).join(" · "),  // sport in het zweefvenster
    })),
    {
      kleurVan: kcalMin != null || kcalMax != null ? kcalKleur : null,
      maxLijn: kcalMax, maxLabel: kcalMax ? `max ${fmt0.format(kcalMax)}` : "",
      minLijn: kcalMin, minLabel: kcalMin ? `min ${fmt0.format(kcalMin)}` : "",
      // Klik op een staaf = het dagboek van die dag openen (zelfde gedrag
      // als een dagrij in het weekoverzicht, incl. bookmarkbare hash).
      bijKlik: (p) => {
        dagInvoer.value = p.datum;
        activeerTab("dagboek");
        location.hash = `dagboek/${p.datum}`;
      },
    });

  // Legende bij de kcal-grafiek (kleur draagt hier betekenis).
  document.getElementById("legende-kcal").replaceChildren(
    ...[["var(--grafiek-goed)", "binnen richtlijn"], ["var(--grafiek-onder)", "onder min"],
        ["var(--grafiek-boven)", "boven max"]]
      .map(([kleur, label]) => el("span", { class: "sleutel" },
        el("span", { class: "vlak", style: `background:${kleur}` }), label)));

  /* --- sportgrafiek: minuten per dag, kleur per type --- */
  sportGrafiek(document.getElementById("grafiek-sport"), alleDagen);

  // Legende: alleen de types die in deze periode voorkomen, met hun vaste
  // kleur (een type behoudt altijd dezelfde kleur).
  const aanwezig = SPORT_VOLGORDE.filter((t) =>
    dagen.some((d) => d.sport.some((s) => s.type === t)));
  document.getElementById("legende-sport").replaceChildren(
    ...aanwezig.map((t) => el("span", { class: "sleutel" },
      el("span", { class: "vlak", style: `background:${SPORT_KLEUREN[t]}` }), t)));
}

/* ================= 5. Dagboek ================= */

let catalogus = [];   // de voedingsmiddelencatalogus, gecachet na eerste keer laden
const dagInvoer = document.getElementById("dag-datum");
dagInvoer.value = vandaag();

// Sporttype start altijd op "lopen" — sommige browsers zetten anders bij
// herladen de vorige keuze (bv. krachttraining) terug.
document.getElementById("sport-type").value = "lopen";

// Bladeren per dag: pijltjes, "Vandaag" of rechtstreeks de datumkiezer.
document.getElementById("dag-vorige").addEventListener("click", () => {
  dagInvoer.value = plusDagen(dagInvoer.value, -1); laadDag();
});
document.getElementById("dag-volgende").addEventListener("click", () => {
  dagInvoer.value = plusDagen(dagInvoer.value, 1); laadDag();
});
document.getElementById("dag-vandaag").addEventListener("click", () => {
  dagInvoer.value = vandaag(); laadDag();
});
dagInvoer.addEventListener("change", laadDag);

// Zoeklijst (datalist) in het dagboek: meest gelogde items eerst, zodat de
// browser die bovenaan voorstelt; bij gelijke frequentie alfabetisch.
function vulVoedingslijst() {
  const volgorde = [...catalogus].sort((a, b) =>
    (b.keer_gelogd || 0) - (a.keer_gelogd || 0) || a.naam.localeCompare(b.naam, "nl"));
  document.getElementById("voedingslijst").replaceChildren(
    ...volgorde.map((vm) => el("option", { value: vm.naam })));
}

// Laad de catalogus één keer en vul er de zoeklijst mee.
async function zorgCatalogus() {
  if (!catalogus.length) {
    catalogus = await api("/api/voedingsmiddelen");
    vulVoedingslijst();
  }
  return catalogus;
}

// Zoek een catalogusitem op exacte naam (hoofdletterongevoelig).
function vindVoedingsmiddel(naam) {
  naam = naam.trim().toLowerCase();
  return catalogus.find((vm) => vm.naam === naam);
}

// Tijdens het typen: toon naast het zoekveld of het gekozen item per stuk of
// per 100 g gaat, en hoeveel kcal dat is — dan weet je wat "hoeveelheid" betekent.
document.getElementById("vm-zoek").addEventListener("input", () => {
  const vm = vindVoedingsmiddel(document.getElementById("vm-zoek").value);
  document.getElementById("vm-eenheid").textContent =
    vm ? (vm.eenheid === "stuk" ? `stuks · ${fmt.format(vm.kcal)} kcal/stuk` : `gram · ${fmt.format(vm.kcal)} kcal/100 g`) : "";
  // De laatst gelogde hoeveelheid van dit item alvast invullen: wie 250 g
  // havermout logt, logt de volgende keer meestal weer 250 g.
  if (vm && vm.laatste_hoeveelheid) {
    document.getElementById("vm-hoeveelheid").value = vm.laatste_hoeveelheid;
  }
});

// Uurvelden: bij het wisselen van dag een verse standaard — het huidige uur
// als de getoonde dag vandaag is, anders leeg (uur is optioneel).
let uurVoorDatum = null;
function zetUurStandaard(datum) {
  if (uurVoorDatum === datum) return;
  uurVoorDatum = datum;
  const uur = datum === vandaag() ? new Date().getHours() : "";
  document.getElementById("vm-uur").value = uur;
  document.getElementById("vrij-uur").value = uur;
}

// Herlaad alles van de gekozen dag: voedingstabel, sport, gewichtmeting en
// notitie.
async function laadDag() {
  await zorgCatalogus();
  const datum = dagInvoer.value;
  document.getElementById("dag-label").textContent = datumLang(datum);
  zetUurStandaard(datum);

  // Kopieerknop: benoem de brondag (de dag vóór de getoonde dag).
  const vorigeDag = plusDagen(datum, -1);
  const kopieerKnop = document.getElementById("dag-kopieer");
  kopieerKnop.textContent =
    datum === vandaag() ? "Kopieer van gisteren" : `Kopieer van ${datumKort(vorigeDag)}`;
  kopieerKnop.title = `Neem alle voeding van ${datumLang(vorigeDag)} over naar deze dag`;

  const dag = await api(`/api/dag/${datum}`);
  document.getElementById("dag-notitie").value = dag.notitie || "";

  /* --- voedingstabel --- */
  const houder = document.getElementById("dag-voeding");
  if (!dag.regels.length) {
    houder.replaceChildren(el("p", { class: "subtitel" }, "Nog niets gegeten vandaag."));
  } else {
    // Eén rij per gegeten portie, met een ×-knopje om ze te verwijderen.
    // De naam kleurt volgens de NOVA-groep uit de catalogus: groen (1,
    // onbewerkt) t/m rood (4, ultrabewerkt); vrije invoer blijft neutraal.
    // Klikken op het uur of de hoeveelheid zet de rij in bewerkmodus:
    // beide worden invoervelden en het × wordt een ✓ om op te slaan
    // (Enter slaat ook op, Esc annuleert).
    const rijen = dag.regels.map((r) => {
      const uurCel = el("td", { class: "gedempt klik-bewerk", title: "Klik om te bewerken" },
        r.uur == null ? "–" : `${r.uur}u`);
      const hoevCel = el("td", { class: "getal gedempt klik-bewerk", title: "Klik om te bewerken" },
        r.eenheid === "stuks" ? `${fmt.format(r.hoeveelheid)}×` : `${fmt.format(r.hoeveelheid)} g`);
      const knop = el("button", { class: "klein", title: "Verwijder" }, "×");
      // ⧉ dupliceert de regel (zelfde dag, uur en waarden) — voor "nog zo eentje".
      const dupKnop = el("button", { class: "klein kopieer", title: "Dupliceer" }, "⧉");
      let veldUur = null, veldHoev = null;   // bestaan zodra de rij bewerkt wordt

      async function opslaan() {
        try {
          await put(`/api/voedingslog/${r.id}`, { hoeveelheid: veldHoev.value, uur: veldUur.value });
          laadDag();   // herladen ververst ook het dagtotaal
        } catch (fout) { toonMelding("melding-voeding", fout.message); }
      }

      function startBewerken(focusUur) {
        if (!veldUur) {
          veldUur = el("input", {
            type: "number", min: 0, max: 24, value: r.uur ?? "", style: "width:56px",
          });
          veldHoev = el("input", {
            type: "number", step: 1, min: 1, value: r.hoeveelheid, style: "width:80px",
          });
          for (const veld of [veldUur, veldHoev]) {
            veld.addEventListener("keydown", (e) => {
              if (e.key === "Enter") opslaan();
              if (e.key === "Escape") laadDag();   // annuleren = vers herladen
            });
          }
          uurCel.replaceChildren(veldUur, " u");
          hoevCel.replaceChildren(veldHoev, r.eenheid === "stuks" ? " ×" : " g");
          knop.textContent = "✓";
          knop.title = "Opslaan";
        }
        (focusUur ? veldUur : veldHoev).focus();
      }

      uurCel.addEventListener("click", () => startBewerken(true));
      hoevCel.addEventListener("click", () => startBewerken(false));
      knop.addEventListener("click", async () => {
        if (veldUur) { opslaan(); return; }
        try {
          await verwijderMetUndo("voedingslog", r.id, `'${r.naam}' verwijderd.`, laadDag);
          laadDag();
        } catch (fout) { toonMelding("melding-voeding", fout.message); }
      });
      dupKnop.addEventListener("click", async () => {
        try {
          await post(`/api/voedingslog/${r.id}/dupliceer`, {});
          laadDag();
        } catch (fout) { toonMelding("melding-voeding", fout.message); }
      });

      return el("tr", {},
        uurCel,
        el("td", { class: r.nova ? `nova${r.nova}` : "" }, r.naam),
        hoevCel,
        ...NUTRIENTEN.map((k) => el("td", { class: "getal" }, fmt.format(r[k] || 0))),
        el("td", { class: "acties" }, dupKnop, knop));
    });

    // Totaalrij van de dag; cellen kleuren als het totaal buiten de
    // richtlijn valt (rood ↑ boven max, amber ↓ onder min).
    const totaal = el("tr", { class: "totaalrij" },
      el("td", {}), el("td", {}, "Totaal"), el("td", {}),
      ...NUTRIENTEN.map((k) => nutrientCel(k, dag.totaal[k])),
      el("td", {}));

    // ...en daaronder de richtlijn (min–max uit de instellingen) ter vergelijking.
    const doelen = el("tr", { class: "doelrij" },
      el("td", {}), el("td", {}, "richtlijn"), el("td", {}),
      ...NUTRIENTEN.map((k) => {
        const min = instellingen[k + "_min"], max = instellingen[k + "_max"];
        return el("td", { class: "getal" },
          min != null && max != null ? `${fmt0.format(min)}–${fmt0.format(max)}` : "");
      }),
      el("td", {}));

    houder.replaceChildren(el("table", {},
      el("thead", {}, el("tr", {},
        el("th", {}, "Uur"), el("th", {}, "Naam"), el("th", { class: "getal" }, "Hoeveelheid"),
        ...NUTRIENT_LABELS.map((l) => el("th", { class: "getal" }, l)), el("th", {}))),
      el("tbody", {}, ...rijen, totaal, doelen)));
  }

  /* --- sport van de dag ---
     Duur en snelheid bewerk je door erop te klikken (zelfde rijgedrag als
     de voedingstabel); het × verwijdert de activiteit. */
  const sportHouder = document.getElementById("dag-sport");
  sportHouder.replaceChildren(
    dag.sport.length
      ? el("table", {}, el("tbody", {}, ...dag.sport.map((s) =>
          sportRij(s, laadDag, "melding-sport", [{ tekst: s.type }]))))
      : el("p", { class: "subtitel" }, "Geen sport op deze dag."));

  /* --- gewichtmeting van de dag ---
     Klikken op de meting zet de cursor in het invoerveld eronder (de waarde
     staat er al in); opslaan overschrijft de meting van deze datum. */
  const gewichten = await api("/api/gewicht");
  const meting = gewichten.find((g) => g.datum === datum);
  const metingTekst = document.getElementById("dag-gewicht-huidig");
  metingTekst.classList.toggle("klik-bewerk", !!meting);
  metingTekst.title = meting ? "Klik om te bewerken" : "";
  metingTekst.onclick = meting ? () => {
    const veld = document.getElementById("gewicht-kg");
    veld.focus();
    veld.select();
  } : null;
  if (meting) {
    // ×-knop verwijdert de meting van deze dag. stopPropagation: anders zou
    // de klik ook de klik-bewerk-handler op de tekst zelf triggeren.
    const wisKnop = el("button", { class: "klein", title: "Verwijder meting" }, "×");
    wisKnop.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await verwijderMetUndo("gewicht", meting.id,
          `Meting van ${datumKort(datum)} verwijderd.`, laadDag);
        document.getElementById("gewicht-kg").value = "";
        laadDag();
      } catch (fout) { toonMelding("melding-gewicht", fout.message); }
    });
    metingTekst.replaceChildren(
      `Gemeten op ${datumKort(datum)}: ${fmt.format(meting.gewicht)} kg `, wisKnop);
    document.getElementById("gewicht-kg").value = meting.gewicht;
  } else {
    metingTekst.textContent = "Nog geen meting op deze dag.";
  }
}

// "Kopieer van gisteren": alle voeding van de dag vóór de getoonde dag
// overnemen (zelfde uren, namen en waarden) — voor dagen die op elkaar lijken.
document.getElementById("dag-kopieer").addEventListener("click", async () => {
  const naar = dagInvoer.value, van = plusDagen(naar, -1);
  try {
    const r = await post("/api/voedingslog/kopieer", { van, naar });
    if (r.aantal) {
      toonMelding("melding-voeding", `${r.aantal} regels overgenomen van ${datumKort(van)}.`, true);
      laadDag();
    } else {
      toonMelding("melding-voeding", `Niets gelogd op ${datumKort(van)}.`);
    }
  } catch (fout) { toonMelding("melding-voeding", fout.message); }
});

// Formulier: dagnotitie opslaan (lege tekst wist de notitie).
document.getElementById("form-notitie").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await put(`/api/dag/${dagInvoer.value}/notitie`,
      { tekst: document.getElementById("dag-notitie").value });
    toonMelding("melding-notitie", "Opgeslagen.", true);
  } catch (fout) { toonMelding("melding-notitie", fout.message); }
});

// Formulier: portie toevoegen uit de catalogus. De server rekent de
// voedingswaarden uit (catalogus × hoeveelheid).
document.getElementById("form-voeding").addEventListener("submit", async (e) => {
  e.preventDefault();
  const vm = vindVoedingsmiddel(document.getElementById("vm-zoek").value);
  if (!vm) { toonMelding("melding-voeding", "Kies een voedingsmiddel uit de lijst (of gebruik vrije invoer)."); return; }
  try {
    await post("/api/voedingslog", {
      datum: dagInvoer.value,
      voedingsmiddel_id: vm.id,
      hoeveelheid: document.getElementById("vm-hoeveelheid").value,
      uur: document.getElementById("vm-uur").value,
    });
    // Formulier leegmaken voor de volgende invoer.
    document.getElementById("vm-zoek").value = "";
    document.getElementById("vm-eenheid").textContent = "";
    document.getElementById("vm-hoeveelheid").value = 1;
    laadDag();
  } catch (fout) { toonMelding("melding-voeding", fout.message); }
});

// Formulier: vrije invoer voor eenmalige dingen (restaurant, feestje, ...)
// die niet in de catalogus thuishoren — je geeft zelf de waarden op.
document.getElementById("form-vrij").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const gegevens = {
      datum: dagInvoer.value,
      naam: document.getElementById("vrij-naam").value,
      hoeveelheid: document.getElementById("vrij-hoeveelheid").value,
      eenheid: document.getElementById("vrij-eenheid").value,
      uur: document.getElementById("vrij-uur").value,
    };
    for (const k of NUTRIENTEN) gegevens[k] = document.getElementById("vrij-" + k).value;
    await post("/api/voedingslog", gegevens);
    e.target.reset();
    laadDag();
  } catch (fout) { toonMelding("melding-voeding", fout.message); }
});

// Snelheid is alleen zinvol bij lopen: bij fietsen en krachttraining
// verdwijnt het veld. Kies je (opnieuw) lopen, dan staat het gebruikelijke
// tempo van 11,6 km/u alvast ingevuld.
document.getElementById("sport-type").addEventListener("change", (e) => {
  const isLopen = e.target.value === "lopen";
  document.getElementById("sport-snelheid-label").classList.toggle("verborgen", !isLopen);
  if (isLopen && !document.getElementById("sport-snelheid").value) {
    document.getElementById("sport-snelheid").value = 11.6;
  }
});

// Formulier: sport toevoegen (snelheid gaat alleen mee bij lopen).
document.getElementById("form-sport").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await post("/api/sport", {
      datum: dagInvoer.value,
      type: document.getElementById("sport-type").value,
      duur_minuten: document.getElementById("sport-duur").value,
      snelheid_kmh: document.getElementById("sport-type").value === "lopen"
        ? document.getElementById("sport-snelheid").value : "",
    });
    toonMelding("melding-sport", "Toegevoegd.", true);
    laadDag();
  } catch (fout) { toonMelding("melding-sport", fout.message); }
});

// Formulier: gewicht van deze dag opslaan (overschrijft een bestaande meting
// op dezelfde datum — handig om een tikfout te verbeteren).
document.getElementById("form-gewicht").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await post("/api/gewicht", {
      datum: dagInvoer.value,
      gewicht: document.getElementById("gewicht-kg").value,
    });
    toonMelding("melding-gewicht", "Opgeslagen.", true);
    laadDag();
  } catch (fout) { toonMelding("melding-gewicht", fout.message); }
});

/* ================= 6. Weekoverzicht ================= */

/* Weken lopen van vrijdag t/m donderdag, precies zoals in het rekenblad
   (vrijdag = weegdag). De weeknummers volgen ook het rekenblad:
   week 1 begon op vrijdag 2 januari 2026. */
const WEEK1_START = "2026-01-02";
let weekStart = weekStartVan(vandaag());   // vrijdag van de getoonde week

// De vrijdag op of vóór een gegeven datum.
function weekStartVan(iso) {
  const d = naarDatum(iso);
  const verschuiving = (d.getDay() - 5 + 7) % 7; // getDay(): 5 = vrijdag
  d.setDate(d.getDate() - verschuiving);
  return isoDatum(d);
}

document.getElementById("week-vorige").addEventListener("click", () => {
  weekStart = plusDagen(weekStart, -7); laadWeek();
});
document.getElementById("week-volgende").addEventListener("click", () => {
  weekStart = plusDagen(weekStart, 7); laadWeek();
});
document.getElementById("week-huidige").addEventListener("click", () => {
  weekStart = weekStartVan(vandaag()); laadWeek();
});

async function laadWeek() {
  const einde = plusDagen(weekStart, 6);

  // Weeknummer = aantal weken sinds week 1 van het rekenblad, plus 1.
  const nummer = Math.round(
    (naarDatum(weekStart).getTime() - naarDatum(WEEK1_START).getTime()) / (7 * DAG_MS)) + 1;
  document.getElementById("week-label").textContent =
    (nummer >= 1 ? `Week ${nummer}: ` : "") + `${datumKort(weekStart)} – ${datumKort(einde)}`;

  const [dagen, gewichten] = await Promise.all([
    api(`/api/dagen?van=${weekStart}&tot=${einde}`),
    api("/api/gewicht"),
  ]);
  const perDatum = Object.fromEntries(dagen.map((d) => [d.datum, d]));

  // NOVA-verdeling van een dag: per groep het percentage van de kcal,
  // als vier gekleurde getallen (groen 1 / geel 2 / oranje 3 / rood 4).
  function novaCel(novaKcal, totaalKcal) {
    if (!totaalKcal) return el("td", {});
    const spans = [];
    for (let groep = 1; groep <= 4; groep++) {
      const pct = ((novaKcal[String(groep)] || 0) / totaalKcal) * 100;
      if (spans.length) spans.push(el("span", { class: "gedempt" }, " / "));
      spans.push(el("span", { class: `nova${groep}` }, fmt0.format(pct)));
    }
    spans.push(el("span", { class: "gedempt" }, " %"));
    return el("td", { class: "getal" }, ...spans);
  }

  // Eén rij per dag (ook lege dagen tonen we, dan zie je meteen de gaten).
  const rijen = [];
  const som = Object.fromEntries(NUTRIENTEN.map((k) => [k, 0]));
  const novaSom = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let dagenMetEten = 0;   // gemiddelde berekenen we alleen over gevulde dagen
  for (let i = 0; i < 7; i++) {
    const datum = plusDagen(weekStart, i);
    const d = perDatum[datum];
    const naamDag = naarDatum(datum).toLocaleDateString("nl-BE", { weekday: "long" });
    // Vandaag is nog niet af: wel tonen, maar niet toetsen aan de
    // richtlijnen en niet meetellen in het weekgemiddelde.
    const isVandaag = datum === vandaag();
    if (d && d.kcal > 0 && !isVandaag) {
      dagenMetEten += 1;
      NUTRIENTEN.forEach((k) => { som[k] += d[k]; });
      for (let groep = 1; groep <= 4; groep++) novaSom[groep] += d.nova_kcal[String(groep)] || 0;
    }
    // Alleen afgeronde dagen waarop echt gegeten is toetsen we aan de
    // richtlijnen; een lege, halve of sport-only dag zou anders vals kleuren.
    // Klikken op een dagrij opent het dagboek van die dag.
    rijen.push(el("tr", {
      class: "klikbaar",
      title: "Open in dagboek",
      onclick: () => {
        dagInvoer.value = datum;
        activeerTab("dagboek");
        location.hash = `dagboek/${datum}`;   // bookmarkbare link naar de dag
      },
    },
      el("td", {}, naamDag.charAt(0).toUpperCase() + naamDag.slice(1),
        isVandaag ? el("span", { class: "gedempt" }, " · vandaag") : ""),
      el("td", { class: "gedempt" }, datumKort(datum)),
      ...NUTRIENTEN.map((k) =>
        d && d.kcal > 0 && !isVandaag ? nutrientCel(k, d[k], fmt0, false)
                        : el("td", { class: "getal gedempt" }, d ? fmt0.format(d[k]) : "")),
      d && d.kcal > 0 ? novaCel(d.nova_kcal, d.kcal) : el("td", {}),
      el("td", {}, d ? d.sport.map(sportTekst).join(" · ") : "")));
  }

  // Onderaan: gemiddelde per dag, vers berekend uit de logregels, plus de
  // NOVA-verdeling over de hele week.
  const weekKcal = som.kcal;
  const gemiddelde = el("tr", { class: "totaalrij" },
    el("td", {}, "Gemiddelde per dag"), el("td", {}),
    // Alleen de kcal in deze rij krijgt de onderrapportage-correctie;
    // de dagrijen erboven en de andere nutriënten blijven ruwe logwaarden.
    ...NUTRIENTEN.map((k) =>
      dagenMetEten ? nutrientCel(k, (k === "kcal" ? metOnderrapportage(som[k]) : som[k]) / dagenMetEten, fmt0, false)
                   : el("td", { class: "getal" }, "")),
    dagenMetEten ? novaCel({ 1: novaSom[1], 2: novaSom[2], 3: novaSom[3], 4: novaSom[4] }, weekKcal)
                 : el("td", {}),
    el("td", {}));

  document.getElementById("week-tabel").replaceChildren(el("table", {},
    el("thead", {}, el("tr", {},
      el("th", {}, "Dag"), el("th", {}, "Datum"),
      ...NUTRIENT_LABELS.map((l) => el("th", { class: "getal" }, l)),
      el("th", { class: "getal" },
        el("span", { class: "nova1" }, "NOVA 1"), " / ",
        el("span", { class: "nova2" }, "2"), " / ",
        el("span", { class: "nova3" }, "3"), " / ",
        el("span", { class: "nova4" }, "4")),
      el("th", {}, "Sport"))),
    el("tbody", {}, ...rijen, gemiddelde)));

  // Onder de tabel: hoeveel kg er die week bij- of afgekomen is. Er wordt op
  // vrijdagochtend gewogen, dus het verschil van deze week (vr t/m do) is de
  // weging van de vrijdag erná min die van de eigen vrijdag. Alleen tonen
  // als beide wegingen bestaan — voor de lopende week is de eindweging er
  // nog niet, dus die blijft vanzelf leeg.
  const gewichtOp = Object.fromEntries(gewichten.map((g) => [g.datum, g.gewicht]));
  const begin = gewichtOp[weekStart], eind = gewichtOp[plusDagen(weekStart, 7)];
  const houder = document.getElementById("week-gewicht");
  houder.replaceChildren();
  if (begin != null && eind != null) {
    const verschil = eind - begin;
    const pond = verschil * 2.20462;
    const teken = verschil > 0 ? "+" : "";
    const woord = verschil < 0 ? "afgevallen" : verschil > 0 ? "bijgekomen" : "gelijk gebleven";
    houder.append(
      el("span", { class: "label" }, "Gewicht deze week: "),
      el("span", { class: "waarde " + (verschil <= 0 ? "goed" : "slecht") },
        `${teken}${fmt.format(verschil)} kg ${woord}`),
      el("span", { class: "pond" }, ` (${teken}${fmt.format(pond)} lb - pond)`));
  }
}

/* ================= 7. Voedingsmiddelen (catalogus) ================= */

document.getElementById("cat-zoek").addEventListener("input", laadCatalogus);

// Toon de catalogus als tabel, gefilterd op de zoektekst.
async function laadCatalogus() {
  catalogus = await api("/api/voedingsmiddelen");
  // De zoeklijst in het dagboek ook verversen (nieuwe items direct bruikbaar).
  vulVoedingslijst();

  const zoek = document.getElementById("cat-zoek").value.trim().toLowerCase();
  const lijst = zoek ? catalogus.filter((vm) => vm.naam.includes(zoek)) : catalogus;
  document.getElementById("cat-aantal").textContent =
    `${lijst.length} van ${catalogus.length} voedingsmiddelen`;

  document.getElementById("cat-tabel").replaceChildren(el("table", {},
    el("thead", {}, el("tr", {},
      el("th", {}, "Naam"), el("th", {}, "Eenheid"), el("th", {}, "NOVA"),
      // twee lege koppen voor de knoppenkolommen (Bewerken / Verwijder)
      ...NUTRIENT_LABELS.map((l) => el("th", { class: "getal" }, l)),
      el("th", {}), el("th", {}))),
    el("tbody", {}, ...lijst.map((vm) => {
      // De naam en het NOVA-cijfer kleuren volgens de groep (groen = 1
      // onbewerkt ... rood = 4 ultrabewerkt). Klikken op de naam klapt de
      // loggeschiedenis van het item uit.
      const naamCel = el("td", {
        class: (vm.nova ? `nova${vm.nova} ` : "") + "klik-bewerk",
        title: "Klik voor de loggeschiedenis",
      }, vm.naam);
      const rij = el("tr", {},
        naamCel,
        el("td", { class: "gedempt" }, vm.eenheid === "stuk" ? "per stuk" : "per 100 g"),
        el("td", { class: vm.nova ? `nova${vm.nova}` : "gedempt" }, vm.nova ? String(vm.nova) : "?"),
        ...NUTRIENTEN.map((k) => el("td", { class: "getal" }, fmt.format(vm[k]))),
        el("td", {}, el("button", {
          class: "klein", onclick: () => bewerkVoedingsmiddel(vm),
        }, "Bewerken")),
        // Verwijderen vraagt eerst bevestiging; eerder gelogde porties blijven
        // gewoon bestaan (die dragen hun eigen naam en waarden).
        el("td", {}, el("button", {
          class: "klein",
          onclick: async () => {
            if (!confirm(`'${vm.naam}' verwijderen uit de catalogus?\nAl gelogde porties blijven bewaard.`)) return;
            try {
              await api(`/api/voedingsmiddelen/${vm.id}`, { method: "DELETE" });
              toonMelding("melding-catalogus", `'${vm.naam}' verwijderd.`, true);
              laadCatalogus();
            } catch (fout) { toonMelding("melding-catalogus", fout.message); }
          },
        }, "Verwijder")));
      naamCel.addEventListener("click", () => toonHistoriek(vm, rij));
      return rij;
    }))));
}

// "250 g" of "2×", afhankelijk van de eenheid van een logregel.
function hoeveelheidTekst(hoeveelheid, eenheid) {
  return eenheid === "stuks" || eenheid === "stuk"
    ? `${fmt.format(hoeveelheid)}×` : `${fmt.format(hoeveelheid)} g`;
}

// Klik op een naam in de catalogus: klapt onder die rij de loggeschiedenis
// van het item uit (hoe vaak, wanneer laatst, gemiddelde portie, aandeel in
// alle gelogde kcal en de laatste keren). Nogmaals klikken klapt weer dicht.
async function toonHistoriek(vm, rij) {
  const volgende = rij.nextElementSibling;
  const wasOpen = volgende && volgende.classList.contains("historiekrij");
  document.querySelectorAll("tr.historiekrij").forEach((r) => r.remove());
  if (wasOpen) return;
  try {
    const h = await api(`/api/voedingsmiddelen/${vm.id}/historiek`);
    const inhoud = el("div", {});
    if (!h.keer) {
      inhoud.append(el("span", { class: "gedempt" }, "Nog nooit gelogd."));
    } else {
      inhoud.append(el("div", {},
        el("strong", {}, `${fmt0.format(h.keer)}× gelogd`),
        ` · laatst op ${h.laatste} · gemiddeld ${hoeveelheidTekst(h.gem_hoeveelheid, vm.eenheid)}` +
        ` per keer · ${fmt0.format(h.totaal_kcal)} kcal in totaal (${fmt.format(h.pct_kcal)}% van alles)`));
      inhoud.append(el("div", { class: "gedempt" }, "Laatste keren: " +
        h.regels.map((r) => `${r.datum} ${hoeveelheidTekst(r.hoeveelheid, r.eenheid)}`).join(" · ")));
    }
    // 11 kolommen: naam, eenheid, NOVA, zes waarden en twee knoppencellen.
    rij.after(el("tr", { class: "historiekrij" }, el("td", { colspan: "11" }, inhoud)));
  } catch (fout) { toonMelding("melding-catalogus", fout.message); }
}

// "Bewerken" zet het formulier bovenaan in bewerkmodus: naam en eenheid
// liggen vast (grijs), alleen de voedingswaarden kun je aanpassen.
function bewerkVoedingsmiddel(vm) {
  document.getElementById("cat-titel").textContent = `Bewerken: ${vm.naam}`;
  document.getElementById("cat-id").value = vm.id;
  document.getElementById("cat-naam").value = vm.naam;
  document.getElementById("cat-naam").disabled = true;
  document.getElementById("cat-eenheid").value = vm.eenheid;
  document.getElementById("cat-eenheid").disabled = true;
  document.getElementById("cat-nova").value = vm.nova || "";
  for (const k of NUTRIENTEN) document.getElementById("cat-" + k).value = vm[k];
  document.getElementById("cat-opslaan").textContent = "Opslaan";
  document.getElementById("cat-annuleer").classList.remove("verborgen");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Terug naar "nieuw toevoegen"-modus.
function resetCatalogusForm() {
  document.getElementById("cat-titel").textContent = "Nieuw voedingsmiddel";
  document.getElementById("cat-id").value = "";
  document.getElementById("cat-naam").disabled = false;
  document.getElementById("cat-eenheid").disabled = false;
  document.getElementById("form-catalogus").reset();
  document.getElementById("cat-opslaan").textContent = "Toevoegen";
  document.getElementById("cat-annuleer").classList.add("verborgen");
}

document.getElementById("cat-annuleer").addEventListener("click", resetCatalogusForm);

// Eén formulier voor twee dingen: zonder id = nieuw item (POST), met id =
// bestaand item bijwerken (PUT).
document.getElementById("form-catalogus").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("cat-id").value;
  const gegevens = {
    naam: document.getElementById("cat-naam").value,
    eenheid: document.getElementById("cat-eenheid").value,
    nova: document.getElementById("cat-nova").value,
  };
  for (const k of NUTRIENTEN) gegevens[k] = document.getElementById("cat-" + k).value;
  try {
    if (id) {
      await put(`/api/voedingsmiddelen/${id}`, gegevens);
      toonMelding("melding-catalogus", "Opgeslagen.", true);
    } else {
      await post("/api/voedingsmiddelen", gegevens);
      toonMelding("melding-catalogus", "Toegevoegd.", true);
    }
    resetCatalogusForm();
    laadCatalogus();
  } catch (fout) { toonMelding("melding-catalogus", fout.message); }
});

/* ================= 8. Gegevens ================= */

/* Rechtstreeks bewerken van de databank: alle gewichtmetingen en alle
   sportactiviteiten, nieuwste bovenaan. Waarden bewerk je door erop te
   klikken (zelfde rijgedrag als in het dagboek); de formulieren bovenaan
   voegen nieuwe rijen toe. Voeding bewerk je in het dagboek. */

async function laadGegevens() {
  // Datumvelden van de invoerformulieren standaard op vandaag.
  for (const id of ["geg-gewicht-datum", "geg-sport-datum"]) {
    const veld = document.getElementById(id);
    if (!veld.value) veld.value = vandaag();
  }

  const [gewichten, sport] = await Promise.all([api("/api/gewicht"), api("/api/sport")]);

  /* --- gewichtmetingen (nieuwste eerst; de API sorteert oplopend) --- */
  document.getElementById("geg-gewicht-tabel").replaceChildren(el("table", {},
    el("thead", {}, el("tr", {},
      el("th", {}, "Datum"), el("th", { class: "getal" }, "Gewicht"), el("th", {}))),
    el("tbody", {}, ...[...gewichten].reverse().map((g) => bewerkbareRij({
      cellen: [
        { naam: "datum", tekst: g.datum, klasse: "gedempt",
          maak: () => el("input", { value: g.datum, placeholder: "yyyy-mm-dd",
                                    pattern: "\\d{4}-\\d{2}-\\d{2}", style: "width:110px" }) },
        { naam: "gewicht", tekst: `${fmt.format(g.gewicht)} kg`, klasse: "getal", nadien: " kg",
          maak: () => el("input", { type: "number", step: "0.1", min: 1, value: g.gewicht, style: "width:80px" }) },
      ],
      opslaan: (invoer) => put(`/api/gewicht/${g.id}`, {
        datum: invoer.datum.value, gewicht: invoer.gewicht.value,
      }),
      verwijder: () => verwijderMetUndo("gewicht", g.id,
        `Meting van ${g.datum} verwijderd.`, laadGegevens),
      herlaad: laadGegevens,
      melding: "melding-geg-gewicht",
    })))));

  /* --- sportactiviteiten --- */
  document.getElementById("geg-sport-tabel").replaceChildren(el("table", {},
    el("thead", {}, el("tr", {},
      el("th", {}, "Datum"), el("th", {}, "Type"),
      el("th", { class: "getal" }, "Duur"), el("th", { class: "getal" }, "Snelheid"), el("th", {}))),
    el("tbody", {}, ...sport.map((s) => sportRij(s, laadGegevens, "melding-geg-sport", [
      { naam: "datum", tekst: s.datum, klasse: "gedempt",
        maak: () => el("input", { value: s.datum, placeholder: "yyyy-mm-dd",
                                  pattern: "\\d{4}-\\d{2}-\\d{2}", style: "width:110px" }) },
      { tekst: s.type },
    ])))));
}

// Eén bewerkbare sportrij (duur + snelheid); gedeeld tussen het
// Gegevens-tabblad en het dagboek. 'voorCellen' bepaalt wat er vóór de
// duur- en snelheidscel staat: hier een bewerkbare datum + het type, in
// het dagboek alleen het type (daar ligt de dag al vast).
function sportRij(s, herlaad, melding, voorCellen) {
  return bewerkbareRij({
    cellen: [
      ...voorCellen,
      { naam: "duur", tekst: `${fmt0.format(s.duur_minuten)} min`, klasse: "getal", nadien: " min",
        maak: () => el("input", { type: "number", min: 1, step: 1, value: s.duur_minuten, style: "width:70px" }) },
      { naam: "snelheid", tekst: s.snelheid_kmh ? `${fmt.format(s.snelheid_kmh)} km/u` : "–", klasse: "getal", nadien: " km/u",
        maak: () => el("input", { type: "number", min: 0.1, step: "any", value: s.snelheid_kmh ?? "", style: "width:80px" }) },
    ],
    // Zonder datumcel (dagboek) blijft de datum staan; de API laat 'm dan weg.
    opslaan: (invoer) => put(`/api/sport/${s.id}`, {
      datum: invoer.datum ? invoer.datum.value : "",
      duur_minuten: invoer.duur.value, snelheid_kmh: invoer.snelheid.value,
    }),
    verwijder: () => verwijderMetUndo("sport", s.id,
      `${sportTekst(s)} (${s.datum}) verwijderd.`, herlaad),
    herlaad, melding,
  });
}

// Formulier: gewichtmeting toevoegen (of overschrijven op dezelfde datum).
document.getElementById("form-geg-gewicht").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await post("/api/gewicht", {
      datum: document.getElementById("geg-gewicht-datum").value,
      gewicht: document.getElementById("geg-gewicht-kg").value,
    });
    document.getElementById("geg-gewicht-kg").value = "";
    toonMelding("melding-geg-gewicht", "Opgeslagen.", true);
    laadGegevens();
  } catch (fout) { toonMelding("melding-geg-gewicht", fout.message); }
});

// Formulier: sportactiviteit toevoegen (snelheid is optioneel).
document.getElementById("form-geg-sport").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await post("/api/sport", {
      datum: document.getElementById("geg-sport-datum").value,
      type: document.getElementById("geg-sport-type").value,
      duur_minuten: document.getElementById("geg-sport-duur").value,
      snelheid_kmh: document.getElementById("geg-sport-snelheid").value,
    });
    toonMelding("melding-geg-sport", "Toegevoegd.", true);
    laadGegevens();
  } catch (fout) { toonMelding("melding-geg-sport", fout.message); }
});

/* ================= 9. Instellingen ================= */

/* Het Instellingen-tabblad toont alle configuratie uit de tabel
   'instellingen' (vroeger het blok naast de gewichten in het rekenblad) en
   laat ze ook bewerken. De *_min/*_max-richtlijnen sturen de kleurcodering
   in het dagboek en het weekoverzicht. */

// Algemene instellingen: [sleutel, label, uitleg]
const INSTELLING_ALGEMEEN = [
  ["lengte_m", "Lengte (m)", "voor de BMI-berekening"],
  ["doelgewicht_kg", "Doelgewicht (kg)", "de stippellijn in de gewichtsgrafiek"],
  ["onderrapportage_pct", "Onderrapportage (%)", "geschat percentage kcal dat je onbewust te weinig logt"],
  ["kcal_per_kg", "Kcal in 1 kg lichaamsgewicht", ""],
];

// Labels voor de min/max-richtlijnen, in de vaste nutriëntvolgorde.
const RICHTLIJN_LABELS = {
  kcal: "kcal", vet: "Vet (g)", koolhydraten: "Koolhydraten (g)",
  eiwit: "Eiwit (g)", zout: "Zout (g)", vezels: "Vezels (g)",
};

/* --- kleurinstellingen --------------------------------------------------
   Elke rij koppelt een instellingensleutel aan de CSS-variabelen die die
   rol in de hele app kleuren: [sleutel, [css-variabelen], label, uitleg].
   Sommige rollen hebben twee varianten (tekst + grafiek); één keuze
   overschrijft ze allebei. Niet ingesteld = de standaardkleur uit
   stijl.css. */
const KLEUR_INSTELLINGEN = [
  ["kleur_pagina", ["--pagina"], "Achtergrond", "de pagina achter alles"],
  ["kleur_oppervlak", ["--oppervlak"], "Kaarten", "kaarten en grafiekoppervlak"],
  ["kleur_knoppen", ["--accent"], "Knoppen", "de actieknoppen (Toevoegen, Opslaan, ...)"],
  ["kleur_goed", ["--goed", "--grafiek-goed"], "Goed / binnen richtlijn", "groen: binnen de richtlijn, gewicht eraf"],
  ["kleur_boven_max", ["--boven-max", "--grafiek-boven"], "Boven maximum", "waarden boven de richtlijn (↑)"],
  ["kleur_onder_min", ["--onder-min", "--grafiek-onder"], "Onder minimum", "waarden onder de richtlijn (↓)"],
  ["kleur_slecht", ["--slecht"], "Slecht", "rood: gewicht erbij, te weinig sport"],
  ["kleur_nova1", ["--nova1"], "NOVA 1", "onbewerkt of minimaal bewerkt"],
  ["kleur_nova2", ["--nova2"], "NOVA 2", "bewerkt culinair ingrediënt"],
  ["kleur_nova3", ["--nova3"], "NOVA 3", "bewerkt"],
  ["kleur_nova4", ["--nova4"], "NOVA 4", "ultrabewerkt"],
  ["kleur_sport_lopen", ["--sport-lopen"], "Sport: lopen", ""],
  ["kleur_sport_fietsen", ["--sport-fietsen"], "Sport: fietsen", ""],
  ["kleur_sport_krachttraining", ["--sport-krachttraining"], "Sport: krachttraining", ""],
  ["kleur_sport_zwemmen", ["--sport-zwemmen"], "Sport: zwemmen", ""],
  ["kleur_sport_overig", ["--sport-overig"], "Sport: overig", "onherkende oude invoer"],
];

// De standaardkleuren uit stijl.css, vastgelegd bij het laden (vóór er
// overrides gezet zijn) — voor de kleurkiezers en de terugzetknop. Bij
// rollen met twee varianten toont de kiezer de eerste (de tekstkleur).
const STANDAARD_KLEUREN = (() => {
  const stijl = getComputedStyle(document.documentElement);
  return Object.fromEntries(KLEUR_INSTELLINGEN.map(
    ([sleutel, cssVars]) => [sleutel, stijl.getPropertyValue(cssVars[0]).trim()]));
})();

// Zet de gekozen kleuren uit de instellingen als CSS-variabelen op :root;
// alles wat via die variabelen kleurt (knoppen, grafieken, NOVA, ...) volgt
// dan vanzelf. Niet-ingestelde sleutels vallen terug op stijl.css.
function pasKleurenToe() {
  for (const [sleutel, cssVars] of KLEUR_INSTELLINGEN) {
    for (const cssVar of cssVars) {
      if (instellingen[sleutel]) {
        document.documentElement.style.setProperty(cssVar, instellingen[sleutel]);
      } else {
        document.documentElement.style.removeProperty(cssVar);
      }
    }
  }
}

// Bouw het formulier op met de huidige waarden uit 'instellingen'.
function laadInstellingen() {
  // Kaart 1: algemene waarden, één rij per instelling.
  document.getElementById("inst-algemeen").replaceChildren(
    ...INSTELLING_ALGEMEEN.map(([sleutel, label, uitleg]) =>
      el("div", { class: "inst-rij" },
        el("label", { for: "inst-" + sleutel }, label),
        el("input", {
          type: "number", step: "any", id: "inst-" + sleutel,
          value: instellingen[sleutel] ?? "",
        }),
        el("span", { class: "hint" }, uitleg))));

  // Kaart 2: tabel met per voedingswaarde een min- en max-invoerveld.
  document.getElementById("inst-richtlijnen").replaceChildren(el("table", {},
    el("thead", {}, el("tr", {},
      el("th", {}, ""), el("th", {}, "Minimum"), el("th", {}, "Maximum"))),
    el("tbody", {}, ...NUTRIENTEN.map((k) => el("tr", {},
      el("td", {}, RICHTLIJN_LABELS[k]),
      el("td", {}, el("input", {
        type: "number", step: "any", id: `inst-${k}_min`,
        value: instellingen[`${k}_min`] ?? "",
      })),
      el("td", {}, el("input", {
        type: "number", step: "any", id: `inst-${k}_max`,
        value: instellingen[`${k}_max`] ?? "",
      })))))));

  // Kaart 3: één kleurkiezer per rol, vooringevuld met de bewaarde keuze of
  // anders de standaardkleur uit stijl.css.
  document.getElementById("inst-kleuren").replaceChildren(
    ...KLEUR_INSTELLINGEN.map(([sleutel, , label, uitleg]) =>
      el("div", { class: "inst-rij" },
        el("label", { for: "inst-" + sleutel }, label),
        el("input", {
          type: "color", id: "inst-" + sleutel,
          value: instellingen[sleutel] || STANDAARD_KLEUREN[sleutel],
        }),
        el("span", { class: "hint" }, uitleg))));
}

// "Standaardkleuren terugzetten" zet alleen de kiezers terug op de waarden
// uit stijl.css; pas na Opslaan is de keuze ook echt bewaard.
document.getElementById("inst-kleuren-standaard").addEventListener("click", () => {
  for (const [sleutel] of KLEUR_INSTELLINGEN) {
    const veld = document.getElementById("inst-" + sleutel);
    if (veld) veld.value = STANDAARD_KLEUREN[sleutel];
  }
});

// Opslaan: alle velden verzamelen en in één keer naar de server sturen.
// De server geeft de nieuwe set terug; daarmee verversen we de globale
// 'instellingen', zodat dagboek/weekoverzicht meteen de nieuwe kleuren tonen.
document.getElementById("form-instellingen").addEventListener("submit", async (e) => {
  e.preventDefault();
  const gegevens = {};
  const sleutels = [
    ...INSTELLING_ALGEMEEN.map(([s]) => s),
    ...NUTRIENTEN.flatMap((k) => [`${k}_min`, `${k}_max`]),
    ...KLEUR_INSTELLINGEN.map(([s]) => s),
  ];
  for (const sleutel of sleutels) {
    const veld = document.getElementById("inst-" + sleutel);
    if (veld && veld.value !== "") gegevens[sleutel] = veld.value;
  }
  try {
    instellingen = await put("/api/instellingen", gegevens);
    pasKleurenToe();   // gekozen kleuren meteen zichtbaar maken
    toonMelding("melding-instellingen", "Opgeslagen.", true);
  } catch (fout) { toonMelding("melding-instellingen", fout.message); }
});

/* ================= 10. Opstarten ================= */

// Grafieken passen zich aan de vensterbreedte aan: bij het verkleinen of
// vergroten van het venster tekenen we het dashboard opnieuw (met een kleine
// vertraging zodat dit niet bij elke pixel gebeurt). Alleen bij een échte
// breedteverandering: op een telefoon verandert de hoogte ook zodra het
// toetsenbord opent, en dan hoeft er niets hertekend te worden.
let hertekenTimer;
let hertekenBreedte = window.innerWidth;
window.addEventListener("resize", () => {
  if (window.innerWidth === hertekenBreedte) return;
  hertekenBreedte = window.innerWidth;
  clearTimeout(hertekenTimer);
  hertekenTimer = setTimeout(() => {
    if (document.getElementById("paneel-dashboard").classList.contains("actief")) laadDashboard();
  }, 200);
});

(async function start() {
  // Instellingen en catalogus eerst: die heeft bijna elk scherm nodig.
  instellingen = await api("/api/instellingen");
  pasKleurenToe();   // bewaarde kleurkeuzes als CSS-variabelen zetten
  await zorgCatalogus();

  // ?dagen=30 in de URL kiest de periode vooraf (0 = alles, jaar = sinds 1 januari).
  const dagenParam = new URLSearchParams(location.search).get("dagen");
  if (dagenParam === "jaar" || (dagenParam !== null && !Number.isNaN(Number(dagenParam)))) {
    filterDagen = dagenParam === "jaar" ? "jaar" : Number(dagenParam);
    document.querySelectorAll("#bereikfilters button").forEach((b) =>
      b.classList.toggle("actief", b.dataset.dagen === dagenParam));
  }

  // De URL-hash bepaalt het starttabblad, bv. /#week of /#dagboek/2026-07-03
  // (dagboek kan met een datum, zodat je een specifieke dag kunt bookmarken).
  const [tab, datum] = location.hash.slice(1).split("/");
  if (tab === "dagboek" && datum && /^\d{4}-\d{2}-\d{2}$/.test(datum)) dagInvoer.value = datum;
  activeerTab(["dagboek", "week", "voedingsmiddelen", "gegevens", "instellingen"].includes(tab) ? tab : "dashboard");
})();
