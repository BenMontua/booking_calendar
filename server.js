const express = require('express');
const sqlite3 = require('better-sqlite3');
const path = require('path');
const session = require('express-session');
const nodemailer = require('nodemailer');
const ics = require('ics');
const app = express();
const db = sqlite3('database.db');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'adminsecret', resave: false, saveUninitialized: false }));

const FIXKOSTEN = { reinigung: 40, bettwaesche: 10 };

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
  total_price REAL
);
CREATE TABLE IF NOT EXISTS prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT,
  category TEXT,
  price REAL
);`;
db.exec(createTables);

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
    backgroundColor: '#fbceb1',
    textColor: '#222',
    category: b.category, // <-- HIER
    extendedProps: { name: b.name, email: b.email, total_price: b.total_price, category: b.category } // <-- HIER
  }));
  res.json(events);
});

// Preise abrufen – gestapelt, farbig pro Kategorie
app.get('/api/prices', (req, res) => {
  const colorMap = {
    "Category1": '#4abcf9', // blau
    "Category2": '#8300c4'  // lila
  };

  const rows = db.prepare('SELECT * FROM prices').all();
  const events = rows.map(p => ({
    id: p.id, // <-- ID hinzufügen!
    start: p.date,
    end: p.date,
    backgroundColor: colorMap[p.category] || '#eef',
    extendedProps: { price: `${p.price.toFixed(2)} €`, priceCategory: p.category } // <-- HIER
  }));
  res.json(events);
});


app.post('/api/prices', (req, res) => {
  try {
    const { start_date, end_date, category, price } = req.body;

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
          db.prepare('UPDATE prices SET price = ? WHERE id = ?').run(price, existing.id);
        } else {
          // Sonst neu einfügen
          db.prepare('INSERT INTO prices (date, category, price) VALUES (?, ?, ?)').run(date, category, price);
        }
      }
    });

    insertOrUpdate(dates);

    res.json({ success: true, inserted: dates.length });
  } catch (err) {
    console.error('Fehler beim Einfügen von Preisen:', err);
    res.status(500).json({ error: 'Serverfehler beim Speichern' });
  }
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

// Buchung speichern & E-Mail senden
app.post('/api/events', async (req, res) => {
  try {
    const { title, start_date, end_date, name, email, categoryIn, guests, bettwaesche, haustiere } = req.body;
    const start = new Date(start_date);
    const end = new Date(end_date);
    let current = new Date(start);

    let category = categoryIn === 'Mit Haustier' ? 'Category2' : 'Category1';

    const dayPricesStmt = db.prepare('SELECT price FROM prices WHERE date = ? AND category = ?');
    let sum = 0;
    while (current < end) {
      const dateStr = current.toISOString().slice(0, 10);
      const priceEntry = dayPricesStmt.get(dateStr, category);
      if (haustiere) priceEntry.price *= 1.11;
      if (priceEntry) sum += priceEntry.price;
      current.setDate(current.getDate() + 1);
    }
    sum += FIXKOSTEN.reinigung + FIXKOSTEN.bettwaesche;

    ////sum += 15 * guests; // pro Person
    ////if (bettwaesche) sum += 10 * guests;
   
    const insert = db.prepare('INSERT INTO bookings (title, start_date, end_date, name, email, category, total_price) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const info = insert.run(title, start_date, end_date, name, email, category, sum);

    
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
app.get('/', (req, res) => {
  res.render('calendar');
});

// Buchung aktualisieren
app.put('/api/events/:id', (req, res) => {
  try {
    const { title, start_date, end_date, name, email, category } = req.body;
    const stmt = db.prepare('UPDATE bookings SET title = ?, start_date = ?, end_date = ?, name = ?, email = ?, category = ? WHERE id = ?');
    const result = stmt.run(title, start_date, end_date, name, email, category, req.params.id);
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

app.listen(3000, () => console.log('Server auf http://localhost:3000'));
