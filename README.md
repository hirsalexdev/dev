# Snowbusters Demo

Eine spielbare Nachbildung dessen, was die **Whiteout Survival**-Werbung verspricht — aber das echte Spiel nicht liefert.

In den Ads steuerst du eine kleine Figur durch verschneite Landschaften, räumst Schnee weg, taust eingefrorene Survivors auf, hältst ein Lagerfeuer am Leben und bekämpfst Schneebestien. Das tatsächliche Mobile Game ist dagegen ein Idle-Strategy-City-Builder ohne diese Action-Mechanik.

Diese Demo baut die beworbene Mechanik als kurzes, eigenständiges Browser-Game nach.

## Spielen

```sh
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

Es braucht keinen Build-Schritt — `phaser.min.js` liegt direkt im Repo, alles ist Vanilla JS.

## Steuerung

- **WASD** oder **Pfeiltasten** — bewegen & gleichzeitig Schnee räumen
- **Leertaste halten** — Survivor in Reichweite auftauen
- **Leertaste tippen** — Bestie in Reichweite angreifen
- **E** — am Lagerfeuer Kohle einwerfen (Feuer-Level ↑ → mehr HP-Regen)
- **Rocket-Button** — sobald 95% Schnee geräumt sind, Stage beenden

## Mechaniken

| Ressource     | Effekt                                                                 |
|---------------|------------------------------------------------------------------------|
| ⛽ Fuel        | Wird bei Bewegung verbraucht. Geht aus → Game Over.                    |
| ❤️ HP          | Beasts machen Schaden. Nahe am Feuer regeneriert es sich.              |
| 🪨 Kohle       | Drops von Beasts. 3× Kohle ins Feuer = Feuer-Level ↑.                  |
| 🔥 Feuer-Lv    | Höheres Level = schnellere HP-Regeneration in der Aura.                |
| 🧑 Survivor    | Aufgetaute Survivor erweitern deinen Räum-Radius dauerhaft.            |
| ❄️ Snow %      | Bei 95% kannst du die Rakete zünden und die Stage gewinnen.            |

## Dateien

- `index.html` — Markup, HUD, Phaser-Mount
- `styles.css` — HUD- und Overlay-Styling
- `game.js` — komplette Game-Logik (Phaser 3 Scene)
- `phaser.min.js` — gebundelter Phaser 3.80.1
