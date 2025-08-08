const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');

// Lade Client-IDs aus credentials.json
const credentials = require('./google_credentials.json');
const { client_id, client_secret, redirect_uris } = credentials.installed;

const oAuth2Client = new google.auth.OAuth2(
  client_id, client_secret, redirect_uris[0]
);

// Token-Datei
const TOKEN_PATH = 'token.json';

// Prüfe, ob Token existiert
fs.readFile(TOKEN_PATH, (err, token) => {
  if (err) return getAccessToken(oAuth2Client);
  oAuth2Client.setCredentials(JSON.parse(token));
  console.log('OAuth2 erfolgreich eingerichtet!');
  // Hier kannst du z.B. Events schreiben/testen
});

// Funktion zum Abrufen eines neuen Tokens
function getAccessToken(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
  });
  console.log('Öffne diesen Link im Browser und gib den Code ein:', authUrl);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question('Code hier eingeben: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Fehler beim Abrufen des Tokens', err);
      oAuth2Client.setCredentials(token);
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
      console.log('Token gespeichert!');
    });
  });
}