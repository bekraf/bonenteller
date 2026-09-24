#!/usr/bin/env python3
"""Bakt de publieke website uit gezondheid.db: alleen het dashboard, alleen lezen.

Gebruik:  python3 bouw_publiek.py [uitvoermap]     (standaard: uit/)

Wat publiek is, wordt HIER beslist, niet in de browser. Alles wat in de
uitvoermap belandt, kan iedereen downloaden — ook zonder de pagina te openen.
Wat er niet in staat, bestaat online niet, wat iemand in de browser ook
probeert. Daarom werkt dit script overal met een allowlist:

  pagina   Van index.html blijft alleen het tabblad Dashboard over: de andere
           knoppen en panelen worden eruit geknipt. app.js zoekt bij het
           opstarten een paar elementen uit die panelen op; die krijgen een
           lege, verborgen stand-in (zie stand_ins), anders crasht hij.
  bestanden  Alleen de bestanden uit STATISCH, de twee leesmodus-bestanden en
           de vier databestanden hieronder. De build faalt als er iets anders
           in de uitvoermap staat.
  data     Alleen wat het dashboard toont, en daarvan alleen de velden die het
           leest: per dag de kcal en de sport, de dagnotities (die staan in
           het zweefvenster van de kcal-grafiek), de kleuren en vijf
           instellingen. Geen dagboek per dag, geen macro's, geen catalogus,
           geen database-download.
  gewicht  Alleen de wekelijkse weging (WEEGDAG) plus de meting van vandaag
           in Belgische tijd. De workflow bouwt 's nachts opnieuw, zodat die
           van gisteren ook uit het bestand verdwijnt.

Het script roept de API-functies uit app.py zelf aan en snoeit daarna, zodat
de publieke cijfers niet kunnen afwijken van wat de app thuis toont.
publiek/leesmodus.js bedient de /api/-aanvragen van app.js uit deze bestanden
en weigert al de rest. static/ en app.py blijven ongewijzigd: de app thuis
merkt hier niets van.

GitHub Actions draait dit bij elke push en elke nacht (zie
.github/workflows/pages.yml); de uitvoermap hoort daarom niet in git.
"""

import json
import re
import shutil
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
import app  # noqa: E402  (staat naast dit script)

UIT = Path(sys.argv[1]) if len(sys.argv) > 1 else HIER / "uit"
BRON = HIER / "publiek"   # leesmodus.js en leesmodus.css

# De bestanden uit static/ die de publieke pagina nodig heeft. Een nieuw
# bestand in static/ gaat dus niet vanzelf online.
STATISCH = ("index.html", "app.js", "stijl.css", "manifest.json",
            "icoon-192.png", "icoon-512.png")

# De wekelijkse weging: vrijdag (Python telt vanaf maandag = 0). "Vandaag"
# is de Belgische kalenderdag, ook al draait de build op een server in UTC.
WEEGDAG = 4
TIJDZONE = ZoneInfo("Europe/Brussels")

# Wat het dashboard uit de data leest — en dus het enige dat online gaat.
SPORT_VELDEN = ("type", "duur_minuten", "snelheid_kmh")
# Instellingen: alle kleuren (kleur_…) plus deze vijf.
INSTELLINGEN = ("lengte_m", "doelgewicht_kg", "kcal_min", "kcal_max", "onderrapportage_pct")

ALLES = {"van": ["0001-01-01"], "tot": ["9999-12-31"]}
LEGE_TAGS = {"input", "img", "br", "hr", "meta", "link", "source", "wbr"}


def schrijf_json(pad, data):
    pad.parent.mkdir(parents=True, exist_ok=True)
    pad.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                   encoding="utf-8")


# ---------------------------------------------------------------------------
# De pagina: alleen het dashboard
# ---------------------------------------------------------------------------

def alleen_dashboard(html):
    """Knip uit <main> alles behalve het dashboardpaneel, en uit de tabbalk
    alle knoppen behalve Dashboard. Allowlist: een tabblad dat er later bij
    komt, valt hier dus ook vanzelf weg.

    Geeft de nieuwe html terug, plus het weggeknipte stuk (voor stand_ins)."""
    main = re.search(r"<main>(.*?)</main>", html, re.S)
    binnen = main.group(1)
    start = binnen.index('<section id="paneel-dashboard"')
    einde = binnen.index("</section>", start) + len("</section>")
    dashboard = binnen[start:einde]
    if "<section" in dashboard[1:]:
        sys.exit("het dashboardpaneel bevat zelf een <section> — knippen gaat hier fout")
    weg = binnen[:start] + binnen[einde:]
    html = html[:main.start(1)] + "\n  " + dashboard + "\n" + html[main.end(1):]

    nav = re.search(r'<nav id="tabs">(.*?)</nav>', html, re.S)
    knop = re.search(r'<button data-paneel="dashboard"[^>]*>.*?</button>', nav.group(1), re.S)
    if not knop:
        sys.exit("geen Dashboard-knop in de tabbalk gevonden")
    html = html[:nav.start(1)] + "\n    " + knop.group(0) + "\n  " + html[nav.end(1):]
    return html, weg


def stand_ins(app_js, weg):
    """Lege stand-ins voor de elementen die app.js opzoekt maar die in de
    weggeknipte panelen stonden. app.js hangt er bij het opstarten
    luisteraars aan (dag-vorige, form-voeding, …); zonder element zou dat
    crashen en bleef het dashboard leeg. Ze zijn leeg, verborgen en inert:
    er staat geen tekst of data in."""
    ids = sorted(set(re.findall(r"""getElementById\(\s*["']([\w-]+)["']\s*\)""", app_js)))
    stukken = []
    for id_ in ids:
        m = re.search(r'<(\w+)[^>]*\sid="%s"' % re.escape(id_), weg)
        if not m:
            continue   # staat op het dashboard of buiten de panelen: blijft echt
        tag = m.group(1)
        stukken.append(f'<{tag} id="{id_}">' if tag in LEGE_TAGS
                       else f'<{tag} id="{id_}"></{tag}>')
    return '<div id="stand-ins" hidden inert>' + "".join(stukken) + "</div>"


def bouw_pagina():
    if UIT.exists():
        shutil.rmtree(UIT)
    UIT.mkdir(parents=True)
    for naam in STATISCH:
        shutil.copy(HIER / "static" / naam, UIT / naam)
    for naam in ("leesmodus.js", "leesmodus.css"):
        shutil.copy(BRON / naam, UIT / naam)

    html = (UIT / "index.html").read_text(encoding="utf-8")
    html, weg = alleen_dashboard(html)
    html = html.replace("</main>", "</main>\n\n"
                        + stand_ins((UIT / "app.js").read_text(encoding="utf-8"), weg), 1)
    # GitHub Pages serveert het project onder /<repo>/: absolute paden
    # (/stijl.css, /app.js) worden relatief.
    html = re.sub(r'(href|src)="/(?!/)', r'\1="./', html)
    html = html.replace(
        '<link rel="stylesheet" href="./stijl.css">',
        '<link rel="stylesheet" href="./stijl.css">\n'
        '<link rel="stylesheet" href="./leesmodus.css">')
    # leesmodus.js moet vóór app.js draaien: hij vervangt fetch().
    html = html.replace('<script src="./app.js">',
                        '<script src="./leesmodus.js"></script>\n<script src="./app.js">')
    (UIT / "index.html").write_text(html, encoding="utf-8")

    # Het webmanifest verwijst ook naar de hoofdmap van de server.
    manifest = json.loads((UIT / "manifest.json").read_text(encoding="utf-8"))
    manifest["name"] = "Gezondheidsdashboard (meelezen)"
    manifest["start_url"] = "./"
    for icoon in manifest["icons"]:
        icoon["src"] = "." + icoon["src"]
    (UIT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2),
                                       encoding="utf-8")


# ---------------------------------------------------------------------------
# De data: alleen wat het dashboard toont
# ---------------------------------------------------------------------------

def publiek_gewicht(con, vandaag):
    """De wekelijkse weging, plus apart de meting van vandaag (als die er is
    en het geen weegdag is — dan zit ze al in de reeks). leesmodus.js toont
    die laatste alleen zolang het bij de bezoeker ook nog vandaag is."""
    metingen = [{"datum": g["datum"], "gewicht": g["gewicht"]}
                for g in app.api_gewicht_lijst(con)]
    weegdagen = [g for g in metingen if date.fromisoformat(g["datum"]).weekday() == WEEGDAG]
    extra = None
    if vandaag.weekday() != WEEGDAG:
        extra = next((g for g in metingen if g["datum"] == vandaag.isoformat()), None)
    return {"weegdagen": weegdagen, "vandaag": extra}


def publiek_dagen(con):
    """Per dag alleen de kcal en de sport (type, duur, snelheid): daarmee
    tekent het dashboard de kcal- en sportgrafiek en rekent het de tegels
    uit. De macro's, de NOVA-verdeling en de omschrijvingen blijven thuis."""
    return [{"datum": d["datum"], "kcal": d["kcal"],
             "sport": [{k: s[k] for k in SPORT_VELDEN} for s in d["sport"]]}
            for d in app.api_dagen(con, ALLES)]


def publieke_instellingen(con):
    return {k: v for k, v in app.api_instellingen(con).items()
            if k in INSTELLINGEN or k.startswith("kleur_")}


def bouw_data(con, vandaag):
    data = UIT / "data"
    schrijf_json(data / "instellingen.json", publieke_instellingen(con))
    schrijf_json(data / "gewicht.json", publiek_gewicht(con, vandaag))
    schrijf_json(data / "dagen.json", publiek_dagen(con))
    schrijf_json(data / "notities.json", app.api_notities(con, ALLES))


def controleer():
    """Laatste slot: in de uitvoermap staat precies wat hierboven gemaakt
    is, en niets anders."""
    verwacht = set(STATISCH) | {"leesmodus.js", "leesmodus.css"} | {
        f"data/{n}.json" for n in ("instellingen", "gewicht", "dagen", "notities")}
    gevonden = {p.relative_to(UIT).as_posix() for p in UIT.rglob("*") if p.is_file()}
    if gevonden != verwacht:
        sys.exit(f"onverwachte bestanden in {UIT}: {sorted(gevonden ^ verwacht)}")
    return sorted(gevonden)


def main():
    if not app.DB_PAD.exists():
        sys.exit("gezondheid.db niet gevonden — hoort naast dit script te staan")
    vandaag = datetime.now(TIJDZONE).date()
    bouw_pagina()
    con = app.db()
    try:
        bouw_data(con, vandaag)
    finally:
        con.close()
    bestanden = controleer()
    grootte = sum((UIT / b).stat().st_size for b in bestanden)
    print(f"{UIT}: {len(bestanden)} bestanden, {grootte / 1e3:.0f} kB (vandaag = {vandaag})")


if __name__ == "__main__":
    main()
