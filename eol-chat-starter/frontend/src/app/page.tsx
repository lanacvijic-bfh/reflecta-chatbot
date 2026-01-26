"use client";
import Chat from "@/components/Chat";
import ConsentModal from "@/components/ConsentModal";
import { useEffect, useState, useCallback } from "react";

type ImportExportHandlers = {
  handleImportJSON: () => void;
  handleExportJSON: () => void;
};

export default function Home() {
  const [llmProvider, setLlmProvider] = useState<string | null>(null);
  const [importExportHandlers, setImportExportHandlers] = useState<ImportExportHandlers | null>(null);
  
  const handleImportExportReady = useCallback((handlers: ImportExportHandlers) => {
    setImportExportHandlers(handlers);
  }, []);

  useEffect(() => {
    // Bestimme API Base URL
    const getApiBaseUrl = (): string => {
      if (typeof window === 'undefined') return '';
      
      const envUrl = process.env.NEXT_PUBLIC_API_URL;
      if (envUrl) return envUrl;
      
      // In Entwicklung: IMMER localhost:8787 verwenden, unabhängig davon, wie das Frontend aufgerufen wird
      // (auch wenn über IP-Adresse aufgerufen, sollte der Backend-Server auf localhost laufen)
      if (process.env.NODE_ENV === 'development' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:8787';
      }
      
      // Für Production: verwende den gleichen Origin (nur wenn nicht in Entwicklung)
      return window.location.origin;
    };

    const apiBaseUrl = getApiBaseUrl();
    
    // Lade LLM-Konfiguration vom Backend
    fetch(`${apiBaseUrl}/api/config`)
      .then(async res => {
        // Prüfe zuerst den Status - bei 404 oder anderen Fehlern einfach Fallback verwenden
        if (!res.ok) {
          if (res.status === 404) {
            console.warn(`Endpoint /api/config nicht gefunden (404). Verwende Fallback.`);
          } else {
            const text = await res.text().catch(() => '');
            console.warn(`API-Fehler (${res.status}):`, text.substring(0, 200));
          }
          // Fallback: annehmen, dass es OpenAI ist
          setLlmProvider('openai');
          return null;
        }
        
        // Prüfe ob die Antwort JSON ist
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          // Versuche die Antwort als Text zu lesen, um zu sehen was zurückkommt
          const text = await res.text().catch(() => '');
          console.warn('Server antwortete nicht mit JSON. Erhalten:', text.substring(0, 200));
          // Fallback: annehmen, dass es OpenAI ist
          setLlmProvider('openai');
          return null;
        }
        
        return res.json();
      })
      .then(data => {
        // Wenn data null ist, wurde bereits der Fallback gesetzt
        if (data === null) return;
        
        if (data && data.llmProvider) {
          setLlmProvider(data.llmProvider);
        } else {
          // Fallback wenn Daten unvollständig
          console.warn('LLM-Konfiguration unvollständig:', data);
          setLlmProvider('openai');
        }
      })
      .catch(err => {
        console.error('Fehler beim Laden der LLM-Konfiguration:', err);
        // Fallback: annehmen, dass es OpenAI ist (wenn Backend nicht erreichbar)
        setLlmProvider('openai');
      });
  }, []);

  const getFooterText = () => {
    if (llmProvider === null) {
      return "Lokale Verarbeitung";
    }
    
    if (llmProvider === 'azure-openai') {
      return "Verarbeitung über Azure OpenAI";
    }
    
    // OpenAI Standard
    return "Verarbeitung über OpenAI";
  };

  const handleRevokeConsent = () => {
    if (typeof window !== 'undefined') {
      if (confirm("Möchten Sie Ihre Einwilligung wirklich widerrufen? Das Popup wird beim nächsten Laden der Seite wieder erscheinen.")) {
        localStorage.removeItem('dataConsent');
        localStorage.removeItem('dataConsentDate');
        // Seite neu laden, damit das Popup wieder erscheint
        window.location.reload();
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <ConsentModal />
      <header>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <img 
            src="/logo.png" 
            alt="Reflecta" 
            style={{ 
              height: '40px', 
              width: 'auto',
              display: 'block'
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {importExportHandlers && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={importExportHandlers.handleImportJSON}
                style={{ 
                  backgroundColor: '#6366f1', 
                  color: 'white',
                  fontSize: '14px',
                  padding: '8px 16px',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                title="JSON Import (Gespräch & Spielstand wiederherstellen)"
              >
                📂 Import
              </button>
              <button
                type="button"
                onClick={importExportHandlers.handleExportJSON}
                style={{ 
                  backgroundColor: '#10b981', 
                  color: 'white',
                  fontSize: '14px',
                  padding: '8px 16px',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                title="JSON Export (Gespräch & Spielstand exportieren)"
              >
                💾 Export
              </button>
            </div>
            )}
          </div>
        </div>
      </header>

      <main style={{ flex: 1, minHeight: 0 }}>
        <Chat onImportExportReady={handleImportExportReady} />
      </main>

      <footer>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
          <small>{getFooterText()}</small>
          <button
            type="button"
            onClick={handleRevokeConsent}
            style={{
              fontSize: '12px',
              color: '#6366f1',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: '4px 8px'
            }}
            title="Einwilligung widerrufen"
          >
            Einwilligung widerrufen
          </button>
        </div>
      </footer>
    </div>
  );
}
