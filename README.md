# Booking Calendar App

## Beschreibung
Node.js-basierte Buchungskalender-Webanwendung mit:

- Kalenderanzeige und Verwaltung von Preisen pro Tag und Kategorie
- Buchungsfunktion mit Name, E-Mail und automatischer Preisberechnung inklusive Fixkosten (Reinigung, Bettwäsche)
- E-Mail-Bestätigung der Buchung an den Kunden
- iCal Export aller Buchungen als `.ics` Datei
- SQLite Datenbank
- Admin-Interface für Preisverwaltung

## Installation

1. Repository klonen oder Dateien kopieren
2. Abhängigkeiten installieren:

```bash
npm install







Nach erfolgreicher Buchung bekommt der Kunde eine E-Mail (SMTP anpassen).

Unter /api/ical kannst du alle Buchungen als iCal herunterladen.

Beide Funktionen sind in server.js integriert.

Frontend bleibt gleich, nur API erweitert.


Die Dateien sind nun komplett:

public/main.css für Design

public/scripts.js als Erweiterungspunkt

views/admin.ejs für Preisverwaltung

views/calendar.ejs für Buchung

server.js mit SQLite und API-Routen