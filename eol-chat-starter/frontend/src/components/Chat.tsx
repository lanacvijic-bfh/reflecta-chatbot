"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// API Base URL - verwendet Umgebungsvariable oder fällt auf localhost zurück
const DEFAULT_LOCAL_API = "http://localhost:8787";

// API Base URL - uses env var, otherwise falls back to localhost (for local dev only)
const getApiBaseUrl = (): string => {
  const envUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

  if (envUrl && envUrl.trim().length > 0) {
    return envUrl.replace(/\/$/, ""); // remove trailing slash
  }

  return DEFAULT_LOCAL_API;
};

type Turn = {
  role: "user" | "assistant";
  text: string;
  ts: number;
  card_id?: string;
  action?: string;
  importance?: string;
};

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

type ChatProps = {
  onImportExportReady?: (handlers: {
    handleImportJSON: () => void;
    handleExportJSON: () => void;
  }) => void;
};

export default function Chat({ onImportExportReady }: ChatProps = {}) {
  const [conversation, setConversation] = useState<Conversation>(() =>
    initialConversation()
  );
  const conversationRef = useRef<Conversation>(initialConversation()); // Ref für aktuellen State
  const [inputValue, setInputValue] = useState<string>("");
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const chatRef = useRef<HTMLDivElement | null>(null);

  // Aktualisiere Ref immer wenn sich conversation ändert
  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);

  // Cache API Base URL - nur client-side berechnen, mit useRef für maximale Stabilität
  const apiBaseUrlRef = useRef<string>("");

  // Initialisiere URL sofort beim ersten Render (client-side)
  if (typeof window !== "undefined" && !apiBaseUrlRef.current) {
    apiBaseUrlRef.current = getApiBaseUrl();
    console.log("🔗 API Base URL initialisiert (useRef):", apiBaseUrlRef.current);
  }

  // Helper: Get API URL
  const getApiUrl = useCallback(
    () => apiBaseUrlRef.current || DEFAULT_LOCAL_API,
    []
  );

  // Helper: Load card by ID (with fallback to API if not in cards array)
  const loadCardById = useCallback(
    async (cardId: string) => {
      const card = cards.find((c) => c.id === cardId);
      if (card) return card;

      try {
        const response = await fetch(`${getApiUrl()}/api/cards/${cardId}`);
        if (response.ok) {
          return await response.json();
        }
      } catch (err) {
        console.error("Fehler beim Laden der Karte:", err);
      }
      return null;
    },
    [cards, getApiUrl]
  );

  // Helper: Show card automatically (used for auto_show_card)
  const showCardAutomatically = useCallback(
    async (cardId: string) => {
      setTimeout(async () => {
        const card = await loadCardById(cardId);
        if (card) {
          setSelectedCard(card);
        }
      }, 100);
    },
    [loadCardById]
  );

  const chatWrapperRef = useRef<HTMLDivElement | null>(null);

  // Debug: Log selectedCard changes
  useEffect(() => {
    console.log("selectedCard geändert:", selectedCard?.id, selectedCard?.title);
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
    wrapper.style.transition = "width 0.4s cubic-bezier(0.4, 0, 0.2, 1)";

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
      const timeoutId = setTimeout(() => {
        if (chatRef.current) {
          chatRef.current.scrollTop = chatRef.current.scrollHeight;
        }
      }, 450);

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
        console.log(
          "🔗 API Base URL nachträglich initialisiert:",
          apiBaseUrlRef.current
        );
      }

      const apiUrl = getApiUrl();
      const url = `${apiUrl}/api/cards`;

      console.log("📡 Lade Karten von:", url);

      try {
        const response = await fetch(url);

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          console.error(
            `❌ HTTP Fehler ${response.status}:`,
            errorText.substring(0, 200)
          );
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          const text = await response.text();
          console.error("❌ Erwartete JSON, bekam HTML/Text:", text.substring(0, 200));
          console.warn(
            "⚠️ Möglicherweise läuft der Backend-Server nicht oder die Route existiert nicht"
          );
          setCards([]);
          return;
        }

        const data = await response.json();
        if (Array.isArray(data)) {
          setCards(data);
          console.log(`✅ ${data.length} Karten geladen`);
        } else if (data.cards && Array.isArray(data.cards)) {
          setCards(data.cards);
          console.log(`✅ ${data.cards.length} Karten geladen (aus cards-Objekt)`);
        } else {
          console.error("❌ Unerwartetes Datenformat:", data);
          setCards([]);
        }
      } catch (err) {
        console.error("❌ Fehler beim Laden der Karten:", err);
        if (err instanceof TypeError && err.message.includes("fetch")) {
          console.error("❌ Netzwerkfehler: Backend-Server ist nicht erreichbar");
          console.warn(`⚠️ Stelle sicher, dass der Backend-Server auf ${apiUrl} läuft`);
          console.warn(`⚠️ Starten Sie ihn mit: cd Backend && node server.mjs`);
        } else {
          console.warn(`⚠️ Stelle sicher, dass der Backend-Server auf ${apiUrl} läuft`);
        }
        setCards([]);
      }
    };

    loadCards();
  }, [getApiUrl]);

  const addTurn = useCallback(
    (role: Turn["role"], text: string | string[], card_id?: string, action?: string) => {
      setConversation((prev) => {
        const texts = Array.isArray(text) ? text : [text];
        const newTurns: Turn[] = [];

        texts.forEach((singleText, index) => {
          const turnExists = prev.turns.some(
            (t) =>
              t.role === role &&
              t.text === singleText &&
              t.card_id === card_id &&
              Math.abs(t.ts - Date.now()) < 1000
          );

          if (!turnExists) {
            const newTurn: Turn = {
              role,
              text: singleText,
              ts: Date.now() + index * 10,
              card_id: index === 0 ? card_id : undefined,
              action: index === 0 ? action : undefined,
            };
            newTurns.push(newTurn);
          }
        });

        if (newTurns.length === 0) {
          console.log(`⚠️ Alle Turns bereits vorhanden, überspringe Duplikate`);
          return prev;
        }

        const updatedTurns = [...prev.turns, ...newTurns];
        console.log(`✅ ${newTurns.length} Turn(s) hinzugefügt:`, {
          role,
          texts: texts.map((t) => t.substring(0, 50)),
          card_id,
          action,
        });
        console.log(`📊 Gesamt Turns nach Hinzufügen: ${updatedTurns.length}`);
        return {
          ...prev,
          turns: updatedTurns,
        };
      });
    },
    []
  );

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [conversation.turns.length]);

  const askPlanner = useCallback(
    async (conv: Conversation) => {
      const body = {
        turns: conv.turns,
        activeTopic: conv.activeTopic,
        phase: conv.phase,
      };

      try {
        const currentApiUrl = getApiUrl();

        if (
          !currentApiUrl ||
          currentApiUrl === "undefined" ||
          currentApiUrl.includes("undefined")
        ) {
          console.error("❌ Ungültige API Base URL:", currentApiUrl);
          throw new Error("API Base URL ist nicht konfiguriert");
        }

        const url = `${currentApiUrl}/api/plan`;
        console.log("📡 API Request an:", url);

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

        if (response.target_topic && response.target_topic !== conv.activeTopic) {
          setConversation((prev) => ({
            ...prev,
            activeTopic: response.target_topic || "",
          }));
        }

        if (response.auto_show_card && response.card_id) {
          console.log(
            `📋 Automatisches Anzeigen der Karten-Details für ${response.card_id} (User-Rückfrage erkannt)`
          );
          showCardAutomatically(response.card_id);
        }

        return response;
      } catch (error) {
        console.error("❌ Fehler beim Abrufen des Planners:", error);
        console.error("API Base URL war:", apiBaseUrlRef.current);

        const apiUrl = getApiUrl();
        const errorMessage = error instanceof Error ? error.message : "Unbekannter Fehler";

        return {
          action: "present_topics",
          utterance:
            `Entschuldigung, ich konnte die Verbindung zum Server nicht herstellen (${errorMessage}). ` +
            `Bitte stellen Sie sicher, dass der Backend-Server läuft (${apiUrl}). ` +
            `Starten Sie ihn mit: cd Backend && node server.mjs`,
          target_topic: "",
          card_id: "",
          importance: "",
          navigation: "",
          propose_action_now: false,
        };
      }
    },
    [getApiUrl, showCardAutomatically]
  );

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
      console.log(
        `📊 Turns vor State-Update: ${conversation.turns.length}, nach Update: ${updatedTurns.length}`
      );

      setConversation(updatedConversation);
      setIsThinking(true);

      askPlanner(updatedConversation)
        .then((next) => {
          console.log("Plan response:", next);
          console.log("card_id in response:", next.card_id);
          setIsThinking(false);
          addTurn("assistant", next.utterance, next.card_id, next.action);

          if (next.auto_show_card && next.card_id) {
            console.log(
              `📋 Automatisches Anzeigen der Karten-Details für ${next.card_id} (User-Rückfrage erkannt)`
            );
            showCardAutomatically(next.card_id);
          }
        })
        .catch((err) => {
          console.error("Error in askPlanner:", err);
          setIsThinking(false);
        });
    },
    [addTurn, askPlanner, conversation, showCardAutomatically]
  );

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const text = inputValue.trim();
      if (!text) {
        addTurn(
          "assistant",
          "Bitte geben Sie eine Antwort ein, oder klicken Sie auf 'Weiter', wenn Sie fortfahren möchten.",
          undefined,
          undefined
        );
        setInputValue("");
        return;
      }

      setInputValue("");

      const newTurn: Turn = { role: "user", text, ts: Date.now() };
      const updatedTurns = [...conversation.turns, newTurn];
      const updatedConversation = { ...conversation, turns: updatedTurns };

      console.log(`📝 User-Antwort hinzugefügt: "${text.substring(0, 50)}"`);
      console.log(
        `📊 Turns vor State-Update: ${conversation.turns.length}, nach Update: ${updatedTurns.length}`
      );
      console.log(
        `📋 Alle Turns:`,
        updatedTurns.map((t) => ({ role: t.role, text: t.text.substring(0, 30) }))
      );

      setConversation(updatedConversation);
      setIsThinking(true);

      askPlanner(updatedConversation)
        .then((next) => {
          console.log("Plan response:", next);
          console.log("card_id in response:", next.card_id);
          setIsThinking(false);
          addTurn("assistant", next.utterance, next.card_id, next.action);

          if (next.auto_show_card && next.card_id) {
            console.log(
              `📋 Automatisches Anzeigen der Karten-Details für ${next.card_id} (User-Rückfrage erkannt)`
            );
            setTimeout(() => {
              const card = cards.find((c) => c.id === next.card_id);
              if (card) {
                setSelectedCard(card);
              } else {
                if (next.card_id) {
                  loadCardById(next.card_id).then((loaded) => {
                    if (loaded) setSelectedCard(loaded);
                  });
                }
              }
            }, 100);
          }
        })
        .catch((err) => {
          console.error("Error in askPlanner:", err);
          setIsThinking(false);
        });
    },
    [addTurn, inputValue, askPlanner, cards, conversation, loadCardById]
  );

  useEffect(() => {
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
        } catch (error) {
          console.error("Error getting initial message:", error);
          if (isMounted) {
            setIsThinking(false);
            addTurn(
              "assistant",
              "Willkommen. Ich begleite Sie bei der Reflexion über Ihre Prioritäten und Wünsche. Lassen Sie uns beginnen.",
              undefined,
              "present_topics"
            );
          }
        }
      };
      initialMessage();

      return () => {
        isMounted = false;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.length, conversation.turns.length]);

  // Funktion zum Anzeigen einer vereinfachten Erklärung mit Beispielen
  const handleShowHelpExplanation = useCallback(
    async (cardId?: string) => {
      if (!cardId) {
        addTurn(
          "assistant",
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

      const currentPhase = conversation.phase || 1;
      if (currentPhase === 2) {
        try {
          const response = await fetch(`${getApiUrl()}/api/plan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              turns: [
                ...conversation.turns,
                {
                  role: "user",
                  text: "Ich brauche eine vereinfachte Erklärung zu diesem Thema",
                  ts: Date.now(),
                },
              ],
              activeTopic: conversation.activeTopic || "",
              phase: 2,
            }),
          });

          if (response.ok) {
            const data = await response.json();
            addTurn("assistant", data.utterance, cardId, data.action);
            return;
          }
        } catch (err) {
          console.error("Fehler beim Abrufen der LLM-Erklärung:", err);
        }
      }

      const card = await loadCardById(cardId);

      if (card) {
        let explanation = `Lassen Sie mich das Thema "${card.title}" vereinfacht erklären:\n\n`;
        explanation += `${card.description || card.prompt}\n\n`;

        if (card.example_actions && card.example_actions.length > 0) {
          explanation += `Beispiele, was das bedeuten könnte:\n`;
          card.example_actions.slice(0, 2).forEach((example: string) => {
            explanation += `• ${example}\n`;
          });
        }

        explanation +=
          `\nSie können auf diese Frage antworten, indem Sie sagen, wie wichtig dieses Thema für Sie ist, ` +
          `oder Sie können es in eigenen Worten beschreiben.`;

        addTurn("assistant", explanation, cardId, "ask_card");
      } else {
        addTurn(
          "assistant",
          "Entschuldigung, ich konnte die Erklärung zu diesem Thema nicht laden. Bitte versuchen Sie es erneut oder beantworten Sie die Frage in eigenen Worten.",
          undefined,
          undefined
        );
      }
    },
    [addTurn, conversation, getApiUrl, loadCardById]
  );

  const handleShowCardDetails = async (cardId: string) => {
    console.log("=== handleShowCardDetails aufgerufen ===");
    console.log("card_id:", cardId);
    console.log("Verfügbare Karten:", cards.length);
    console.log("Aktuell selectedCard:", selectedCard?.id);

    if (!cardId) {
      console.error("Keine card_id übergeben!");
      return;
    }

    if (cards.length === 0) {
      console.log("Karten noch nicht geladen, lade sie jetzt...");
      try {
        const response = await fetch(`${getApiUrl()}/api/cards`);
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data)) {
            setCards(data);
            const card = data.find((c: Card) => c.id === cardId);
            if (card) {
              console.log("Karte gefunden nach Laden:", card.title);
              setSelectedCard(card);
              return;
            }
          }
        }
      } catch (err) {
        console.error("Fehler beim Laden der Karte:", err);
      }
    }

    const card = cards.find((c) => c.id === cardId);
    console.log("Gefundene Karte im lokalen Array:", card);
    if (card) {
      console.log("Setze selectedCard auf:", card.title);
      setSelectedCard(card);
      console.log("selectedCard nach setState:", selectedCard);
    } else {
      console.warn("Karte nicht im lokalen Array gefunden für ID:", cardId);
      console.log("Verfügbare Karten-IDs (erste 5):", cards.slice(0, 5).map((c) => c.id));

      try {
        console.log("Versuche Karte direkt vom Backend zu holen...");
        console.log("cardId:", cardId);
        console.log("encodeURIComponent(cardId):", encodeURIComponent(cardId));

        let response = await fetch(`${getApiUrl()}/api/cards/${cardId}`);

        if (!response.ok && response.status === 404) {
          console.log("404 ohne Encoding, versuche mit Encoding...");
          response = await fetch(`${getApiUrl()}/api/cards/${encodeURIComponent(cardId)}`);
        }

        if (!response.ok) {
          const errorText = await response.text();
          console.error("Backend antwortete mit Status:", response.status);
          console.error("Fehler-Response:", errorText);

          if (response.status === 404) {
            console.log("404 erhalten, lade alle Karten neu...");
            const allCardsResponse = await fetch(`${getApiUrl()}/api/cards`);
            if (allCardsResponse.ok) {
              const allCards = await allCardsResponse.json();
              setCards(allCards);

              let foundCard = allCards.find((c: Card) => c.id === cardId);
              if (!foundCard) {
                foundCard = allCards.find(
                  (c: Card) => c.id.toLowerCase() === cardId.toLowerCase()
                );
              }
              if (foundCard) {
                console.log("Karte nach Neu-Laden gefunden:", foundCard.title);
                setSelectedCard(foundCard);
                return;
              } else {
                console.error(
                  "Karte auch nach Neu-Laden nicht gefunden. Verfügbare IDs:",
                  allCards.slice(0, 5).map((c: Card) => c.id)
                );
              }
            }
          }
          return;
        }

        const cardData = await response.json();
        console.log("Karte vom Backend erhalten:", cardData.title);
        setSelectedCard(cardData);
      } catch (err) {
        console.error("Fehler beim Abrufen der Karte:", err);
      }
    }
  };

  // Prüfe, ob alle Karten gespielt wurden (wrap action)
  const isGameComplete = useMemo(
    () => conversation.turns.some((turn) => turn.action === "wrap"),
    [conversation.turns]
  );

  // PDF Export Funktion
  const handleExportPDF = useCallback(async () => {
    try {
      const response = await fetch(`${getApiUrl()}/api/export/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(conversation),
      });

      if (!response.ok) {
        throw new Error("PDF Export fehlgeschlagen");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "reflexion-zusammenfassung.pdf";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("PDF Export Fehler:", err);
      alert("Fehler beim Exportieren der PDF. Bitte versuchen Sie es erneut.");
    }
  }, [conversation, getApiUrl]);

  // JSON Export Funktion
  const handleExportJSON = useCallback(async () => {
    try {
      const currentConversation = conversationRef.current;

      console.log("📤 Exportiere Conversation:", {
        turnsCount: currentConversation.turns.length,
        phase: currentConversation.phase,
        activeTopic: currentConversation.activeTopic,
        turns: currentConversation.turns.map((t) => ({
          role: t.role,
          text: t.text.substring(0, 30),
        })),
      });
      console.log(
        "📤 Vollständige Conversation-Struktur:",
        JSON.stringify(currentConversation, null, 2)
      );

      const response = await fetch(`${getApiUrl()}/api/export/json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentConversation),
      });

      console.log("📤 Response Status:", response.status, response.statusText);

      if (!response.ok) {
        let errorMessage = "JSON Export fehlgeschlagen";
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch {
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const exportData = await response.json();

      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reflexion-export-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      alert("✅ Export erfolgreich! Die Datei enthält Ihr gesamtes Gespräch und den Spielstand.");
    } catch (err) {
      console.error("JSON Export Fehler:", err);
      alert("Fehler beim Exportieren der JSON. Bitte versuchen Sie es erneut.");
    }
  }, [getApiUrl]);

  // JSON Import Funktion
  const handleImportJSON = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const exportData = JSON.parse(text);

        if (!exportData.version || !exportData.conversation) {
          alert("❌ Ungültiges Export-Format. Bitte wählen Sie eine gültige Export-Datei.");
          return;
        }

        const hasSensitiveContent = exportData.metadata?.has_sensitive_content || false;
        if (hasSensitiveContent) {
          const confirmImport = confirm(
            "⚠️ Diese Datei enthält möglicherweise sensible Inhalte.\n\n" +
              "Es wird empfohlen, diese mit einer Fachperson zu besprechen.\n\n" +
              "Möchten Sie trotzdem fortfahren?"
          );
          if (!confirmImport) return;
        }

        const response = await fetch(`${getApiUrl()}/api/import/json`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ exportData }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || "Import fehlgeschlagen");
        }

        const result = await response.json();

        setConversation(result.conversation);

        if (result.metadata.has_sensitive_content) {
          alert(
            "✅ Import erfolgreich!\n\n" +
              "⚠️ Diese Datei enthält möglicherweise sensible Inhalte.\n" +
              "Es wird empfohlen, diese mit einer Fachperson zu besprechen."
          );
        } else {
          alert("✅ Import erfolgreich! Ihr Gespräch und Spielstand wurden wiederhergestellt.");
        }
      } catch (err) {
        console.error("JSON Import Fehler:", err);
        alert(`Fehler beim Importieren: ${err instanceof Error ? err.message : "Unbekannter Fehler"}`);
      }
    };
    input.click();
  }, [getApiUrl]);

  // Übergebe Handler-Funktionen an Parent-Komponente (nur einmal beim Mount)
  useEffect(() => {
    if (onImportExportReady) {
      onImportExportReady({ handleImportJSON, handleExportJSON });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onImportExportReady]);

  return (
    <div className="chat-container">
      <div
        ref={chatWrapperRef}
        className={`chat-wrapper ${selectedCard ? "chat-shrunk" : "chat-expanded"}`}
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div className="chat-inner-wrapper">
          <section id="chat" aria-live="polite" aria-label="Chatverlauf" ref={chatRef}>
            {conversation.turns.map((turn, idx) => {
              const hasCardId = turn.role === "assistant" && turn.card_id;
              const isAskCard = turn.action === "ask_card";
              const currentPhase = conversation.phase || 1;
              const showDetailsButton = hasCardId && isAskCard && currentPhase === 2;
              const isWrap = turn.action === "wrap";

              const utteranceArray = Array.isArray(turn.text) ? turn.text : [turn.text];

              return (
                <div key={idx}>
                  {utteranceArray.map((text, bubbleIdx) => (
                    <div key={bubbleIdx} className={`msg ${turn.role}`}>
                      <div className="msg-content-wrapper">
                        <div className="bubble">{text}</div>

                        {showDetailsButton && bubbleIdx === utteranceArray.length - 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              console.log("Button geklickt für card_id:", turn.card_id);

                              const p = conversation.phase || 1;
                              if (p === 2) {
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
                                backgroundColor: "#3b82f6",
                                color: "white",
                                marginRight: "8px",
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
                                backgroundColor: "#10b981",
                                color: "white",
                              }}
                              title="JSON exportieren"
                            >
                              💾 JSON exportieren
                            </button>
                          </>
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

          {/* Quick-Response Buttons */}
          {(() => {
            const lastAssistantTurnWithAction = [...conversation.turns]
              .reverse()
              .find((turn) => turn.role === "assistant" && turn.action);

            const isAskCard =
              lastAssistantTurnWithAction &&
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
      </div>

      {selectedCard && (
        <>
          <div
            className="card-overlay"
            onClick={() => {
              console.log("Overlay geklickt, Karte wird geschlossen");
              setSelectedCard(null);
            }}
            aria-label="Karte schließen"
          />
          <aside className="card-detail-panel">
            <button
              className="card-close-btn"
              onClick={() => {
                console.log("Karte wird geschlossen");
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
