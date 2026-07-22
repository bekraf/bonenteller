"""Minimale Marionette-client (Firefox aansturen met alleen stdlib).

Gebruik:
    mkdir -p <scratchpad>/ffprofiel
    MOZ_HEADLESS=1 firefox --headless --no-remote --marionette \
        --profile <scratchpad>/ffprofiel about:blank &
    # wachten tot poort 2828 luistert, dan:
    python3 marionette.py "http://127.0.0.1:8377/?dagen=30" \
        "return document.title"

Of importeren:
    m = Marionette(); m.cmd("WebDriver:NewSession", {})
    m.cmd("WebDriver:Navigate", {"url": ...}); print(m.js("return 1+1"))
    m.cmd("Marionette:Quit", {"flags": ["eForceQuit"]})   # sluit Firefox af
"""
import json, socket, sys, time


class Marionette:
    def __init__(self, port=2828, wachtsec=30):
        for _ in range(wachtsec * 2):
            try:
                self.s = socket.create_connection(("127.0.0.1", port), timeout=5)
                break
            except OSError:
                time.sleep(0.5)
        else:
            sys.exit("kan niet verbinden met marionette (draait firefox --marionette?)")
        self.s.settimeout(30)
        self.buf = b""
        self.msgid = 0
        self._recv()  # begroeting

    def _recv(self):
        # Pakketformaat: b"<lengte>:<json>"
        while b":" not in self.buf:
            self.buf += self.s.recv(65536)
        n, rest = self.buf.split(b":", 1)
        n = int(n)
        while len(rest) < n:
            rest += self.s.recv(65536)
        pakket, self.buf = rest[:n], rest[n:]
        return json.loads(pakket)

    def cmd(self, naam, params=None):
        # Commando [0, msgid, naam, params] -> antwoord [1, msgid, fout, resultaat]
        self.msgid += 1
        m = json.dumps([0, self.msgid, naam, params or {}]).encode()
        self.s.sendall(str(len(m)).encode() + b":" + m)
        while True:
            antw = self._recv()
            if antw[0] == 1 and antw[1] == self.msgid:
                if antw[2]:
                    sys.exit(f"fout bij {naam}: {antw[2]}")
                return antw[3]

    def js(self, script):
        """Voer JS uit in de pagina; 'return ...' bepaalt de uitkomst."""
        return self.cmd("WebDriver:ExecuteScript",
                        {"script": script, "args": []})["value"]


if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8377/"
    script = sys.argv[2] if len(sys.argv) > 2 else "return document.title"
    m = Marionette()
    m.cmd("WebDriver:NewSession", {})
    m.cmd("WebDriver:Navigate", {"url": url})
    time.sleep(2)  # data laden + grafieken tekenen
    print(m.js(script))
    m.cmd("Marionette:Quit", {"flags": ["eForceQuit"]})
