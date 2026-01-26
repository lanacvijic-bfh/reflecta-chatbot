# Azure OpenAI Setup

Dieses Projekt unterstützt Azure OpenAI für besseren Datenschutz und regionale Datenresidenz.

## Vorteile von Azure OpenAI

- **Datenschutz**: Daten bleiben in der gewählten Azure-Region (z.B. Schweiz)
- **Compliance**: Erfüllt Anforderungen für Gesundheitsdaten (z.B. Genfer Spital)
- **Kontrolle**: Volle Kontrolle über Datenfluss und Speicherort
- **Sicherheit**: Enterprise-Grade Sicherheit durch Azure

## Einrichtung

### 1. Azure OpenAI Resource erstellen

1. Gehe zum [Azure Portal](https://portal.azure.com)
2. Erstelle eine neue "Azure OpenAI" Resource
3. Wähle eine Region (z.B. **Switzerland North** für Datenschutz)
4. Erstelle ein Deployment (z.B. `gpt-4` oder `gpt-4-turbo`)

### 2. API-Schlüssel und Endpoint abrufen

1. In der Azure OpenAI Resource:
   - **Keys and Endpoint** → Kopiere einen der API Keys
   - **Endpoint** → Kopiere die URL (z.B. `https://your-resource.openai.azure.com`)

### 3. Konfiguration in `development.env`

Kopiere `development.env.example` zu `development.env` und fülle die Werte aus:

```env
AZURE_OPENAI_API_KEY=your-azure-api-key-here
AZURE_OPENAI_ENDPOINT=https://your-resource-name.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-4  # Name deines Deployments
AZURE_OPENAI_API_VERSION=2024-02-15-preview
MODEL=gpt-4
PORT=8787
```

### 4. Server starten

```bash
cd Backend
node server.mjs
```

Der Server erkennt automatisch, ob Azure OpenAI konfiguriert ist und verwendet es, falls verfügbar.

## Fallback zu Standard OpenAI

Falls keine Azure OpenAI Konfiguration vorhanden ist, fällt das System automatisch auf Standard OpenAI zurück (nur für Entwicklung empfohlen).

## Verfügbare Modelle

Azure OpenAI unterstützt verschiedene Modelle:
- `gpt-4` / `gpt-4-turbo`
- `gpt-35-turbo` (GPT-3.5)
- `gpt-4o` (falls verfügbar)

Wichtig: Der `AZURE_OPENAI_DEPLOYMENT` muss exakt dem Namen deines Deployments entsprechen!

## Regionale Auswahl

Für Schweizer Datenschutz-Anforderungen:
- **Switzerland North** (Zürich)
- **Switzerland West** (Genf)

Diese Regionen halten Daten in der Schweiz.

## Troubleshooting

### "Keine Azure OpenAI Konfiguration gefunden"
- Prüfe, ob alle drei Variablen gesetzt sind: `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`

### "Deployment not found"
- Prüfe, ob der Deployment-Name in `AZURE_OPENAI_DEPLOYMENT` exakt dem Namen im Azure Portal entspricht
- Prüfe, ob das Deployment aktiv ist

### API-Version Fehler
- Verwende eine neuere API-Version: `2024-02-15-preview` oder `2024-06-01`

