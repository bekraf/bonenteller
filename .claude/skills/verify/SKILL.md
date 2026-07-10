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
- Selenium + chromedriver werkt hier niet (kan service niet spawnen); direct
  chromium of CDP wel.
- Snelle screenshot zonder interactie:
  ```bash
  chromium --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
    --window-size=1400,1600 --virtual-time-budget=4000 \
    --screenshot=uit.png "http://127.0.0.1:8377/?dagen=30"
  ```
- Klikken/JS nodig? Start chromium met `--remote-debugging-port=9222
  --remote-allow-origins=* --user-data-dir=<scratchpad>/profiel` en praat CDP
  via `websocket-client` (pip). Werkend voorbeeldscript: zie eerdere sessie
  (Runtime.evaluate voor klikken + uitlezen, Page.captureScreenshot).

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
  voedingslog, sportactiviteiten, voedingsmiddelen, instellingen.
- Dashboard telt t/m gisteren; gewichtmeting van vandaag telt wél mee.
