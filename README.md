# Gezondheidsdashboard

Een klein webdashboard om thuis gewicht, voeding en sport bij te houden. Je logt
per dag wat je eet en sport, en het dashboard tekent grafieken van je gewicht,
je calorieën en je beweging. Alles draait lokaal op de Python-standaard­biblio­theek —
geen frameworks, geen pakketten, geen buildstap.

De data komt oorspronkelijk uit een rekenblad (`2026.ods`) en zit nu in een
SQLite-bestand (`gezondheid.db`).

> **Let op:** dit is een proof of concept voor thuisgebruik. De server bindt op
> `0.0.0.0` (iedereen op je LAN kan erbij) en er is **bewust geen login of
> beveiliging**. Zet dit niet zomaar op het open internet.

## Vereisten

- Python 3 (getest met de standaardbibliotheek; niets te installeren)
- Een moderne browser

## Starten

```bash
python3 app.py            # draait op http://0.0.0.0:8000
python3 app.py 9000       # of kies zelf een poort
```

Open daarna `http://localhost:8000` (of het IP van deze machine vanaf een ander
apparaat op je netwerk). `gezondheid.db` moet naast `app.py` staan.

## Wat je ermee doet

Het dashboard heeft vijf tabbladen:

- **Dashboard** — grafieken van gewicht (met doellijn en BMI-zones), calorieën
  per dag en sport per dag, met periodefilters (7/14/30/90/180 dagen of alles).
  Hover over de gewichtsgrafiek toont gewicht, datum en BMI van die dag, plus —
  als er in `afbeeldingen/` een weegschaalfoto van die datum staat — de foto zelf.
- **Dagboek** — per dag porties eten loggen (uit de catalogus óf vrije invoer),
  sportactiviteiten toevoegen en je gewicht opslaan.
- **Weekoverzicht** — een weektabel met dagtotalen, gekleurd wanneer een waarde
  boven het maximum of onder het minimum van je richtlijn valt.
- **Voedingsmiddelen** — je eigen catalogus beheren: voedingswaarden per stuk of
  per 100 g, plus de NOVA-bewerkingsgraad (1 onbewerkt … 4 ultrabewerkt).
- **Instellingen** — lengte, doelgewicht, dagelijkse richtlijnen (kcal en macro's)
  en alle kleuren van de interface.

De zes voedingswaarden staan overal in dezelfde volgorde: **kcal, vet,
koolhydraten, eiwit, zout, vezels**.

## Structuur

```
app.py            # webserver + JSON-API (http.server + sqlite3)
gezondheid.db     # SQLite-database met alle data
afbeeldingen/     # weegschaalfoto's (IMG_JJJJMMDD_….jpg); de map zit in git,
                  # de foto's zelf niet (zie afbeeldingen/.gitignore)
static/
  index.html      # de enige pagina (vijf tabbladen)
  app.js          # frontend-logica en grafieken (vanilla JS)
  stijl.css       # opmaak
```

`app.py` bevat, van boven naar beneden: hulpfuncties en invoervalidatie, de
API-functies (één per endpoint), en de HTTP-handler die URL's naar die functies
routeert.

## Database

SQLite met vijf tabellen:

| Tabel | Inhoud |
|-------|--------|
| `instellingen` | sleutel/waarde: richtlijnen (kcal-/macrogrenzen) en kleuren |
| `gewichtmetingen` | één gewicht per datum |
| `voedingsmiddelen` | de catalogus (naam, eenheid, NOVA, voedingswaarden) |
| `voedingslog` | gelogde porties per dag; elke regel bewaart zijn eigen waarden |
| `sportactiviteiten` | type, duur en eventueel snelheid per activiteit |

Elke gelogde portie bewaart zijn eigen voedingswaarden. Zo blijft de geschiedenis
kloppen, ook als je een catalogusitem later aanpast of verwijdert.

## API

Alles onder `/api/` spreekt JSON; `/afbeeldingen/<bestandsnaam>` serveert een
weegschaalfoto, en al het andere is een statisch bestand uit `static/`.

| Methode | Pad | Doel |
|---------|-----|------|
| GET | `/api/instellingen` | alle instellingen |
| PUT | `/api/instellingen` | instellingen opslaan |
| GET | `/api/gewicht` | alle gewichtmetingen |
| GET | `/api/afbeeldingen` | weegschaalfoto's per datum (`{"2026-07-12": [bestandsnaam, …]}`) |
| POST | `/api/gewicht` | meting opslaan (overschrijft bij bestaande datum) |
| DELETE | `/api/gewicht/<id>` | meting verwijderen |
| GET | `/api/voedingsmiddelen` | de volledige catalogus |
| POST | `/api/voedingsmiddelen` | nieuw catalogusitem |
| PUT | `/api/voedingsmiddelen/<id>` | catalogusitem bewerken |
| DELETE | `/api/voedingsmiddelen/<id>` | catalogusitem verwijderen (log blijft) |
| GET | `/api/dagen?van=&tot=` | dagtotalen (voeding + sport) in een periode |
| GET | `/api/dag/<datum>` | alle details van één dag |
| POST | `/api/voedingslog` | portie loggen (uit catalogus of vrije invoer) |
| POST | `/api/voedingslog/<id>/dupliceer` | portie dupliceren (zelfde dag, uur en waarden) |
| PUT | `/api/voedingslog/<id>` | hoeveelheid/uur van een portie bijstellen |
| DELETE | `/api/voedingslog/<id>` | portie verwijderen |
| POST | `/api/sport` | sportactiviteit loggen |
| DELETE | `/api/sport/<id>` | sportactiviteit verwijderen |

Datums zijn overal ISO-tekst (`JJJJ-MM-DD`). Foute invoer geeft een nette
`400` met een Nederlandstalige melding terug.
