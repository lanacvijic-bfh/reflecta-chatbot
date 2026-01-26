"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// API Base URL - verwendet Umgebungsvariable oder fällt auf localhost zurück
const getApiBaseUrl = (): string => {
  if (typeof window === 'undefined') {
    // Server-side: verwende localhost
    return 'http://localhost:8787';
  }
  
  // Client-side: prüfe Umgebungsvariable zuerst
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  if (envUrl) {
    return envUrl;
  }
  
  // In Entwicklung: IMMER localhost:8787 verwenden, unabhängig davon, wie das Frontend aufgerufen wird
  // (auch wenn über IP-Adresse aufgerufen, sollte der Backend-Server auf localhost laufen)
  // In Production würde man hier window.location.origin verwenden, aber für Entwicklung ist localhost sicherer
  if (process.env.NODE_ENV === 'development' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:8787';
  }
  
  // Für Production: verwende den gleichen Origin (nur wenn nicht in Entwicklung)
  return window.location.origin;
};

type Turn = { role: "user" | "assistant"; text: string; ts: number; card_id?: string; action?: string; importance?: string };

type Conversation = {
  id: string;
  phase: 1 | 2 | 3;
  activeTopic: string;
  turns: Turn[];
};

type Card = {
  id: string;
  topic: string;
  order: number;
  title: string;
  prompt: string;
  description: string;
  example_actions: string[];
};

function initialConversation(): Conversation {
  // Use a stable ID that won't cause hydration issues
  // This will only be called on the client side
  const id = typeof window !== "undefined" ? Date.now().toString(36) : "init";
  return {
    id,
    phase: 1,
    activeTopic: "",
    turns: [],
  };
}

const SAFETY_KEYWORDS = [
  "suizid",
  "selbstmord",
  "notfall",
  "akut",
  "medizinische empfehlung",
  "dosierung",
];

function hasSafetyRisk(text: string): boolean {
  const lc = (text || "").toLowerCase();
  return SAFETY_KEYWORDS.some((k) => lc.includes(k));
}


type ConsoleLog = {
  type: 'log' | 'warn' | 'error' | 'info';
  message: string;
  timestamp: number;
};

type ChatProps = {
  onImportExportReady?: (handlers: { handleImportJSON: () => void; handleExportJSON: () => void }) => void;
};

export default function Chat({ onImportExportReady }: ChatProps = {}) {
  const [conversation, setConversation] = useState<Conversation>(() => initialConversation());
  const conversationRef = useRef<Conversation>(initialConversation()); // Ref für aktuellen State
  const [inputValue, setInputValue] = useState<string>("");
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLog[]>([]);
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const chatRef = useRef<HTMLDivElement | null>(null);
  
  // Aktualisiere Ref immer wenn sich conversation ändert
  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);
  
  // Cache API Base URL - nur client-side berechnen, mit useRef für maximale Stabilität
  const apiBaseUrlRef = useRef<string>('');
  
  // Initialisiere URL sofort beim ersten Render (client-side)
  if (typeof window !== 'undefined' && !apiBaseUrlRef.current) {
    apiBaseUrlRef.current = getApiBaseUrl();
    console.log('🔗 API Base URL initialisiert (useRef):', apiBaseUrlRef.current);
  }
  
  // Helper: Get API URL
  const getApiUrl = useCallback(() => apiBaseUrlRef.current || 'http://localhost:8787', []);
  
  // Helper: Load card by ID (with fallback to API if not in cards array)
  const loadCardById = useCallback(async (cardId: string) => {
    const card = cards.find(c => c.id === cardId);
    if (card) return card;
    
    try {
      const response = await fetch(`${getApiUrl()}/api/cards/${cardId}`);
      if (response.ok) {
        return await response.json();
      }
    } catch (err) {
      console.error('Fehler beim Laden der Karte:', err);
    }
    return null;
  }, [cards, getApiUrl]);
  
  // Helper: Show card automatically (used for auto_show_card)
  const showCardAutomatically = useCallback(async (cardId: string) => {
    setTimeout(async () => {
      const card = await loadCardById(cardId);
      if (card) {
        setSelectedCard(card);
      }
    }, 100);
  }, [loadCardById]);
  
  const chatWrapperRef = useRef<HTMLDivElement | null>(null);
  const originalConsoleRef = useRef<{
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
    info: typeof console.info;
  } | null>(null);
  const isInterceptedRef = useRef<boolean>(false);
  const logsBufferRef = useRef<ConsoleLog[]>([]);
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const flushLogsRef = useRef<(() => void) | null>(null);

  // Funktion zum Batch-Update der Logs (außerhalb des useEffect, damit sie überall verfügbar ist)
  const flushLogs = useCallback(() => {
    if (logsBufferRef.current.length > 0) {
      setConsoleLogs(prev => {
        const combined = [...prev, ...logsBufferRef.current];
        logsBufferRef.current = [];
        // Behalte nur die letzten 100 Logs
        return combined.slice(-100);
      });
    }
  }, []);

  // Console-Logs intercepten und sammeln
  useEffect(() => {
    // Verhindere mehrfache Interception
    if (isInterceptedRef.current) return;
    
    // Speichere originale Console-Methoden
    if (!originalConsoleRef.current) {
      originalConsoleRef.current = {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        info: console.info.bind(console),
      };
    }

    const original = originalConsoleRef.current;
    
    // Speichere flushLogs-Referenz
    flushLogsRef.current = flushLogs;

    // Überschreibe Console-Methoden
    const interceptConsole = (type: ConsoleLog['type']) => {
      return (...args: any[]) => {
        // Rufe originale Methode auf (für Browser-Console)
        if (original[type]) {
          original[type](...args);
        }
        
        // Sammle Log im Buffer (ohne sofortigen State-Update)
        const message = args.map(arg => {
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg, null, 2);
            } catch {
              return String(arg);
            }
          }
          return String(arg);
        }).join(' ');
        
        logsBufferRef.current.push({ type, message, timestamp: Date.now() });
        
        // Batch-Update: Warte 50ms, bevor State aktualisiert wird (kürzer für bessere UX)
        if (updateTimerRef.current) {
          clearTimeout(updateTimerRef.current);
        }
        updateTimerRef.current = setTimeout(() => {
          if (flushLogsRef.current) {
            flushLogsRef.current();
          }
        }, 50);
      };
    };

    console.log = interceptConsole('log');
    console.warn = interceptConsole('warn');
    console.error = interceptConsole('error');
    console.info = interceptConsole('info');
    
    isInterceptedRef.current = true;
    
    // Test-Log, um zu bestätigen, dass die Interception funktioniert
    console.log('🔧 Console-Interception aktiviert - Logs werden jetzt gesammelt');

    // Cleanup: Stelle originale Console-Methoden wieder her
    return () => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }
      if (flushLogsRef.current) {
        flushLogsRef.current(); // Flushe verbleibende Logs
      }
      if (originalConsoleRef.current) {
        console.log = originalConsoleRef.current.log;
        console.warn = originalConsoleRef.current.warn;
        console.error = originalConsoleRef.current.error;
        console.info = originalConsoleRef.current.info;
        isInterceptedRef.current = false;
      }
    };
  }, [flushLogs]);

  // Debug: Log selectedCard changes
  useEffect(() => {
    console.log('selectedCard geändert:', selectedCard?.id, selectedCard?.title);
  }, [selectedCard]);

  // Animierte Breitenänderung für chat-wrapper
  useEffect(() => {
    if (!chatWrapperRef.current) return;
    
    const wrapper = chatWrapperRef.current;
    const container = wrapper.parentElement;
    if (!container) return;
    
    const containerWidth = container.offsetWidth;
    const targetWidth = selectedCard ? containerWidth - 416 : containerWidth;
    
    // Setze initiale Breite
    wrapper.style.width = `${containerWidth}px`;
    wrapper.style.transition = 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
    
    // Trigger reflow
    void wrapper.offsetWidth;
    
    // Setze Zielbreite
    requestAnimationFrame(() => {
      wrapper.style.width = `${targetWidth}px`;
    });
  }, [selectedCard]);

  // Scroll nach unten, wenn Details-Box geöffnet/geschlossen wird
  useEffect(() => {
    if (chatRef.current) {
      // Warte auf das Ende der Animation (400ms) plus ein kleines Delay
      const timeoutId = setTimeout(() => {
        if (chatRef.current) {
          chatRef.current.scrollTop = chatRef.current.scrollHeight;
        }
      }, 450); // 400ms Animation + 50ms Buffer
      
      return () => clearTimeout(timeoutId);
    }
  }, [selectedCard]);

  // Scroll nach unten, wenn Thinking-Indikator erscheint
  useEffect(() => {
    if (isThinking && chatRef.current) {
      const timeoutId = setTimeout(() => {
        if (chatRef.current) {
          chatRef.current.scrollTop = chatRef.current.scrollHeight;
        }
      }, 100);
      
      return () => clearTimeout(timeoutId);
    }
  }, [isThinking]);

  // Karten laden
  useEffect(() => {
    const loadCards = async () => {
      // Stelle sicher, dass apiBaseUrlRef initialisiert ist
      if (!apiBaseUrlRef.current) {
        apiBaseUrlRef.current = getApiBaseUrl();
        console.log('🔗 API Base URL nachträglich initialisiert:', apiBaseUrlRef.current);
      }
      
      const apiUrl = getApiUrl();
      const url = `${apiUrl}/api/cards`;
      
      console.log('📡 Lade Karten von:', url);
      
      try {
        const response = await fetch(url);
        
        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          console.error(`❌ HTTP Fehler ${response.status}:`, errorText.substring(0, 200));
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          const text = await response.text();
          console.error("❌ Erwartete JSON, bekam HTML/Text:", text.substring(0, 200));
          console.warn("⚠️ Möglicherweise läuft der Backend-Server nicht oder die Route existiert nicht");
          setCards([]);
          return;
        }
        
        const data = await response.json();
        if (Array.isArray(data)) {
          setCards(data);
          console.log(`✅ ${data.length} Karten geladen`);
        } else if (data.cards && Array.isArray(data.cards)) {
          // Fallback falls die API { cards: [...] } zurückgibt
          setCards(data.cards);
          console.log(`✅ ${data.cards.length} Karten geladen (aus cards-Objekt)`);
        } else {
          console.error("❌ Unerwartetes Datenformat:", data);
          setCards([]);
        }
      } catch (err) {
        console.error("❌ Fehler beim Laden der Karten:", err);
        if (err instanceof TypeError && err.message.includes('fetch')) {
          console.error("❌ Netzwerkfehler: Backend-Server ist nicht erreichbar");
          console.warn(`⚠️ Stelle sicher, dass der Backend-Server auf ${apiUrl} läuft`);
          console.warn(`⚠️ Starten Sie ihn mit: cd Backend && node server.mjs`);
        } else {
          console.warn(`⚠️ Stelle sicher, dass der Backend-Server auf ${apiUrl} läuft`);
        }
        // Fallback: leeres Array, damit die App weiter funktioniert
        setCards([]);
      }
    };
    
    loadCards();
  }, []);

  const addTurn = useCallback((role: Turn["role"], text: string | string[], card_id?: string, action?: string) => {
    setConversation((prev) => {
      // Wenn text ein Array ist, erstelle mehrere Turns
      const texts = Array.isArray(text) ? text : [text];
      const newTurns: Turn[] = [];
      
      texts.forEach((singleText, index) => {
        // Prüfe ob dieser Turn bereits existiert (verhindert Duplikate in React Strict Mode)
        const turnExists = prev.turns.some(t => 
          t.role === role && 
          t.text === singleText && 
          t.card_id === card_id && 
          Math.abs(t.ts - Date.now()) < 1000 // Innerhalb von 1 Sekunde
        );
        
        if (!turnExists) {
          // Nur für den ersten Turn: card_id und action setzen, für die restlichen undefined
          const newTurn: Turn = { 
            role, 
            text: singleText, 
            ts: Date.now() + index * 10, // Kleine Verzögerung für Reihenfolge
            card_id: index === 0 ? card_id : undefined, 
            action: index === 0 ? action : undefined 
          };
          newTurns.push(newTurn);
        }
      });
      
      if (newTurns.length === 0) {
        console.log(`⚠️ Alle Turns bereits vorhanden, überspringe Duplikate`);
        return prev;
      }
      
      const updatedTurns = [...prev.turns, ...newTurns];
      console.log(`✅ ${newTurns.length} Turn(s) hinzugefügt:`, { role, texts: texts.map(t => t.substring(0, 50)), card_id, action });
      console.log(`📊 Gesamt Turns nach Hinzufügen: ${updatedTurns.length}`);
      return {
        ...prev,
        turns: updatedTurns,
      };
    });
  }, []);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [conversation.turns.length]);
  

  const askPlanner = useCallback(async (conv: Conversation) => {
    const body = {
      turns: conv.turns,
      activeTopic: conv.activeTopic,
      phase: conv.phase,
    };
    
    try {
      // Verwende die Ref-URL direkt, um sicherzustellen, dass sie stabil ist
      const currentApiUrl = getApiUrl();
      
      // Sicherstellen, dass apiBaseUrl gültig ist
      if (!currentApiUrl || currentApiUrl === 'undefined' || currentApiUrl.includes('undefined')) {
        console.error('❌ Ungültige API Base URL:', currentApiUrl);
        throw new Error('API Base URL ist nicht konfiguriert');
      }
      
      const url = `${currentApiUrl}/api/plan`;
      console.log('📡 API Request an:', url);
      
      const r = await fetch(url, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      
      if (!r.ok) {
        throw new Error(`Backend-Fehler: ${r.status}`);
      }
      
      const response = (await r.json()) as {
        action: string;
        utterance: string | string[];
        target_topic?: string;
        card_id?: string;
        importance?: string;
        navigation?: string;
        propose_action_now?: boolean;
        auto_show_card?: boolean;
      };
      
      // Update conversation state based on response
      if (response.target_topic && response.target_topic !== conv.activeTopic) {
        setConversation((prev) => ({ ...prev, activeTopic: response.target_topic || "" }));
      }
      
      // Wenn auto_show_card gesetzt ist, zeige automatisch die Karten-Details an
      if (response.auto_show_card && response.card_id) {
        console.log(`📋 Automatisches Anzeigen der Karten-Details für ${response.card_id} (User-Rückfrage erkannt)`);
        showCardAutomatically(response.card_id);
      }
      
      return response;
    } catch (error) {
      console.error('❌ Fehler beim Abrufen des Planners:', error);
      console.error('API Base URL war:', apiBaseUrlRef.current);
      
      // Zeige eine benutzerfreundliche Fehlermeldung
      const apiUrl = getApiUrl();
      const errorMessage = error instanceof Error ? error.message : 'Unbekannter Fehler';
      
      return {
        action: "present_topics",
        utterance: `Entschuldigung, ich konnte die Verbindung zum Server nicht herstellen (${errorMessage}). Bitte stellen Sie sicher, dass der Backend-Server läuft (${apiUrl}). Starten Sie ihn mit: cd Backend && node server.mjs`,
        target_topic: "",
        card_id: "",
        importance: "",
        navigation: "",
        propose_action_now: false
      };
    }
  }, [cards, setSelectedCard]);

  const planNextStepLLM = useCallback(async () => {
    const lastUser = [...conversation.turns].reverse().find((t) => t.role === "user");
    if (lastUser && hasSafetyRisk(lastUser.text)) {
      return {
        action: "safe",
        utterance:
          "Das klingt sensibel oder akut. Ich gebe keine medizinischen Empfehlungen. " +
          "Wenn es dringend ist: bitte sofort den ärztlichen Notdienst kontaktieren. " +
          "Sollen wir notieren, was Sie mit Ihrer Ärztin/Ihrem Arzt besprechen möchten?",
        card_id: undefined,
      };
    }

    const step = await askPlanner(conversation);
    return step;
  }, [askPlanner, conversation]);

  // Funktion zum Senden einer Quick-Response
  const sendQuickResponse = useCallback(
    async (responseText: string) => {
      const newTurn: Turn = { role: "user", text: responseText, ts: Date.now() };
      const updatedTurns = [...conversation.turns, newTurn];
      const updatedConversation = { ...conversation, turns: updatedTurns };
      
      console.log(`📝 Quick-Response hinzugefügt: "${responseText.substring(0, 50)}"`);
      console.log(`📊 Turns vor State-Update: ${conversation.turns.length}, nach Update: ${updatedTurns.length}`);
      
      // Aktualisiere den State
      setConversation(updatedConversation);
      
      // Zeige Thinking-Indikator
      setIsThinking(true);
      
      // Rufe askPlanner mit der aktualisierten Conversation auf
      askPlanner(updatedConversation).then((next) => {
        console.log('Plan response:', next);
        console.log('card_id in response:', next.card_id);
        setIsThinking(false); // Thinking beenden
        addTurn("assistant", next.utterance, next.card_id, next.action);
        
        // Wenn auto_show_card gesetzt ist, zeige automatisch die Karten-Details an
        if (next.auto_show_card && next.card_id) {
          console.log(`📋 Automatisches Anzeigen der Karten-Details für ${next.card_id} (User-Rückfrage erkannt)`);
          showCardAutomatically(next.card_id);
        }
      }).catch((err) => {
        console.error('Error in askPlanner:', err);
        setIsThinking(false); // Thinking beenden auch bei Fehler
      });
    },
    [addTurn, askPlanner, cards, conversation]
  );

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const text = inputValue.trim();
      if (!text) {
        // Leere Eingabe: Zeige neutrale Guidance-Meldung
        addTurn("assistant", "Bitte geben Sie eine Antwort ein, oder klicken Sie auf 'Weiter', wenn Sie fortfahren möchten.", undefined, undefined);
        setInputValue("");
        return;
      }

      setInputValue("");

      // WICHTIG: Konstruiere die aktualisierte Conversation mit der neuen User-Nachricht
      // BEVOR askPlanner aufgerufen wird, damit die neue Nachricht im Request enthalten ist
      // Konstruiere die Conversation direkt aus dem aktuellen State
      const newTurn: Turn = { role: "user", text, ts: Date.now() };
      const updatedTurns = [...conversation.turns, newTurn];
      const updatedConversation = { ...conversation, turns: updatedTurns };
      
      console.log(`📝 User-Antwort hinzugefügt: "${text.substring(0, 50)}"`);
      console.log(`📊 Turns vor State-Update: ${conversation.turns.length}, nach Update: ${updatedTurns.length}`);
      console.log(`📋 Alle Turns:`, updatedTurns.map(t => ({ role: t.role, text: t.text.substring(0, 30) })));
      
      // Aktualisiere den State
      setConversation(updatedConversation);
      
      // Zeige Thinking-Indikator
      setIsThinking(true);
      
      // Rufe askPlanner mit der aktualisierten Conversation auf
      askPlanner(updatedConversation).then((next) => {
        console.log('Plan response:', next);
        console.log('card_id in response:', next.card_id);
        setIsThinking(false); // Thinking beenden
        addTurn("assistant", next.utterance, next.card_id, next.action);
        
        // Wenn auto_show_card gesetzt ist, zeige automatisch die Karten-Details an
        if (next.auto_show_card && next.card_id) {
          console.log(`📋 Automatisches Anzeigen der Karten-Details für ${next.card_id} (User-Rückfrage erkannt)`);
          // Verwende setSelectedCard direkt, um die Karte anzuzeigen
          setTimeout(() => {
            const card = cards.find(c => c.id === next.card_id);
            if (card) {
              setSelectedCard(card);
            } else {
              // Falls Karte noch nicht geladen, lade sie
              if (next.card_id) {
                loadCardById(next.card_id).then(card => {
                  if (card) setSelectedCard(card);
                });
              }
            }
          }, 100);
        }
      }).catch((err) => {
        console.error('Error in askPlanner:', err);
        setIsThinking(false); // Thinking beenden auch bei Fehler
      });
    },
    [addTurn, inputValue, askPlanner, cards, conversation]
  );

  useEffect(() => {
    // Initial greeting - request welcome message from backend with four categories
    // Nur einmal ausführen wenn noch keine Turns vorhanden sind und Karten geladen sind
    if (conversation.turns.length === 0 && cards.length > 0) {
      let isMounted = true;
      const initialMessage = async () => {
        setIsThinking(true);
        try {
          const next = await askPlanner(conversation);
          if (isMounted) {
            setIsThinking(false);
            addTurn("assistant", next.utterance, next.card_id, next.action);
          }
          // Karte wird NICHT automatisch angezeigt - nur beim Klick auf "Mehr Details"
        } catch (error) {
          console.error('Error getting initial message:', error);
          if (isMounted) {
            setIsThinking(false);
            addTurn("assistant", "Willkommen. Ich begleite Sie bei der Reflexion über Ihre Prioritäten und Wünsche. Lassen Sie uns beginnen.", undefined, "present_topics");
          }
        }
      };
      initialMessage();
      
      return () => {
        isMounted = false;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.length, conversation.turns.length]); // Nur wenn sich die Anzahl ändert, nicht das gesamte Array

  const debugState = useMemo(() => {
    // Zähle "sehr wichtige" Karten/Themen
    const veryImportantCardIds = new Set<string>();
    conversation.turns.forEach((turn, index) => {
      // Prüfe assistant turns mit importance='very_important'
      if (turn.role === 'assistant' && turn.importance === 'very_important' && turn.card_id) {
        veryImportantCardIds.add(turn.card_id);
      }
      // Prüfe user turns, die "sehr wichtig" sagen
      if (turn.role === 'user' && index > 0) {
        const prevTurn = conversation.turns[index - 1];
        if (prevTurn && prevTurn.role === 'assistant' && prevTurn.card_id) {
          const userText = turn.text.toLowerCase();
          if (userText.includes('sehr wichtig') || userText.includes('extrem wichtig') || 
              userText.includes('außerordentlich wichtig') || userText.includes('besonders wichtig')) {
            veryImportantCardIds.add(prevTurn.card_id);
          }
        }
      }
    });
    
    const state = {
      phase: conversation.phase,
      activeTopic: conversation.activeTopic,
      veryImportantCount: veryImportantCardIds.size,
      veryImportantCardIds: Array.from(veryImportantCardIds),
    };
    
    const stateJson = JSON.stringify(state, null, 2);
    
    // Füge Console-Logs hinzu
    const logsSection = consoleLogs.length > 0 
      ? `\n\n=== Console Logs (${consoleLogs.length}) ===\n` +
        consoleLogs.map(log => {
          const time = new Date(log.timestamp).toLocaleTimeString('de-DE');
          const typePrefix = log.type === 'error' ? '❌' : log.type === 'warn' ? '⚠️' : log.type === 'info' ? 'ℹ️' : '📝';
          return `[${time}] ${typePrefix} ${log.type.toUpperCase()}: ${log.message}`;
        }).join('\n')
      : '\n\n=== Console Logs ===\n(Keine Logs vorhanden)';
    
    return stateJson + logsSection;
  }, [conversation, consoleLogs]);

  // Funktion zum Anzeigen einer vereinfachten Erklärung mit Beispielen
  const handleShowHelpExplanation = useCallback(async (cardId?: string) => {
    if (!cardId) {
      // Wenn keine card_id vorhanden, zeige allgemeine Hilfe
      addTurn("assistant", 
        "Gerne helfe ich Ihnen weiter. Wenn Sie bei einem Thema unsicher sind, können Sie:\n\n" +
        "• Die Frage in eigenen Worten beantworten\n" +
        "• 'Sehr wichtig', 'Wichtig' oder 'Nicht wichtig' wählen\n" +
        "• Auf '?' klicken, um eine vereinfachte Erklärung zu erhalten\n\n" +
        "Sie können jederzeit Fragen stellen oder ein Thema überspringen, wenn es für Sie nicht relevant ist.",
        undefined,
        undefined
      );
      return;
    }

    // In Phase 2: Rufe Backend an, damit LLM die Erklärung generiert (keine Side-Karte)
    const currentPhase = conversation.phase || 1;
    if (currentPhase === 2) {
      // Phase 2: LLM soll vereinfachte Erklärung generieren
      try {
        const response = await fetch(`${getApiUrl()}/api/plan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            turns: [...conversation.turns, {
              role: "user",
              text: "Ich brauche eine vereinfachte Erklärung zu diesem Thema",
              ts: Date.now()
            }],
            activeTopic: conversation.activeTopic || "",
            phase: 2
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          addTurn("assistant", data.utterance, cardId, data.action);
          return;
        }
      } catch (err) {
        console.error('Fehler beim Abrufen der LLM-Erklärung:', err);
      }
    }

    // Phase 1: Fallback auf lokale Erklärung
    const card = await loadCardById(cardId);

    if (card) {
      // Erstelle eine vereinfachte Erklärung mit Beispielen
      let explanation = `Lassen Sie mich das Thema "${card.title}" vereinfacht erklären:\n\n`;
      explanation += `${card.description || card.prompt}\n\n`;
      
      if (card.example_actions && card.example_actions.length > 0) {
        explanation += `Beispiele, was das bedeuten könnte:\n`;
        card.example_actions.slice(0, 2).forEach((example: string) => {
          explanation += `• ${example}\n`;
        });
      }
      
      explanation += `\nSie können auf diese Frage antworten, indem Sie sagen, wie wichtig dieses Thema für Sie ist, oder Sie können es in eigenen Worten beschreiben.`;
      
      addTurn("assistant", explanation, cardId, "ask_card");
    } else {
      addTurn("assistant", 
        "Entschuldigung, ich konnte die Erklärung zu diesem Thema nicht laden. Bitte versuchen Sie es erneut oder beantworten Sie die Frage in eigenen Worten.",
        undefined,
        undefined
      );
    }
  }, [cards, addTurn, conversation]);

  const handleShowCardDetails = async (cardId: string) => {
    console.log('=== handleShowCardDetails aufgerufen ===');
    console.log('card_id:', cardId);
    console.log('Verfügbare Karten:', cards.length);
    console.log('Aktuell selectedCard:', selectedCard?.id);
    
    if (!cardId) {
      console.error('Keine card_id übergeben!');
      return;
    }
    
    // Wenn Karten noch nicht geladen sind, versuche sie zu laden
    if (cards.length === 0) {
      console.log('Karten noch nicht geladen, lade sie jetzt...');
      try {
        const response = await fetch(`${getApiUrl()}/api/cards`);
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data)) {
            setCards(data);
            const card = data.find((c: Card) => c.id === cardId);
            if (card) {
              console.log('Karte gefunden nach Laden:', card.title);
              setSelectedCard(card);
              return;
            }
          }
        }
      } catch (err) {
        console.error('Fehler beim Laden der Karte:', err);
      }
    }
    
    const card = cards.find(c => c.id === cardId);
    console.log('Gefundene Karte im lokalen Array:', card);
    if (card) {
      console.log('Setze selectedCard auf:', card.title);
      setSelectedCard(card);
      console.log('selectedCard nach setState:', selectedCard);
    } else {
      console.warn('Karte nicht im lokalen Array gefunden für ID:', cardId);
      console.log('Verfügbare Karten-IDs (erste 5):', cards.slice(0, 5).map(c => c.id));
      
      // Versuche die Karte direkt vom Backend zu holen
      try {
        console.log('Versuche Karte direkt vom Backend zu holen...');
        console.log('cardId:', cardId);
        console.log('encodeURIComponent(cardId):', encodeURIComponent(cardId));
        
        // Versuche zuerst ohne Encoding, dann mit Encoding
        let response = await fetch(`${getApiUrl()}/api/cards/${cardId}`);
        
        // Wenn 404, versuche mit Encoding
        if (!response.ok && response.status === 404) {
          console.log('404 ohne Encoding, versuche mit Encoding...');
          response = await fetch(`${getApiUrl()}/api/cards/${encodeURIComponent(cardId)}`);
        }
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('Backend antwortete mit Status:', response.status);
          console.error('Fehler-Response:', errorText);
          
          // Wenn 404, versuche nochmal alle Karten zu laden und suche dann
          if (response.status === 404) {
            console.log('404 erhalten, lade alle Karten neu...');
            const allCardsResponse = await fetch(`${getApiUrl()}/api/cards`);
            if (allCardsResponse.ok) {
              const allCards = await allCardsResponse.json();
              setCards(allCards);
              // Versuche verschiedene Matching-Strategien
              let foundCard = allCards.find((c: Card) => c.id === cardId);
              if (!foundCard) {
                foundCard = allCards.find((c: Card) => c.id.toLowerCase() === cardId.toLowerCase());
              }
              if (foundCard) {
                console.log('Karte nach Neu-Laden gefunden:', foundCard.title);
                setSelectedCard(foundCard);
                return;
              } else {
                console.error('Karte auch nach Neu-Laden nicht gefunden. Verfügbare IDs:', allCards.slice(0, 5).map((c: Card) => c.id));
              }
            }
          }
          return;
        }
        
        const cardData = await response.json();
        console.log('Karte vom Backend erhalten:', cardData.title);
        setSelectedCard(cardData);
      } catch (err) {
        console.error('Fehler beim Abrufen der Karte:', err);
      }
    }
  };

  // Prüfe, ob alle Karten gespielt wurden (wrap action)
  const isGameComplete = conversation.turns.some(turn => turn.action === "wrap");
  
  // PDF Export Funktion
  const handleExportPDF = useCallback(async () => {
    try {
      const response = await fetch(`${getApiUrl()}/api/export/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(conversation)
      });
      
      if (!response.ok) {
        throw new Error('PDF Export fehlgeschlagen');
      }
      
      // Erstelle Blob und Download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'reflexion-zusammenfassung.pdf';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('PDF Export Fehler:', err);
      alert('Fehler beim Exportieren der PDF. Bitte versuchen Sie es erneut.');
    }
  }, [conversation]);
  
  // JSON Export Funktion
  const handleExportJSON = useCallback(async () => {
    try {
      // Verwende Ref für garantiert aktuellen State
      const currentConversation = conversationRef.current;
      
      console.log('📤 Exportiere Conversation:', {
        turnsCount: currentConversation.turns.length,
        phase: currentConversation.phase,
        activeTopic: currentConversation.activeTopic,
        turns: currentConversation.turns.map(t => ({ role: t.role, text: t.text.substring(0, 30) }))
      });
      console.log('📤 Vollständige Conversation-Struktur:', JSON.stringify(currentConversation, null, 2));
      
      const response = await fetch(`${getApiUrl()}/api/export/json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentConversation)
      });
      
      console.log('📤 Response Status:', response.status, response.statusText);
      
      if (!response.ok) {
        // Versuche Fehler-Details aus Response zu extrahieren
        let errorMessage = 'JSON Export fehlgeschlagen';
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch {
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }
      
      const exportData = await response.json();
      
      // Erstelle JSON-Datei und Download
      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reflexion-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      alert('✅ Export erfolgreich! Die Datei enthält Ihr gesamtes Gespräch und den Spielstand.');
    } catch (err) {
      console.error('JSON Export Fehler:', err);
      alert('Fehler beim Exportieren der JSON. Bitte versuchen Sie es erneut.');
    }
  }, [conversation]); // WICHTIG: conversation als Dependency hinzufügen!
  
  // JSON Import Funktion
  const handleImportJSON = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const exportData = JSON.parse(text);
        
        // Validiere Format
        if (!exportData.version || !exportData.conversation) {
          alert('❌ Ungültiges Export-Format. Bitte wählen Sie eine gültige Export-Datei.');
          return;
        }
        
        // Prüfe auf sensible Inhalte
        const hasSensitiveContent = exportData.metadata?.has_sensitive_content || false;
        if (hasSensitiveContent) {
          const confirmImport = confirm(
            '⚠️ Diese Datei enthält möglicherweise sensible Inhalte.\n\n' +
            'Es wird empfohlen, diese mit einer Fachperson zu besprechen.\n\n' +
            'Möchten Sie trotzdem fortfahren?'
          );
          if (!confirmImport) return;
        }
        
        // Sende an Backend zum Import
        const response = await fetch(`${getApiUrl()}/api/import/json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ exportData })
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Import fehlgeschlagen');
        }
        
        const result = await response.json();
        
        // Wiederherstelle Conversation
        setConversation(result.conversation);
        
        // Zeige Warnung bei sensiblen Inhalten
        if (result.metadata.has_sensitive_content) {
          alert(
            '✅ Import erfolgreich!\n\n' +
            '⚠️ Diese Datei enthält möglicherweise sensible Inhalte.\n' +
            'Es wird empfohlen, diese mit einer Fachperson zu besprechen.'
          );
        } else {
          alert('✅ Import erfolgreich! Ihr Gespräch und Spielstand wurden wiederhergestellt.');
        }
      } catch (err) {
        console.error('JSON Import Fehler:', err);
        alert(`Fehler beim Importieren: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`);
      }
    };
    input.click();
  }, [setConversation]);
  
  // Übergebe Handler-Funktionen an Parent-Komponente (nur einmal beim Mount)
  useEffect(() => {
    if (onImportExportReady) {
      onImportExportReady({ handleImportJSON, handleExportJSON });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onImportExportReady]); // Nur onImportExportReady als Dependency, Handler sind stabil
  
  // Dev Tool: Markiere alle Karten als gespielt
  const handleMarkAllCardsPlayed = useCallback(async () => {
    try {
      const response = await fetch(`${getApiUrl()}/api/dev/mark-all-cards-played`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turns: conversation.turns })
      });
      
      if (!response.ok) {
        // Versuche Error-Message aus Response zu extrahieren
        let errorMessage = 'Dev Tool fehlgeschlagen';
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch {
          if (response.status === 404) {
            errorMessage = `HTTP 404: Endpoint nicht gefunden. Bitte starten Sie den Backend-Server neu, damit die neuen Endpoints verfügbar sind.`;
          } else {
            errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          }
        }
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      // Aktualisiere Conversation mit den neuen Turns
      setConversation({
        ...conversation,
        turns: data.turns
      });
      alert(`✅ ${data.message}`);
    } catch (err) {
      console.error('Dev Tool Fehler:', err);
      let errorMessage = 'Unbekannter Fehler';
      
      if (err instanceof TypeError && err.message.includes('fetch')) {
        errorMessage = `Netzwerkfehler: Backend-Server ist nicht erreichbar. Bitte stellen Sie sicher, dass der Server auf ${getApiUrl()} läuft.`;
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }
      
      alert(`Fehler beim Markieren aller Karten:\n\n${errorMessage}\n\nBitte prüfen Sie:\n- Läuft der Backend-Server? (${getApiUrl()})\n- Sind die Karten geladen?`);
    }
  }, [conversation, setConversation]);

  return (
    <div className="chat-container">
      <div 
        ref={chatWrapperRef}
        className={`chat-wrapper ${selectedCard ? 'chat-shrunk' : 'chat-expanded'}`}
        style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          minHeight: 0
        }}
      >
        <div className="chat-inner-wrapper">
          <section id="chat" aria-live="polite" aria-label="Chatverlauf" ref={chatRef}>
          {conversation.turns.map((turn, idx) => {
            // Zeige "Mehr Details" Button nur in Phase 2 bei ask_card, nicht bei follow_up_card
            const hasCardId = turn.role === "assistant" && turn.card_id;
            const isAskCard = turn.action === "ask_card";
            const currentPhase = conversation.phase || 1;
            const showDetailsButton = hasCardId && isAskCard && currentPhase === 2;
            const isWrap = turn.action === "wrap";
            // Debug-Log entfernt - wurde bei jedem Render ausgeführt und füllte die Konsole
            
            // Handle array utterances (multiple bubbles)
            const utteranceArray = Array.isArray(turn.text) ? turn.text : [turn.text];
            
            return (
              <div key={idx}>
                {utteranceArray.map((text, bubbleIdx) => (
                  <div key={bubbleIdx} className={`msg ${turn.role}`}>
                    <div className="msg-content-wrapper">
                      <div className="bubble">
                        {text}
                      </div>
                      {showDetailsButton && bubbleIdx === utteranceArray.length - 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            console.log('Button geklickt für card_id:', turn.card_id);
                            // In Phase 2: Verwende handleShowHelpExplanation (keine Side-Karte)
                            // In Phase 1: Verwende handleShowCardDetails (Side-Karte)
                            const currentPhase = conversation.phase || 1;
                            if (currentPhase === 2) {
                              handleShowHelpExplanation(turn.card_id!);
                            } else {
                              handleShowCardDetails(turn.card_id!);
                            }
                          }}
                          className="card-details-btn"
                          title="Mehr Details"
                        >
                          ℹ️ Mehr Details
                        </button>
                      )}
                      {isWrap && bubbleIdx === utteranceArray.length - 1 && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleExportPDF();
                            }}
                            className="card-details-btn"
                            style={{ 
                              backgroundColor: '#3b82f6', 
                              color: 'white',
                              marginRight: '8px'
                            }}
                            title="PDF herunterladen"
                          >
                            📥 PDF herunterladen
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleExportJSON();
                            }}
                            className="card-details-btn"
                            style={{ 
                              backgroundColor: '#10b981', 
                              color: 'white'
                            }}
                            title="JSON exportieren"
                          >
                            💾 JSON exportieren
                          </button>
                        </>
                      )}
                      {showDetailsButton && bubbleIdx === utteranceArray.length - 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            console.log('Button geklickt für card_id:', turn.card_id);
                            // In Phase 2: Verwende handleShowHelpExplanation (keine Side-Karte)
                            // In Phase 1: Verwende handleShowCardDetails (Side-Karte)
                            const currentPhase = conversation.phase || 1;
                            if (currentPhase === 2) {
                              handleShowHelpExplanation(turn.card_id!);
                            } else {
                              handleShowCardDetails(turn.card_id!);
                            }
                          }}
                          className="card-details-btn"
                          title="Mehr Details"
                        >
                          ℹ️ Mehr Details
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
          {/* Thinking Indicator */}
          {isThinking && (
            <div className="msg assistant">
              <div className="msg-content-wrapper">
                <div className="bubble thinking-bubble">
                  <div className="thinking-dots">
                    <span className="dot"></span>
                    <span className="dot"></span>
                    <span className="dot"></span>
                  </div>
                </div>
              </div>
            </div>
          )}
          </section>
          
          {/* Quick-Response Buttons - erscheinen NUR bei ask_card (Themen/Karten), NICHT bei follow_up_card, present_topics, summarize_topic, wrap, etc. */}
          {(() => {
            // Finde die letzte Assistant-Nachricht MIT einer action
            // (Bei mehreren Bubbles hat nur der erste Turn eine action, daher müssen wir den letzten mit action finden)
            const lastAssistantTurnWithAction = [...conversation.turns].reverse().find(turn => 
              turn.role === "assistant" && turn.action
            );
            
            // STRENGE Prüfung: Buttons nur anzeigen wenn:
            // 1. Es gibt eine letzte Assistant-Nachricht mit action
            // 2. Die Aktion ist genau "ask_card"
            // 3. Es gibt eine card_id (sollte immer bei ask_card vorhanden sein)
            const isAskCard = lastAssistantTurnWithAction && 
                             lastAssistantTurnWithAction.action === "ask_card" &&
                             lastAssistantTurnWithAction.card_id;
            
            if (!isAskCard) return null;
            
            return (
              <div className="quick-response-buttons">
                <button
                  type="button"
                  onClick={() => sendQuickResponse("Sehr wichtig")}
                  className="quick-response-btn quick-response-sehr-wichtig"
                  title="Sehr wichtig"
                >
                  <span className="quick-response-icon">⭐</span>
                  <span className="quick-response-text">Sehr wichtig</span>
                </button>
                <button
                  type="button"
                  onClick={() => sendQuickResponse("Wichtig")}
                  className="quick-response-btn quick-response-wichtig"
                  title="Wichtig"
                >
                  <span className="quick-response-icon">✓</span>
                  <span className="quick-response-text">Wichtig</span>
                </button>
                <button
                  type="button"
                  onClick={() => sendQuickResponse("Nicht wichtig")}
                  className="quick-response-btn quick-response-nicht-wichtig"
                  title="Nicht wichtig"
                >
                  <span className="quick-response-icon">○</span>
                  <span className="quick-response-text">Nicht wichtig</span>
                </button>
                <button
                  type="button"
                  onClick={() => sendQuickResponse("Ich bin unsicher")}
                  className="quick-response-btn quick-response-unsure"
                  title="Ich bin unsicher"
                >
                  <span className="quick-response-icon">?</span>
                  <span className="quick-response-text">Ich bin unsicher</span>
                </button>
              </div>
            );
          })()}
        </div>

        <form id="composer" autoComplete="off" onSubmit={onSubmit}>
        <label htmlFor="userInput" className="sr-only">
          Ihre Antwort
        </label>
        <textarea
          id="userInput"
          rows={2}
          placeholder="Ihre Antwort..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          suppressHydrationWarning
        />
        <div className="controls">
          <button type="submit" id="btnNext" title="Weiter" suppressHydrationWarning>
            Weiter
          </button>
        </div>
      </form>

        <details 
          className="panel"
          onToggle={(e) => {
            // Wenn das Panel geöffnet wird, flushe sofort alle gepufferten Logs
            if ((e.currentTarget as HTMLDetailsElement).open && flushLogsRef.current) {
              flushLogsRef.current();
            }
          }}
        >
          <summary>Debug (zeigt internen Zustand)</summary>
          <pre id="debug">{debugState}</pre>
          <div style={{ marginTop: '16px', padding: '12px', border: '1px solid #ccc', borderRadius: '4px' }}>
            <h4 style={{ marginTop: 0 }}>Dev Tools</h4>
            <button
              type="button"
              onClick={handleMarkAllCardsPlayed}
              style={{
                padding: '8px 16px',
                backgroundColor: '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              🧪 Alle Karten als gespielt markieren (Test)
            </button>
            <p style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
              Dies markiert alle Karten als gespielt, um den Endgame-Status zu testen.
            </p>
          </div>
        </details>
      </div>

      {selectedCard && (
        <>
          <div 
            className="card-overlay"
            onClick={() => {
              console.log('Overlay geklickt, Karte wird geschlossen');
              setSelectedCard(null);
            }}
            aria-label="Karte schließen"
          />
          <aside className="card-detail-panel">
            <button
              className="card-close-btn"
              onClick={() => {
                console.log('Karte wird geschlossen');
                setSelectedCard(null);
              }}
              aria-label="Karte schließen"
            >
              ×
            </button>
            <div className="card-content">
              <h3 className="card-title">{selectedCard.title}</h3>
              <div className="card-description">
                <p>{selectedCard.description}</p>
              </div>
              {selectedCard.example_actions && selectedCard.example_actions.length > 0 && (
                <div className="card-actions">
                  <h4>Mögliche Handlungsoptionen</h4>
                  <ul>
                    {selectedCard.example_actions.map((action, idx) => (
                      <li key={idx}>{action}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}


