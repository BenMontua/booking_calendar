# Buchungsportal mit FullCalendar 6

## Features
- Admin- und Buchungsseite mit FullCalendar 6
- Drag & Drop Preisverwaltung pro Tag und Kategorie
- Buchungen mit Namens-/E-Mail-Eingabe
- Fixkosten wie Reinigung und Bettwäsche
- SQLite-Datenbank (lokal eingebettet)
- Docker-bereit

## Lokale Installation

# bash
npm install
npm start


## Google auth flow

Natürlich! Hier ist eine Schritt-für-Schritt-Anleitung, wie du den OAuth2-Flow für die Google Calendar API in Node.js einrichtest:

1. Google Cloud Projekt & API aktivieren
Gehe zu Google Cloud Console.
Erstelle ein neues Projekt.
Aktiviere die Google Calendar API für das Projekt.
Gehe zu APIs & Dienste → Anmeldedaten und erstelle OAuth 2.0-Client-IDs (Typ: Desktop-App).
Lade die Datei credentials.json herunter.
2. Installiere die benötigten Pakete
3. Erstelle ein Setup-Skript für den OAuth2-Flow
Erstelle z.B. eine Datei google-auth.js:

4. Starte das Skript

node google-auth.js

Folge der Anleitung im Terminal: Öffne den Link, logge dich mit deinem Google-Konto ein, erlaube den Zugriff, kopiere den Code und füge ihn im Terminal ein.
Das Token wird in token.json gespeichert.
5. Nutze das Token in deinem Server