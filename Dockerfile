
# Node.js offizielles Image verwenden
FROM node:18-alpine

# Arbeitsverzeichnis erstellen
WORKDIR /app

# Package-Dateien kopieren
COPY package*.json ./

# Abhängigkeiten installieren
RUN npm install --production

# Restliche App kopieren
COPY . .

# Port freigeben
EXPOSE 3000

# Startbefehl
CMD ["npm", "start"]
