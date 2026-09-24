---
name: verify
description: Bouw-/start-/testrecept voor het gezondheidsdashboard (Python stdlib server + vanilla JS frontend)
---

# Gezondheidsdashboard verifiëren

## Starten
```bash
python app.py 8377   # serveert static/ + API; leest gezondheid.db naast app.py
```
Geen dependencies, geen build. Frontend = `static/app.js` + `static/index.html`.

## Browser aansturen (headless)
- `localhost` resolvet NIET in de sandbox — gebruik overal `127.0.0.1`.
- Chromium, chromedriver, geckodriver en pip zijn er NIET (meer); alleen
  Firefox. Aansturen kan met stdlib-Python via Marionette (TCP+JSON op poort
  2828): werkende client staat hiernaast in `marionette.py` (importeer de
  klasse, of draai `python3 marionette.py <url> "<js met return>"`).
- Starten (profielmap MOET vooraf bestaan, anders start Firefox stil zonder
  Marionette-listener):
  ```bash
  mkdir -p <scratchpad>/ffprofiel
  MOZ_HEADLESS=1 firefox --headless --no-remote --marionette \
    --profile <scratchpad>/ffprofiel about:blank &
  # wachten tot `ss -tln | grep 2828` raak is, dan verbinden
  ```
- Protocol: pakketten `<lengte>:<json>`; commando `[0, msgid, naam, params]`,
  antwoord `[1, msgid, fout, resultaat]`. Nuttige commando's:
  `WebDriver:NewSession`, `WebDriver:Navigate`, `WebDriver:ExecuteScript`
  (script met `return ...`), `Marionette:Quit` (sluit Firefox echt af —
  daarna opnieuw starten voor een volgende run).
- Screenshot zonder interactie kan ook: `firefox --headless
  --window-size=1400,1600 --screenshot uit.png "http://127.0.0.1:8377/"`.

## Muteren? Test op een kopie
`gezondheid.db` is de echte data van de gebruiker. Voor tests die schrijven:
kopieer `app.py`, `static/` en `gezondheid.db` naar de scratchpad en start de
server dáár (bv. poort 8378). Let op: `pkill -f "python app.py ..."` in
hetzelfde Bash-commando als de start matcht zijn eigen commandoregel en doodt
de shell (exit 144) — gebruik `app[.]py` en aparte aanroepen.

## Handige ingangen
- `?dagen=7|14|30|90|jaar|0` kiest de dashboardperiode vooraf (0 = alles).
- `#dagboek/2026-07-03` opent het dagboek op een datum.
- Data checken: `sqlite3 gezondheid.db` — tabellen: gewichtmetingen,
  voedingslog, sportactiviteiten, voedingsmiddelen, instellingen, dagnotities
  (die laatste maakt app.py bij het opstarten aan als ze ontbreekt).
- Dashboardgrafieken lopen t/m vandaag (staaf van vandaag halfdoorzichtig,
  zweeftekst "dag loopt nog"); de tegels en de weekgemiddeldelijnen rekenen
  t/m gisteren. Gewichtmeting van vandaag telt wél mee.

## Publieke site (alleen het dashboard) testen
```bash
python3 bouw_publiek.py uit && python3 -m http.server -d uit 8392 --bind 127.0.0.1
```
Test ze bij voorkeur ónder een submap (GitHub Pages serveert op `/bonenteller/`):
kopieer `uit/` naar `<scratchpad>/serveer/bonenteller/` en serveer `serveer/`.
Zo vang je paden die nog met `/` beginnen.

De build faalt zelf al als er andere bestanden dan de twaalf verwachte in `uit/`
staan. In de browser (Marionette, zie hierboven) nakijken:
- **Zelfde dashboard als thuis**: vergelijk per periode (`?dagen=7|14|30|90|jaar|0`)
  de innerHTML van `#tegels`, `#grafiek-gewicht`, `#grafiek-kcal`,
  `#grafiek-sport` en de legendes, en de tekst van `#zweefinfo` na een
  `pointermove` op elk `rect[fill="transparent"]`, met een referentiebuild.
  Verschillen wijzen meestal op een veld dat `bouw_publiek.py` wegsnoeit
  maar het dashboard nu wél leest.
- **Niets anders bereikbaar**: alleen `#tabs button[data-paneel=dashboard]` en
  alleen `#paneel-dashboard` bestaan; `#dagboek`, `#instellingen`, … in de URL
  blijven op het dashboard met een lege hash; een klik op een kcal-staaf doet
  niets; `activeerTab("dagboek")` in de console verandert niets.
- **API**: elke `/api/`-aanvraag buiten `ROUTES` in `publiek/leesmodus.js` en
  elke POST/PUT/DELETE geeft `403`; `data/dag/…`, `data/gezondheid.db` e.d.
  geven `404`.
- **Geen dagboekdata**: geen enkele voedingsnaam uit `voedingslog` in
  `document.documentElement.textContent` (dus ook niet in verborgen delen),
  ook niet na het aanroepen van `laadDag()`, `laadWeek()`, … in de console.
- **Gewicht**: `/api/gewicht` geeft alleen vrijdagen + de meting van vandaag;
  zet je in `data/gewicht.json` bij `vandaag` een datum van gisteren, dan
  verdwijnt die uit de grafiek.

Let op: `location.hash` aanpassen herlaadt de pagina niet — navigeer met een
volledige URL (met een wisselende `?t=`) om het opstarten te testen.
