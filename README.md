# py-studio

Ein minimalistischer Python-Editor im VS-Code-Stil. CodeMirror liefert Syntax-Highlighting und Pyodide führt CPython direkt in einem Web Worker im Browser aus. Es gibt kein Backend und es werden keine Dateien hochgeladen.

## Lokal starten

Die Seite muss über HTTP geöffnet werden, damit ES-Module und der Worker funktionieren:

```bash
python3 -m http.server 8000
```

Danach `http://localhost:8000` öffnen. Beim ersten Ausführen lädt der Browser Pyodide von jsDelivr; dafür ist eine Internetverbindung nötig.

## GitHub Pages

1. Repository auf GitHub anlegen und diesen Ordner pushen.
2. Unter **Settings → Actions → General** die Ausführung von Actions erlauben.
3. Unter **Settings → Pages** als Quelle **GitHub Actions** auswählen.
4. Auf den Branch `main` pushen. Der Workflow unter `.github/workflows/pages.yml` veröffentlicht die statischen Dateien.

Die Anwendung läuft danach vollständig im Browser des jeweiligen Besuchers. Der Python-Code wird in `localStorage` gespeichert und bleibt auf diesem Gerät erhalten.

## Grenzen

Pyodide ist ein CPython-Build für WebAssembly. Viele reine Python-Pakete funktionieren, native Pakete aber nur, wenn es dafür ein passendes Pyodide-Paket gibt. Server-Frameworks, dauerhafte Hintergrundprozesse und serverseitige Dateisysteme stehen nicht zur Verfügung.

## Bedienung und Ausfallsicherheit

Run oder Ctrl/⌘+Enter führt den Code aus. Stop beendet den Worker auch bei Endlosschleifen und lädt eine frische Runtime; Python-Variablen und das virtuelle Dateisystem gehen dabei verloren. Clear leert nur das Terminal. Zurücksetzen stellt den Beispielcode wieder her, Download speichert `main.py` (auch auf Mobilgeräten).

Ist das CodeMirror-CDN nicht erreichbar oder antwortet es nicht innerhalb von 15 Sekunden, bleibt ein einfacher Texteditor verfügbar. Bei einem Runtime-Ladefehler oder nach 90 Sekunden Ladezeit lässt sich Python mit Run erneut laden. Ohne Zugriff auf das Pyodide-CDN ist keine Ausführung möglich. `input()` erhält EOF; interaktive Eingaben werden nicht unterstützt. Die Terminalansicht begrenzt ältere Ausgabe auf 1.000 Fragmente bzw. 200.000 Zeichen.

Syntaxprüfungen: `node --check --input-type=module < app.js` und `node --check pyodide-worker.js`. Der Pages-Workflow prüft JavaScript und veröffentlicht nur die vier benötigten statischen Dateien.
