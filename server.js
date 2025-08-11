const express = require('express');
const sqlite3 = require('better-sqlite3');
const path = require('path');
const session = require('express-session');
const nodemailer = require('nodemailer');
const ics = require('ics');
const ICAL = require('ical.js');
const { google } = require('googleapis');
const credentials = require('./google_credentials.json');
const token = require('./token.json');
const app = express();
const db = sqlite3('database.db');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'adminsecret', resave: false, saveUninitialized: false }));

const FIXKOSTEN = { reinigung: 100, bettwaesche: 15 };

// Liste der iCal-Kalender mit Farben
const icalCalendars = [
  { name: "Booking", url: "https://ical.booking.com/v1/export?t=f4bea42b-a403-4b92-af56-f53ef94efecb", color: "#b3b3b3ff", border: "#fcabdeff" },
  { name: "BestFewo", url: "https://www.optimale-praesentation.de/comm/ical/eb159700_f2e12b7b/belegungen.ics", color: "#a67fbaff", border: "#5e008f" }
  // Weitere Kalender nach Bedarf, jeweils mit color und border
];

// Konfiguration für den Sammel-Kalender (alle importierten Events zusammengefasst)
const icalCombinedCalendar = {
  name: "Alle Kalender",
  color: "#28a745",      // z.B. grün
  border: "#1e7e34"
};




// Tabellen erstellen
const createTables = `
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  start_date TEXT,
  end_date TEXT,
  name TEXT,
  email TEXT,
  category TEXT,
  total_price REAL,
  guests INTEGER,           -- <--- NEU: Anzahl Personen
  has_pet INTEGER            -- <--- NEU: Mit Haustier (0/1)
);
CREATE TABLE IF NOT EXISTS prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT,
  category TEXT,
  price REAL,
  min_nights INTEGER DEFAULT 1  -- Mindestnächte
);
`;
db.exec(createTables);

// Tabelle für iCal-Events anlegen (falls noch nicht vorhanden)
db.exec(`
CREATE TABLE IF NOT EXISTS ical_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  start TEXT,
  end TEXT,
  calendarName TEXT
);
`);


// Neue Spalte min_nights zu prices hinzufügen (falls noch nicht vorhanden)
try { db.prepare('ALTER TABLE prices ADD COLUMN min_nights INTEGER DEFAULT 1').run(); } catch(e){}

// Einmalig: Alle Buchungen löschen
//db.exec('DELETE FROM bookings');


// SMTP Transporter für Nodemailer (bitte SMTP Daten anpassen)
const transporter = nodemailer.createTransport({
  host: 'smtp.example.com', // z.B. smtp.gmail.com
  port: 587,
  secure: false,
  auth: {
    user: 'dein@email.de',
    pass: 'deinpasswort'
  }
});

// Buchungen abrufen (JSON)
app.get('/api/events', (req, res) => {
  const rows = db.prepare('SELECT * FROM bookings').all();
  const events = rows.map(b => ({
    id: b.id,
    title: b.title,
    start: b.start_date,
    end: b.end_date,
    backgroundColor: '#fcb28eff',
    textColor: '#222',
    category: b.category,
    extendedProps: {
      name: b.name,
      email: b.email,
      total_price: b.total_price,
      category: b.category,
      guests: b.guests,           // <-- geändert von persons zu guests
      has_pet: !!b.has_pet
    }
  }));
  res.json(events);
});

// Buchung speichern & E-Mail senden
app.post('/api/events', async (req, res) => {
  try {
    const { title, start_date, end_date, name, email, categoryIn, guests, has_pet } = req.body; // <-- geändert von persons zu guests
    const start = new Date(start_date);
    const end = new Date(end_date);
    let current = new Date(start);

    let category = categoryIn === 'Mit Haustier' ? 'Category2' : 'Category1';

    const dayPricesStmt = db.prepare('SELECT price FROM prices WHERE date = ? AND category = ?');
    let sum = 0;
    while (current < end) {
      const dateStr = current.toISOString().slice(0, 10);
      const priceEntry = dayPricesStmt.get(dateStr, category);
      if (has_pet) priceEntry.price *= 1.05; // 5% Aufschlag für Haustier
      if (priceEntry) sum += priceEntry.price;
      current.setDate(current.getDate() + 1);
    }
    sum += FIXKOSTEN.reinigung + FIXKOSTEN.bettwaesche;

    // Rabatt: 10% ab 7 Nächten
    const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    if (days > 6) {
      sum *= 0.9; // 10% Rabatt
    }

    ////sum += 15 * guests; // pro Person
    ////if (bettwaesche) sum += 10 * guests;

    const insert = db.prepare('INSERT INTO bookings (title, start_date, end_date, name, email, category, total_price, guests, has_pet) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'); // <-- geändert von persons zu guests
    const info = insert.run(title, start_date, end_date, name, email, category, sum, guests, has_pet ? 1 : 0); // <-- geändert von persons zu guests

    // E-Mail senden
    const mailOptions = {
      from: '"Buchungsportal" <no-reply@deine-domain.de>',
      to: email,
      subject: 'Ihre Buchungsbestätigung',
      text: `Hallo ${name},

Ihre Buchung wurde erfolgreich erfasst:

Titel: ${title}
Zeitraum: ${start_date} bis ${end_date}
Kategorie: ${category}
Gesamtpreis: ${sum.toFixed(2)} €

Vielen Dank!

Mit freundlichen Grüßen,
Ihr Buchungsteam`
    };

    ////await transporter.sendMail(mailOptions);

    res.json({ success: true, total_price: sum });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  }
});



// Preise abrufen – gestapelt, farbig pro Kategorie
app.get('/api/prices', (req, res) => {
  const colorMap = {
    "Category1": '#029df1ff', // blau
    "Category2": '#8300c4'  // lila
  };

  const rows = db.prepare('SELECT * FROM prices').all();
  const events = rows.map(p => ({
    id: p.id, // <-- ID hinzufügen!
    start: p.date,
    end: p.date,
    backgroundColor: colorMap[p.category] || '#eef',
    extendedProps: { price: `${p.price.toFixed(2)} €`, priceCategory: p.category, minNights: p.min_nights } // <-- HIER
  }));
  res.json(events);
});


app.post('/api/prices', (req, res) => {
  const { start_date, end_date, category, price, min_nights } = req.body;

  if (!start_date || !end_date || !category || typeof price !== 'number') {
    return res.status(400).json({ error: 'Ungültige Eingabedaten' });
  }

  const start = new Date(start_date);
  const end = new Date(end_date);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ error: 'Ungültige Datumsangabe' });
  }

  const dates = [];
  let current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10);
    dates.push(dateStr);
    current.setDate(current.getDate() + 1);
  }

  const insertOrUpdate = db.transaction((rows) => {
    for (const date of rows) {
      // Prüfen, ob bereits ein Eintrag existiert
      const existing = db.prepare('SELECT id FROM prices WHERE date = ? AND category = ?').get(date, category);
      if (existing) {
        // Update, falls vorhanden
        db.prepare('UPDATE prices SET price = ?, min_nights = ? WHERE id = ?').run(price, min_nights, existing.id);
      } else {
        // Sonst neu einfügen
        db.prepare('INSERT INTO prices (date, category, price, min_nights) VALUES (?, ?, ?, ?)').run(date, category, price, min_nights || 1);
      }
    }
  });

  insertOrUpdate(dates);

  res.json({ success: true, inserted: dates.length });
});

// Preis löschen per ID
app.delete('/api/prices/:id', (req, res) => {
  try {
    const id = req.params.id;
    const stmt = db.prepare('DELETE FROM prices WHERE id = ?');
    const result = stmt.run(id);
    if (result.changes > 0) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Preis nicht gefunden' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Löschen' });
  }
});

// Preise im Zeitraum und Kategorie löschen
app.delete('/api/prices', (req, res) => {
  try {
    const { start_date, end_date, category } = req.body;
    if (!start_date || !end_date || !category) {
      return res.status(400).json({ error: 'Ungültige Eingabedaten' });
    }
    const stmt = db.prepare('DELETE FROM prices WHERE date >= ? AND date <= ? AND category = ?');
    const result = stmt.run(start_date, end_date, category);
    res.json({ success: true, deleted: result.changes });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Löschen' });
  }
});

// iCal Export Route (alle Buchungen)
app.get('/api/ical', (req, res) => {
  const bookings = db.prepare('SELECT * FROM bookings').all();

  const events = bookings.map(b => {
    // Datum konvertieren [YYYY, M-1, D, H, M]
    const startDate = new Date(b.start_date);
    const endDate = new Date(b.end_date);

    return {
      start: [startDate.getFullYear(), startDate.getMonth()+1, startDate.getDate(), 0, 0],
      end: [endDate.getFullYear(), endDate.getMonth()+1, endDate.getDate(), 0, 0],
      title: `${b.title} (${b.category})`,
      description: `Gebucht von: ${b.name} (${b.email})\nPreis: ${b.total_price.toFixed(2)} €`
    };
  });

  ics.createEvents(events, (error, value) => {
    if (error) {
      console.error(error);
      return res.status(500).send('Fehler beim Erzeugen des iCal-Exports');
    }
    res.setHeader('Content-Disposition', 'attachment; filename="buchungen.ics"');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.send(value);
  });
});

// Adminseite anzeigen
app.get('/admin', (req, res) => {
  res.render('admin');
});

// Buchungsseite anzeigen
app.get('/calendar', (req, res) => {
  res.render('calendar');
});

// Buchung aktualisieren
app.put('/api/events/:id', (req, res) => {
  try {
    const { title, start_date, end_date, name, email, category, guests, has_pet } = req.body;
    const stmt = db.prepare('UPDATE bookings SET title = ?, start_date = ?, end_date = ?, name = ?, email = ?, category = ?, guests = ?, has_pet = ? WHERE id = ?');
    const result = stmt.run(title, start_date, end_date, name, email, category, guests, has_pet, req.params.id);
    if (result.changes > 0) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Buchung nicht gefunden' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Aktualisieren' });
  }
});

// Buchung löschen
app.delete('/api/events/:id', (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM bookings WHERE id = ?');
    const result = stmt.run(req.params.id);
    if (result.changes > 0) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Buchung nicht gefunden' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Löschen' });
  }
});

// Funktion zum Speichern der iCal-Events in SQLite
async function saveIcalEventsToDB(events) {
  db.prepare('DELETE FROM ical_events').run();
  const insert = db.prepare('INSERT INTO ical_events (title, start, end, calendarName, backgroundColor, borderColor) VALUES (?, ?, ?, ?, ?, ?)');
  const insertMany = db.transaction((events) => {
    for (const ev of events) {
      insert.run(ev.title, ev.start, ev.end, ev.calendarName, ev.backgroundColor, ev.borderColor);
    }
  });
  insertMany(events);
}

async function syncIcalCalendars() {
  const allEvents = [];
  for (const cal of icalCalendars) {
    try {
      const res = await fetch(cal.url);
      const icsText = await res.text();
      const jcalData = ICAL.parse(icsText);
      const comp = new ICAL.Component(jcalData);
      const vevents = comp.getAllSubcomponents('vevent');
      vevents.forEach(ev => {
        const event = new ICAL.Event(ev);
        let endDateEvent = event.endDate ? new Date(event.endDate.toString()) : new Date(event.startDate.toString());
        // NEU: Auch als Buchung in die DB eintragen, aber nur wenn noch nicht vorhanden
        const startDate = event.startDate.toString().slice(0, 10);
        const endDate = endDateEvent.toISOString().slice(0, 10);

        //endDate.setDate(endDate.getDate() + 1);
        allEvents.push({
          title: `${cal.name}: ${event.summary}`,
          start: startDate,
          end: endDate,
          calendarName: cal.name,
          backgroundColor: cal.color,
          borderColor: cal.border
        });

        const existsBooking = db.prepare(
          'SELECT id FROM bookings WHERE start_date = ? AND end_date = ?'
        ).get(startDate, endDate);

        if (!existsBooking) {
          const insertBooking = db.prepare(`INSERT INTO bookings 
            (title, start_date, end_date, name, email, category, total_price, guests, has_pet) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
          insertBooking.run(
            "Belegt",
            startDate,
            endDate,
            cal.name,
            "",
            "Category1",
            0,
            1,
            0
          );
        }
      });
    } catch (err) {
      console.warn(`Fehler beim Laden von ${cal.name}:`, err);
    }
  }

  // Sammel-Kalender-Event: alle importierten Events zusammengefasst
  // Jeder Event bekommt den Originaltitel aus dem importierten Kalender!
  const combinedEvents = allEvents.map(ev => ({
    // Nur den Originaltitel übernehmen, KEIN "Alle Kalender:" davor!
    title: ev.title,
    start: ev.start,
    end: ev.end,
    calendarName: icalCombinedCalendar.name,
    backgroundColor: icalCombinedCalendar.color,
    borderColor: icalCombinedCalendar.border
  }));

  // only uncomment this line if you want to delete all events from the combined calendar before writing new ones
  //await deleteAllEventsFromCombinedGoogleCalendar();
  // Speichere alle Einzel-Events und Sammel-Events
  await saveIcalEventsToDB([...allEvents, ...combinedEvents]);
  await writeCombinedEventsToGoogleCalendar(); // <-- Hier wird sie nach jedem Sync aufgerufen!
}


// Google Calendar API Setup
const { client_id, client_secret, redirect_uris } = credentials.installed;
const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);
oAuth2Client.setCredentials(token);

const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
const calendarId = 'b878d561d60b5b4e1546ec54f4c1db269ad15186109544f436df5a5b6f3c85ed@group.calendar.google.com';

// Neue Funktion: Kombinierte Events in Google Calendar schreiben
async function writeCombinedEventsToGoogleCalendar() {
  // Hole alle Sammel-Events aus der DB
  const rows = db.prepare('SELECT * FROM ical_events WHERE calendarName = ?').all(icalCombinedCalendar.name);

  // Duplikate vermeiden: Hole existierende Events aus Google Kalender
  const existingEvents = await calendar.events.list({
    calendarId: calendarId,
    timeMin: new Date().toISOString(), // nur zukünftige Events
    maxResults: 2500,
    singleEvents: true,
    orderBy: 'startTime'
  });

  // Erstelle eine Set mit Titeln und Startzeiten der existierenden Events
  const existingSet = new Set(
    existingEvents.data.items.map(ev =>
      `${ev.summary}|${(ev.start?.dateTime || ev.start?.date || '').slice(0, 10)}`
    )
  );

  console.log(`Überprüfe ${rows.length} Events auf fehlende Einträge im Google Kalender: ${icalCombinedCalendar.name}`);

  for (const ev of rows) {
    // Nur das Datum extrahieren (ohne Uhrzeit/Zeitzone)
    const startDate = new Date(ev.start);
    const startKey = `${ev.title}|${startDate.toISOString().slice(0, 10)}`;

    // Passe auch die existingSet-Erstellung an:
    const existingSet = new Set(
      existingEvents.data.items.map(ev =>
        `${ev.summary}|${(ev.start?.dateTime || ev.start?.date || '').slice(0, 10)}`
      )
    );

    if (existingSet.has(startKey)) continue; // Event existiert schon, überspringen

    try {
      await calendar.events.insert({
        calendarId,
        resource: {
          summary: ev.title,
          start: { dateTime: startDate.toISOString() },
          end: { dateTime: new Date(ev.end).toISOString() }
        }
      });
      console.log(`Event hinzugefügt zu ${icalCombinedCalendar.name}: ${ev.title} (${startDate.toISOString()} - ${ev.end})`);
    } catch (err) {
      console.error('Fehler beim Schreiben in Google Kalender:', err);
    }
  }
}

// Funktion: Alle Events aus dem "Alle Kalender"-Google-Kalender löschen
async function deleteAllEventsFromCombinedGoogleCalendar() {

  console.log('Lösche alle Events aus dem Google Kalender:', calendarId);
  // Alle Events abrufen (ggf. paginieren)
  let pageToken = undefined;
  do {
    const res = await calendar.events.list({
      calendarId,
      maxResults: 2500,
      singleEvents: true,
      pageToken
    });
    const events = res.data.items;
    for (const ev of events) {
      try {
        await calendar.events.delete({ calendarId, eventId: ev.id });
        console.log(`Event gelöscht: ${ev.summary} (${ev.start?.dateTime || ev.start?.date})`);
      } catch (err) {
        console.error('Fehler beim Löschen aus Google Kalender:', err);
      }
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
}

// Alle 5 Minuten synchronisieren
setInterval(syncIcalCalendars, 5 * 60 * 1000);
// Beim Serverstart einmal synchronisieren
syncIcalCalendars();

app.listen(3000, () => console.log('Server auf http://localhost:3000'));

// Neue Route: iCal-Events abrufen
app.get('/api/ical-events', (req, res) => {
  const rows = db.prepare('SELECT * FROM ical_events').all();
  const events = rows.map(ev => ({
    id: ev.id,
    title: ev.title,
    start: ev.start,
    end: ev.end,
    backgroundColor: ev.backgroundColor,
    borderColor: ev.borderColor,
    calendarName: ev.calendarName // <-- Kalendername wird mit ausgegeben
  }));
  res.json(events);
});


