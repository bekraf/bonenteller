# Gezondheidsdashboard

Lokale webapp (LAN, geen login — proof of concept) rond gewicht, voeding en
sport. Alleen Python-standaardbibliotheek, geen dependencies.

## Starten

```bash
python3 app.py          # start de server op http://<dit-ip>:8000 (heel je LAN kan erbij)
```

## Bestanden

| Bestand | Wat |
| --- | --- |
| `app.py` | webserver + JSON-API |
| `gezondheid.db` | SQLite-database (Nederlandstalig schema) — dé databron |
| `static/` | frontend (Nederlandstalig, vanilla JS/SVG) |
| `2026.ods` | het originele rekenblad, alleen nog als archief |

De database is eenmalig gevuld vanuit `2026.ods` (weight-blad, database-blad
en weekbladen 1–27). Het importscript is daarna verwijderd; alle nieuwe data
gaat via de webapp. **Maak dus af en toe een kopie van `gezondheid.db` als
back-up** — dat bestand is nu de enige waarheid.

## Database

Volgorde van voedingswaarden overal: **kcal, vet, koolhydraten, eiwit, zout, vezels**.

- `voedingsmiddelen` — catalogus; `eenheid` is `stuk` (waarden per stuk) of
  `100g` (waarden per 100 gram); `nova` is de NOVA-groep (1 = onbewerkt of
  minimaal bewerkt, 2 = bewerkt culinair ingrediënt, 3 = bewerkt,
  4 = ultrabewerkt — eenmalig door de assistent toegekend, aanpasbaar via
  de webapp)
- `voedingslog` — elke gegeten portie; draagt zijn **eigen** voedingswaarden,
  zodat eenmalige gerechten (restaurant, feest, …) zonder catalogusitem kunnen
  bestaan en de geschiedenis blijft kloppen als de catalogus later wijzigt
- `gewichtmetingen` — één meting per datum
- `sportactiviteiten` — type (`lopen`/`fietsen`/`krachttraining`),
  duur in minuten, eventueel snelheid in km/u. Het type `wandelen` is op
  verzoek verwijderd (er stonden 4 wandelingen in, die zijn gewist).
- `instellingen` — doelgewicht, lengte, de kcal-/macro-richtlijnen en de
  kleurkeuzes (`kleur_*`-sleutels, hexwaarden als tekst)

## Keuzes bij de eenmalige import (ter referentie)

- Namen zijn genormaliseerd naar het Nederlands: `_count` weggehaald (zit nu
  in het veld `eenheid`), underscores → spaties, Engels/Frans vertaald
  (`chickenwing` → kippenvleugel, `tajine_agneau` → lamstajine, …) en typo's
  rechtgezet (`aardbij` → aardbei, `woda` → wodka, `carslberg` → carlsberg, …).
- Per stuk of per 100 g is afgeleid uit hoe elk item werkelijk gelogd werd
  (`2x` = stuks, `220` = gram).
- De catalogusregel `test` (100/200/…/600) is bewust niet geïmporteerd.
- Berekende bladvelden (Daily Average, Adjusted For Underreporting, weight
  diff, BMI) zijn niet geïmporteerd — de app rekent ze zelf uit.
- Enkele regels zonder waarden kregen een berekening of schatting: mango
  (8 jan) uit de catalogus; zalm (20 jan), wodka shot (2× op 4 apr) en bbq
  (17 jun, waarden van de bbq van 1 mei) geschat. "Kaas & wijn" (28 feb)
  zonder hoeveelheid werd 1 stuk; uurtikfout "111" (11 mei) werd 11.
- `frambozen` staat in de catalogus met 47 g vet per 100 g — dat lijkt een
  invoerfout uit het origineel, maar is bewust ongemoeid gelaten. Aanpassen
  kan in de webapp (Voedingsmiddelen → Bewerken).

## Webapp

Permanent donker thema: warm bijna-zwart als achtergrond met de
desktopkleuren van de gebruiker als accenten (crème #FFE4A7, blauw #234990,
roest #89380F). De meeste kleuren (achtergrond, kaarten, knoppen,
richtlijngrenzen, NOVA-groepen, sporttypes) zijn per gebruiker aanpasbaar op
het Instellingen-tabblad; de standaarden staan in `static/stijl.css`.

- **Dashboard** — tegels (gewicht, doel, BMI, kcal, sport; gekleurd volgens
  BMI-zone, kcal-richtlijn en de WHO-beweegrichtlijn van 150–300 min/week,
  en meeschalend met de gekozen periode) en drie grafieken met
  periode-filter (7/14/30/90/180 dagen/alles, standaard alles): gewicht (doellijn + BMI-zones
  als achtergrond; bij "Alles" uitgezoomd tot de grenslijnen voor onder- en
  overgewicht), kcal per dag (staafkleur t.o.v. de richtlijn) en sport per
  dag (minuten, vaste kleur per type: lopen rood, krachttraining groen,
  fietsen geel). Statistieken lopen t/m gisteren; de lopende dag telt nog
  niet mee.
- **Dagboek** — per dag eten toevoegen (uit de catalogus of vrije invoer),
  sport en gewicht registreren; voedingsnamen kleuren volgens hun
  NOVA-groep. Uur en hoeveelheid van een gelogde portie zijn aanpasbaar
  door erop te klikken (het × wordt dan een ✓ om op te slaan; bij een
  nieuwe hoeveelheid schalen de voedingswaarden evenredig mee). Direct te
  openen via bv. `/#dagboek/2026-07-03`.
- **Weekoverzicht** — weken lopen van vrijdag t/m donderdag (week 1 =
  2 januari 2026), met per dag de NOVA-verdeling als percentages van de kcal.
- **Voedingsmiddelen** — catalogus doorzoeken, toevoegen (incl. NOVA-groep),
  waarden bewerken en verwijderen (al gelogde porties blijven daarbij
  bewaard).
- **Instellingen** — lengte, doelgewicht, onderrapportagefactor en de
  dagelijkse min/max-richtlijnen bekijken en aanpassen. Dagtotalen en
  weekcellen kleuren groen binnen de richtlijn, rood ↑ erboven en amber ↓
  eronder.
