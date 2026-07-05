#!/usr/bin/env python3
"""Gezondheidsdashboard — webserver + JSON-API.

Gebruik:  python3 app.py [poort]     (standaard poort 8000)

De server bindt op 0.0.0.0, dus iedereen op het LAN kan erbij. Er is bewust
geen login of beveiliging: dit is een proof of concept voor thuisgebruik.

Alles draait op de Python-standaardbibliotheek (http.server + sqlite3), er
zijn dus geen pakketten te installeren. De data zit in gezondheid.db; die is
eenmalig opgebouwd uit het rekenblad 2026.ods.

Opbouw van dit bestand:
  1. hulpfuncties en invoervalidatie
  2. API-functies (één per endpoint), gegroepeerd per onderwerp
  3. de HTTP-handler die URL's naar die functies routeert
"""

import json
import re
import sqlite3
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

# Paden: alles staat naast dit script.
HIER = Path(__file__).resolve().parent
DB_PAD = HIER / "gezondheid.db"
STATISCH = HIER / "static"   # map met index.html, app.js en stijl.css

# De zes voedingswaarden, altijd in deze vaste volgorde (zo staat het ook in
# de database en in de frontend): kcal, vet, koolhydraten, eiwit, zout, vezels.
VOEDING_KOLOMMEN = ("kcal", "vet", "koolhydraten", "eiwit", "zout", "vezels")

# Toegelaten sporttypes. 'overig' bestaat als vangnet voor oude activiteiten
# uit het rekenblad die niet herkend werden; de invoer in de app gebruikt de
# eerste drie.
SPORT_TYPES = ("lopen", "fietsen", "krachttraining", "overig")

# Datums zijn overal tekst in ISO-vorm (JJJJ-MM-DD): dat sorteert vanzelf goed.
DATUM_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Bestandsextensie -> Content-Type voor de statische bestanden.
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
}


def db():
    """Open een nieuwe databaseverbinding (één per verzoek, dat is
    thread-veilig omdat de server meerdere verzoeken tegelijk afhandelt)."""
    con = sqlite3.connect(DB_PAD)
    con.row_factory = sqlite3.Row  # rijen gedragen zich als dicts
    con.execute("PRAGMA foreign_keys = ON")
    return con


class FoutInvoer(ValueError):
    """Ongeldige invoer van de gebruiker; wordt een nette 400-fout met
    Nederlandstalige melding in plaats van een servercrash."""


def eis_datum(waarde):
    """Controleer dat een waarde een geldige ISO-datum is."""
    if not isinstance(waarde, str) or not DATUM_RE.match(waarde):
        raise FoutInvoer("datum moet JJJJ-MM-DD zijn")
    return waarde


def eis_getal(waarde, naam, minimum=None):
    """Zet invoer om naar een getal en bewaak een ondergrens."""
    try:
        getal = float(waarde)
    except (TypeError, ValueError):
        raise FoutInvoer(f"{naam} moet een getal zijn")
    if minimum is not None and getal < minimum:
        raise FoutInvoer(f"{naam} moet minstens {minimum} zijn")
    return getal


# ---------------------------------------------------------------------------
# API: instellingen
# ---------------------------------------------------------------------------

# De enige sleutels die mogen bestaan; alles komt uit het vroegere weight-blad.
# De frontend gebruikt de *_min/*_max-waarden om cellen te kleuren die onder
# of boven de richtlijn zitten.
INSTELLING_SLEUTELS = {
    "lengte_m", "doelgewicht_kg", "onderrapportage_pct", "kcal_per_kg",
    "kcal_min", "kcal_max", "vet_min", "vet_max",
    "koolhydraten_min", "koolhydraten_max", "eiwit_min", "eiwit_max",
    "zout_min", "zout_max", "vezels_min", "vezels_max",
}

# Kleurinstellingen: hex-tekst (#rrggbb) in plaats van een getal. De frontend
# zet ze om naar CSS-variabelen; ontbreekt een sleutel, dan geldt gewoon de
# standaardkleur uit stijl.css.
KLEUR_SLEUTELS = {
    "kleur_pagina", "kleur_oppervlak", "kleur_knoppen",
    "kleur_boven_max", "kleur_onder_min",
    "kleur_nova1", "kleur_nova2", "kleur_nova3", "kleur_nova4",
    "kleur_sport_lopen", "kleur_sport_fietsen",
    "kleur_sport_krachttraining", "kleur_sport_overig",
}
KLEUR_RE = re.compile(r"^#[0-9a-f]{6}$")


def api_instellingen(con):
    """Alle instellingen als één dict: getallen (doelgewicht, lengte,
    kcal-/macro-richtlijnen) plus de kleurkeuzes (die blijven tekst)."""
    return {r["sleutel"]: (r["waarde"] if r["sleutel"] in KLEUR_SLEUTELS
                           else float(r["waarde"]))
            for r in con.execute("SELECT sleutel, waarde FROM instellingen")}


def api_instellingen_bewerk(con, gegevens):
    """Instellingen opslaan vanaf het Instellingen-tabblad. Alleen bekende
    sleutels zijn toegestaan; getalsleutels moeten getallen zijn en
    kleursleutels een hexkleur (#rrggbb). Geeft de volledige (nieuwe) set
    terug zodat de frontend meteen bij is."""
    for sleutel, waarde in gegevens.items():
        if sleutel in KLEUR_SLEUTELS:
            if not isinstance(waarde, str) or not KLEUR_RE.match(waarde.lower()):
                raise FoutInvoer(f"{sleutel} moet een kleur in #rrggbb-vorm zijn")
            waarde = waarde.lower()
        elif sleutel in INSTELLING_SLEUTELS:
            waarde = str(eis_getal(waarde, sleutel))
        else:
            raise FoutInvoer(f"onbekende instelling '{sleutel}'")
        con.execute(
            "INSERT OR REPLACE INTO instellingen (sleutel, waarde) VALUES (?, ?)",
            (sleutel, waarde))
    con.commit()
    return api_instellingen(con)


# ---------------------------------------------------------------------------
# API: gewichtmetingen
# ---------------------------------------------------------------------------

def api_gewicht_lijst(con):
    """Alle gewichtmetingen, oplopend op datum (voor de grafiek)."""
    return [dict(r) for r in con.execute(
        "SELECT id, datum, gewicht FROM gewichtmetingen ORDER BY datum")]


def api_gewicht_nieuw(con, gegevens):
    """Meting opslaan. Eén meting per datum: bestaat de datum al, dan wordt
    het gewicht overschreven (handig om een tikfout te verbeteren)."""
    datum = eis_datum(gegevens.get("datum"))
    gewicht = eis_getal(gegevens.get("gewicht"), "gewicht", 1)
    con.execute(
        "INSERT INTO gewichtmetingen (datum, gewicht) VALUES (?, ?) "
        "ON CONFLICT(datum) DO UPDATE SET gewicht = excluded.gewicht",
        (datum, gewicht))
    con.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# API: voedingsmiddelencatalogus
# ---------------------------------------------------------------------------

def api_voedingsmiddelen(con):
    """De volledige catalogus, alfabetisch. 'eenheid' is 'stuk' (waarden per
    stuk) of '100g' (waarden per 100 gram)."""
    return [dict(r) for r in con.execute(
        "SELECT * FROM voedingsmiddelen ORDER BY naam")]


def eis_nova(gegevens):
    """De NOVA-groep (1 = onbewerkt t/m 4 = ultrabewerkt) is optioneel."""
    nova = gegevens.get("nova")
    if nova in (None, ""):
        return None
    nova = int(eis_getal(nova, "nova", 1))
    if nova > 4:
        raise FoutInvoer("nova moet 1 t/m 4 zijn")
    return nova


def api_voedingsmiddel_nieuw(con, gegevens):
    """Nieuw voedingsmiddel toevoegen. Namen bewaren we in kleine letters,
    zodat zoeken en dubbelcontrole eenvoudig blijven."""
    naam = (gegevens.get("naam") or "").strip().lower()
    if not naam:
        raise FoutInvoer("naam is verplicht")
    eenheid = gegevens.get("eenheid")
    if eenheid not in ("100g", "stuk"):
        raise FoutInvoer("eenheid moet '100g' of 'stuk' zijn")
    nova = eis_nova(gegevens)
    waarden = [eis_getal(gegevens.get(k, 0), k, 0) for k in VOEDING_KOLOMMEN]
    try:
        cur = con.execute(
            "INSERT INTO voedingsmiddelen "
            "(naam, eenheid, nova, kcal, vet, koolhydraten, eiwit, zout, vezels) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", (naam, eenheid, nova, *waarden))
    except sqlite3.IntegrityError:
        # UNIQUE op naam: hetzelfde item twee keer toevoegen kan niet.
        raise FoutInvoer(f"'{naam}' bestaat al")
    con.commit()
    return {"ok": True, "id": cur.lastrowid}


def api_voedingsmiddel_verwijder(con, vm_id):
    """Voedingsmiddel uit de catalogus verwijderen. Gelogde porties blijven
    bestaan (ze dragen hun eigen naam en waarden); alleen hun koppeling naar
    de catalogus wordt losgemaakt."""
    rij = con.execute("SELECT id FROM voedingsmiddelen WHERE id = ?", (vm_id,)).fetchone()
    if rij is None:
        raise FoutInvoer("voedingsmiddel niet gevonden")
    con.execute("UPDATE voedingslog SET voedingsmiddel_id = NULL WHERE voedingsmiddel_id = ?", (vm_id,))
    con.execute("DELETE FROM voedingsmiddelen WHERE id = ?", (vm_id,))
    con.commit()
    return {"ok": True}


def api_voedingsmiddel_bewerk(con, vm_id, gegevens):
    """Voedingswaarden van een bestaand item aanpassen (bv. een invoerfout
    verbeteren). Naam en eenheid liggen vast; alleen de waarden wijzigen.
    Let op: eerder gelogde porties behouden hun oude waarden — de log bewaart
    per regel wat er toen gold."""
    rij = con.execute("SELECT id FROM voedingsmiddelen WHERE id = ?", (vm_id,)).fetchone()
    if rij is None:
        raise FoutInvoer("voedingsmiddel niet gevonden")
    nova = eis_nova(gegevens)
    waarden = [eis_getal(gegevens.get(k, 0), k, 0) for k in VOEDING_KOLOMMEN]
    con.execute(
        "UPDATE voedingsmiddelen SET nova=?, kcal=?, vet=?, koolhydraten=?, "
        "eiwit=?, zout=?, vezels=? WHERE id=?", (nova, *waarden, vm_id))
    con.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# API: dagoverzichten (voedingslog + sport samengevat)
# ---------------------------------------------------------------------------

def api_dagen(con, query):
    """Dagtotalen tussen ?van= en ?tot= (beide inclusief). Per dag: de som
    van de zes voedingswaarden plus de lijst sportactiviteiten. Dit voedt de
    kcal-grafiek op het dashboard en het weekoverzicht."""
    van = eis_datum(query.get("van", ["0000-01-01"])[0])
    tot = eis_datum(query.get("tot", ["9999-12-31"])[0])

    # Eerst de voedingstotalen per dag...
    dagen = {}
    for r in con.execute(
            "SELECT datum, SUM(kcal) kcal, SUM(vet) vet, "
            "SUM(koolhydraten) koolhydraten, SUM(eiwit) eiwit, "
            "SUM(zout) zout, SUM(vezels) vezels "
            "FROM voedingslog WHERE datum BETWEEN ? AND ? GROUP BY datum", (van, tot)):
        d = dict(r)
        for k in VOEDING_KOLOMMEN:
            d[k] = round(d[k] or 0, 1)
        d["sport"] = []
        d["nova_kcal"] = {}
        dagen[r["datum"]] = d

    # ...dan per dag de kcal opgeteld per NOVA-groep (via de catalogus;
    # vrije invoer zonder catalogusitem telt als 'onbekend')...
    for r in con.execute(
            "SELECT l.datum, vm.nova nova, SUM(l.kcal) kcal FROM voedingslog l "
            "LEFT JOIN voedingsmiddelen vm ON vm.id = l.voedingsmiddel_id "
            "WHERE l.datum BETWEEN ? AND ? GROUP BY l.datum, vm.nova", (van, tot)):
        dag = dagen.get(r["datum"])
        if dag is not None:
            sleutel = str(r["nova"]) if r["nova"] else "onbekend"
            dag["nova_kcal"][sleutel] = round(r["kcal"] or 0, 1)

    # ...en tot slot de sport. Een dag met alleen sport (niets gegeten/gelogd)
    # krijgt nullen voor de voedingswaarden.
    for r in con.execute(
            "SELECT datum, type, duur_minuten, snelheid_kmh, omschrijving "
            "FROM sportactiviteiten WHERE datum BETWEEN ? AND ? ORDER BY datum", (van, tot)):
        dag = dagen.setdefault(r["datum"], dict(
            datum=r["datum"], sport=[], nova_kcal={},
            **{k: 0 for k in VOEDING_KOLOMMEN}))
        dag["sport"].append(dict(r))

    return sorted(dagen.values(), key=lambda d: d["datum"])


def api_dag(con, datum):
    """Alles van één dag, voor het dagboek: elke gegeten portie (gesorteerd
    op uur, met de NOVA-groep uit de catalogus), de sport en het dagtotaal."""
    eis_datum(datum)
    regels = [dict(r) for r in con.execute(
        "SELECT l.*, vm.nova FROM voedingslog l "
        "LEFT JOIN voedingsmiddelen vm ON vm.id = l.voedingsmiddel_id "
        "WHERE l.datum = ? "
        "ORDER BY l.uur IS NULL, l.uur, l.id", (datum,))]   # zonder uur achteraan
    sport = [dict(r) for r in con.execute(
        "SELECT * FROM sportactiviteiten WHERE datum = ? ORDER BY id", (datum,))]
    totaal = {k: round(sum(r[k] or 0 for r in regels), 1) for k in VOEDING_KOLOMMEN}
    return {"datum": datum, "regels": regels, "sport": sport, "totaal": totaal}


# ---------------------------------------------------------------------------
# API: voedingslog (porties toevoegen/verwijderen)
# ---------------------------------------------------------------------------

def api_voedingslog_nieuw(con, gegevens):
    """Een gegeten portie loggen. Twee smaken:

    1. Met 'voedingsmiddel_id': de waarden worden hier berekend uit de
       catalogus × hoeveelheid (stuks, of gram gedeeld door 100).
    2. Vrije invoer (restaurant, feestje, ...): zonder id, met eigen naam en
       zelf opgegeven voedingswaarden.

    In beide gevallen bewaart de logregel zijn eigen waarden. Zo blijft de
    geschiedenis kloppen, ook als de catalogus later wordt aangepast."""
    datum = eis_datum(gegevens.get("datum"))

    # Uur is optioneel (0–24; het rekenblad gebruikte 24 voor 'einde dag').
    uur = gegevens.get("uur")
    if uur not in (None, ""):
        uur = int(eis_getal(uur, "uur", 0))
        if uur > 24:
            raise FoutInvoer("uur moet tussen 0 en 24 liggen")
    else:
        uur = None

    hoeveelheid = eis_getal(gegevens.get("hoeveelheid"), "hoeveelheid", 0.01)

    vm_id = gegevens.get("voedingsmiddel_id")
    if vm_id:
        # Smaak 1: uit de catalogus.
        vm = con.execute("SELECT * FROM voedingsmiddelen WHERE id = ?", (vm_id,)).fetchone()
        if vm is None:
            raise FoutInvoer("voedingsmiddel niet gevonden")
        # Catalogus 'stuk' -> loggen in stuks; catalogus '100g' -> loggen in gram.
        eenheid = "stuks" if vm["eenheid"] == "stuk" else "gram"
        factor = hoeveelheid if eenheid == "stuks" else hoeveelheid / 100.0
        naam = vm["naam"]
        waarden = [round(vm[k] * factor, 1) for k in VOEDING_KOLOMMEN]
        vm_id = vm["id"]
    else:
        # Smaak 2: vrije invoer met eigen waarden.
        naam = (gegevens.get("naam") or "").strip().lower()
        if not naam:
            raise FoutInvoer("naam of voedingsmiddel_id is verplicht")
        eenheid = gegevens.get("eenheid") or "stuks"
        if eenheid not in ("gram", "stuks"):
            raise FoutInvoer("eenheid moet 'gram' of 'stuks' zijn")
        waarden = [eis_getal(gegevens.get(k, 0), k, 0) for k in VOEDING_KOLOMMEN]
        vm_id = None

    cur = con.execute(
        "INSERT INTO voedingslog (datum, uur, voedingsmiddel_id, naam, "
        "hoeveelheid, eenheid, kcal, vet, koolhydraten, eiwit, zout, vezels) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (datum, uur, vm_id, naam, hoeveelheid, eenheid, *waarden))
    con.commit()
    return {"ok": True, "id": cur.lastrowid}


def api_voedingslog_bewerk(con, log_id, gegevens):
    """Hoeveelheid en/of uur van een gelogde portie aanpassen (tikfout
    verbeteren). Bij een nieuwe hoeveelheid schalen de bewaarde
    voedingswaarden evenredig mee: de regel behoudt zo zijn eigen
    waarden-per-eenheid van toen, ook als de catalogus intussen wijzigde."""
    rij = con.execute("SELECT * FROM voedingslog WHERE id = ?", (log_id,)).fetchone()
    if rij is None:
        raise FoutInvoer("logregel niet gevonden")

    uur = gegevens.get("uur")
    if uur not in (None, ""):
        uur = int(eis_getal(uur, "uur", 0))
        if uur > 24:
            raise FoutInvoer("uur moet tussen 0 en 24 liggen")
    else:
        uur = None

    hoeveelheid = eis_getal(gegevens.get("hoeveelheid"), "hoeveelheid", 0.01)
    factor = hoeveelheid / rij["hoeveelheid"] if rij["hoeveelheid"] else 1
    waarden = [round((rij[k] or 0) * factor, 1) for k in VOEDING_KOLOMMEN]

    con.execute(
        "UPDATE voedingslog SET uur=?, hoeveelheid=?, kcal=?, vet=?, "
        "koolhydraten=?, eiwit=?, zout=?, vezels=? WHERE id=?",
        (uur, hoeveelheid, *waarden, log_id))
    con.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# API: sportactiviteiten
# ---------------------------------------------------------------------------

def api_sport_nieuw(con, gegevens):
    """Sportactiviteit loggen: type, duur in minuten en (behalve bij
    krachttraining) eventueel de snelheid in km/u."""
    datum = eis_datum(gegevens.get("datum"))
    soort = gegevens.get("type")
    if soort not in SPORT_TYPES:
        raise FoutInvoer(f"type moet een van {SPORT_TYPES} zijn")
    duur = eis_getal(gegevens.get("duur_minuten"), "duur_minuten", 1)
    snelheid = gegevens.get("snelheid_kmh")
    snelheid = eis_getal(snelheid, "snelheid_kmh", 0.1) if snelheid not in (None, "") else None
    # Leesbare samenvatting, in de stijl van het oude rekenblad ("52m run ...").
    tekst = f"{duur:g}m {soort}" + (f" {snelheid:g}km/u" if snelheid else "")
    cur = con.execute(
        "INSERT INTO sportactiviteiten (datum, type, duur_minuten, snelheid_kmh, omschrijving) "
        "VALUES (?, ?, ?, ?, ?)", (datum, soort, duur, snelheid, tekst))
    con.commit()
    return {"ok": True, "id": cur.lastrowid}


# Vaste verwijderquery's per URL-naam; zo staat er nooit een variabele
# tabelnaam in een query.
VERWIJDER_QUERIES = {
    "voedingslog": "DELETE FROM voedingslog WHERE id = ?",
    "sport": "DELETE FROM sportactiviteiten WHERE id = ?",
    "gewicht": "DELETE FROM gewichtmetingen WHERE id = ?",
}


def verwijder(con, soort, rij_id):
    """Eén rij verwijderen (voedingslog, sport of gewicht)."""
    cur = con.execute(VERWIJDER_QUERIES[soort], (rij_id,))
    con.commit()
    if cur.rowcount == 0:
        raise FoutInvoer("niet gevonden")
    return {"ok": True}


# ---------------------------------------------------------------------------
# HTTP-afhandeling: routeert URL's naar de API-functies hierboven
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        # Beknopte toegangslog naar stderr.
        sys.stderr.write(f"{self.address_string()} {fmt % args}\n")

    # -- antwoorden versturen ------------------------------------------------

    def _json(self, gegevens, status=200):
        """Stuur een JSON-antwoord."""
        body = json.dumps(gegevens, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _fout(self, melding, status=400):
        """Stuur een foutmelding; de frontend toont die aan de gebruiker."""
        self._json({"fout": melding}, status)

    def _statisch(self, pad):
        """Serveer een bestand uit de map static/. De resolve()-controle
        voorkomt dat iemand met ../ buiten die map kan lezen."""
        if pad == "/":
            pad = "/index.html"
        bestand = (STATISCH / pad.lstrip("/")).resolve()
        if not str(bestand).startswith(str(STATISCH)) or not bestand.is_file():
            self._fout("niet gevonden", 404)
            return
        body = bestand.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(bestand.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # -- verzoeken verwerken ------------------------------------------------

    def _body(self):
        """Lees de JSON-body van een POST/PUT-verzoek."""
        lengte = int(self.headers.get("Content-Length") or 0)
        if lengte == 0:
            return {}
        return json.loads(self.rfile.read(lengte).decode("utf-8"))

    def _route(self, methode):
        """Gemeenschappelijke afhandeling voor alle HTTP-methodes: statische
        bestanden direct serveren, /api/-paden naar _api() sturen, en fouten
        omzetten in nette JSON-antwoorden."""
        url = urlparse(self.path)
        pad = url.path
        query = parse_qs(url.query)

        # Alles buiten /api/ is een statisch bestand (de frontend zelf).
        if not pad.startswith("/api/"):
            if methode == "GET":
                self._statisch(pad)
            else:
                self._fout("niet gevonden", 404)
            return

        con = db()
        try:
            gegevens = self._body() if methode in ("POST", "PUT") else None
            resultaat = self._api(methode, pad, query, gegevens, con)
            if resultaat is None:
                self._fout("niet gevonden", 404)
            else:
                self._json(resultaat)
        except FoutInvoer as f:
            self._fout(str(f))                       # 400: gebruikersfout
        except json.JSONDecodeError:
            self._fout("ongeldige JSON")
        except Exception as f:                        # noqa: BLE001
            self._fout(f"serverfout: {f}", 500)       # POC: toon de echte fout
        finally:
            con.close()

    def _api(self, methode, pad, query, gegevens, con):
        """De routetabel: (methode, pad) -> API-functie. Geeft None terug als
        er geen route past (wordt dan een 404)."""
        delen = pad.strip("/").split("/")[1:]  # padstukken zonder 'api'

        if methode == "GET":
            if pad == "/api/instellingen":
                return api_instellingen(con)
            if pad == "/api/gewicht":
                return api_gewicht_lijst(con)
            if pad == "/api/voedingsmiddelen":
                return api_voedingsmiddelen(con)
            if pad == "/api/dagen":
                return api_dagen(con, query)
            if len(delen) == 2 and delen[0] == "dag":   # /api/dag/2026-07-03
                return api_dag(con, delen[1])

        if methode == "POST":
            if pad == "/api/gewicht":
                return api_gewicht_nieuw(con, gegevens)
            if pad == "/api/voedingsmiddelen":
                return api_voedingsmiddel_nieuw(con, gegevens)
            if pad == "/api/voedingslog":
                return api_voedingslog_nieuw(con, gegevens)
            if pad == "/api/sport":
                return api_sport_nieuw(con, gegevens)

        if methode == "PUT":
            # PUT /api/instellingen: instellingen opslaan.
            if pad == "/api/instellingen":
                return api_instellingen_bewerk(con, gegevens)
            # PUT /api/voedingsmiddelen/<id>: waarden van een catalogusitem bewerken.
            if len(delen) == 2 and delen[0] == "voedingsmiddelen":
                return api_voedingsmiddel_bewerk(con, int(delen[1]), gegevens)
            # PUT /api/voedingslog/<id>: hoeveelheid/uur van een logregel bewerken.
            if len(delen) == 2 and delen[0] == "voedingslog":
                return api_voedingslog_bewerk(con, int(delen[1]), gegevens)

        if methode == "DELETE" and len(delen) == 2:
            # DELETE /api/voedingsmiddelen/<id>: catalogusitem weg (log blijft).
            if delen[0] == "voedingsmiddelen":
                return api_voedingsmiddel_verwijder(con, int(delen[1]))
            # DELETE /api/<soort>/<id>: logregel, sport of gewichtmeting weg.
            if delen[0] in VERWIJDER_QUERIES:
                return verwijder(con, delen[0], int(delen[1]))

        return None

    # http.server verwacht per HTTP-methode een aparte do_*-functie.
    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_PUT(self):
        self._route("PUT")

    def do_DELETE(self):
        self._route("DELETE")


def main():
    if not DB_PAD.exists():
        sys.exit("gezondheid.db niet gevonden — hoort naast app.py te staan")
    poort = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = ThreadingHTTPServer(("0.0.0.0", poort), Handler)
    print(f"Gezondheidsdashboard draait op http://0.0.0.0:{poort}  (Ctrl+C om te stoppen)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
