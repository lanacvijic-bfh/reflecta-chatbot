# Azure Deployment Guide - Reflecta

Diese Anleitung zeigt, wie Sie Reflecta auf Azure hosten können, damit HTTPS verfügbar ist und der Browser-Mikrofon-Zugriff funktioniert.

## Übersicht

**Architektur:**
- **Frontend**: Azure Static Web Apps oder Azure App Service (Next.js)
- **Backend**: Azure App Service (Node.js)
- **HTTPS**: Automatisch verfügbar (erforderlich für Mikrofon-Zugriff)

## Option 1: Azure App Service (Empfohlen)

### Vorteile
- ✅ Einfaches Deployment
- ✅ HTTPS automatisch verfügbar
- ✅ Skalierbar
- ✅ Unterstützt Node.js und Next.js

### Schritt 1: Backend auf Azure App Service deployen

1. **Azure Portal öffnen**
   - Gehen Sie zu [portal.azure.com](https://portal.azure.com)
   - Klicken Sie auf "Create a resource"
   - Suchen Sie nach "Web App"
   - Klicken Sie auf "Create"

2. **Backend App Service erstellen**
   - **Subscription**: Wählen Sie Ihr Abonnement
   - **Resource Group**: Erstellen Sie eine neue (z.B. "reflecta-rg")
   - **Name**: z.B. `reflecta-backend` (muss eindeutig sein)
   - **Publish**: Code
   - **Runtime stack**: Node.js 20 LTS
   - **Operating System**: Linux
   - **Region**: Wählen Sie eine Region (z.B. "Switzerland North" für Datenschutz)
   - **App Service Plan**: Erstellen Sie einen neuen Plan (z.B. "Basic B1" für Testing)
   - Klicken Sie auf "Review + create" → "Create"

3. **Backend-Code deployen**

   **Option A: GitHub Actions (Empfohlen)**
   
   Erstellen Sie `.github/workflows/deploy-backend.yml`:
   ```yaml
   name: Deploy Backend to Azure
   
   on:
     push:
       branches: [ main ]
       paths:
         - 'eol-chat-starter/Backend/**'
   
   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v3
         
         - name: Setup Node.js
           uses: actions/setup-node@v3
           with:
             node-version: '20'
         
         - name: Install dependencies
           working-directory: ./eol-chat-starter/Backend
           run: npm install
         
         - name: Deploy to Azure
           uses: azure/webapps-deploy@v2
           with:
             app-name: 'reflecta-backend'
             publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
             package: ./eol-chat-starter/Backend
   ```
   
   **Option B: Azure CLI**
   ```bash
   # Login
   az login
   
   # Deploy
   cd eol-chat-starter/Backend
   az webapp up --name reflecta-backend --runtime "NODE:20-lts" --os-type Linux
   ```

4. **Umgebungsvariablen konfigurieren**
   
   Im Azure Portal:
   - Gehen Sie zu Ihrer App Service → "Configuration" → "Application settings"
   - Fügen Sie hinzu:
     ```
     AZURE_OPENAI_API_KEY=<Ihr-API-Key>
     AZURE_OPENAI_ENDPOINT=https://reflecta.cognitiveservices.azure.com
     AZURE_OPENAI_DEPLOYMENT=gpt-4.1
     AZURE_OPENAI_API_VERSION=2024-02-15-preview
     OPENAI_API_KEY=<Fallback-API-Key>
     MODEL=gpt-4
     PORT=8080
     ```
   - Klicken Sie auf "Save"

5. **Startup-Command setzen**
   
   Im Azure Portal:
   - Gehen Sie zu "Configuration" → "General settings"
   - **Startup Command**: `node server.mjs`
   - Klicken Sie auf "Save"

6. **CORS konfigurieren**
   
   Im Azure Portal:
   - Gehen Sie zu "Configuration" → "CORS"
   - Fügen Sie Ihre Frontend-URL hinzu (z.B. `https://reflecta-frontend.azurestaticapps.net`)
   - Oder aktivieren Sie "Enable Access-Control-Allow-Credentials"
   - Klicken Sie auf "Save"

### Schritt 2: Frontend auf Azure Static Web Apps deployen

1. **Azure Static Web Apps erstellen**
   - Im Azure Portal: "Create a resource" → "Static Web App"
   - **Name**: z.B. `reflecta-frontend`
   - **Region**: Wählen Sie eine Region
   - **Deployment**: GitHub (oder andere Option)
   - **Build Preset**: Next.js
   - Klicken Sie auf "Review + create" → "Create"

2. **Frontend-Code deployen**

   **GitHub Actions wird automatisch erstellt:**
   - Nach dem Erstellen der Static Web App wird ein GitHub Actions Workflow erstellt
   - Pushen Sie Ihren Code zu GitHub
   - Der Workflow deployt automatisch

3. **Umgebungsvariablen konfigurieren**
   
   Im Azure Portal:
   - Gehen Sie zu Ihrer Static Web App → "Configuration" → "Application settings"
   - Fügen Sie hinzu:
     ```
     NEXT_PUBLIC_API_URL=https://reflecta-backend.azurewebsites.net
     ```
   - Klicken Sie auf "Save"

4. **Next.js Build-Konfiguration**
   
   Die `next.config.ts` ist bereits vorhanden. Für Azure Static Web Apps sollte `output: 'standalone'` verwendet werden, wenn Server-Features benötigt werden. Für reine Static Sites kann `output: 'export'` verwendet werden.

### Schritt 3: URLs konfigurieren

Nach dem Deployment erhalten Sie:
- **Backend URL**: `https://reflecta-backend.azurewebsites.net`
- **Frontend URL**: `https://reflecta-frontend.azurestaticapps.net` (oder ähnlich)

**Wichtig:** Aktualisieren Sie die Frontend-Umgebungsvariable:
```
NEXT_PUBLIC_API_URL=https://reflecta-backend.azurewebsites.net
```

## Option 2: Beide auf Azure App Service

Wenn Sie beide auf App Service hosten möchten:

1. **Backend App Service** (wie oben beschrieben)
2. **Frontend App Service**:
   - Erstellen Sie eine zweite App Service
   - **Name**: z.B. `reflecta-frontend`
   - **Runtime stack**: Node.js 20 LTS
   - **Startup Command**: `npm start` (nach `npm run build`)
   - Deployen Sie den `frontend`-Ordner

## Option 3: Azure Container Apps (Fortgeschritten)

Für Container-basiertes Deployment:

1. Erstellen Sie `Dockerfile` für Backend und Frontend
2. Deployen Sie auf Azure Container Apps
3. Konfigurieren Sie HTTPS und Umgebungsvariablen

## HTTPS & Mikrofon-Zugriff

✅ **HTTPS ist automatisch verfügbar** bei Azure App Service und Static Web Apps!

- Alle Azure-URLs verwenden automatisch HTTPS
- Browser erlauben Mikrofon-Zugriff auf HTTPS-Websites
- Keine zusätzliche Konfiguration nötig

## Testing

1. **Backend testen:**
   ```bash
   curl https://reflecta-backend.azurewebsites.net/api/dev/test
   ```

2. **Frontend öffnen:**
   - Öffnen Sie `https://reflecta-frontend.azurestaticapps.net`
   - Browser sollte Mikrofon-Zugriff erlauben
   - Testen Sie die ASR-Funktionalität

## Kosten-Schätzung

**Für Testing (Basic Tier):**
- Backend App Service (B1): ~$13/Monat (~12€)
- Frontend Static Web Apps: **Kostenlos** (bis 100GB Bandbreite)
- **Gesamt**: ~$13/Monat

**Für Produktion (Standard Tier):**
- Backend App Service (S1): ~$70/Monat (~63€)
- Frontend Static Web Apps: **Kostenlos** (bis 100GB Bandbreite)
- **Gesamt**: ~$70/Monat

## Troubleshooting

### Backend nicht erreichbar
- Prüfen Sie die App Service-Logs: "Log stream" im Azure Portal
- Prüfen Sie die Umgebungsvariablen
- Prüfen Sie den Startup-Command

### CORS-Fehler
- Fügen Sie die Frontend-URL zu CORS-Einstellungen hinzu
- Prüfen Sie, ob `NEXT_PUBLIC_API_URL` korrekt gesetzt ist

### Mikrofon funktioniert nicht
- Prüfen Sie, ob die Website über HTTPS läuft (nicht HTTP)
- Prüfen Sie Browser-Konsole auf Fehler
- Prüfen Sie Browser-Berechtigungen

## Nächste Schritte

1. Deployen Sie Backend auf Azure App Service
2. Deployen Sie Frontend auf Azure Static Web Apps
3. Konfigurieren Sie Umgebungsvariablen
4. Testen Sie die Mikrofon-Funktionalität

Bei Fragen oder Problemen, siehe Azure-Dokumentation oder kontaktieren Sie den Support.

