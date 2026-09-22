#!/usr/bin/env python3
"""Bakt de publieke alleen-lezen website uit gezondheid.db.

Gebruik:  python3 bouw_publiek.py [uitvoermap]     (standaard: uit/)

De publieke site is dezelfde frontend als de lokale app, maar zonder server:
de JSON die app.py normaal uitrekent wordt hier één keer naar bestanden
geschreven, en publiek/leesmodus.js zet elke GET /api/... om naar zo'n
bestand. app.js blijft ongewijzigd — hij heeft maar één fetch(), in api().

Dit script roept de API-functies uit app.py zelf aan, zodat de gebakken JSON
gegarandeerd hetzelfde is als wat de lokale server geeft; er is dus geen
tweede SQL-implementatie die kan gaan afwijken.

De weegschaalfoto's gaan bewust NIET mee (afbeeldingen.json blijft leeg): de
zweefinfo van de gewichtsgrafiek werkt gewoon zonder foto.

GitHub Actions draait dit bij elke push (zie .github/workflows/pages.yml);
de uitvoermap hoort daarom niet in git.
"""

import csv
import io
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

HIER = Path(__file__).resolve().parent
sys.path.insert(0, str(HIER))
import app  # noqa: E402  (staat naast dit script)

UIT = Path(sys.argv[1]) if len(sys.argv) > 1 else HIER / "uit"
BRON = HIER / "publiek"   # leesmodus.js en leesmodus.css


def schrijf_json(pad, data):
    pad.parent.mkdir(parents=True, exist_ok=True)
    pad.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                   encoding="utf-8")


def bouw_pagina():
    """static/ kopiëren en omschrijven naar een pagina zonder server.

    GitHub Pages serveert het project onder /<repo>/, dus de absolute paden
    uit de lokale app (/stijl.css, /app.js) worden hier relatief gemaakt."""
    if UIT.exists():
        shutil.rmtree(UIT)
    shutil.copytree(HIER / "static", UIT)

    html = (UIT / "index.html").read_text(encoding="utf-8")
    html = re.sub(r'(href|src)="/(?!/)', r'\1="./', html)
    html = html.replace(
        '<link rel="stylesheet" href="./stijl.css">',
        '<link rel="stylesheet" href="./stijl.css">\n'
        '<link rel="stylesheet" href="./leesmodus.css">')
    # leesmodus.js moet vóór app.js draaien: hij vervangt fetch().
    html = html.replace('<script src="./app.js">',
                        '<script src="./leesmodus.js"></script>\n<script src="./app.js">')
    # De exportknoppen wijzen naar de API; hier naar de meegebakken bestanden.
    html = html.replace('href="./api/export/db"', 'href="./data/gezondheid.db"')
    html = html.replace('href="./api/export/csv"', 'href="./data/gezondheid-csv.zip"')
    (UIT / "index.html").write_text(html, encoding="utf-8")

    # Het webmanifest verwijst ook naar de hoofdmap van de server.
    manifest = json.loads((UIT / "manifest.json").read_text(encoding="utf-8"))
    manifest["name"] = "Gezondheidsdashboard (meelezen)"
    manifest["start_url"] = "./"
    for icoon in manifest["icons"]:
        icoon["src"] = "." + icoon["src"]
    (UIT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2),
                                       encoding="utf-8")

    for naam in ("leesmodus.js", "leesmodus.css"):
        shutil.copy(BRON / naam, UIT / naam)


def bouw_data(con):
    """Elk API-antwoord dat de frontend opvraagt als bestand wegschrijven."""
    data = UIT / "data"
    alles = {"van": ["0001-01-01"], "tot": ["9999-12-31"]}

    schrijf_json(data / "instellingen.json", app.api_instellingen(con))
    schrijf_json(data / "gewicht.json", app.api_gewicht_lijst(con))
    schrijf_json(data / "sport.json", app.api_sport_lijst(con))
    schrijf_json(data / "notities.json", app.api_notities(con, alles))
    schrijf_json(data / "afbeeldingen.json", {})   # foto's blijven privé

    dagen = app.api_dagen(con, alles)
    schrijf_json(data / "dagen.json", dagen)
    for dag in dagen:
        schrijf_json(data / "dag" / f"{dag['datum']}.json", app.api_dag(con, dag["datum"]))

    catalogus = app.api_voedingsmiddelen(con)
    schrijf_json(data / "voedingsmiddelen.json", catalogus)
    for vm in catalogus:
        schrijf_json(data / "historiek" / f"{vm['id']}.json",
                     app.api_voedingsmiddel_historiek(con, vm["id"]))

    return len(dagen), len(catalogus)


def bouw_downloads(con):
    """Dezelfde twee downloads als /api/export/db en /api/export/csv."""
    data = UIT / "data"
    (data / "gezondheid.db").write_bytes(con.serialize())
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zip_:
        for tabel in app.EXPORT_TABELLEN:
            tekst = io.StringIO()
            schrijver = csv.writer(tekst)
            cur = con.execute(f"SELECT * FROM {tabel}")   # vaste naam
            schrijver.writerow([k[0] for k in cur.description])
            schrijver.writerows(cur)
            zip_.writestr(f"{tabel}.csv", tekst.getvalue())
    (data / "gezondheid-csv.zip").write_bytes(buffer.getvalue())


def main():
    if not app.DB_PAD.exists():
        sys.exit("gezondheid.db niet gevonden — hoort naast dit script te staan")
    bouw_pagina()
    con = app.db()
    try:
        aantal_dagen, aantal_items = bouw_data(con)
        bouw_downloads(con)
    finally:
        con.close()
    bestanden = sum(1 for p in UIT.rglob("*") if p.is_file())
    bytes_ = sum(p.stat().st_size for p in UIT.rglob("*") if p.is_file())
    print(f"{UIT}: {bestanden} bestanden, {bytes_ / 1e6:.2f} MB "
          f"({aantal_dagen} dagen, {aantal_items} voedingsmiddelen)")


if __name__ == "__main__":
    main()
