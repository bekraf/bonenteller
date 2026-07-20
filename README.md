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

Op de telefoon kun je de app via "Toevoegen aan beginscherm" installeren
(er is een webmanifest met icoon); hij opent dan zonder adresbalk.

## Wat je ermee doet

Het dashboard heeft zes tabbladen:

- **Dashboard** — grafieken van gewicht (met doellijn en BMI-zones), calorieën
  per dag en sport per dag, met periodefilters (7/14/30/90/180 dagen of alles).
  Hover over de gewichtsgrafiek toont gewicht, datum en BMI van die dag, plus —
  als er in `afbeeldingen/` een weegschaalfoto van die datum staat — de foto zelf.
- **Dagboek** — per dag porties eten loggen (uit de catalogus óf vrije invoer),
  sportactiviteiten toevoegen, je gewicht opslaan en een vrije dagnotitie
  bijhouden. "Kopieer van gisteren" neemt alle voeding van de vorige dag over.
  De zoeklijst toont de meest gelogde items eerst; bij het kiezen van een item
  staat de laatst gebruikte hoeveelheid alvast ingevuld, en op de dag van
  vandaag het huidige uur. Een verwijderde regel is via de "Ongedaan
  maken"-melding onderaan terug te zetten.
- **Weekoverzicht** — een weektabel met dagtotalen, gekleurd wanneer een waarde
  boven het maximum of onder het minimum van je richtlijn valt.
- **Voedingsmiddelen** — je eigen catalogus beheren: voedingswaarden per stuk of
  per 100 g, plus de NOVA-bewerkingsgraad (1 onbewerkt … 4 ultrabewerkt).
  Klikken op een naam klapt de loggeschiedenis van dat item uit (hoe vaak,
  wanneer laatst, gemiddelde portie, aandeel in alle gelogde kcal).
- **Gegevens** — gewichtmetingen en sportactiviteiten rechtstreeks bewerken,
  en alles exporteren: het SQLite-bestand zelf of een zip met CSV's per tabel.
- **Instellingen** — lengte, doelgewicht, dagelijkse richtlijnen (kcal en macro's)
  en alle kleuren van de interface (ook de richtlijnkleuren van de grafieken).

De zes voedingswaarden staan overal in dezelfde volgorde: **kcal, vet,
koolhydraten, eiwit, zout, vezels**.

## Structuur

```
app.py            # webserver + JSON-API (http.server + sqlite3)
gezondheid.db     # SQLite-database met alle data
afbeeldingen/     # weegschaalfoto's (IMG_JJJJMMDD_….jpg); de map zit in git,
                  # de foto's zelf niet (zie afbeeldingen/.gitignore)
static/
  index.html      # de enige pagina (zes tabbladen)
  app.js          # frontend-logica en grafieken (vanilla JS)
  stijl.css       # opmaak
  manifest.json   # webmanifest (installeren op het beginscherm)
  icoon-*.png     # app-iconen
```

`app.py` bevat, van boven naar beneden: hulpfuncties en invoervalidatie, de
API-functies (één per endpoint), en de HTTP-handler die URL's naar die functies
routeert.

## Database

SQLite met zes tabellen:

| Tabel | Inhoud |
|-------|--------|
| `instellingen` | sleutel/waarde: richtlijnen (kcal-/macrogrenzen) en kleuren |
| `gewichtmetingen` | één gewicht per datum |
| `voedingsmiddelen` | de catalogus (naam, eenheid, NOVA, voedingswaarden) |
| `voedingslog` | gelogde porties per dag; elke regel bewaart zijn eigen waarden |
| `sportactiviteiten` | type, duur en eventueel snelheid per activiteit |
| `dagnotities` | één vrije tekstnotitie per dag |

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
| GET | `/api/voedingsmiddelen` | de volledige catalogus, incl. loggeschiedenis per item |
| GET | `/api/voedingsmiddelen/<id>/historiek` | loggeschiedenis van één item |
| POST | `/api/voedingsmiddelen` | nieuw catalogusitem |
| PUT | `/api/voedingsmiddelen/<id>` | catalogusitem bewerken |
| DELETE | `/api/voedingsmiddelen/<id>` | catalogusitem verwijderen (log blijft) |
| GET | `/api/dagen?van=&tot=` | dagtotalen (voeding + sport) in een periode |
| GET | `/api/dag/<datum>` | alle details van één dag (incl. notitie) |
| GET | `/api/notities?van=&tot=` | dagnotities in een periode (`{datum: tekst}`) |
| PUT | `/api/dag/<datum>/notitie` | dagnotitie opslaan (lege tekst wist) |
| POST | `/api/voedingslog` | portie loggen (uit catalogus of vrije invoer) |
| POST | `/api/voedingslog/kopieer` | alle porties van dag `van` naar dag `naar` kopiëren |
| POST | `/api/voedingslog/<id>/dupliceer` | portie dupliceren (zelfde dag, uur en waarden) |
| PUT | `/api/voedingslog/<id>` | hoeveelheid/uur van een portie bijstellen |
| DELETE | `/api/voedingslog/<id>` | portie verwijderen |
| POST | `/api/sport` | sportactiviteit loggen |
| DELETE | `/api/sport/<id>` | sportactiviteit verwijderen |
| POST | `/api/herstel/<soort>` | verwijderde rij terugzetten ('ongedaan maken') |
| GET | `/api/export/db` | download: momentopname van het SQLite-bestand |
| GET | `/api/export/csv` | download: zip met één CSV per tabel |

Datums zijn overal ISO-tekst (`JJJJ-MM-DD`). Foute invoer geeft een nette
`400` met een Nederlandstalige melding terug. Een DELETE-antwoord bevat de
verwijderde rij; die kan ongewijzigd naar `/api/herstel/<soort>`
(`voedingslog`, `sport` of `gewicht`) om ze terug te zetten.
