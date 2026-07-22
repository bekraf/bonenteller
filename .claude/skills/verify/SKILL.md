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
- Dashboard telt t/m gisteren; gewichtmeting van vandaag telt wél mee.
