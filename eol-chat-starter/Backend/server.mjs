import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import PDFDocument from 'pdfkit';

function cleanModelText(t) {
  if (!t || typeof t !== 'string') return '';
  let s = t.trim();
  // Codefences entfernen
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  }
  return s;
}

function safeParsePlanner(text) {
  const cleaned = cleanModelText(text);
  // 1. direkter Versuch
  try { return JSON.parse(cleaned); } catch {}
  // 2. JSON-Block heuristisch herausschneiden (erstes '{' bis letztes '}')
  const first = cleaned.indexOf('{');
  const last  = cleaned.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    const slice = cleaned.slice(first, last + 1);
    try { return JSON.parse(slice); } catch {}
  }
  // 3. gescheitert → null zurück
  return null;
}

// Helper functions to handle utterance as string or array
function getUtteranceLength(utterance) {
  if (Array.isArray(utterance)) {
    return utterance.join(' ').length;
  }
  return (utterance || '').length;
}

function cleanUtterance(utterance, cleanerFn) {
  if (Array.isArray(utterance)) {
    return utterance.map(cleanerFn).filter(u => u && u.trim().length > 0);
  }
  const cleaned = cleanerFn(utterance);
  return cleaned && cleaned.trim().length > 0 ? cleaned : utterance;
}

function utteranceToString(utterance) {
  if (Array.isArray(utterance)) {
    return utterance.join(' ');
  }
  return (utterance || '');
}

function isUtteranceEmpty(utterance) {
  if (!utterance) return true;
  if (Array.isArray(utterance)) {
    return utterance.length === 0 || utterance.every(u => !u || u.trim() === '');
  }
  return utterance.trim() === '';
}

// Erkennt, ob der User eine Rückfrage stellt oder die Frage nicht versteht
function isUserAskingQuestion(userMessage) {
  if (!userMessage || typeof userMessage !== 'string') return false;
  const msg = userMessage.toLowerCase().trim();
  
  // Prüfe auf Fragezeichen am Ende
  if (msg.endsWith('?')) {
    return true;
  }
  
  // Fragewörter am Anfang (häufigste Indikatoren für Fragen)
  const questionStarters = [
    'was', 'wie', 'wo', 'wann', 'warum', 'weshalb', 'wozu', 'wem', 'wen', 'wessen',
    'welche', 'welcher', 'welches', 'welchen', 'welchem', 'welchem'
  ];
  
  // Prüfe, ob die Nachricht mit einem Fragewort beginnt
  const firstWord = msg.split(/\s+/)[0];
  if (questionStarters.some(starter => firstWord === starter || firstWord.startsWith(starter))) {
    return true;
  }
  
  // Keywords für Rückfragen oder Nicht-Verstehen
  const questionKeywords = [
    'was meinen', 'was bedeutet', 'was heißt', 'was ist',
    'verstehe nicht', 'verstehe ich nicht', 'nicht verstanden',
    'kannst du erklären', 'können sie erklären', 'erklären sie',
    'was soll das', 'was meinst du', 'was meinen sie',
    'wie meinen', 'wie meinst du', 'wie meinen sie',
    'können sie das', 'kannst du das', 'können sie mir',
    'was genau', 'wie genau', 'was ist damit gemeint',
    'unverständlich', 'unklar', 'nicht klar',
    'was bedeutet das', 'was heißt das', 'was meint das',
    'können sie mir erklären', 'kannst du mir erklären',
    'ich verstehe nicht', 'ich habe nicht verstanden',
    'was ist gemeint', 'was meinen sie damit',
    'können sie das erklären', 'kannst du das erklären',
    'was ist das', 'was soll ich damit', 'was bedeutet dieser begriff',
    'was bedeutet dieser', 'was bedeutet diese', 'was bedeutet das wort',
    'erklären sie bitte', 'können sie bitte erklären',
    'ich weiß nicht was', 'ich weiß nicht wie', 'ich weiß nicht wo',
    'ich verstehe es nicht', 'ich habe es nicht verstanden'
  ];
  
  return questionKeywords.some(keyword => msg.includes(keyword));
}

// Erkennt das Thema aus der Benutzerantwort
function detectTopicFromUserMessage(userMessage) {
  if (!userMessage || typeof userMessage !== 'string') return null;
  const msg = userMessage.toLowerCase().trim();
  
  // Keywords für illness_care (erweitert für bessere Erkennung)
  if (msg.includes('krankheit') || msg.includes('behandlung') || msg.includes('medizin') || 
      msg.includes('krank') || msg.includes('therapie') || msg.includes('arzt') || 
      msg.includes('ärztin') || msg.includes('patient') || msg.includes('krankheit & behandlung') ||
      msg.includes('krankheit und behandlung')) {
    return 'illness_care';
  }
  
  // Keywords für practical
  if (msg.includes('praktisch') || msg.includes('organisatorisch') || msg.includes('organisation') ||
      msg.includes('alltag') || msg.includes('planung') || msg.includes('dokument')) {
    return 'practical';
  }
  
  // Keywords für dignity
  // WICHTIG: "wichtig" ist KEIN Topic-Keyword, sondern eine Antwort auf Fragen!
  // Nur explizite Topic-Auswahlen sollten erkannt werden
  if (msg.includes('würde') || msg.includes('werte') || msg.includes('selbstbild') ||
      msg.includes('priorität') || msg.includes('respekt') || msg.includes('dignity')) {
    return 'dignity';
  }
  
  // Keywords für feelings
  if (msg.includes('gefühl') || msg.includes('beziehung') || msg.includes('verbundenheit') ||
      msg.includes('familie') || msg.includes('partner') || msg.includes('freund') ||
      msg.includes('liebe') || msg.includes('trauer') || msg.includes('angst')) {
    return 'feelings';
  }
  
  return null;
}

function inferImportanceFromUserText(userText) {
  const text = (userText || '').toLowerCase();
  if (!text) return null;

  if (
    text.includes('nicht mehr sehr wichtig') ||
    text.includes('nicht so wichtig') ||
    text.includes('weniger wichtig') ||
    text.includes('nicht wichtig') ||
    text.includes('unwichtig')
  ) {
    return 'not_important';
  }

  if (
    text.includes('sehr wichtig') ||
    text.includes('extrem wichtig') ||
    text.includes('außerordentlich wichtig') ||
    text.includes('besonders wichtig')
  ) {
    return 'very_important';
  }

  if (text.includes('wichtig')) return 'important';
  if (text.includes('unsicher') || text.includes('ich weiß nicht') || text.includes('weiss nicht')) return 'unsure';
  return null;
}

function buildCurrentCardImportanceState(turns) {
  const importanceByCardId = new Map();

  turns.forEach((turn, index) => {
    if (
      turn.role === 'assistant' &&
      turn.card_id &&
      typeof turn.importance === 'string' &&
      turn.importance.trim() !== ''
    ) {
      importanceByCardId.set(turn.card_id, turn.importance);
    }

    if (turn.role === 'user' && index > 0) {
      const inferred = inferImportanceFromUserText(turn.text);
      if (!inferred) return;

      for (let i = index - 1; i >= 0; i--) {
        const prev = turns[i];
        if (prev?.role === 'assistant' && prev.card_id) {
          importanceByCardId.set(prev.card_id, inferred);
          break;
        }
      }
    }
  });

  return importanceByCardId;
}

// env laden
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, 'development.env') });

// Karten laden
let CARDS = [];
try {
  const cardsPath = path.join(__dirname, 'cards', 'cards.de.json');
  const cardsData = readFileSync(cardsPath, 'utf-8');
  const allCards = JSON.parse(cardsData);

  // Optionaler Whitelist-Filter: editierbar über cards/active-card-ids.json
  // Wenn die Datei fehlt oder leer ist, werden alle Karten verwendet.
  const whitelistPath = path.join(__dirname, 'cards', 'active-card-ids.json');
  let activeCardIds = [];

  if (existsSync(whitelistPath)) {
    try {
      const rawWhitelist = readFileSync(whitelistPath, 'utf-8');
      const parsedWhitelist = JSON.parse(rawWhitelist);
      if (Array.isArray(parsedWhitelist)) {
        activeCardIds = parsedWhitelist
          .map((id) => (typeof id === 'string' ? id.trim() : ''))
          .filter((id) => id.length > 0);
      } else {
        console.warn(`⚠️ Whitelist-Datei ist kein Array: ${whitelistPath}. Verwende alle Karten.`);
      }
    } catch (whitelistErr) {
      console.warn(`⚠️ Konnte Whitelist nicht lesen: ${whitelistErr.message}. Verwende alle Karten.`);
    }
  }

  if (activeCardIds.length > 0) {
    const whitelistSet = new Set(activeCardIds);
    const filteredCards = allCards.filter((card) => whitelistSet.has(card.id));
    const unknownIds = activeCardIds.filter((id) => !allCards.some((card) => card.id === id));

    if (filteredCards.length > 0) {
      CARDS = filteredCards;
      console.log(`✅ ${CARDS.length}/${allCards.length} Karten per Whitelist geladen (${whitelistPath})`);
      if (unknownIds.length > 0) {
        console.warn(`⚠️ ${unknownIds.length} unbekannte card_id(s) in Whitelist ignoriert: ${unknownIds.join(', ')}`);
      }
    } else {
      CARDS = allCards;
      console.warn(`⚠️ Whitelist enthält keine gültigen IDs. Fallback auf alle ${allCards.length} Karten.`);
    }
  } else {
    CARDS = allCards;
    console.log(`✅ ${CARDS.length} Karten geladen (keine aktive Whitelist)`);
  }
} catch (e) {
  console.error('❌ Konnte Karten nicht laden:', e.message);
  CARDS = [];
}

// System-Prompt laden
let SYSTEM_PROMPT = '';
try {
  const promptPath = path.join(__dirname, 'prompts', 'system-prompt.txt');
  SYSTEM_PROMPT = readFileSync(promptPath, 'utf-8').trim();
  console.log('✅ System-Prompt geladen');
} catch (e) {
  console.error('❌ Konnte System-Prompt nicht laden:', e.message);
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

// Request Logging Middleware
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path}`);
  next();
});

// OpenAI Konfiguration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ORG_ID = process.env.OPENAI_ORG_ID;
const OPENAI_PROJECT_ID = process.env.OPENAI_PROJECT_ID;

function maskSecret(value) {
  if (!value || typeof value !== 'string') return 'nicht gesetzt';
  if (value.length <= 14) return '<gesetzt, maskiert>';
  return `${value.slice(0, 7)}...${value.slice(-4)} (${value.length} Zeichen)`;
}

if (!OPENAI_API_KEY) {
  console.error('❌ Keine OpenAI API Key gefunden!');
  console.error('   Bitte setzen Sie OPENAI_API_KEY in development.env');
  process.exit(1);
}

console.log('✅ Verwende OpenAI direkt');
console.log(`🔑 OpenAI API Key: ${maskSecret(OPENAI_API_KEY)}`);
console.log(`🏢 OpenAI Organization: ${OPENAI_ORG_ID || 'nicht gesetzt'}`);
console.log(`📁 OpenAI Project: ${OPENAI_PROJECT_ID || 'nicht gesetzt'}`);
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
  organization: OPENAI_ORG_ID,
  project: OPENAI_PROJECT_ID,
  maxRetries: 2,
  timeout: 30000
});

let COLD = true;
const MODEL = process.env.MODEL || 'gpt-5.1';
console.log(`🤖 Verwendetes Model: ${MODEL} (aus env: ${process.env.MODEL || 'nicht gesetzt, verwende Standard'})`);

// hilfsfunktion: LLM-Aufruf mit Timeout
function withTimeout(promise, ms = 30000) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('planner_timeout')), ms))
  ]);
}

async function callPlanner(requestPayload, useNewFormat, fallbackPayload) {
  // GPT-5.1 verwendet das responses.create API
  if (useNewFormat) {
    try {
      if (openai.responses && typeof openai.responses.create === 'function') {
        return await withTimeout(
          openai.responses.create(requestPayload),
          30000
        );
      }
    } catch (e) {
      console.warn('responses.create not available, falling back to chat.completions:', e.message);
      // Verwende den Fallback-Payload für chat.completions
      if (fallbackPayload) {
        return withTimeout(
          openai.chat.completions.create(fallbackPayload),
          30000
        );
      }
    }
  }
  
  // Fallback zu chat.completions (für GPT-4 oder wenn responses.create nicht verfügbar)
  return withTimeout(
    openai.chat.completions.create(requestPayload),
    30000
  );
}

app.post('/api/plan', async (req, res) => {
  try {
    const { turns = [], activeTopic = "" } = req.body || {};
    let phase = req.body?.phase || 1; // Verwende let, damit phase geändert werden kann
    
    const lastTurns = turns.slice(-6);
    
    // Wenn keine Turns vorhanden sind, ist es der Start - sende Willkommensnachricht in mehreren Bubbles
    // Prüfe auch, ob bereits ein present_topics Turn vorhanden ist oder ob bereits eine User-Nachricht vorhanden ist
    const hasWelcomeMessage = turns.some(t => 
      t.role === 'assistant' && 
      (t.action === 'present_topics' || 
       (t.text && (t.text.includes('Herzlich willkommen') || t.text.includes('willkommen zur Reflexion'))))
    );
    const hasUserMessage = turns.some(t => t.role === 'user');
    
    // Nur Einstiegstext senden, wenn keine Turns vorhanden sind UND kein Welcome-Message UND keine User-Nachricht
    if (turns.length === 0 && !hasWelcomeMessage && !hasUserMessage) {
      return res.json({
        action: "present_topics",
        utterance: [
          "Herzlich willkommen zur Reflexion über Prioritäten und Wünsche am Lebensende.",
          "Ich bin Reflecta und begleite Sie durch den Reflektionsprozess, in dem wir gemeinsam wichtige Themen erkunden. Die Themen wurden von HUG's Spezialisten entwickelt und deckt unterschiedliche Aspekte Ihres Lebens.",
          "Der Prozess verläuft in zwei Phasen:Phase 1: Wir erkunden verschiedene Themen und sammeln erste Gedanken. Sie entscheiden, ob das Thema sehr wichtig, wichtig oder nicht so wichtig ist.\nPhase 2: Wir vertiefen die wichtigsten Themen und besprechen mögliche nächste Schritte.",
          "Insgesamt gibt es ungefähr 30 Themen. Sie bestimmen das Tempo und können jederzeit pausieren. Zu den Themen gibt es keine richtigen oder falschen Antworten.",
          "Schreiben Sie, wenn Sie bereit sind!"
        ],
        target_topic: "",
        card_id: "",
        importance: "",
        navigation: "",
        propose_action_now: false
      });
    }

    // Prüfe, ob der Benutzer gerade ein Thema gewählt hat
    // WICHTIG: Suche in ALLEN User-Nachrichten, nicht nur der neuesten
    // um zu sehen, ob der User bereits ein Topic gewählt hat
    // DEBUG: Zeige alle Turns
    console.log(`📋 DEBUG Turns (${turns.length} total):`, turns.map(t => `${t.role}: "${t.text?.substring(0, 30)}"`).join(' | '));
    
    const allUserTurns = turns.filter(t => t.role === 'user');
    // Die neueste User-Nachricht ist die letzte im gesamten Turns-Array, nicht nur in allUserTurns
    // Prüfe zuerst, ob der letzte Turn überhaupt ein User-Turn ist
    const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
    const lastUserMessage = lastTurn && lastTurn.role === 'user' ? lastTurn.text : 
                           (allUserTurns.length > 0 ? allUserTurns[allUserTurns.length - 1].text : '');
    
    // Prüfe, ob der User eine Pause einlegen möchte
    const userWantsPause = lastUserMessage && (
      lastUserMessage.toLowerCase().includes('pause') ||
      lastUserMessage.toLowerCase().includes('unterbrechen') ||
      lastUserMessage.toLowerCase().includes('stopp') ||
      lastUserMessage.toLowerCase().includes('aufhören') ||
      lastUserMessage.toLowerCase().includes('beenden')
    );
    
    // Prüfe, ob die Eingabe leer ist
    if (!lastUserMessage || lastUserMessage.trim().length === 0) {
      console.log('⚠️ Leere Eingabe erkannt - sende Guidance-Meldung');
      return res.json({
        action: "present_topics",
        utterance: "Bitte geben Sie eine Antwort ein. Sie können auch 'überspringen' sagen, wenn Sie eine Frage nicht beantworten möchten.",
        target_topic: "",
        card_id: "",
        importance: "",
        navigation: "",
        propose_action_now: false
      });
    }
    
    // Prüfe, ob der User eine Rückfrage stellt oder die Frage nicht versteht
    const isUserQuestion = isUserAskingQuestion(lastUserMessage);
    // Finde die letzte Assistant-Nachricht mit card_id (falls vorhanden)
    const lastAssistantWithCard = [...turns].reverse().find(t => t.role === 'assistant' && t.card_id);
    
    // Wenn User eine Rückfrage stellt und es gibt eine Karte in der letzten Assistant-Nachricht,
    // markiere, dass die Karten-Details automatisch angezeigt werden sollen
    const shouldShowCardDetails = isUserQuestion && lastAssistantWithCard && lastAssistantWithCard.card_id;
    
    if (shouldShowCardDetails) {
      console.log(`❓ User stellt Rückfrage: "${lastUserMessage}". Zeige automatisch Details für Karte ${lastAssistantWithCard.card_id}`);
    }
    
    // WICHTIG: Wenn User eine Rückfrage stellt, lasse den LLM eine detaillierte Erklärung geben
    // Wir überspringen NICHT den LLM-Aufruf, damit er eine umfassende Antwort geben kann
    // auto_show_card wird später nur gesetzt, wenn die Antwort kurz ist und die Karten-Details hilfreich wären
    
    // WICHTIG: Prüfe zuerst, ob bereits ein activeTopic gesetzt ist
    // Wenn ja, verwende es, es sei denn, der User wählt explizit ein neues Topic
    let detectedTopic = null;
    
    // Prüfe, ob der User auf ein Thema hinweist (z.B. "es gäbe doch noch würde und werte")
    const userMentionsTopic = detectTopicFromUserMessage(lastUserMessage);
    const userHintsAtTopic = lastUserMessage && (
      lastUserMessage.toLowerCase().includes('gäbe') ||
      lastUserMessage.toLowerCase().includes('gibt') ||
      lastUserMessage.toLowerCase().includes('noch') ||
      lastUserMessage.toLowerCase().includes('auch') ||
      lastUserMessage.toLowerCase().includes('fehlt') ||
      lastUserMessage.toLowerCase().includes('vergessen') ||
      lastUserMessage.toLowerCase().includes('dürfte') ||
      lastUserMessage.toLowerCase().includes('sollte')
    );
    
    if (!activeTopic || activeTopic === "") {
      // Nur wenn noch kein Topic gewählt wurde, prüfe die neueste Nachricht
      detectedTopic = userMentionsTopic;
    } else {
      // Wenn bereits ein Topic aktiv ist, prüfe ob der User ein NEUES Topic wählt
      // ODER ob er auf ein Thema hinweist (auch wenn es ein anderes Thema ist)
      if (userMentionsTopic && userMentionsTopic !== activeTopic) {
        // User wählt explizit ein anderes Topic oder weist darauf hin
        detectedTopic = userMentionsTopic;
        console.log(`🔄 User wechselt/weist hin auf Thema ${userMentionsTopic} (aktuell: ${activeTopic})`);
      } else if (userMentionsTopic && userMentionsTopic === activeTopic && userHintsAtTopic) {
        // User weist auf das aktuelle Thema hin (z.B. "es gäbe doch noch würde und werte")
        // Prüfe, ob es noch ungefragte Fragen zu diesem Thema gibt
        const topicCardsForMentioned = CARDS.filter(c => c.topic === userMentionsTopic);
        const askedCardsForMentioned = topicCardsForMentioned.filter(c => askedCardIds.has(c.id));
        if (askedCardsForMentioned.length < topicCardsForMentioned.length) {
          // Es gibt noch ungefragte Fragen zu diesem Thema
          detectedTopic = userMentionsTopic;
          console.log(`💡 User weist auf Thema ${userMentionsTopic} hin - es gibt noch ${topicCardsForMentioned.length - askedCardsForMentioned.length} ungefragte Fragen`);
        }
      } else if (userMentionsTopic && userHintsAtTopic) {
        // User weist auf ein Thema hin, auch wenn es nicht das aktuelle ist
        // Prüfe, ob es noch ungefragte Fragen zu diesem Thema gibt
        const topicCardsForMentioned = CARDS.filter(c => c.topic === userMentionsTopic);
        const askedCardsForMentioned = topicCardsForMentioned.filter(c => askedCardIds.has(c.id));
        if (askedCardsForMentioned.length < topicCardsForMentioned.length) {
          // Es gibt noch ungefragte Fragen zu diesem Thema
          detectedTopic = userMentionsTopic;
          console.log(`💡 User weist auf Thema ${userMentionsTopic} hin - es gibt noch ${topicCardsForMentioned.length - askedCardsForMentioned.length} ungefragte Fragen`);
        }
      } else {
        // User antwortet auf Fragen, kein Topic-Wechsel
        detectedTopic = null;
      }
    }
    
    let currentTopic = activeTopic;
    
    console.log(`🔍 Topic Detection: lastTurn.role="${lastTurn?.role}", lastUserMessage="${lastUserMessage}", detectedTopic="${detectedTopic}", activeTopic="${activeTopic}", phase=${phase}, totalTurns=${turns.length}, userTurns=${allUserTurns.length}, isUserQuestion=${isUserQuestion}`);
    
    // Wenn ein Thema erkannt wurde, setze currentTopic
    // Wenn der User auf ein Thema hinweist (z.B. "es gäbe doch noch würde und werte"), sollte currentTopic auch gesetzt werden
    if (detectedTopic) {
      if (!currentTopic || (userHintsAtTopic && detectedTopic !== currentTopic)) {
        currentTopic = detectedTopic;
        console.log(`✅ Setze currentTopic auf ${detectedTopic}${userHintsAtTopic ? ' (User weist darauf hin)' : ''}`);
      } else if (userHintsAtTopic && detectedTopic === currentTopic) {
        // User weist auf das aktuelle Thema hin - currentTopic bleibt gleich, aber wir wissen, dass es noch Fragen gibt
        console.log(`💡 User weist auf aktuelles Thema ${detectedTopic} hin - es gibt noch ungefragte Fragen`);
      }
    }
    
    // Karten für aktuelles Thema filtern (vorher definieren, falls es später verwendet wird)
    let topicCards = currentTopic ? CARDS.filter(c => c.topic === currentTopic).sort((a, b) => (a.order || 0) - (b.order || 0)) : [];
    
    // KRITISCH: Wenn ein Thema erkannt wurde, IMMER prüfen ob es ungefragte Karten gibt
    // und diese zurückgeben, OHNE das LLM aufzurufen - auch wenn activeTopic bereits gesetzt ist
    if (detectedTopic) {
      console.log(`🎯 Thema erkannt (${detectedTopic}) - prüfe ungefragte Karten (activeTopic: ${activeTopic}, phase: ${phase})`);
      // Finde die erste ungefragte Karte dieses Themas
      topicCards = CARDS.filter(c => c.topic === detectedTopic).sort((a, b) => (a.order || 0) - (b.order || 0));
      // Berechne bereits gefragte Karten aus den Turns
      const askedCardIdsForTopic = new Set();
      turns.forEach(turn => {
        if (turn.card_id) {
          const card = CARDS.find(c => c.id === turn.card_id);
          if (card && card.topic === detectedTopic) {
            askedCardIdsForTopic.add(turn.card_id);
          }
        }
      });
      console.log(`📊 Für Thema ${detectedTopic}: ${topicCards.length} Karten gesamt, ${askedCardIdsForTopic.size} bereits gefragt`);
      
      // Finde erste ungefragte Karte
      const firstUnaskedCard = topicCards.find(c => !askedCardIdsForTopic.has(c.id));
      
      // Wenn es ungefragte Karten gibt, IMMER die erste zurückgeben OHNE LLM-Aufruf
      if (firstUnaskedCard) {
        console.log(`✅ EARLY RETURN: Erste ungefragte Karte ${firstUnaskedCard.id} für Thema ${detectedTopic} (activeTopic war: ${activeTopic}, turns.length: ${turns.length})`);
        // Karten-Prompt ist bereits in der gewünschten Sprache (aus cards.de.json)
        // Für andere Sprachen müssten wir cards.en.json, cards.fr.json, cards.it.json laden
        // Für jetzt: LLM wird die Sprache aus dem System-Prompt verwenden
        return res.json({
          action: "ask_card",
          utterance: firstUnaskedCard.prompt, // TODO: Mehrsprachige Karten laden
          target_topic: detectedTopic,
          card_id: firstUnaskedCard.id,
          importance: "",
          navigation: "",
          propose_action_now: false
        });
      }
      
      // Wenn wirklich alle Karten gefragt wurden, lass den normalen Flow weiterlaufen
      if (askedCardIdsForTopic.size >= topicCards.length && topicCards.length > 0) {
        console.log(`ℹ️ Alle ${topicCards.length} Karten für ${detectedTopic} wurden bereits gefragt, lass normalen Flow weiterlaufen`);
      } else if (topicCards.length === 0) {
        console.log(`⚠️ Keine Karten für Thema ${detectedTopic} gefunden!`);
      }
    }
    const allCardsByTopic = {
      illness_care: CARDS.filter(c => c.topic === 'illness_care'),
      practical: CARDS.filter(c => c.topic === 'practical'),
      dignity: CARDS.filter(c => c.topic === 'dignity'),
      feelings: CARDS.filter(c => c.topic === 'feelings')
    };
    
    // Extrahiere bereits behandelte Karten aus allen Turns (nicht nur letzten 6)
    const askedCardIds = new Set();
    const answeredCardIds = new Set();
    const askedCardPrompts = new Map(); // Map von card_id zu prompt text
    const recentAssistantTurns = []; // Letzte 3 Assistant-Turns für Duplikatsprüfung
    const veryImportantCardIds = new Set(); // Karten, die als "very_important" markiert wurden
    const veryImportantFollowUpAsked = new Set(); // Karten, bei denen bereits nach dem Grund gefragt wurde
    const completedTopics = new Set(); // Themen, die bereits abgeschlossen wurden (alle Fragen wurden gestellt)
    
    // ZUERST: Sammle alle gefragten card_ids aus allen Turns
    // WICHTIG: Nur Assistant-Turns mit ask_card sollten zählen (nicht follow_up_card, etc.)
    turns.forEach((turn, index) => {
      if (turn.card_id) {
        // Zähle ALLE card_ids, die gefragt wurden (egal welche action)
        // Dies zählt alle Karten, die dem User präsentiert wurden
        askedCardIds.add(turn.card_id);
        // Speichere den Prompt-Text für diese Karte
        if (turn.role === 'assistant') {
          askedCardPrompts.set(turn.card_id, turn.text.toLowerCase());
          recentAssistantTurns.push({ card_id: turn.card_id, text: turn.text.toLowerCase() });
          
          // Prüfe, ob dies eine follow_up_card für eine very_important Karte ist
          const textLower = turn.text.toLowerCase();
          if (textLower.includes('warum') || textLower.includes('wichtig') || textLower.includes('grund')) {
            // Möglicherweise eine Nachfrage nach dem Grund
            veryImportantFollowUpAsked.add(turn.card_id);
          }
        }
      }
      // Wenn nach einer Karte gefragt wurde und der User geantwortet hat, markiere als beantwortet
      if (turn.role === 'assistant' && turn.card_id) {
        // Nächster Turn sollte User-Antwort sein
        if (index < turns.length - 1 && turns[index + 1].role === 'user') {
          answeredCardIds.add(turn.card_id);
        }
      }
      
      // Prüfe, ob summarize_topic aufgerufen wurde (Thema wurde abgeschlossen)
      // WICHTIG: summarize_topic ist in Phase 1 VERBOTEN - nur in Phase 2/3 erlaubt
      // Daher sollte diese Logik hier eigentlich nie in Phase 1 greifen
      if (turn.role === 'assistant' && turn.action === 'summarize_topic') {
        // Versuche target_topic aus dem Turn zu bekommen, sonst aus currentTopic oder dem Text
        const topicToMark = turn.target_topic || currentTopic;
        if (topicToMark) {
          // Zusätzliche Validierung: Prüfe, ob wirklich ALLE Karten dieses Themas gefragt wurden
          const topicCards = CARDS.filter(c => c.topic === topicToMark);
          const askedCardsForTopic = topicCards.filter(c => askedCardIds.has(c.id));
          
          if (topicCards.length > 0 && askedCardsForTopic.length === topicCards.length) {
            completedTopics.add(topicToMark);
            console.log(`✅ Thema ${topicToMark} wurde als abgeschlossen markiert (summarize_topic wurde aufgerufen, alle ${topicCards.length} Karten wurden behandelt: ${askedCardsForTopic.length}/${topicCards.length})`);
          } else {
            console.log(`⚠️ WARNUNG: summarize_topic für Thema ${topicToMark} aufgerufen, aber nicht alle Karten gefragt (${askedCardsForTopic.length}/${topicCards.length}) - markiere NICHT als abgeschlossen`);
          }
        } else {
          console.log(`⚠️ WARNUNG: summarize_topic aufgerufen, aber kein topicToMark gefunden (target_topic: ${turn.target_topic}, currentTopic: ${currentTopic})`);
        }
      }
      
      // ENTFERNT: Text-basierte Erkennung abgeschlossener Themen war zu aggressiv
      // Ein Thema wird NUR als abgeschlossen markiert, wenn:
      // 1. summarize_topic explizit aufgerufen wurde, ODER
      // 2. ALLE Karten des Themas gefragt wurden (siehe Code unten)
    });
    
    // Zusätzlich: Prüfe, ob alle Karten eines Themas behandelt wurden (als Fallback)
    const allTopics = ['illness_care', 'practical', 'dignity', 'feelings'];
    const topicMentions = {
      'illness_care': ['krankheit', 'behandlung', 'medizinisch'],
      'practical': ['praktisch', 'organisatorisch', 'praktische fragen'],
      'dignity': ['würde', 'werte', 'würde und werte'],
      'feelings': ['gefühle', 'beziehungen', 'verbundenheit', 'gefühle und beziehungen']
    };
    
    // KRITISCH: Markiere Themen als abgeschlossen, wenn ALLE Karten des Themas gefragt wurden
    // WICHTIG: Prüfe für JEDES Thema einzeln, ob ALLE Karten gefragt wurden
    // Logge zuerst den aktuellen Status
    console.log(`📊 [TOPIC COMPLETION CHECK] Prüfe Themen-Abschluss:`);
    console.log(`   Bereits als abgeschlossen markiert: ${Array.from(completedTopics).join(', ') || 'keine'}`);
    console.log(`   Gefragte Karten gesamt: ${askedCardIds.size}/${CARDS.length}`);
    
    allTopics.forEach(topic => {
      const topicCards = CARDS.filter(c => c.topic === topic);
      const askedCardsForTopic = topicCards.filter(c => askedCardIds.has(c.id));
      const cardIdsForTopic = topicCards.map(c => c.id).join(', ');
      const askedCardIdsForTopic = Array.from(askedCardsForTopic).map(c => c.id).join(', ');
      
      console.log(`   Thema ${topic}: ${askedCardsForTopic.length}/${topicCards.length} Karten behandelt`);
      console.log(`     Karten IDs: [${cardIdsForTopic}]`);
      console.log(`     Gefragte IDs: [${askedCardIdsForTopic}]`);
      
      if (!completedTopics.has(topic)) {
        // NUR wenn ALLE Karten eines Themas gefragt wurden, markiere es als abgeschlossen
        if (topicCards.length > 0 && askedCardsForTopic.length === topicCards.length) {
          completedTopics.add(topic);
          console.log(`   ✅ Thema ${topic} wurde als abgeschlossen markiert (alle ${topicCards.length} Karten wurden behandelt: ${askedCardsForTopic.length}/${topicCards.length})`);
        } else if (topicCards.length > 0) {
          console.log(`   📊 Thema ${topic}: ${askedCardsForTopic.length}/${topicCards.length} Karten behandelt - noch NICHT abgeschlossen`);
        } else {
          console.log(`   ⚠️ Thema ${topic}: Keine Karten gefunden!`);
        }
      } else {
        // Prüfe, ob das Thema wirklich abgeschlossen sein sollte (Validierung)
        if (topicCards.length > 0 && askedCardsForTopic.length < topicCards.length) {
          console.log(`   ⚠️ WARNUNG: Thema ${topic} ist als abgeschlossen markiert, aber nicht alle Karten wurden gefragt (${askedCardsForTopic.length}/${topicCards.length})!`);
          console.log(`   → Entferne aus completedTopics`);
          completedTopics.delete(topic);
        } else {
          console.log(`   ✅ Thema ${topic} ist bereits als abgeschlossen markiert und validiert (${askedCardsForTopic.length}/${topicCards.length} Karten)`);
        }
      }
    });
    
    console.log(`📊 [TOPIC COMPLETION CHECK] Finaler Status: ${completedTopics.size}/4 Themen abgeschlossen: [${Array.from(completedTopics).join(', ')}]`);
    
    // Behalte nur die letzten 3 Assistant-Turns für Duplikatsprüfung
    if (recentAssistantTurns.length > 3) {
      recentAssistantTurns.splice(0, recentAssistantTurns.length - 3);
    }
    
    // Bereits behandelte Karten filtern
    const askedCards = Array.from(askedCardIds).map(id => CARDS.find(c => c.id === id)).filter(Boolean);
    const unansweredCards = topicCards.filter(c => !answeredCardIds.has(c.id));
    const unaskedCards = topicCards.filter(c => !askedCardIds.has(c.id));
    
    // Analysiere, welche Karten aktuell als "very_important" markiert sind und ob bereits nach dem Grund gefragt wurde
    const currentImportanceByCard = buildCurrentCardImportanceState(turns);
    const currentlyVeryImportantCardIds = new Set(
      Array.from(currentImportanceByCard.entries())
        .filter(([, importance]) => importance === 'very_important')
        .map(([cardId]) => cardId)
    );

    const veryImportantCards = [];
    const discussionCards = new Set(); // Karten mit discussion: true (für Phase 2)
    const processedVeryImportantCardIds = new Set(); // Verhindert Duplikate
    
    // Zuerst: Prüfe alle Assistant-Turns mit importance='very_important'
    turns.forEach((turn, index) => {
      if (turn.role === 'assistant' && turn.importance === 'very_important' && turn.card_id) {
        if (!processedVeryImportantCardIds.has(turn.card_id)) {
          veryImportantCards.push({
            card_id: turn.card_id,
            user_response: '', // Wird später gefüllt, falls vorhanden
            turn_index: index
          });
          discussionCards.add(turn.card_id);
          processedVeryImportantCardIds.add(turn.card_id);
          console.log(`✅ [VERY IMPORTANT] Karte ${turn.card_id} aus Assistant-Turn mit importance='very_important' erkannt`);
        }
      }
    });
    
    // Dann: Prüfe alle User-Turns, die "sehr wichtig" sagen
    turns.forEach((turn, index) => {
      if (turn.role === 'user') {
        const userText = turn.text.toLowerCase();
        // Prüfe, ob der User "sehr wichtig" oder ähnliches gesagt hat
        if (userText.includes('sehr wichtig') || userText.includes('extrem wichtig') || 
            userText.includes('außerordentlich wichtig') || userText.includes('besonders wichtig')) {
          // Suche rückwärts nach dem letzten Assistant-Turn mit ask_card und card_id
          let foundCardId = null;
          for (let i = index - 1; i >= 0; i--) {
            const prevTurn = turns[i];
            if (prevTurn && prevTurn.role === 'assistant' && prevTurn.card_id && 
                (prevTurn.action === 'ask_card' || !prevTurn.action)) {
              foundCardId = prevTurn.card_id;
              break;
            }
          }
          
          if (foundCardId && !processedVeryImportantCardIds.has(foundCardId)) {
            veryImportantCards.push({
              card_id: foundCardId,
              user_response: turn.text,
              turn_index: index
            });
            discussionCards.add(foundCardId);
            processedVeryImportantCardIds.add(foundCardId);
            console.log(`✅ [VERY IMPORTANT] Karte ${foundCardId} aus User-Turn "${turn.text.substring(0, 50)}" erkannt`);
          } else if (foundCardId && processedVeryImportantCardIds.has(foundCardId)) {
            // Karte wurde bereits erkannt, aber aktualisiere user_response falls leer
            const existingCard = veryImportantCards.find(vic => vic.card_id === foundCardId);
            if (existingCard && !existingCard.user_response) {
              existingCard.user_response = turn.text;
              console.log(`✅ [VERY IMPORTANT] User-Response für Karte ${foundCardId} aktualisiert`);
            }
          } else if (!foundCardId) {
            console.log(`⚠️ [VERY IMPORTANT] User sagte "sehr wichtig", aber keine passende card_id gefunden (Turn ${index})`);
          }
        }
      }
    });
    
    const historicalVeryImportantIds = new Set(veryImportantCards.map(vic => vic.card_id));
    const downgradedCardIds = Array.from(historicalVeryImportantIds).filter(
      cardId => !currentlyVeryImportantCardIds.has(cardId)
    );
    if (downgradedCardIds.length > 0) {
      console.log(`↩️ [VERY IMPORTANT DOWNGRADE] Karten wurden neu eingestuft und zählen nicht mehr als "sehr wichtig": ${downgradedCardIds.join(', ')}`);
    }

    const filteredVeryImportantCards = veryImportantCards.filter(vic => currentlyVeryImportantCardIds.has(vic.card_id));
    veryImportantCards.splice(0, veryImportantCards.length, ...filteredVeryImportantCards);
    discussionCards.clear();
    veryImportantCards.forEach(vic => discussionCards.add(vic.card_id));

    console.log(`📊 [VERY IMPORTANT COUNT] Aktuell: ${veryImportantCards.length} Karten: ${veryImportantCards.map(vic => vic.card_id).join(', ')}`);
    
    // Prüfe, ob alle Fragen in Phase 1 durch sind
    // WICHTIG: Zwei Bedingungen müssen erfüllt sein:
    // 1. Alle Karten wurden gefragt (askedCardIds.size >= CARDS.length), ODER
    // 2. Alle 4 Themen sind abgeschlossen - EXPLIZIT prüfen, ob alle 4 Themen wirklich drin sind
    const allCardsAsked = askedCardIds.size >= CARDS.length;
    
    // EXPLIZIT prüfen: Sind wirklich alle 4 Themen abgeschlossen?
    const allFourTopics = ['illness_care', 'practical', 'dignity', 'feelings'];
    const allTopicsReallyCompleted = allFourTopics.every(topic => completedTopics.has(topic));
    const allTopicsCompleted = allTopicsReallyCompleted && completedTopics.size === 4;
    
    // DEBUG: Logge Details
    console.log(`📊 [PHASE 1 STATUS CHECK]`);
    console.log(`   allCardsAsked=${allCardsAsked} (${askedCardIds.size}/${CARDS.length} Karten gefragt)`);
    console.log(`   completedTopics.size=${completedTopics.size}, expected=4`);
    console.log(`   completedTopics content: [${Array.from(completedTopics).join(', ')}]`);
    console.log(`   allFourTopics check:`);
    allFourTopics.forEach(topic => {
      const isCompleted = completedTopics.has(topic);
      const topicCards = CARDS.filter(c => c.topic === topic);
      const askedCardsForTopic = topicCards.filter(c => askedCardIds.has(c.id));
      console.log(`     - ${topic}: ${isCompleted ? '✅' : '❌'} (${askedCardsForTopic.length}/${topicCards.length} Karten gefragt)`);
    });
    console.log(`   allTopicsReallyCompleted=${allTopicsReallyCompleted}`);
    console.log(`   allTopicsCompleted=${allTopicsCompleted}`);
    
    const phase1Complete = allCardsAsked || allTopicsCompleted;
    console.log(`   phase1Complete=${phase1Complete}`);
    
    const phaseTransitionAsked = turns.some(t => 
      t.role === 'assistant' && 
      t.text && 
      (t.text.toLowerCase().includes('phase 2') || t.text.toLowerCase().includes('zweite phase')) &&
      (t.text.toLowerCase().includes('wechseln') || t.text.toLowerCase().includes('fortfahren') || t.text.toLowerCase().includes('bereit'))
    );
    const userConfirmedPhase2 = lastUserMessage && (
      lastUserMessage.toLowerCase().includes('ja') ||
      lastUserMessage.toLowerCase().includes('ok') ||
      lastUserMessage.toLowerCase().includes('gerne') ||
      lastUserMessage.toLowerCase().includes('weiter') ||
      lastUserMessage.toLowerCase().includes('bereit') ||
      lastUserMessage.toLowerCase().includes('los') ||
      lastUserMessage.toLowerCase().includes('phase 2') ||
      lastUserMessage.toLowerCase().includes('zweite phase')
    );
    
    // Zähle die Anzahl der "sehr wichtigen" Karten
    const veryImportantCount = veryImportantCards.length;
    const maxVeryImportant = 10;
    
    // Prüfe, ob der User zu einer Frage springen möchte (neu einstufen)
    const userWantsToJump = lastUserMessage && (
      lastUserMessage.toLowerCase().includes('springen') ||
      lastUserMessage.toLowerCase().includes('neu einstufen') ||
      lastUserMessage.toLowerCase().includes('ändern') ||
      lastUserMessage.toLowerCase().includes('korrigieren') ||
      lastUserMessage.toLowerCase().includes('nochmal')
    );
    
    // KRITISCH: Wenn Phase 1 abgeschlossen ist (alle Karten gefragt ODER alle Themen abgeschlossen) 
    // und User Phase 2 bestätigt hat, prüfe ob Phase 2 starten kann
    // WICHTIG: Diese Prüfung erfolgt VOR dem LLM-Aufruf, damit Phase 2 sofort gesetzt wird
    if (phase1Complete && phase === 1 && phaseTransitionAsked && userConfirmedPhase2) {
      // Phase 2 kann nur starten, wenn es zwischen 1 und 10 "sehr wichtige" Karten gibt
      if (veryImportantCount === 0) {
        // Keine "sehr wichtigen" Karten - Phase 2 kann nicht starten
        console.log(`⚠️ Phase 2 kann nicht starten: Keine "sehr wichtigen" Karten vorhanden`);
        // Phase bleibt 1, LLM wird informiert (siehe Context-Anweisung)
      } else if (veryImportantCount > maxVeryImportant) {
        // Mehr als 10 "sehr wichtige" Karten - Phase 2 kann nicht starten
        console.log(`⚠️ Phase 2 kann nicht starten: ${veryImportantCount} "sehr wichtige" Karten (max. ${maxVeryImportant})`);
        // Phase bleibt 1, LLM wird informiert (siehe Context-Anweisung)
      } else {
        // Zwischen 1 und 10 "sehr wichtige" Karten - Phase 2 kann SOFORT starten
        phase = 2;
        console.log(`✅ [SOFORT-PHASE-2] Phase 1 abgeschlossen - User hat bestätigt → Wechsel zu Phase 2 SOFORT (${veryImportantCount} sehr wichtige Karten)`);
        // Phase ist jetzt 2 - das LLM sollte dies im Context sehen und entsprechend eine Phase-2-Aktion zurückgeben
      }
    }
    
    
    // Prüfe, ob bereits nach dem Grund gefragt wurde
    const veryImportantWithReason = new Set();
    // Tracke, welche Karten bereits eine follow_up_card erhalten haben (Phase 2)
    const followUpCardsAsked = new Set(); // Karten, für die bereits eine follow_up_card gestellt wurde
    // Tracke Diskussions-Status für Phase 2: welche Fragen haben bereits Diskussion + Handlungsoptionen
    const discussionCompleted = new Set(); // Fragen, bei denen Diskussion abgeschlossen ist
    const actionOptionsAsked = new Set(); // Fragen, bei denen bereits nach Handlungsoptionen gefragt wurde
    const actionOptionsAnswered = new Set(); // Fragen, bei denen Handlungsoptionen beantwortet wurden
    const actionOptionsByCard = new Map(); // card_id -> { question, answer } für wrap-Context
    const summariesByCard = new Map(); // card_id -> { summary_text, confirmed } für summarization tracking
    const summariesConfirmed = new Set(); // card_id -> ob Zusammenfassung bestätigt wurde
    
    turns.forEach((turn, index) => {
      if (turn.role === 'assistant' && turn.card_id) {
        const textLower = turn.text.toLowerCase();
        
        // KRITISCH: Prüfe, ob bereits eine follow_up_card für diese card_id gestellt wurde
        if (turn.action === 'follow_up_card' || 
            (textLower.includes('warum') && textLower.includes('wichtig')) ||
            (textLower.includes('grund') && textLower.includes('wichtig'))) {
          followUpCardsAsked.add(turn.card_id);
        }
        
        // Prüfe ob nach Grund gefragt wurde (und User bereits geantwortet hat)
        if ((textLower.includes('warum') || textLower.includes('wichtig für sie') || textLower.includes('grund')) &&
            index > 0 && turns[index - 1].role === 'user') {
          veryImportantWithReason.add(turn.card_id);
        }
        // Prüfe ob nach Handlungsoptionen gefragt wurde
        if ((textLower.includes('handlungsoptionen') || textLower.includes('hilfreich') || 
             textLower.includes('umgehen') || textLower.includes('vorbereiten')) &&
            turn.action === 'propose_action' && discussionCards.has(turn.card_id)) {
          actionOptionsAsked.add(turn.card_id);
          // Speichere Handlungsoptionen-Frage
          const nextUserTurn = turns.slice(index + 1).find(t => t.role === 'user');
          actionOptionsByCard.set(turn.card_id, {
            question: turn.text,
            answer: nextUserTurn?.text || null
          });
        }
      }
      // Prüfe ob User auf Handlungsoptionen geantwortet hat
      if (turn.role === 'user' && index > 0) {
        const prevTurn = turns[index - 1];
        if (prevTurn && prevTurn.role === 'assistant' && prevTurn.card_id) {
          if (actionOptionsAsked.has(prevTurn.card_id)) {
            actionOptionsAnswered.add(prevTurn.card_id);
            // Aktualisiere actionOptionsByCard mit Antwort
            if (actionOptionsByCard.has(prevTurn.card_id)) {
              actionOptionsByCard.set(prevTurn.card_id, {
                question: actionOptionsByCard.get(prevTurn.card_id).question,
                answer: turn.text
              });
            }
            // Wenn Handlungsoptionen beantwortet, ist Diskussion abgeschlossen
            if (veryImportantWithReason.has(prevTurn.card_id)) {
              discussionCompleted.add(prevTurn.card_id);
            }
          }
          
          // Prüfe ob User auf Zusammenfassung geantwortet hat (Bestätigung/Änderung)
          if (prevTurn.action === 'summarize_topic' && prevTurn.card_id) {
            const userText = turn.text.toLowerCase();
            // Prüfe auf Bestätigung (ja, richtig, korrekt, passt, stimmt, etc.)
            if (userText.includes('ja') || userText.includes('richtig') || userText.includes('korrekt') || 
                userText.includes('passt') || userText.includes('stimmt') || userText.includes('genau') ||
                userText.includes('zutreffend') || userText.includes('korrekt')) {
              summariesConfirmed.add(prevTurn.card_id);
              console.log(`✅ Zusammenfassung für ${prevTurn.card_id} bestätigt`);
            } else {
              // User möchte etwas ändern/hinzufügen
              summariesByCard.set(prevTurn.card_id, {
                summary_text: prevTurn.text,
                confirmed: false,
                user_feedback: turn.text
              });
            }
          }
        }
      }
      
      // Tracke Zusammenfassungen
      if (turn.role === 'assistant' && turn.action === 'summarize_topic' && turn.card_id) {
        summariesByCard.set(turn.card_id, {
          summary_text: turn.text,
          confirmed: false
        });
      }
    });
    
    // Strukturierter, klarerer Context für das LLM
    const topicNames = {
      'illness_care': 'Krankheit & Behandlung',
      'practical': 'Praktisches & Organisatorisches',
      'dignity': 'Würde & Werte',
      'feelings': 'Gefühle & Beziehungen'
    };
    
    // Berechne Fortschritt: verbleibende Themen und Fragen
    const totalTopics = 4;
    const completedTopicsCount = completedTopics.size;
    const remainingTopicsCount = totalTopics - completedTopicsCount;
    
    const totalQuestions = CARDS.length;
    const askedQuestionsCount = askedCardIds.size;
    const remainingQuestionsCount = totalQuestions - askedQuestionsCount;
    
    // Berechne Anzahl der aktuell als "sehr wichtig" markierten Fragen (nicht historisch)
    const allVeryImportantCardIdsForCount = new Set(currentlyVeryImportantCardIds);
    
    const currentVeryImportantCount = allVeryImportantCardIdsForCount.size;
    
    // Prüfe, ob die aktuelle User-Antwort "sehr wichtig" ist
    const lastUserTurn = turns.slice().reverse().find(t => t.role === 'user');
    const lastUserIndex = lastUserTurn ? turns.indexOf(lastUserTurn) : -1;
    const userText = lastUserTurn?.text?.toLowerCase() || '';
    const isCurrentResponseVeryImportant = userText.includes('sehr wichtig') || 
                                          userText.includes('extrem wichtig') || 
                                          userText.includes('außerordentlich wichtig') || 
                                          userText.includes('besonders wichtig');
    
    // Finde die card_id der aktuellen Frage (die vor der User-Antwort gestellt wurde)
    let currentCardId = null;
    if (lastUserIndex > 0) {
      // Suche den assistant turn vor der User-Antwort
      for (let i = lastUserIndex - 1; i >= 0; i--) {
        if (turns[i].role === 'assistant' && turns[i].card_id) {
          currentCardId = turns[i].card_id;
          break;
        }
      }
    }
    
    // Berechne die Nummer für die aktuelle "sehr wichtige" Antwort
    // Wenn die aktuelle Antwort "sehr wichtig" ist und die Karte noch nicht gezählt wurde, ist es eine neue
    let veryImportantNumber = currentVeryImportantCount;
    if (isCurrentResponseVeryImportant && currentCardId) {
      if (!allVeryImportantCardIdsForCount.has(currentCardId)) {
        // Neue "sehr wichtige" Karte → Nummer = Anzahl bisheriger + 1
        veryImportantNumber = currentVeryImportantCount + 1;
        console.log(`📊 [GLOBAL COUNT] Neue "sehr wichtige" Karte ${currentCardId} - wird Nummer ${veryImportantNumber} (bisher ${currentVeryImportantCount} Karten gezählt)`);
      } else {
        // Karte wurde bereits gezählt → finde ihre Position in der Reihenfolge
        const cardOrder = [];
        turns.forEach((t, idx) => {
          if (t.role === 'assistant' && t.importance === 'very_important' && t.card_id) {
            if (currentlyVeryImportantCardIds.has(t.card_id) && !cardOrder.includes(t.card_id)) {
              cardOrder.push(t.card_id);
            }
          }
          if (t.role === 'user' && idx > 0) {
            const prevTurn = turns[idx - 1];
            if (prevTurn && prevTurn.role === 'assistant' && prevTurn.card_id) {
              const inferred = inferImportanceFromUserText(t.text);
              if (inferred === 'very_important' && currentlyVeryImportantCardIds.has(prevTurn.card_id) && !cardOrder.includes(prevTurn.card_id)) {
                cardOrder.push(prevTurn.card_id);
              }
            }
          }
        });
        const position = cardOrder.indexOf(currentCardId);
        veryImportantNumber = position >= 0 ? position + 1 : currentVeryImportantCount;
        console.log(`📊 [GLOBAL COUNT] Bereits gezählte "sehr wichtige" Karte ${currentCardId} - ist Nummer ${veryImportantNumber} in der Reihenfolge`);
      }
    }
    
    // Zähle wie viele Fragen seit dem letzten Pause/Export-Prompt gestellt wurden
    let questionsSinceLastPausePrompt = 0;
    let lastPausePromptIndex = -1;
    turns.forEach((turn, index) => {
      if (turn.role === 'assistant' && turn.text && 
          (turn.text.toLowerCase().includes('pause') || turn.text.toLowerCase().includes('export') ||
           turn.text.toLowerCase().includes('unterbrechen'))) {
        lastPausePromptIndex = index;
      }
    });
    if (lastPausePromptIndex >= 0) {
      questionsSinceLastPausePrompt = turns.slice(lastPausePromptIndex).filter(t => 
        t.role === 'assistant' && t.action === 'ask_card'
      ).length;
    } else {
      questionsSinceLastPausePrompt = askedCardIds.size;
    }
    
    const userContext = `
=== KONVERSATIONS-VERLAUF ===
Letzte 6 Turns:
${lastTurns.map(t => `${t.role}: ${t.text}${t.card_id ? ` [Frage: ${t.card_id}]` : ''}`).join('\n')}

=== AKTUELLER ZUSTAND ===
Phase: ${phase}
Aktives Thema: ${currentTopic || "(noch keines gewählt)"}

=== FORTSCHRITT ===
Behandelte Fragen: ${askedQuestionsCount} von ${totalQuestions} (${remainingQuestionsCount} verbleibend)
Abgeschlossene Themen: ${completedTopicsCount} von ${totalTopics}
Verbleibende Themen: ${remainingTopicsCount}
Fragen seit letztem Pause/Export-Prompt: ${questionsSinceLastPausePrompt}
${questionsSinceLastPausePrompt >= 5 ? '→ Zeit für Pause/Export-Prompt (alle 5-7 Fragen)' : ''}

=== THEMEN-STATUS ===
${completedTopics.size > 0 ? `Abgeschlossene Themen (nicht mehr anbieten):
${Array.from(completedTopics).map(topic => `- ${topic} (${topicNames[topic] || topic})`).join('\n')}
` : ''}

=== FRAGEN-STATUS ===
Bereits behandelte Fragen: ${askedCards.length > 0 ? askedCards.map(c => `${c.id}: ${c.title}`).join(', ') : 'keine'}
Bereits beantwortete Fragen: ${Array.from(answeredCardIds).map(id => {
  const card = CARDS.find(c => c.id === id);
  return card ? `${card.id}: ${card.title}` : id;
}).join(', ') || 'keine'}

${veryImportantCards.length > 0 ? `Sehr wichtige Fragen (discussion: true für Phase 2):
${veryImportantCards.map(vic => {
  const card = CARDS.find(c => c.id === vic.card_id);
  const hasReason = veryImportantWithReason.has(vic.card_id);
  const hasActionOptions = actionOptionsAsked.has(vic.card_id);
  const hasActionAnswer = actionOptionsAnswered.has(vic.card_id);
  const isCompleted = discussionCompleted.has(vic.card_id);
  let status = '';
  if (isCompleted) status = 'Diskussion abgeschlossen';
  else if (hasActionAnswer) status = 'Handlungsoptionen beantwortet → Zusammenfassung nötig';
  else if (hasActionOptions) status = 'Handlungsoptionen gefragt → warte auf Antwort';
  else if (hasReason) status = 'Grund erfragt → Handlungsoptionen nötig';
  else status = 'Grund noch NICHT erfragt → follow_up_card nötig';
  return `- ${card ? card.title : vic.card_id}: ${status}`;
}).join('\n')}
` : ''}

=== VERFÜGBARE FRAGEN ===
${phase === 2 ? 
  `PHASE 2: Nur sehr wichtige Fragen (discussion: true) werden besprochen:
${Array.from(discussionCards).map(cardId => {
  const card = CARDS.find(c => c.id === cardId);
  return card ? `  • ${card.id}: ${card.title} (${card.topic})` : `  • ${cardId}`;
}).join('\n') || '  (noch keine sehr wichtigen Fragen)'}
` : currentTopic ? 
  `Thema "${currentTopic}":
- Gesamt: ${topicCards.length} Fragen
- Noch nicht gestellt: ${unaskedCards.length} Fragen
${unaskedCards.length > 0 ? unaskedCards.map(c => `  • ${c.id}: ${c.title}`).join('\n') : '  (alle bereits gestellt)'}
${unansweredCards.length > 0 && unaskedCards.length === 0 ? `- Noch nicht beantwortet: ${unansweredCards.map(c => c.id).join(', ')}` : ''}` :
  `Verfügbare Themen:
${['illness_care', 'practical', 'dignity', 'feelings'].map(topic => {
  const status = completedTopics.has(topic) ? 'abgeschlossen' : 'verfügbar';
  const count = allCardsByTopic[topic].length;
  const askedCount = allCardsByTopic[topic].filter(c => askedCardIds.has(c.id)).length;
  return `- ${topic} (${topicNames[topic]}): ${count} Fragen gesamt, ${askedCount} gestellt - ${status}`;
}).join('\n')}
WICHTIG: Wenn present_topics verwendet wird, zeige IMMER ALLE vier Themenbereiche an: Krankheit & Behandlung, Praktisches & Organisatorisches, Würde & Werte, Gefühle & Beziehungen. Nur abgeschlossene Themen sollten nicht mehr angeboten werden.
${completedTopics.size < 4 ? `AKTUELL: ${completedTopics.size}/4 Themen abgeschlossen. ${4 - completedTopics.size} Themen sind noch NICHT abgeschlossen und müssen noch durchgegangen werden.` : ''}`
}

${!phase1Complete && phase === 1 && completedTopics.size < 4 ? `🚨 KRITISCH: NOCH NICHT ALLE THEMEN ABGESCHLOSSEN!
- Aktueller Status: ${completedTopics.size}/4 Themen abgeschlossen
- Abgeschlossene Themen: ${completedTopics.size > 0 ? Array.from(completedTopics).map(t => topicNames[t] || t).join(', ') : 'keine'}
- OFFENE THEMEN: ${4 - completedTopics.size}/4 (${['illness_care', 'practical', 'dignity', 'feelings'].filter(t => !completedTopics.has(t)).map(t => `${topicNames[t] || t} (${allCardsByTopic[t].filter(c => askedCardIds.has(c.id)).length}/${allCardsByTopic[t].length} Fragen gestellt)`).join(', ')})
- VERBOTEN: Sage NICHT, dass "alle Themen durchgesprochen wurden" oder "alle Bereiche angeschaut wurden"! Es fehlen noch ${4 - completedTopics.size} Themenbereiche!
- VERBOTEN: Erwähne NICHT Phase 2 oder "vertiefen" oder "nächster Schritt"! Phase 1 ist noch nicht abgeschlossen!
- Wenn das aktuelle Thema (${currentTopic || 'keines'}) abgeschlossen ist, frage nach dem NÄCHSTEN Themenbereich mit present_topics oder direkt mit ask_card für das nächste offene Thema.` : ''}

=== BESONDERE SITUATION ===
${isUserQuestion ? `Der Benutzer stellt eine Frage: "${lastUserMessage}"
→ Erkläre detailliert (mindestens 100 Zeichen), verwende dieselbe card_id (${lastAssistantWithCard?.card_id || 'keine'}), stelle KEINE neue Frage nach der Erklärung.` : ''}
${userWantsPause ? `WICHTIG: Der Benutzer möchte eine Pause einlegen. Reagiere freundlich auf die Pause und weise darauf hin, dass der Fortschritt oben rechts exportiert werden kann. Beispiel: "Gerne können Sie eine Pause machen. Falls Sie möchten, können Sie Ihren Fortschritt oben rechts exportieren, um später fortzufahren."` : ''}
${isCurrentResponseVeryImportant && phase === 2 ? `WICHTIG: Der Benutzer hat gerade eine Frage als "sehr wichtig" markiert. Dies ist die ${veryImportantNumber}. Frage, die als "sehr wichtig" markiert wurde. Erwähne diese Nummer in deiner follow_up_card Nachricht (z.B. "Das ist Ihre ${veryImportantNumber}. Frage, die Sie als sehr wichtig wählen...").` : ''}
${isCurrentResponseVeryImportant && phase === 1 ? `WICHTIG: Der Benutzer hat gerade eine Frage als "sehr wichtig" markiert. In Phase 1: Sende den Kommentar (z.B. "Das ist Ihre ${veryImportantNumber}. Sache, die Sie als sehr wichtig gewählt haben...") UND stelle direkt danach die nächste Frage. Verwende ein Array mit zwei Bubbles: [Kommentar, nächste Frage]. Beispiel: ["Das ist Ihre ${veryImportantNumber}. Sache, die Sie als sehr wichtig gewählt haben - das hilft, Ihre Prioritäten gut zu sortieren.", "Wie wichtig ist es Ihnen, dass...?"]` : ''}
${phase1Complete && phase === 1 && !phaseTransitionAsked && veryImportantCount === 0 ? `WICHTIG: Alle Themen in Phase 1 wurden durchgesprochen (${completedTopics.size}/4 Themen abgeschlossen, ${askedCardIds.size}/${CARDS.length} Fragen gestellt), aber es wurden KEINE Fragen als "sehr wichtig" eingestuft. Phase 2 kann nicht gestartet werden, da mindestens 1 "sehr wichtige" Frage benötigt wird. Biete dem Benutzer an, zu Fragen zu springen und sie neu einzustufen. Beispiel: "Wir haben nun alle Themen durchgesprochen. Für Phase 2 benötigen wir mindestens eine Frage, die Sie als sehr wichtig einstufen. Möchten Sie zu bestimmten Fragen zurückkehren und sie neu bewerten?"` : ''}
${phase1Complete && phase === 1 && !phaseTransitionAsked && veryImportantCount > 0 && veryImportantCount <= maxVeryImportant ? `WICHTIG: Alle Themen in Phase 1 wurden durchgesprochen (${completedTopics.size}/4 Themen abgeschlossen, ${askedCardIds.size}/${CARDS.length} Fragen gestellt). Frage den Benutzer, ob er zu Phase 2 wechseln möchte, um die sehr wichtigen Themen zu vertiefen. Beispiel: "Wir haben nun alle Themen durchgesprochen. Sie haben ${veryImportantCount} Frage${veryImportantCount > 1 ? 'n' : ''} als sehr wichtig eingestuft. Möchten Sie zu Phase 2 wechseln, um diese Themen zu vertiefen?"` : ''}
${phase1Complete && phase === 1 && !phaseTransitionAsked && veryImportantCount > maxVeryImportant ? `WICHTIG: Alle Themen in Phase 1 wurden durchgesprochen (${completedTopics.size}/4 Themen abgeschlossen, ${askedCardIds.size}/${CARDS.length} Fragen gestellt), aber es wurden ${veryImportantCount} Fragen als "sehr wichtig" eingestuft (Maximum: ${maxVeryImportant}). Phase 2 kann nicht gestartet werden. Gehe alle sehr wichtigen Fragen der Reihe nach durch, damit der Benutzer auf maximal ${maxVeryImportant} "sehr wichtige" Fragen kommt. Beispiel: "Wir haben nun alle Themen durchgesprochen. Sie haben ${veryImportantCount} Fragen als sehr wichtig eingestuft. Für Phase 2 können wir maximal ${maxVeryImportant} sehr wichtige Fragen vertiefen. Lassen Sie uns diese der Reihe nach durchgehen, damit Sie die ${maxVeryImportant} wichtigsten auswählen können."` : ''}
${phase1Complete && phase === 1 && phaseTransitionAsked && !userConfirmedPhase2 && veryImportantCount === 0 ? `WICHTIG: Du hast bereits gefragt, ob der Benutzer zu Phase 2 wechseln möchte, aber es wurden KEINE Fragen als "sehr wichtig" eingestuft. Phase 2 kann nicht gestartet werden. Biete dem Benutzer an, zu Fragen zu springen und sie neu einzustufen.` : ''}
${phase1Complete && phase === 1 && phaseTransitionAsked && !userConfirmedPhase2 && veryImportantCount > maxVeryImportant ? `WICHTIG: Du hast bereits gefragt, ob der Benutzer zu Phase 2 wechseln möchte, aber es wurden ${veryImportantCount} Fragen als "sehr wichtig" eingestuft (Maximum: ${maxVeryImportant}). Phase 2 kann nicht gestartet werden. Gehe alle sehr wichtigen Fragen der Reihe nach durch.` : ''}
${phase1Complete && phase === 1 && phaseTransitionAsked && !userConfirmedPhase2 && veryImportantCount > 0 && veryImportantCount <= maxVeryImportant ? `WICHTIG: Du hast bereits gefragt, ob der Benutzer zu Phase 2 wechseln möchte. Warte auf die Bestätigung des Benutzers (z.B. "ja", "ok", "weiter", "gerne").` : ''}
${userWantsToJump && phase === 1 ? `WICHTIG: Der Benutzer möchte zu Fragen springen und sie neu einstufen. Biete an, zu bestimmten Fragen zurückzukehren, damit der Benutzer sie neu bewerten kann. Beispiel: "Gerne können wir zu bestimmten Fragen zurückkehren. Welche Frage möchten Sie neu bewerten?" oder liste einige Fragen auf, die noch nicht als "sehr wichtig" eingestuft wurden.` : ''}
${phase === 2 ? `WICHTIG: Phase 2 ist aktiv! Beginne jetzt mit der Diskussion der sehr wichtigen Fragen. Starte mit follow_up_card für die erste sehr wichtige Frage. Liste der sehr wichtigen Fragen: ${veryImportantCards.map(vic => {
  const card = CARDS.find(c => c.id === vic.card_id);
  return card ? card.title : vic.card_id;
}).join(', ')}` : ''}
${phase === 2 && phase1Complete && phaseTransitionAsked && userConfirmedPhase2 ? `KRITISCH: Der Benutzer hat soeben Phase 2 bestätigt (z.B. "ja", "weiter", "machen wir weiter"). Du MUSST jetzt eine follow_up_card Aktion für die erste sehr wichtige Frage zurückgeben. Verwende die erste sehr wichtige Frage aus der Liste oben.` : ''}

=== REGELN ===
${phase === 1 ? `PHASE 1: Alle Themen durchgehen
- Frage keine bereits beantworteten Fragen nochmal mit ask_card
- Frage keine bereits behandelten Fragen nochmal
- Gehe systematisch durch ungefragte Fragen
- Wenn Thema gewählt: beginne sofort mit erster ungefragter Frage
- WICHTIG: Frage ALLE Fragen eines Themas, bevor du zu einem anderen Thema wechselst
- VERBOTEN in Phase 1: summarize_topic, propose_action, wrap - diese Aktionen sind NUR in Phase 2/3 erlaubt
- KEINE Zusammenfassungen in Phase 1 - fahre einfach mit der nächsten Frage oder dem nächsten Thema fort
- Wenn very_important: KEINE follow_up_card in Phase 1 - fahre einfach mit der nächsten Frage fort. Die Erläuterung und Diskussion erfolgt in Phase 2.
- Wenn importance = "unsure": Gib kurze, einfache Erklärung + Beispiel
- Keine Handlungsempfehlungen in Phase 1
- Erwähne NICHT explizit, um welche Karte/Frage es sich handelt - stelle die Frage einfach natürlich
- VERBOTEN: "Beim Thema... geht es um die Frage:", "Bei der Frage...", "Zu der Frage..." - beginne direkt mit der Frage selbst
- Frage alle 5-7 Fragen nach Pause oder Export mit Fortschrittsupdate (z.B. "Wir haben bereits X von Y Fragen besprochen. Möchten Sie eine Pause machen oder den Fortschritt exportieren?")
- KRITISCH: Stelle NIE eine Pause-Frage in derselben utterance wie eine ask_card Frage! Wenn action=ask_card, dann enthält utterance NUR die Topic-Frage, KEINE Pause-Frage. Pause-Fragen müssen in einem separaten Turn sein.
- SPRINGEN ZU FRAGEN: Wenn der Benutzer zu Fragen springen möchte (z.B. "springen", "neu einstufen", "ändern", "korrigieren"), biete an, zu bestimmten Fragen zurückzukehren, damit sie neu bewertet werden können. Verwende ask_card mit der entsprechenden card_id.
- WENN MEHR ALS 10 "SEHR WICHTIG": Wenn es mehr als 10 "sehr wichtige" Fragen gibt, gehe alle sehr wichtigen Fragen der Reihe nach durch, damit der Benutzer auf maximal 10 kommt. Stelle jede Frage erneut mit ask_card und lasse den Benutzer neu bewerten.` : phase === 2 ? `PHASE 2: Nur sehr wichtige Fragen (discussion: true) besprechen
- Zeige nur Fragen mit discussion: true
- Pro Frage: 1) follow_up_card "Warum wichtig?" → 2) propose_action "Handlungsoptionen?" → 3) summarize_topic "Zusammenfassung"
- Nach "Warum wichtig" beantwortet: Frage nach Handlungsoptionen mit propose_action
- Handlungsoptionen: Beispiele, wie man damit umgehen kann (nicht medizinisch, praktische Tipps)
- Frage: "Welche Handlungsoptionen wären für Sie hilfreich?"
- Nach Handlungsoptionen beantwortet: Fasse neutral zusammen, was der Nutzer formuliert hat (summarize_topic)
- Nach jeder Zusammenfassung: Frage den Nutzer, ob die Zusammenfassung korrekt war
- "Mehr Details" Button: Erkläre vereinfacht mit Beispielen direkt in utterance (keine Side-Frage)
- Verweise immer auf die genaue Frage, die gerade besprochen wird (z.B. "Bei der Frage 'Wie möchten Sie behandelt werden?'...")
${Array.from(discussionCards).map(cardId => {
  const card = CARDS.find(c => c.id === cardId);
  const hasReason = veryImportantWithReason.has(cardId);
  const hasActionOptions = actionOptionsAsked.has(cardId);
  const hasActionAnswer = actionOptionsAnswered.has(cardId);
  if (!hasReason) return `- ${card?.title || cardId}: follow_up_card nötig`;
  if (!hasActionOptions) return `- ${card?.title || cardId}: propose_action (Handlungsoptionen) nötig`;
  if (!hasActionAnswer) return `- ${card?.title || cardId}: warte auf Handlungsoptionen-Antwort`;
  return `- ${card?.title || cardId}: summarize_topic (Zusammenfassung) nötig`;
}).join('\n')}` : `PHASE 3: Spielende (Abschlussphase)
- wrap: Erstelle umfassende Zusammenfassung
- Zusammenfassung aller sehr wichtigen Themen + formulierter Gründe
- Zusammenfassung aller Handlungsoptionen (selbst formuliert + vorgeschlagene)
- Hinweis auf Export-Möglichkeiten (JSON, PDF)
- Entspricht Phase 3: "Reflektieren" + etwas aufschreiben`}

${phase === 3 ? `
=== WRAP: ABSCHLUSSZUSAMMENFASSUNG ===
Erstelle eine umfassende, warme Abschlusszusammenfassung:
1. Zusammenfassung aller sehr wichtigen Themen + formulierter Gründe:
${veryImportantCards.length > 0 ? veryImportantCards.map(vic => {
  const card = CARDS.find(c => c.id === vic.card_id);
  const reason = veryImportantWithReason.has(vic.card_id);
  // Finde die tatsächliche Begründung aus den Turns
  let reasonText = null;
  turns.forEach((turn, idx) => {
    if (turn.role === 'assistant' && turn.card_id === vic.card_id && 
        (turn.action === 'follow_up_card' || turn.text.toLowerCase().includes('warum'))) {
      const nextUserTurn = turns.slice(idx + 1).find(t => t.role === 'user');
      if (nextUserTurn) reasonText = nextUserTurn.text;
    }
  });
  return `- ${card?.title || vic.card_id}: ${reasonText ? `Grund: "${reasonText}"` : 'Grund noch nicht formuliert'}`;
}).join('\n') : 'Noch keine sehr wichtigen Themen'}
2. Zusammenfassung aller Handlungsoptionen (selbst formuliert + vorgeschlagene):
${Array.from(actionOptionsByCard.entries()).length > 0 ? Array.from(actionOptionsByCard.entries()).map(([cardId, option]) => {
  const card = CARDS.find(c => c.id === cardId);
  return `- ${card?.title || cardId}: Vorschlag: "${option.question}" ${option.answer ? `| Ihre Antwort: "${option.answer}"` : '| Noch keine Antwort'}`;
}).join('\n') : 'Noch keine Handlungsoptionen'}
3. Hinweis auf Export: "Sie können Ihre Reflexion als JSON oder PDF exportieren und optional mit Angehörigen oder Fachpersonen teilen."
4. Warme, respektvolle Abschlussformulierung (entspricht Phase 3: "Reflektieren" + etwas aufschreiben)
` : ''}

`;

    // Prüfe, ob das Model das neue responses.create API unterstützt
    const useNewFormat = MODEL.includes('gpt-5') || MODEL.includes('o1') || MODEL.includes('o3');
    
    // Erstelle beide Payloads - einen für responses.create und einen für chat.completions
    const newFormatPayload = {
      // Newer API format (for GPT-5.1, O1, O3, etc.)
      model: MODEL,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userContext }
      ],
      temperature: 0.2,
      text: {
        format: {
          type: "json_schema",
          name: "PlannerStep",
          strict: true,
          schema: {
            type: "object",
            properties: {
              action: { 
                type: "string", 
                enum: ["present_topics", "ask_card", "follow_up_card", "propose_action", "summarize_topic", "return_to_cards", "park_topic", "wrap"] 
              },
              utterance: { type: "string" },
              target_topic: { 
                type: "string", 
                enum: ["illness_care", "practical", "dignity", "feelings", ""] 
              },
              card_id: { type: "string" },
              importance: { 
                type: "string", 
                enum: ["very_important", "important", "neutral", "not_important", "unsure", ""] 
              },
              navigation: { 
                type: "string", 
                enum: ["return_to_cards", ""] 
              },
              propose_action_now: { type: "boolean" }
            },
            required: ["action", "utterance", "target_topic", "card_id", "importance", "navigation", "propose_action_now"],
            additionalProperties: false
          }
        }
      }
    };
    
    const standardPayload = {
      // Standard chat.completions format (for GPT-4, GPT-3.5, etc.)
      model: MODEL,
      messages: [
        { 
          role: "system", 
          content: SYSTEM_PROMPT + "\n\nAntworte IMMER als gültiges JSON-Objekt mit den Feldern: action, utterance, target_topic, card_id, importance, navigation, propose_action_now. " +
            "action muss einer von: present_topics, ask_card, follow_up_card, propose_action, summarize_topic, return_to_cards, park_topic, wrap sein. " +
            "utterance: Gib es als JSON-Array-String zurück (z.B. \"[\\\"Erste Nachricht\\\", \\\"Zweite Nachricht\\\"]\"), wenn die Nachricht mehr als 2 Sätze enthält oder mehrere Gedanken hat. " +
            "Teile konsequent in mehrere Bubbles auf - dies verbessert die Lesbarkeit erheblich. " +
            "target_topic muss einer von: illness_care, practical, dignity, feelings, oder leer sein. " +
            "importance muss einer von: very_important, important, neutral, not_important, unsure, oder leer sein. " +
            "navigation muss return_to_cards oder leer sein. " +
            "propose_action_now muss true oder false sein."
        },
        { role: "user",   content: userContext }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    };

    let response;
    try {
      response = await callPlanner(useNewFormat ? newFormatPayload : standardPayload, useNewFormat, standardPayload);
      COLD = false; // ab hier warm
    } catch (e) {
      // ⬇️ EINMALIGER RETRY wenn Cold-Start
      if (COLD) {
        console.warn('Cold-start retry …', e.message);
        try {
          response = await callPlanner(requestPayload, useNewFormat);
          COLD = false;
        } catch (e2) {
          console.warn('Retry failed:', e2.message);
          return res.json({
            action: "present_topics",
            utterance: "Willkommen.\n\n" +
              "Diese Anwendung begleitet Sie dabei, auszudrücken, was Ihnen wichtig ist, insbesondere am Lebensende.\n\n" +
              "Wir werden gemeinsam ungefähr 30 Themen durchgehen, die unterschiedliche Aspekte Ihres Lebens berühren.\n\n" +
              "Die Anwendung läuft in zwei Phasen:\n" +
              "• Phase 1: Themen kennenlernen & sortieren – Sie entdecken verschiedene Themen und ordnen sie nach Wichtigkeit ein.\n" +
              "• Phase 2: Wichtige Themen vertiefen – Wir gehen gezielt auf die Themen ein, die Ihnen besonders wichtig sind.\n\n" +
              "Es stehen Ihnen vier Themenbereiche zur Verfügung:\n\n" +
              "Krankheit & Behandlung\n\n" +
              "Praktische und organisatorische Fragen\n\n" +
              "Würde & persönliche Werte\n\n" +
              "Gefühle, Beziehungen & Verbundenheit\n\n" +
              "Sie können in Ihrem eigenen Tempo entdecken, was Ihnen wichtig ist.\n\n" +
              "Diese Anwendung entstand in Kooperation mit Anticip:action von HUG.\n\n" +
              "Alle Antworten bleiben lokal auf Ihrem Gerät und werden nicht gespeichert oder übertragen.\n\n" +
              "Wenn Sie bereit sind, können wir gemeinsam mit dem ersten Thema beginnen.",
            target_topic: "",
            card_id: "",
            importance: "",
            navigation: "",
            propose_action_now: false
          });
        }
      } else {
        // normaler Timeout → Fallback
        console.warn('Planner timeout/retry:', e.message);
        return res.json({
          action: "present_topics",
          utterance: "Entschuldigung, ich hatte einen Moment Schwierigkeiten. Lassen Sie uns mit den vier Themenbereichen fortfahren. Welcher Bereich interessiert Sie?",
          target_topic: "",
          card_id: "",
          importance: "",
          navigation: "",
          propose_action_now: false
        });
      }
    }

    // --------- ROBUSTES PARSING ----------
    // Handle both API response formats
    let out = null;
    if (response.output_text) {
      // Newer responses API format
      out = response.output_text;
    } else if (response.output?.[0]?.content?.[0]?.text) {
      // Alternative newer format path
      out = response.output[0].content[0].text;
    } else if (response.choices?.[0]?.message?.content) {
      // Standard chat.completions format
      out = response.choices[0].message.content;
    }
    
    if (!out) {
      console.warn('Unexpected response format:', JSON.stringify(response).slice(0, 200));
      out = "";
    }

    let parsed = null;
    const objectRegex = /(\{(?:[^{}]|"(?:\\.|[^"\\])*")*\})/g;
    let match;
    while ((match = objectRegex.exec(out)) !== null) {
      try { parsed = JSON.parse(match[1]); } catch {}
    }
    if (!parsed) {
      console.error('Planner parse failed. Raw output (konnte nicht extrahiert werden):', out.slice(0, 500));
      return res.json({
        action: "present_topics",
        utterance: "Entschuldigung, ich hatte Schwierigkeiten, Ihre Antwort zu verarbeiten. Lassen Sie uns mit den vier Themenbereichen beginnen.",
        target_topic: "",
        card_id: "",
        importance: "",
        navigation: "",
        propose_action_now: false
      });
    }
    
    // Konvertiere utterance zu Array, falls es ein JSON-Array-String ist
    if (parsed.utterance && typeof parsed.utterance === 'string') {
      // Prüfe, ob der String ein JSON-Array ist
      const trimmed = parsed.utterance.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const arrayParsed = JSON.parse(trimmed);
          if (Array.isArray(arrayParsed)) {
            parsed.utterance = arrayParsed;
            console.log('✅ Utterance als Array erkannt und konvertiert:', arrayParsed.length, 'Elemente');
          }
        } catch (e) {
          // Kein gültiges JSON-Array, behalte als String
        }
      }
    }
    
    // Sanfter Fallback bei Fragen: Wenn LLM card_id wechselt oder nicht setzt, korrigiere nur als Fallback
    if (isUserQuestion && lastAssistantWithCard && lastAssistantWithCard.card_id) {
      const currentCard = CARDS.find(c => c.id === lastAssistantWithCard.card_id);
      if (currentCard) {
        // Nur korrigieren, wenn card_id fehlt oder zu einer anderen Karte gewechselt wird
        if (!parsed.card_id || parsed.card_id === "" || parsed.card_id !== lastAssistantWithCard.card_id) {
          console.log(`⚠️ User-Frage erkannt: Korrigiere card_id zu ${lastAssistantWithCard.card_id} (Fallback)`);
          parsed.card_id = lastAssistantWithCard.card_id;
          parsed.target_topic = currentCard.topic;
          parsed.action = "ask_card";
        }
        // Keine utterance-Manipulation mehr - LLM sollte selbst korrekt antworten
      }
    }
    
    // Duplikatsprüfung entfernt: LLM sollte selbst Duplikate vermeiden basierend auf Context
    // (Bereits behandelte/beantwortete Karten sind im Context sichtbar)
    
    // Warnung statt Override: LLM sollte bereits beantwortete Karten im Context sehen
    if (parsed.action === "ask_card" && parsed.card_id && answeredCardIds.has(parsed.card_id)) {
      console.log(`⚠️ Warnung: LLM versucht, bereits beantwortete Karte ${parsed.card_id} nochmal zu fragen.`);
      // Kein Override mehr - LLM sollte selbst korrigieren basierend auf Context
    }
    
    // Sanfter Fallback: Wenn ask_card ohne card_id, verwende erste ungefragte Karte
    if (parsed.action === "ask_card" && (!parsed.card_id || parsed.card_id === "")) {
      console.log('⚠️ ask_card ohne card_id, verwende erste ungefragte Karte als Fallback');
      if (unaskedCards.length > 0) {
        parsed.card_id = unaskedCards[0].id;
        if (!parsed.utterance) {
          parsed.utterance = unaskedCards[0].prompt;
        }
      } else {
        console.log('⚠️ Keine ungefragten Karten verfügbar - LLM sollte korrigieren');
      }
    }
    
    // KRITISCH: Prüfe, ob LLM summarize_topic zurückgibt, obwohl noch ungefragte Karten existieren
    console.log(`🔍 Validierung: parsed.action="${parsed.action}", currentTopic="${currentTopic}", detectedTopic="${detectedTopic}", unaskedCards.length=${unaskedCards.length}, topicCards.length=${topicCards.length}, askedCardIds.size=${askedCardIds.size}`);
    
    // KRITISCH: Wenn summarize_topic und noch ungefragte Karten existieren, IMMER verhindern und zur nächsten ungefragten Karte wechseln
    if (parsed.action === "summarize_topic" && currentTopic) {
      const askedCardsForCurrentTopic = new Set();
      turns.forEach(turn => {
        if (turn.card_id) {
          const card = CARDS.find(c => c.id === turn.card_id);
          if (card && card.topic === currentTopic) {
            askedCardsForCurrentTopic.add(turn.card_id);
          }
        }
      });
      
      // Berechne ungefragte Karten für das aktuelle Thema
      const unaskedCardsForTopic = topicCards.filter(c => !askedCardsForCurrentTopic.has(c.id));
      
      if (unaskedCardsForTopic.length > 0) {
        console.log(`🚫 BLOCKIERE summarize_topic: Es gibt noch ${unaskedCardsForTopic.length} ungefragte Karten im Thema ${currentTopic}. Frage diese zuerst!`);
        // Überschreibe summarize_topic mit ask_card für die nächste ungefragte Karte
        const nextUnaskedCard = unaskedCardsForTopic[0];
        parsed.action = "ask_card";
        parsed.card_id = nextUnaskedCard.id;
        parsed.utterance = nextUnaskedCard.prompt;
        parsed.target_topic = currentTopic;
        console.log(`✅ Geändert zu ask_card für Karte ${nextUnaskedCard.id}`);
      } else if (askedCardsForCurrentTopic.size === 0 && topicCards.length > 0) {
        console.log(`🚫 BLOCKIERE summarize_topic: Noch keine Karten für ${currentTopic} gefragt (${topicCards.length} verfügbar).`);
        // Überschreibe mit ask_card für die erste Karte
        const firstCard = topicCards[0];
        parsed.action = "ask_card";
        parsed.card_id = firstCard.id;
        parsed.utterance = firstCard.prompt;
        parsed.target_topic = currentTopic;
        console.log(`✅ Geändert zu ask_card für erste Karte ${firstCard.id}`);
      }
    }
    
    // Very Important: Automatische follow_up_card nur in Phase 2 (in Phase 1 wird nicht nachgefragt)
    // KRITISCH: Validiere, ob der User wirklich "sehr wichtig" gesagt hat, nicht nur "wichtig"
    if (parsed.importance === "very_important" && parsed.card_id && parsed.card_id !== "") {
      // Prüfe die letzte User-Antwort, um zu validieren, ob wirklich "sehr wichtig" gesagt wurde
      const lastUserTurn = turns.slice().reverse().find(t => t.role === 'user');
      const userText = lastUserTurn?.text?.toLowerCase() || '';
      
      // Prüfe, ob der User wirklich "sehr wichtig" oder ähnliches gesagt hat
      const isReallyVeryImportant = userText.includes('sehr wichtig') || 
                                    userText.includes('extrem wichtig') || 
                                    userText.includes('außerordentlich wichtig') || 
                                    userText.includes('besonders wichtig') ||
                                    // Prüfe auch, ob die Karte bereits als very_important markiert wurde
                                    veryImportantCards.some(vic => vic.card_id === parsed.card_id);
      
      // Wenn der User nur "wichtig" gesagt hat (ohne "sehr"), korrigiere importance zu "important"
      if (!isReallyVeryImportant && userText.includes('wichtig') && !userText.includes('sehr')) {
        console.log(`⚠️ Korrigiere: User sagte nur "wichtig", nicht "sehr wichtig" → ändere importance von very_important zu important`);
        parsed.importance = "important";
        // Keine follow_up_card für "important", nur für "very_important"
        console.log(`✅ Keine follow_up_card, da nur "wichtig" (nicht "sehr wichtig")`);
      } else if (isReallyVeryImportant) {
        // User hat wirklich "sehr wichtig" gesagt
        // In Phase 1: KEINE follow_up_card stellen, einfach mit nächster Frage fortfahren
        // In Phase 2: follow_up_card stellen
        if (phase === 1) {
          console.log(`✅ Phase 1: Frage ${parsed.card_id} als "very_important" markiert - keine follow_up_card in Phase 1, fahre mit nächster Frage fort`);
          // Stelle sicher, dass die action nicht follow_up_card ist, sondern ask_card oder die nächste Frage
          if (parsed.action === "follow_up_card") {
            // Ändere zu ask_card für die nächste Frage
            parsed.action = "ask_card";
            console.log(`🔄 Ändere action von follow_up_card zu ask_card für Phase 1`);
          }
          
          // WICHTIG: Nach dem Kommentar muss direkt die nächste Frage kommen
          // Finde die nächste verfügbare Frage
          const topicCards = currentTopic ? CARDS.filter(c => c.topic === currentTopic) : [];
          const unaskedCards = topicCards.filter(c => !askedCardIds.has(c.id));
          
          if (unaskedCards.length > 0) {
            const nextCard = unaskedCards[0];
            const utteranceStr = Array.isArray(parsed.utterance) 
              ? parsed.utterance.join(' ') 
              : (parsed.utterance || '');
            
            // Prüfe, ob die utterance einen Kommentar über "sehr wichtig" enthält
            const utteranceLower = utteranceStr.toLowerCase();
            const hasComment = utteranceLower.includes('das ist ihre') || 
                              utteranceLower.includes('das ist deine') ||
                              (utteranceLower.match(/\d+\.?\s*(sache|frage|aussage)/) && utteranceLower.includes('sehr wichtig'));
            
            if (hasComment) {
              // Die utterance enthält einen Kommentar - trenne Kommentar von Frage, um Doppelungen zu vermeiden
              const questionRegex = /(wie wichtig[^?]*\?)/i;
              const questionFromUtterance = utteranceStr.match(questionRegex)?.[0]?.trim();
              const commentOnly = utteranceStr.replace(questionRegex, '').trim();
              
              // Wähle eine einzelne Frage-Bubble: bevorzugt die aus der Utterance, sonst Prompt/Title
              let nextQuestionBubble = questionFromUtterance || nextCard.prompt || nextCard.title;
              if (
                questionFromUtterance &&
                nextCard.prompt &&
                nextCard.prompt.toLowerCase().includes(questionFromUtterance.toLowerCase().slice(0, 20))
              ) {
                nextQuestionBubble = questionFromUtterance;
              }
              
              // Erstelle Array mit zwei Bubbles: [Kommentar?, Frage]
              const bubbles = [];
              if (commentOnly) bubbles.push(commentOnly);
              if (nextQuestionBubble) bubbles.push(nextQuestionBubble);
              
              parsed.utterance = bubbles.length === 1 ? bubbles[0] : bubbles;
              parsed.card_id = nextCard.id;
              parsed.target_topic = currentTopic || parsed.target_topic;
              
              console.log(`✨ Phase 1: Füge nächste Frage nach Kommentar hinzu: ${nextCard.id} - "${nextQuestionBubble.substring(0, 50)}..."`);
            } else {
              // Kein Kommentar gefunden - stelle sicher, dass eine Frage gestellt wird
              parsed.card_id = nextCard.id;
              parsed.utterance = nextCard.prompt || nextCard.title;
              parsed.target_topic = currentTopic || parsed.target_topic;
              console.log(`✨ Phase 1: Stelle nächste Frage: ${nextCard.id}`);
            }
          } else {
            // Keine weiteren Fragen im aktuellen Thema - behalte die utterance wie sie ist
            console.log(`⚠️ Phase 1: Keine weiteren Fragen im Thema ${currentTopic}, behalte utterance wie sie ist`);
          }
        } else {
          // Phase 2: follow_up_card stellen
          const hasFollowUpForThisCard = veryImportantWithReason.has(parsed.card_id);
          
          // KRITISCH: Prüfe, ob diese Karte bereits vollständig diskutiert wurde (Zusammenfassung bestätigt)
          // Nur dann sollten wir zur nächsten Karte wechseln
          const isFullyDiscussed = discussionCompleted.has(parsed.card_id) || summariesConfirmed.has(parsed.card_id);
          
          // KRITISCH: Prüfe, ob diese Karte bereits vollständig diskutiert wurde
          // Wenn ja, wechsle automatisch zur nächsten noch nicht diskutierten Karte
          if (isFullyDiscussed && parsed.action === "follow_up_card") {
            console.log(`🚫 Phase 2: follow_up_card für ${parsed.card_id} wurde bereits vollständig diskutiert - wechsle zu nächster`);
            // Finde die nächste sehr wichtige Karte, die noch nicht vollständig diskutiert wurde
            const nextUndiscussedCard = veryImportantCards.find(vic => 
              !summariesConfirmed.has(vic.card_id) && 
              discussionCards.has(vic.card_id)
            );
            
            if (nextUndiscussedCard) {
              const card = CARDS.find(c => c.id === nextUndiscussedCard.card_id);
              
              // Prüfe, welcher Schritt als nächstes kommt
              if (!followUpCardsAsked.has(nextUndiscussedCard.card_id)) {
                // Noch keine follow_up_card gestellt → stelle sie
                parsed.action = "follow_up_card";
                parsed.card_id = nextUndiscussedCard.card_id;
                parsed.utterance = `Warum ist ${card?.title || 'das'} so wichtig für Sie?`;
                parsed.target_topic = card?.topic || "";
                console.log(`✅ Phase 2: Wechsle zu nächster undiskutierter Karte: ${nextUndiscussedCard.card_id} (follow_up_card)`);
              } else if (!veryImportantWithReason.has(nextUndiscussedCard.card_id)) {
                // follow_up_card gestellt, aber noch keine Antwort → warte (sollte nicht passieren)
                console.log(`⏳ Phase 2: Warte noch auf Antwort zu follow_up_card für ${nextUndiscussedCard.card_id}`);
              } else if (!actionOptionsAsked.has(nextUndiscussedCard.card_id)) {
                // Grund bereits erfragt → frage nach Handlungsoptionen
                parsed.action = "propose_action";
                parsed.card_id = nextUndiscussedCard.card_id;
                const examples = card?.example_actions?.slice(0, 3).join(', ') || 'verschiedene Möglichkeiten';
                parsed.utterance = `Welche Handlungsoptionen wären für Sie hilfreich? Hier sind einige Beispiele, wie man damit umgehen kann: ${examples}.`;
                parsed.target_topic = card?.topic || "";
                console.log(`✅ Phase 2: Wechsle zu nächster undiskutierter Karte: ${nextUndiscussedCard.card_id} (propose_action)`);
              } else if (!actionOptionsAnswered.has(nextUndiscussedCard.card_id)) {
                // Warte noch auf Antwort zu Handlungsoptionen
                console.log(`⏳ Phase 2: Warte noch auf Antwort zu Handlungsoptionen für ${nextUndiscussedCard.card_id}`);
              } else {
                // Handlungsoptionen beantwortet → Zusammenfassung
                parsed.action = "summarize_topic";
                parsed.card_id = nextUndiscussedCard.card_id;
                parsed.utterance = `Zu der Frage "${card?.title || 'diesem Thema'}" habe ich von Ihnen gehört, dass... [Fasse hier die Antworten zusammen, OHNE die Frage zu wiederholen]. Ist diese Zusammenfassung für Sie so stimmig, oder möchten Sie etwas ergänzen oder korrigieren?`;
                parsed.target_topic = card?.topic || "";
                console.log(`✅ Phase 2: Wechsle zu nächster undiskutierter Karte: ${nextUndiscussedCard.card_id} (summarize_topic)`);
              }
            } else {
              // Alle sehr wichtigen Karten wurden bereits diskutiert
              console.log(`✅ Phase 2: Alle sehr wichtigen Karten wurden bereits diskutiert - verwende wrap oder nächste Aktion`);
              // Lass das LLM entscheiden, was als nächstes kommt (wrap, etc.)
            }
            // Überspringe den Rest der Logik für diese Karte
          } else {
            // Verwende die bereits berechnete veryImportantNumber aus dem Context
            // Prüfe, ob die aktuelle Karte bereits als "sehr wichtig" markiert wurde
            const isAlreadyCounted = allVeryImportantCardIdsForCount.has(parsed.card_id);
            
            // Bestimme die korrekte Nummer für diese Karte (basierend auf der Reihenfolge der ersten Markierung)
            let currentVeryImportantNumber;
          
          // Erstelle IMMER eine vollständige Liste aller "sehr wichtigen" Karten in der chronologischen Reihenfolge
          // Dies muss VOR der Prüfung geschehen, damit wir die korrekte Position finden können
          const cardOrder = [];
          turns.forEach((t, idx) => {
            // Prüfe assistant turns mit importance='very_important'
            if (t.role === 'assistant' && t.importance === 'very_important' && t.card_id) {
              if (currentlyVeryImportantCardIds.has(t.card_id) && !cardOrder.includes(t.card_id)) {
                cardOrder.push(t.card_id);
              }
            }
            // Prüfe user turns, die "sehr wichtig" sagen (beim ERSTEN Mal)
            if (t.role === 'user' && idx > 0) {
              const prevTurn = turns[idx - 1];
              if (prevTurn && prevTurn.role === 'assistant' && prevTurn.card_id) {
                const inferred = inferImportanceFromUserText(t.text);
                if (
                  inferred === 'very_important' &&
                  currentlyVeryImportantCardIds.has(prevTurn.card_id) &&
                  !cardOrder.includes(prevTurn.card_id)
                ) {
                  // Nur hinzufügen, wenn die Karte noch nicht in der Liste ist (beim ERSTEN Mal)
                  cardOrder.push(prevTurn.card_id);
                }
              }
            }
          });
          
          // Finde die Position dieser Karte in der Reihenfolge
          const position = cardOrder.indexOf(parsed.card_id);
          
          if (isAlreadyCounted) {
            // Karte wurde bereits gezählt → verwende ihre ursprüngliche Position
            if (position >= 0) {
              currentVeryImportantNumber = position + 1;
              console.log(`📊 Karte ${parsed.card_id} bereits gezählt - ursprüngliche Position: ${currentVeryImportantNumber} (Reihenfolge: ${cardOrder.join(', ')})`);
            } else {
              // Fallback: Karte sollte in cardOrder sein, ist sie aber nicht → verwende currentVeryImportantCount
              // Dies sollte nicht passieren, aber falls doch, verwenden wir die Gesamtzahl
              currentVeryImportantNumber = currentVeryImportantCount;
              console.warn(`⚠️ Karte ${parsed.card_id} sollte bereits gezählt sein, aber nicht in cardOrder gefunden! Verwende Fallback: ${currentVeryImportantCount}`);
            }
          } else {
            // Karte wurde noch nicht gezählt → neue Karte, verwende die berechnete Nummer
            currentVeryImportantNumber = veryImportantNumber;
            console.log(`📊 Neue "sehr wichtige" Karte ${parsed.card_id} - Nummer: ${currentVeryImportantNumber} (Reihenfolge: ${cardOrder.join(', ')})`);
          }
          
          const isFirstVeryImportant = currentVeryImportantNumber === 1;
          
          if (!hasFollowUpForThisCard) {
            console.log(`🔍 Phase 2: Frage ${parsed.card_id} als "very_important" markiert → follow_up_card (validiert: User sagte wirklich "sehr wichtig") - Nummer: ${currentVeryImportantNumber}`);
            parsed.action = "follow_up_card";
            
            // Stelle sicher, dass die Nummer IMMER in der Nachricht erwähnt wird
            const card = CARDS.find(c => c.id === parsed.card_id);
            const cardTitle = card?.title || "diese Frage";
            
            // Prüfe, ob die Nummer bereits korrekt in der utterance erwähnt wird
            const utteranceLower = utteranceToString(parsed.utterance).toLowerCase();
            
            // Prüfe auf korrekte Nummer (mit Punkt oder Leerzeichen)
            const hasCorrectNumber = utteranceLower.includes(`ihre ${currentVeryImportantNumber}.`) || 
                                    utteranceLower.includes(`ihre ${currentVeryImportantNumber} `) ||
                                    utteranceLower.includes(`ihre ${currentVeryImportantNumber}te`) ||
                                    (isFirstVeryImportant && (utteranceLower.includes('ihre erste') || utteranceLower.includes('erste frage')));
            
            // Prüfe auch, ob eine FALSCHE Nummer erwähnt wird (z.B. "erste" wenn es eigentlich die zweite sein sollte)
            const hasWrongNumber = !isFirstVeryImportant && (
              utteranceLower.includes('ihre erste') || 
              utteranceLower.includes('erste frage') ||
              /ihre (zweite|dritte|vierte|fünfte|sechste|siebte|achte|neunte|zehnte)/.test(utteranceLower)
            ) && !hasCorrectNumber;
            
            // In Phase 2: Entferne die "erste Frage, die Sie als sehr wichtig wählen"-Nachricht
            // Diese Nachricht ist nur für Phase 1 gedacht, nicht für Phase 2 Diskussionen
            if (phase === 2) {
              // In Phase 2: Entferne die Phase-1-Nachricht, wenn sie vorhanden ist
              const utteranceStr = Array.isArray(parsed.utterance) 
                ? parsed.utterance.join(' ') 
                : (parsed.utterance || '');
              
              // Entferne die "erste Frage, die Sie als sehr wichtig wählen"-Nachricht
              const cleanedUtterance = utteranceStr
                .replace(/Das ist Ihre (erste|zweite|dritte|vierte|fünfte|sechste|siebte|achte|neunte|zehnte)\.? Frage, die Sie als sehr wichtig wählen\.?\s*Das hilft uns, Ihre Prioritäten besser zu verstehen\.\s*/gi, '')
                .replace(/Das ist Ihre \d+\.? Frage, die Sie als sehr wichtig wählen\.?\s*Das hilft uns, Ihre Prioritäten besser zu verstehen\.\s*/gi, '')
                .replace(/Das ist Ihre (erste|zweite|dritte|vierte|fünfte|sechste|siebte|achte|neunte|zehnte)\.? Frage, die Sie als sehr wichtig wählen\.?\s*/gi, '')
                .replace(/Das ist Ihre \d+\.? Frage, die Sie als sehr wichtig wählen\.?\s*/gi, '')
                .trim();
              
              if (cleanedUtterance !== utteranceStr) {
                parsed.utterance = cleanedUtterance || `Warum ist ${cardTitle} so wichtig für Sie?`;
                console.log(`🧹 Phase 2: Entferne Phase-1-Nachricht "erste Frage, die Sie als sehr wichtig wählen" - verwende nur die Diskussionsfrage`);
              }
            } else {
              // In Phase 1: Wenn die Nummer nicht korrekt erwähnt wird ODER eine falsche Nummer vorhanden ist, korrigiere
              if (!hasCorrectNumber || hasWrongNumber) {
                // Konvertiere utterance zu String, falls es ein Array ist
                const utteranceStr = Array.isArray(parsed.utterance) 
                  ? parsed.utterance.join(' ') 
                  : (parsed.utterance || '');
                
                if (isFirstVeryImportant) {
                  // Erste Frage: Verwende spezielle Formulierung
                  parsed.utterance = `Das ist Ihre erste Frage, die Sie als sehr wichtig wählen. Das hilft uns, Ihre Prioritäten besser zu verstehen.\n\n${utteranceStr || `Warum ist ${cardTitle} so wichtig für Sie?`}`;
                } else {
                  // Alle weiteren: Füge die Nummer am Anfang hinzu
                  // Entferne eventuell vorhandene falsche Nummernangaben
                  const cleanedUtterance = utteranceStr
                    .replace(/Das ist Ihre (erste|zweite|dritte|vierte|fünfte|sechste|siebte|achte|neunte|zehnte)\.? Frage, die Sie als sehr wichtig wählen\.?\s*/gi, '')
                    .replace(/Das ist Ihre \d+\.? Frage, die Sie als sehr wichtig wählen\.?\s*/gi, '')
                    .trim();
                  
                  const numberPrefix = `Das ist Ihre ${currentVeryImportantNumber}. Frage, die Sie als sehr wichtig wählen.\n\n`;
                  parsed.utterance = numberPrefix + (cleanedUtterance || `Warum ist ${cardTitle} so wichtig für Sie?`);
                }
                console.log(`✨ Nummer ${currentVeryImportantNumber} zur utterance hinzugefügt für Karte ${parsed.card_id}`);
              }
            }
            parsed.target_topic = currentTopic || parsed.target_topic;
          }
          }
        }
      } else {
        // User hat weder "wichtig" noch "sehr wichtig" gesagt, aber LLM hat very_important gesetzt
        // Das könnte ein Fehler sein, aber wir lassen es zu (vielleicht hat der User es anders formuliert)
        console.log(`⚠️ Warnung: LLM hat very_important gesetzt, aber User-Antwort enthält weder "wichtig" noch "sehr wichtig": "${userText.substring(0, 50)}"`);
      }
    }
    
    // Phase 2: Nach "Warum wichtig" beantwortet → Handlungsoptionen fragen
    if (phase === 2 && parsed.action === "follow_up_card" && parsed.card_id && 
        veryImportantWithReason.has(parsed.card_id) && !actionOptionsAsked.has(parsed.card_id)) {
      // User hat bereits "warum wichtig" beantwortet, jetzt Handlungsoptionen fragen
      console.log(`📋 Phase 2: Karte ${parsed.card_id} hat bereits Grund, frage nach Handlungsoptionen`);
      parsed.action = "propose_action";
      if (isUtteranceEmpty(parsed.utterance)) {
        const card = CARDS.find(c => c.id === parsed.card_id);
        const examples = card?.example_actions?.slice(0, 3).join(', ') || 'verschiedene Möglichkeiten';
        parsed.utterance = `Welche Handlungsoptionen wären für Sie hilfreich? Hier sind einige Beispiele, wie man damit umgehen kann: ${examples}.`;
      }
    }
    
    // Phase 2: Nach Handlungsoptionen beantwortet → Zusammenfassung
    if (phase === 2 && parsed.action === "propose_action" && parsed.card_id && 
        actionOptionsAnswered.has(parsed.card_id) && !discussionCompleted.has(parsed.card_id)) {
      console.log(`📋 Phase 2: Frage ${parsed.card_id} hat Handlungsoptionen beantwortet, fasse zusammen`);
      parsed.action = "summarize_topic";
      
      // WICHTIG: Das LLM sollte die Antworten aufnehmen und direkt zusammenfassen, OHNE die Frage zu wiederholen
      // Die Zusammenfassung sollte direkt mit "Zu der Frage X habe ich von Ihnen gehört, dass..." beginnen
      if (isUtteranceEmpty(parsed.utterance)) {
        const card = CARDS.find(c => c.id === parsed.card_id);
        parsed.utterance = `Zu der Frage "${card?.title || 'diesem Thema'}" habe ich von Ihnen gehört, dass... [Fasse hier die Antworten zusammen, OHNE die Frage zu wiederholen]. Ist diese Zusammenfassung für Sie so stimmig, oder möchten Sie etwas ergänzen oder korrigieren?`;
      } else {
        // Entferne eventuelle Fragenwiederholungen aus der Utterance
        const utteranceStr = Array.isArray(parsed.utterance) 
          ? parsed.utterance.join(' ') 
          : (parsed.utterance || '');
        
        // Stelle sicher, dass die Zusammenfassung nicht die Frage wiederholt
        // Wenn die Utterance mit "Zu der Frage" beginnt, ist sie bereits korrekt
        if (!utteranceStr.toLowerCase().includes('zu der frage') && 
            !utteranceStr.toLowerCase().includes('habe ich von ihnen gehört')) {
          const card = CARDS.find(c => c.id === parsed.card_id);
          parsed.utterance = `Zu der Frage "${card?.title || 'diesem Thema'}" habe ich von Ihnen gehört, dass ${utteranceStr}. Ist diese Zusammenfassung für Sie so stimmig, oder möchten Sie etwas ergänzen oder korrigieren?`;
        }
      }
    }
    
    // Phase 2: Nach Zusammenfassung → Frage ob korrekt (wenn noch nicht bestätigt)
    if (phase === 2 && parsed.action === "summarize_topic" && parsed.card_id) {
      // Prüfe, ob bereits eine Zusammenfassung für diese Frage existiert und ob sie bestätigt wurde
      const existingSummary = summariesByCard.get(parsed.card_id);
      if (existingSummary && !summariesConfirmed.has(parsed.card_id)) {
        // Zusammenfassung existiert bereits, aber wurde noch nicht bestätigt
        // Frage sollte schon im letzten Turn gestellt worden sein, warte auf Antwort
        console.log(`⏳ Warte auf Bestätigung der Zusammenfassung für ${parsed.card_id}`);
      }
    }
    
    // Phase 2: Nach Bestätigung der Zusammenfassung → automatisch zum nächsten sehr wichtigen Topic
    // Prüfe, ob User gerade eine Zusammenfassung bestätigt hat
    if (phase === 2 && lastUserMessage) {
      const lastAssistantTurn = turns.slice().reverse().find(t => 
        t.role === 'assistant' && 
        t.action === 'summarize_topic' && 
        t.card_id
      );
      
      if (lastAssistantTurn) {
        const userText = lastUserMessage.toLowerCase();
        const isConfirmation = userText.includes('ja') || userText.includes('richtig') || userText.includes('korrekt') || 
                               userText.includes('passt') || userText.includes('stimmt') || userText.includes('genau') ||
                               userText.includes('zutreffend') || userText.includes('das stimmt') || 
                               userText.includes('stimmt so') || userText.includes('korrekt so');
        
        // Prüfe, ob diese Zusammenfassung gerade bestätigt wurde
        if (isConfirmation && summariesConfirmed.has(lastAssistantTurn.card_id) && parsed.action !== "wrap") {
          // User hat gerade die Zusammenfassung bestätigt → wechsle zum nächsten sehr wichtigen Topic
          const nextUndiscussedCard = veryImportantCards.find(vic => 
            !summariesConfirmed.has(vic.card_id) && 
            discussionCards.has(vic.card_id)
          );
          
          if (nextUndiscussedCard) {
            const card = CARDS.find(c => c.id === nextUndiscussedCard.card_id);
            
            // Prüfe, welcher Schritt als nächstes kommt
            if (!followUpCardsAsked.has(nextUndiscussedCard.card_id)) {
              // Noch keine follow_up_card gestellt → stelle sie
              parsed.action = "follow_up_card";
              parsed.card_id = nextUndiscussedCard.card_id;
              parsed.utterance = `Warum ist ${card?.title || 'das'} so wichtig für Sie?`;
              parsed.target_topic = card?.topic || "";
              console.log(`✅ Phase 2: Zusammenfassung bestätigt → wechsle zu nächster sehr wichtiger Karte: ${nextUndiscussedCard.card_id} (follow_up_card)`);
            } else if (!veryImportantWithReason.has(nextUndiscussedCard.card_id)) {
              // follow_up_card gestellt, aber noch keine Antwort → warte (sollte nicht passieren)
              console.log(`⏳ Phase 2: Warte noch auf Antwort zu follow_up_card für ${nextUndiscussedCard.card_id}`);
            } else if (!actionOptionsAsked.has(nextUndiscussedCard.card_id)) {
              // Grund bereits erfragt → frage nach Handlungsoptionen
              parsed.action = "propose_action";
              parsed.card_id = nextUndiscussedCard.card_id;
              const examples = card?.example_actions?.slice(0, 3).join(', ') || 'verschiedene Möglichkeiten';
              parsed.utterance = `Welche Handlungsoptionen wären für Sie hilfreich? Hier sind einige Beispiele, wie man damit umgehen kann: ${examples}.`;
              parsed.target_topic = card?.topic || "";
              console.log(`✅ Phase 2: Zusammenfassung bestätigt → wechsle zu nächster sehr wichtiger Karte: ${nextUndiscussedCard.card_id} (propose_action)`);
            } else if (!actionOptionsAnswered.has(nextUndiscussedCard.card_id)) {
              // Warte noch auf Antwort zu Handlungsoptionen
              console.log(`⏳ Phase 2: Warte noch auf Antwort zu Handlungsoptionen für ${nextUndiscussedCard.card_id}`);
            } else {
              // Handlungsoptionen beantwortet → Zusammenfassung
              parsed.action = "summarize_topic";
              parsed.card_id = nextUndiscussedCard.card_id;
              parsed.utterance = `Zu der Frage "${card?.title || 'diesem Thema'}" habe ich von Ihnen gehört, dass... [Fasse hier die Antworten zusammen, OHNE die Frage zu wiederholen]. Ist diese Zusammenfassung für Sie so stimmig, oder möchten Sie etwas ergänzen oder korrigieren?`;
              parsed.target_topic = card?.topic || "";
              console.log(`✅ Phase 2: Zusammenfassung bestätigt → wechsle zu nächster sehr wichtiger Karte: ${nextUndiscussedCard.card_id} (summarize_topic)`);
            }
          } else {
            // Alle sehr wichtigen Karten wurden diskutiert → wrap
            console.log(`✅ Phase 2: Alle sehr wichtigen Karten wurden diskutiert → wrap`);
            if (parsed.action !== "wrap") {
              parsed.action = "wrap";
              parsed.card_id = "";
              parsed.target_topic = "";
            }
          }
        }
      }
    }
    
    // Unsure: Kurze Erklärung + Beispiel geben
    if (parsed.importance === "unsure" && parsed.card_id && parsed.card_id !== "") {
      const card = CARDS.find(c => c.id === parsed.card_id);
      if (card) {
        console.log(`❓ Karte ${parsed.card_id} als "unsure" markiert → Erklärung + Beispiel`);
        // LLM sollte selbst formulieren basierend auf card.description, nur Fallback
        if (isUtteranceEmpty(parsed.utterance)) {
          parsed.utterance = `${card.description || card.prompt}\n\nBeispiel: ${card.example_actions?.[0] || 'Ein Beispiel folgt...'}`;
        }
        parsed.action = "ask_card"; // Bleibt bei ask_card, aber mit Erklärung
      }
    }
    
    // Phase 2: Nur discussion: true Karten anzeigen
    if (phase === 2 && parsed.action === "ask_card" && parsed.card_id) {
      if (!discussionCards.has(parsed.card_id)) {
        console.log(`⚠️ Phase 2: Karte ${parsed.card_id} ist nicht sehr wichtig (discussion: false), überspringe`);
        // Finde nächste discussion: true Karte
        const nextDiscussionCard = Array.from(discussionCards).find(cardId => {
          const card = CARDS.find(c => c.id === cardId);
          return card && !askedCardIds.has(cardId);
        });
        if (nextDiscussionCard) {
          const card = CARDS.find(c => c.id === nextDiscussionCard);
          parsed.card_id = nextDiscussionCard;
          if (isUtteranceEmpty(parsed.utterance)) {
            parsed.utterance = card?.prompt || "";
          }
        } else {
          // Alle discussion Karten behandelt, wechsle zu wrap
          console.log(`✅ Alle sehr wichtigen Karten wurden besprochen, wechsle zu wrap`);
          parsed.action = "wrap";
        }
      }
    }
    
    // Stelle sicher, dass alle Pflichtfelder vorhanden sind
    if (!parsed.card_id) parsed.card_id = "";
    if (!parsed.target_topic) parsed.target_topic = "";
    if (!parsed.importance) parsed.importance = "";
    if (!parsed.navigation) parsed.navigation = "";
    if (typeof parsed.propose_action_now !== 'boolean') parsed.propose_action_now = false;
    
    // Phase 1: Wenn mehr als 10 "sehr wichtige" Karten vorhanden sind, gehe sie automatisch durch
    if (phase === 1 && allCardsAsked && veryImportantCount > maxVeryImportant) {
      // Finde die nächste "sehr wichtige" Karte, die noch nicht neu bewertet wurde
      // Wir gehen alle sehr wichtigen Karten der Reihe nach durch
      const veryImportantCardIds = veryImportantCards.map(vic => vic.card_id);
      const lastReviewedVeryImportant = turns.slice().reverse().find(t => 
        t.role === 'assistant' && 
        t.card_id && 
        veryImportantCardIds.includes(t.card_id) &&
        t.text && t.text.toLowerCase().includes('sehr wichtig')
      );
      
      // Finde die nächste sehr wichtige Karte, die noch nicht neu bewertet wurde
      let nextVeryImportantCard = null;
      if (lastReviewedVeryImportant) {
        const lastIndex = veryImportantCardIds.indexOf(lastReviewedVeryImportant.card_id);
        if (lastIndex < veryImportantCardIds.length - 1) {
          nextVeryImportantCard = CARDS.find(c => c.id === veryImportantCardIds[lastIndex + 1]);
        } else {
          // Alle durchgegangen, starte von vorne
          nextVeryImportantCard = CARDS.find(c => c.id === veryImportantCardIds[0]);
        }
      } else {
        // Noch keine neu bewertet, starte mit der ersten
        nextVeryImportantCard = CARDS.find(c => c.id === veryImportantCardIds[0]);
      }
      
      if (nextVeryImportantCard && parsed.action !== "ask_card") {
        // Stelle die nächste sehr wichtige Frage
        parsed.action = "ask_card";
        parsed.card_id = nextVeryImportantCard.id;
        parsed.utterance = nextVeryImportantCard.prompt;
        parsed.target_topic = nextVeryImportantCard.topic;
        console.log(`🔄 Phase 1: Mehr als ${maxVeryImportant} sehr wichtige Karten - gehe durch: ${nextVeryImportantCard.id}`);
      }
    }
    
    // Phase 1: KRITISCH - Wenn currentTopic gesetzt ist, muss das Thema vollständig durchgefragt werden
    // Verhindere Wechsel zu anderen Themen oder present_topics, solange noch ungefragte Karten im aktuellen Thema existieren
    if (phase === 1 && currentTopic && unaskedCards.length > 0) {
      // Es gibt noch ungefragte Karten im aktuellen Thema
      if (parsed.action === "present_topics" || (parsed.action === "ask_card" && parsed.target_topic && parsed.target_topic !== currentTopic)) {
        console.log(`🚫 Phase 1: Blockiere Wechsel zu anderem Thema - ${unaskedCards.length} ungefragte Karten im aktuellen Thema ${currentTopic} verbleiben`);
        // Erzwinge Fortsetzung im aktuellen Thema
        const nextUnaskedCard = unaskedCards[0];
        parsed.action = "ask_card";
        parsed.card_id = nextUnaskedCard.id;
        parsed.utterance = nextUnaskedCard.prompt;
        parsed.target_topic = currentTopic;
        console.log(`✅ Erzwinge ask_card für Karte ${nextUnaskedCard.id} im aktuellen Thema ${currentTopic}`);
      }
    }
    
    // Phase 1: Wenn currentTopic abgeschlossen ist (alle Karten gefragt), aber noch andere Themen offen sind
    // Erzwinge present_topics oder Wechsel zum nächsten offenen Thema
    if (phase === 1 && currentTopic && unaskedCards.length === 0 && completedTopics.has(currentTopic)) {
      const remainingTopics = ['illness_care', 'practical', 'dignity', 'feelings'].filter(t => !completedTopics.has(t));
      if (remainingTopics.length > 0) {
        console.log(`✅ Thema ${currentTopic} ist abgeschlossen (alle Karten gefragt), aber noch ${remainingTopics.length} Themen offen: ${remainingTopics.join(', ')}`);
        
        // Wenn das LLM etwas anderes als present_topics oder ask_card für ein offenes Thema wählt, korrigiere es
        if (parsed.action !== "present_topics" && parsed.action !== "ask_card") {
          // Wenn es wrap oder ähnliches ist, ändere zu present_topics
          if (parsed.action === "wrap" || parsed.action === "return_to_cards") {
            console.log(`🚫 Phase 1: Blockiere ${parsed.action} - noch ${remainingTopics.length} Themen offen, ändere zu present_topics`);
            parsed.action = "present_topics";
            parsed.card_id = "";
            parsed.target_topic = "";
            
            // Korrigiere die Utterance, wenn sie sagt, dass alle Themen durchgesprochen wurden
            const utteranceText = Array.isArray(parsed.utterance) 
              ? parsed.utterance.join(' ') 
              : parsed.utterance;
            const utteranceLower = String(utteranceText).toLowerCase();
            
            // Prüfe, ob die Utterance behauptet, dass alle Themen durchgesprochen wurden
            const claimsAllTopicsDone = utteranceLower.includes('alle themen') || 
                                       utteranceLower.includes('alle bereiche') ||
                                       utteranceLower.includes('alle themenbereiche') ||
                                       (utteranceLower.includes('durchgesprochen') && !utteranceLower.includes('noch')) ||
                                       (utteranceLower.includes('abgeschlossen') && utteranceLower.includes('themen'));
            
            if (claimsAllTopicsDone || isUtteranceEmpty(parsed.utterance)) {
              // Korrigiere die Utterance, um klar zu machen, dass noch Themen offen sind
              parsed.utterance = `Gut, wir haben den Bereich "${topicNames[currentTopic] || currentTopic}" abgeschlossen. Es gibt noch ${remainingTopics.length} weitere ${remainingTopics.length === 1 ? 'Bereich' : 'Bereiche'}: ${remainingTopics.map(t => topicNames[t] || t).join(', ')}. Mit welchem Bereich möchten Sie fortfahren?`;
              console.log(`✅ Korrigiere Utterance - noch ${remainingTopics.length} Themen offen`);
            }
          }
        }
        
        // Wenn parsed.target_topic auf das gerade abgeschlossene Thema zeigt, aber noch andere Themen offen sind
        // Korrigiere es, um zum nächsten offenen Thema zu wechseln
        if (parsed.action === "ask_card" && parsed.target_topic === currentTopic) {
          // Das aktuelle Thema ist abgeschlossen, aber LLM möchte eine Karte aus diesem Thema fragen
          // Wechsle zum ersten offenen Thema
          const nextOpenTopic = remainingTopics[0];
          const nextTopicCards = CARDS.filter(c => c.topic === nextOpenTopic).sort((a, b) => (a.order || 0) - (b.order || 0));
          const firstUnaskedCard = nextTopicCards.find(c => !askedCardIds.has(c.id));
          
          if (firstUnaskedCard) {
            console.log(`🔄 Phase 1: Aktuelles Thema ${currentTopic} abgeschlossen, wechsle zu nächstem offenen Thema ${nextOpenTopic}, Karte ${firstUnaskedCard.id}`);
            parsed.action = "ask_card";
            parsed.card_id = firstUnaskedCard.id;
            parsed.utterance = firstUnaskedCard.prompt;
            parsed.target_topic = nextOpenTopic;
            // Aktualisiere currentTopic für den nächsten Request
            currentTopic = nextOpenTopic;
          } else {
            // Alle Karten des nächsten Themas wurden auch schon gefragt (sollte nicht passieren)
            console.log(`⚠️ Phase 1: Alle Karten des nächsten Themas ${nextOpenTopic} wurden auch schon gefragt - verwende present_topics`);
            parsed.action = "present_topics";
            parsed.card_id = "";
            parsed.target_topic = "";
          }
        }
      }
    }
    
    // Phase 1: Blockiere propose_action, wrap und summarize_topic (nur in Phase 2/3 erlaubt)
    if (phase === 1 && (parsed.action === "propose_action" || parsed.action === "wrap" || parsed.action === "summarize_topic")) {
      console.log(`🚫 Phase 1: Blockiere ${parsed.action} - nicht erlaubt in Phase 1`);
      // Wenn summarize_topic blockiert wird, wechsle zu ask_card für die nächste Frage oder present_topics
      if (parsed.action === "summarize_topic") {
        // Prüfe ob es noch ungefragte Fragen im aktuellen Thema gibt
        if (currentTopic && unaskedCards.length > 0) {
          parsed.action = "ask_card";
          parsed.card_id = unaskedCards[0].id;
          parsed.utterance = unaskedCards[0].prompt;
          parsed.target_topic = currentTopic;
          console.log(`🔄 Phase 1: Ändere summarize_topic zu ask_card für nächste Frage: ${unaskedCards[0].id}`);
        } else if (currentTopic && unaskedCards.length === 0) {
          // Alle Fragen des Themas wurden gestellt - Thema ist abgeschlossen
          const remainingTopics = ['illness_care', 'practical', 'dignity', 'feelings'].filter(t => !completedTopics.has(t) || t === currentTopic);
          
          // Prüfe, ob es noch andere offene Themen gibt (außer dem aktuellen)
          const otherOpenTopics = remainingTopics.filter(t => t !== currentTopic);
          
          if (otherOpenTopics.length > 0) {
            // Es gibt noch andere offene Themen - biete diese an
            parsed.action = "present_topics";
            parsed.card_id = "";
            parsed.target_topic = "";
            console.log(`🔄 Phase 1: Ändere summarize_topic zu present_topics - Thema ${currentTopic} abgeschlossen, noch ${otherOpenTopics.length} offene Themen: ${otherOpenTopics.join(', ')}`);
          } else {
            // Alle Themen sind abgeschlossen - sollte nicht passieren, aber als Fallback
            parsed.action = "present_topics";
            parsed.card_id = "";
            parsed.target_topic = "";
            console.log(`🔄 Phase 1: Ändere summarize_topic zu present_topics - alle Themen abgeschlossen`);
          }
        } else {
          // Kein aktives Thema - biete Themen an
          parsed.action = "present_topics";
          parsed.card_id = "";
          parsed.target_topic = "";
          console.log(`🔄 Phase 1: Ändere summarize_topic zu present_topics`);
        }
      }
      // Wenn propose_action blockiert wird, wechsle zu ask_card oder follow_up_card
      else if (parsed.action === "propose_action") {
        // Prüfe ob es eine very_important Karte gibt, die noch keinen Grund hat
        if (parsed.card_id && veryImportantCards.some(vic => vic.card_id === parsed.card_id) && 
            !veryImportantWithReason.has(parsed.card_id)) {
          parsed.action = "follow_up_card";
          if (isUtteranceEmpty(parsed.utterance)) {
            parsed.utterance = "Warum ist das so wichtig für Sie?";
          }
        } else {
          // Ansonsten fahre mit nächster Frage fort
          const nextUnaskedCard = unaskedCards.length > 0 ? unaskedCards[0] : null;
          if (nextUnaskedCard) {
            parsed.action = "ask_card";
            parsed.card_id = nextUnaskedCard.id;
            parsed.utterance = nextUnaskedCard.prompt;
            parsed.target_topic = currentTopic || nextUnaskedCard.topic;
          } else {
            // Keine ungefragten Karten mehr, wechsle zu summarize_topic wenn Thema aktiv
            if (currentTopic) {
              parsed.action = "summarize_topic";
            } else {
              parsed.action = "present_topics";
            }
          }
        }
      } else if (parsed.action === "wrap") {
        // Wrap ist nur in Phase 3 erlaubt
        parsed.action = "present_topics";
      }
    }
    
    // Wenn summarize_topic aufgerufen wird, markiere das Thema als abgeschlossen
    if (parsed.action === "summarize_topic" && currentTopic) {
      console.log(`✅ Thema ${currentTopic} wird als abgeschlossen markiert (summarize_topic wurde aufgerufen)`);
      // Das Thema wird beim nächsten Request als abgeschlossen erkannt, da wir es in den Turns tracken
    }
    
    // Wenn present_topics aufgerufen wird, prüfe ob es noch nicht abgeschlossene Themen gibt
    if (parsed.action === "present_topics") {
      // KRITISCH: Wenn ein Thema aktiv ist und noch ungefragte Karten existieren, verhindere present_topics
      // Ein Thema muss vollständig durchgefragt werden, bevor ein anderes gestartet wird
      if (currentTopic && unaskedCards.length > 0) {
        console.log(`🚫 BLOCKIERE present_topics: Es gibt noch ${unaskedCards.length} ungefragte Karten im aktiven Thema ${currentTopic}. Frage diese zuerst!`);
        const nextUnaskedCard = unaskedCards[0];
        parsed.action = "ask_card";
        parsed.card_id = nextUnaskedCard.id;
        parsed.utterance = nextUnaskedCard.prompt;
        parsed.target_topic = currentTopic;
        console.log(`✅ Geändert zu ask_card für Karte ${nextUnaskedCard.id}`);
      }
      
      // Bei present_topics: Zeige nur nicht abgeschlossene Themen an
      // Ein Thema wird nur als abgeschlossen markiert, wenn ALLE Fragen gestellt wurden
      const availableTopics = ['illness_care', 'practical', 'dignity', 'feelings'].filter(t => 
        !completedTopics.has(t)
      );
      
      console.log(`📋 present_topics: availableTopics=${availableTopics.join(', ')}, completedTopics=${Array.from(completedTopics).join(', ')}, currentTopic=${currentTopic}, unaskedCards.length=${unaskedCards.length}`);
      
      if (availableTopics.length === 0) {
        // Alle Themen sind abgeschlossen
        console.log(`✅ Alle Themen wurden abgeschlossen. Wechsle zu wrap.`);
        parsed.action = "wrap";
        // LLM sollte selbst formulieren, nur Fallback wenn utterance leer
        if (isUtteranceEmpty(parsed.utterance)) {
          parsed.utterance = "Wir haben alle Themenbereiche durchgesprochen. Vielen Dank für Ihre Offenheit und die Zeit, die Sie sich genommen haben.\n\nSie können nun eine PDF-Zusammenfassung Ihrer Reflexion herunterladen, indem Sie auf den Button unten klicken.";
        }
        parsed.target_topic = "";
        parsed.card_id = "";
      } else {
        // Es gibt noch verfügbare Themen - LLM sollte selbst formulieren
        // Nur Warnung wenn LLM abgeschlossene/gestartete Themen erwähnt
        // topicNames wird oben bereits definiert
        const availableTopicNames = availableTopics.map(t => topicNames[t] || t);
        
        // Prüfe ob LLM abgeschlossene/gestartete Themen in utterance erwähnt
        const utteranceLower = utteranceToString(parsed.utterance).toLowerCase();
        const topicKeywords = {
          'illness_care': ['krankheit', 'behandlung', 'medizinisch'],
          'practical': ['praktisch', 'organisatorisch'],
          'dignity': ['würde', 'werte'],
          'feelings': ['gefühle', 'beziehungen', 'verbundenheit']
        };
        
        // Prüfe nur, ob LLM abgeschlossene Themen erwähnt (gestartete Themen sind erlaubt bei present_topics)
        ['illness_care', 'practical', 'dignity', 'feelings'].forEach(topic => {
          if (completedTopics.has(topic) && !availableTopics.includes(topic)) {
            const keywords = topicKeywords[topic] || [];
            if (keywords.some(kw => utteranceLower.includes(kw))) {
              console.log(`⚠️ Warnung: LLM erwähnt ${topic} in present_topics, obwohl es bereits abgeschlossen ist.`);
            }
          }
        });
        
        console.log(`📋 present_topics: Verfügbare Themen: ${availableTopics.join(', ')} (abgeschlossen: ${Array.from(completedTopics).join(', ')})`);
      }
    }
    
    // Warnung statt Override: LLM sollte selbst korrekt present_topics verwenden
    if (parsed.action === "present_topics") {
      const allTopics = ['illness_care', 'practical', 'dignity', 'feelings'];
      const trulyAvailable = allTopics.filter(t => !completedTopics.has(t));
      
      if (trulyAvailable.length === 0) {
        console.log(`⚠️ Warnung: present_topics gewählt, aber alle Themen sind abgeschlossen.`);
        // Kein Override - LLM sollte selbst zu wrap wechseln
      } else {
        console.log(`✅ present_topics: ${trulyAvailable.length} Themen verfügbar`);
      }
    }
    
    // Phase 1: KRITISCH - Wenn ask_card verwendet wird, aber target_topic nicht mit currentTopic übereinstimmt
    // und currentTopic noch ungefragte Karten hat, korrigiere target_topic
    if (phase === 1 && parsed.action === "ask_card" && currentTopic && unaskedCards.length > 0) {
      if (parsed.target_topic && parsed.target_topic !== currentTopic) {
        console.log(`🚫 Phase 1: ask_card mit falschem target_topic (${parsed.target_topic} statt ${currentTopic}) - korrigiere`);
        // Stelle sicher, dass die nächste Karte aus dem aktuellen Thema kommt
        const nextUnaskedCard = unaskedCards[0];
        parsed.card_id = nextUnaskedCard.id;
        parsed.utterance = nextUnaskedCard.prompt;
        parsed.target_topic = currentTopic;
        console.log(`✅ Korrigiert zu ask_card für Karte ${nextUnaskedCard.id} im aktuellen Thema ${currentTopic}`);
      } else if (!parsed.target_topic || parsed.target_topic === "") {
        // target_topic ist leer, setze es auf currentTopic
        parsed.target_topic = currentTopic;
        console.log(`✅ Setze target_topic auf currentTopic: ${currentTopic}`);
      }
    }
    
    // Wenn User eine Rückfrage stellt, prüfe ob die LLM-Antwort detailliert genug ist
    // Wenn die Antwort detailliert ist (länger als 100 Zeichen), zeige die Karten-Details NICHT automatisch an
    // Die Karten-Details werden nur angezeigt, wenn die Antwort kurz ist und zusätzliche Details hilfreich wären
    if (shouldShowCardDetails && lastAssistantWithCard && lastAssistantWithCard.card_id) {
      // Prüfe, ob die LLM-Antwort bereits detailliert genug ist
      const utteranceLength = getUtteranceLength(parsed.utterance);
      const isDetailedAnswer = utteranceLength > 100; // Antwort ist detailliert, wenn sie länger als 100 Zeichen ist
      
      if (isDetailedAnswer) {
        // Antwort ist bereits detailliert - zeige Karten-Details NICHT automatisch an
        parsed.auto_show_card = false;
        console.log(`📋 Antwort ist detailliert (${utteranceLength} Zeichen) - zeige Karten-Details NICHT automatisch an`);
      } else {
        // Antwort ist kurz - zeige Karten-Details automatisch an, um zusätzliche Informationen zu geben
        parsed.auto_show_card = true;
        console.log(`📋 Setze auto_show_card=true für Karte ${lastAssistantWithCard.card_id} (kurze Antwort, Karten-Details hilfreich)`);
      }
    } else {
      parsed.auto_show_card = false;
    }
    
    // Entferne "[Karte: ...]" Tags aus der utterance, falls das LLM sie hinzugefügt hat
    if (parsed.utterance) {
      parsed.utterance = cleanUtterance(parsed.utterance, (u) => u.replace(/\s*\[Karte:\s*[^\]]+\]/gi, '').trim());
    }
    
    // KRITISCH: In Phase 1 prüfe, ob die Utterance fälschlicherweise sagt, dass alle Themen durchgesprochen wurden
    if (phase === 1 && !phase1Complete && parsed.utterance && completedTopics.size < 4) {
      const utteranceText = Array.isArray(parsed.utterance) 
        ? parsed.utterance.join(' ') 
        : parsed.utterance;
      const utteranceLower = String(utteranceText).toLowerCase();
      
      // Prüfe, ob die Utterance behauptet, dass alle Themen durchgesprochen wurden
      const falseClaims = [
        'alle themen durchgesprochen',
        'alle bereiche angeschaut',
        'alle themenbereiche',
        'alle themen durchgedacht',
        'alle themen einmal',
        'alle fragen durchgesprochen',
        'alle fragen einmal'
      ];
      
      const claimsAllDone = falseClaims.some(claim => utteranceLower.includes(claim));
      
      if (claimsAllDone) {
        console.log(`⚠️ [UTTERANCE CHECK] LLM behauptet fälschlicherweise, dass alle Themen durchgesprochen wurden - korrigiere`);
        const remainingTopics = ['illness_care', 'practical', 'dignity', 'feelings'].filter(t => !completedTopics.has(t));
        
        // Korrigiere die Utterance, um klar zu machen, dass noch Themen offen sind
        if (parsed.action === "present_topics" || parsed.action === "return_to_cards") {
          parsed.utterance = `Gut, wir haben ${completedTopics.size} ${completedTopics.size === 1 ? 'Bereich' : 'Bereiche'} abgeschlossen. Es gibt noch ${remainingTopics.length} weitere ${remainingTopics.length === 1 ? 'Bereich' : 'Bereiche'}: ${remainingTopics.map(t => topicNames[t] || t).join(', ')}. Mit welchem Bereich möchten Sie fortfahren?`;
          parsed.action = "present_topics";
          parsed.card_id = "";
          parsed.target_topic = "";
          console.log(`✅ Korrigiere Utterance - noch ${remainingTopics.length} Themen offen: ${remainingTopics.join(', ')}`);
        } else if (parsed.action === "ask_card" && remainingTopics.length > 0) {
          // Wenn ask_card für ein abgeschlossenes Thema, wechsle zum nächsten offenen Thema
          const nextOpenTopic = remainingTopics[0];
          const nextTopicCards = CARDS.filter(c => c.topic === nextOpenTopic).sort((a, b) => (a.order || 0) - (b.order || 0));
          const firstUnaskedCard = nextTopicCards.find(c => !askedCardIds.has(c.id));
          
          if (firstUnaskedCard) {
            parsed.action = "ask_card";
            parsed.card_id = firstUnaskedCard.id;
            parsed.utterance = firstUnaskedCard.prompt;
            parsed.target_topic = nextOpenTopic;
            console.log(`✅ Korrigiere zu ask_card für nächste offene Thema ${nextOpenTopic}, Karte ${firstUnaskedCard.id}`);
          }
        }
      }
    }
    
    // KRITISCH: In Phase 1 entferne alle Erwähnungen von "Bei der Frage...", "Zu der Frage..." etc.
    if (phase === 1 && parsed.utterance) {
      const cleaner = (u) => {
        let cleaned = u;
        
        // Entferne Formulierungen wie:
        // "Bei der praktischen Frage '...':"
        // "Zu der praktischen Frage '...':"
        // "Bei der Frage '...':"
        // etc.
        const questionRefPattern = /(?:Bei|Zu)\s+der\s+(?:praktischen|krankheit|würde|gefühle|medizinischen|organisatorischen)?\s*Frage\s*["'„][^"'"]*["'"]\s*:\s*/gi;
        cleaned = cleaned.replace(questionRefPattern, '');
        
        // Entferne auch ohne Anführungszeichen: "Bei der praktischen Frage:"
        const questionRefPattern2 = /(?:Bei|Zu)\s+der\s+(?:praktischen|krankheit|würde|gefühle|medizinischen|organisatorischen)?\s*Frage\s*:\s*/gi;
        cleaned = cleaned.replace(questionRefPattern2, '');
        
        // Entferne "Bei dem Thema..." oder "Zu dem Thema..."
        const topicRefPattern = /(?:Bei|Zu)\s+dem\s+(?:praktischen|krankheit|würde|gefühle|medizinischen|organisatorischen)?\s*Thema\s*["'„][^"'"]*["'"]\s*:\s*/gi;
        cleaned = cleaned.replace(topicRefPattern, '');
        
        // Entferne "Beim Thema... geht es um die Frage:" oder "Beim Thema... geht es jetzt um die Frage:"
        const topicQuestionPattern = /(?:Bei\s+dem|Beim|Zu\s+dem)\s+Thema\s+[^:]*?\s+geht\s+es\s+(?:jetzt|nun)?\s+um\s+die\s+Frage\s*:\s*/gi;
        cleaned = cleaned.replace(topicQuestionPattern, '');
        
        // Entferne leere Zeilen am Anfang und Ende
        cleaned = cleaned.replace(/^\s*\n\s*/gm, '').trim();
        cleaned = cleaned.replace(/\s*\n\s*$/gm, '').trim();
        
        // Entferne doppelte Leerzeichen
        cleaned = cleaned.replace(/\s{2,}/g, ' ');
        
        return cleaned;
      };
      
      const cleaned = cleanUtterance(parsed.utterance, cleaner);
      if (JSON.stringify(cleaned) !== JSON.stringify(parsed.utterance)) {
        console.log(`🧹 Phase 1: Entferne Karten-Referenzen aus utterance`);
        const before = Array.isArray(parsed.utterance) ? parsed.utterance.join(' ') : parsed.utterance;
        const after = Array.isArray(cleaned) ? cleaned.join(' ') : cleaned;
        console.log(`   Vorher: "${before.substring(0, 150)}..."`);
        console.log(`   Nachher: "${after.substring(0, 150)}..."`);
        parsed.utterance = cleaned;
      }
    }
    
    // KRITISCH: Prüfe, ob eine ask_card Utterance auch eine Pause-Frage enthält
    // Wenn ja, entferne die Pause-Frage aus der utterance, da sie nicht mit einer Topic-Frage kombiniert werden darf
    if (parsed.action === "ask_card" && parsed.utterance) {
      const utteranceText = Array.isArray(parsed.utterance) 
        ? parsed.utterance.join(' ') 
        : parsed.utterance;
      const utteranceLower = utteranceText.toLowerCase();
      
      // Prüfe auf Pause-Fragen
      const pauseKeywords = [
        'pause machen',
        'pause',
        'unterbrechen',
        'stopp',
        'fortschritt exportieren',
        'fortschritt speichern',
        'später fortfahren',
        'möchten sie eine pause',
        'wollen sie eine pause',
        'können sie eine pause',
        'möchten sie kurz eine pause',
        'wollen sie kurz eine pause'
      ];
      
      const containsPauseQuestion = pauseKeywords.some(keyword => utteranceLower.includes(keyword));
      
      if (containsPauseQuestion) {
        console.log(`⚠️ [PAUSE CHECK] ask_card utterance enthält Pause-Frage - entferne sie`);
        
        // Wenn utterance ein Array ist, entferne Elemente, die Pause-Fragen enthalten
        if (Array.isArray(parsed.utterance)) {
          const cleanedArray = parsed.utterance.filter(text => {
            const textLower = String(text).toLowerCase();
            return !pauseKeywords.some(keyword => textLower.includes(keyword));
          });
          
          if (cleanedArray.length > 0) {
            parsed.utterance = cleanedArray.length === 1 ? cleanedArray[0] : cleanedArray;
            console.log(`✅ [PAUSE CHECK] Pause-Frage aus Array entfernt, verbleibende Elemente: ${cleanedArray.length}`);
          } else {
            // Alle Elemente waren Pause-Fragen - behalte nur die Topic-Frage (falls vorhanden)
            // Fallback: Verwende die card prompt
            const card = CARDS.find(c => c.id === parsed.card_id);
            if (card) {
              parsed.utterance = card.prompt;
              console.log(`✅ [PAUSE CHECK] Alle Elemente waren Pause-Fragen - verwende card.prompt als Fallback`);
            }
          }
        } else {
          // Utterance ist ein String - entferne Pause-Fragen-Teile
          // Versuche, die Topic-Frage zu extrahieren (alles vor der Pause-Frage)
          let cleaned = String(parsed.utterance);
          
          // Finde die Position der ersten Pause-Frage
          let pauseStartIndex = -1;
          for (const keyword of pauseKeywords) {
            const index = cleaned.toLowerCase().indexOf(keyword);
            if (index !== -1 && (pauseStartIndex === -1 || index < pauseStartIndex)) {
              pauseStartIndex = index;
            }
          }
          
          if (pauseStartIndex !== -1) {
            // Entferne alles ab der Pause-Frage
            cleaned = cleaned.substring(0, pauseStartIndex).trim();
            
            // Entferne auch Satzzeichen am Ende, die auf eine Pause-Frage hinweisen könnten
            cleaned = cleaned.replace(/[.,;:]\s*$/, '').trim();
            
            if (cleaned.length > 0) {
              parsed.utterance = cleaned;
              console.log(`✅ [PAUSE CHECK] Pause-Frage aus String entfernt`);
            } else {
              // Der gesamte String war eine Pause-Frage - verwende card.prompt als Fallback
              const card = CARDS.find(c => c.id === parsed.card_id);
              if (card) {
                parsed.utterance = card.prompt;
                console.log(`✅ [PAUSE CHECK] String war nur Pause-Frage - verwende card.prompt als Fallback`);
              }
            }
          }
        }
      }
    }
    
    // KRITISCH: Wenn Phase 1 abgeschlossen ist und das LLM eine Phase 2 Aktion zurückgibt,
    // wechsle automatisch zu Phase 2 (auch ohne explizite User-Bestätigung, wenn LLM es bereits tut)
    // Diese Prüfung erfolgt NACH dem Parsing der LLM-Response und allen anderen Validierungen,
    // damit parsed.action verfügbar ist und alle Bedingungen geprüft werden können
    if (parsed && parsed.action) {
      const isPhase2Action = parsed.action === "follow_up_card" || 
                             parsed.action === "propose_action" || 
                             parsed.action === "summarize_topic";
      
      if (phase1Complete && phase === 1 && isPhase2Action && veryImportantCount > 0 && veryImportantCount <= maxVeryImportant) {
        // Phase 1 ist abgeschlossen, LLM gibt Phase 2 Aktion zurück → automatischer Wechsel zu Phase 2
        phase = 2;
        console.log(`✅ [AUTO-PHASE-2] Phase 1 abgeschlossen - LLM gibt Phase 2 Aktion (${parsed.action}) zurück → automatischer Wechsel zu Phase 2 (${veryImportantCount} sehr wichtige Karten)`);
      }
    }
    
    // Füge phase immer zum Response hinzu
    parsed.phase = phase;
    const previousPhase = req.body?.phase || req.body?.conversation?.phase || 1;
    if (phase !== previousPhase) {
      console.log(`📤 Phase geändert: ${previousPhase} → ${phase}`);
    }
    
    console.log('📤 Sende Response:', { action: parsed.action, card_id: parsed.card_id, target_topic: parsed.target_topic, importance: parsed.importance, auto_show_card: parsed.auto_show_card, completedTopics: Array.from(completedTopics), phase: parsed.phase });
    res.json(parsed);

  } catch (err) {
    console.error('❌ Planner error:', err?.message || err);
    console.error('❌ Stack:', err?.stack);
    console.error('❌ Request body:', JSON.stringify({ 
      turnsCount: req.body?.turns?.length || 0, 
      activeTopic: req.body?.activeTopic || '', 
      phase: req.body?.phase || 1 
    }));
    res.status(500).json({ 
      error: "planner_failed", 
      message: err?.message || "Unbekannter Fehler",
      details: process.env.NODE_ENV === 'development' ? err?.stack : undefined
    });
  }
});

// Karten abrufen
app.get('/api/cards', (req, res) => {
  console.log(`📋 GET /api/cards - Route erreicht!`);
  console.log(`📋 Anzahl geladener Karten: ${CARDS.length}`);
  try {
    if (!CARDS || CARDS.length === 0) {
      console.warn('⚠️ Keine Karten geladen, aber Anfrage erhalten');
      return res.status(503).json({ error: 'Karten noch nicht geladen', cards: [] });
    }
    console.log(`✅ Sende ${CARDS.length} Karten zurück`);
    res.json(CARDS);
  } catch (e) {
    console.error('❌ Fehler beim Abrufen der Karten:', e);
    res.status(500).json({ error: e.message });
  }
});

// Einzelne Karte abrufen
app.get('/api/cards/:id', (req, res) => {
  try {
    const cardId = req.params.id;
    console.log(`📋 Anfrage für Karte: ${cardId}`);
    console.log(`📋 Verfügbare Karten: ${CARDS.length}`);
    
    if (!CARDS || CARDS.length === 0) {
      console.warn('⚠️ Keine Karten geladen');
      return res.status(503).json({ error: 'Karten noch nicht geladen' });
    }
    
    const card = CARDS.find(c => c.id === cardId);
    if (!card) {
      console.warn(`⚠️ Karte nicht gefunden: ${cardId}`);
      console.log(`Verfügbare IDs (erste 5):`, CARDS.slice(0, 5).map(c => c.id));
      return res.status(404).json({ error: 'Karte nicht gefunden', requestedId: cardId });
    }
    
    console.log(`✅ Karte gefunden: ${card.title}`);
    res.json(card);
  } catch (e) {
    console.error('Fehler beim Abrufen der Karte:', e);
    res.status(500).json({ error: e.message });
  }
});

// Verfügbare Modelle auflisten
app.get('/api/models', async (_req, res) => {
  try {
    const list = await openai.models.list();
    res.json(list.data.map(m => m.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// JSON Export Endpoint
app.post('/api/export/json', async (req, res) => {
  try {
    console.log('📤 JSON Export Anfrage erhalten');
    console.log('📤 Request Body Keys:', Object.keys(req.body || {}));
    
    // Das Frontend sendet das conversation-Objekt direkt
    // Unterstütze sowohl direktes Format als auch verschachteltes conversation-Objekt
    let turns = [];
    let activeTopic = "";
    let phase = 1;
    
    if (req.body && typeof req.body === 'object') {
      // Prüfe ob es ein conversation-Objekt gibt (verschachtelt)
      if (req.body.conversation && typeof req.body.conversation === 'object') {
        turns = req.body.conversation.turns || [];
        activeTopic = req.body.conversation.activeTopic || "";
        phase = req.body.conversation.phase || req.body.phase || 1;
      } else if (req.body.turns) {
        // Direktes Format: conversation-Objekt wurde direkt gesendet
        turns = req.body.turns || [];
        activeTopic = req.body.activeTopic || "";
        phase = req.body.phase || 1;
      }
    }
    
    console.log(`📤 Export: ${turns.length} Turns, Phase: ${phase}, ActiveTopic: ${activeTopic}`);
    console.log(`📤 Request Body Type:`, typeof req.body);
    console.log(`📤 Request Body hat 'turns'?:`, 'turns' in (req.body || {}));
    console.log(`📤 Request Body hat 'conversation'?:`, 'conversation' in (req.body || {}));
    if (turns.length > 0) {
      console.log(`📤 Erste Turn:`, JSON.stringify(turns[0], null, 2));
    } else {
      console.log(`⚠️ KEINE TURNS GEFUNDEN! Request Body:`, JSON.stringify(req.body, null, 2).substring(0, 500));
    }
    
    // Analysiere Conversation für Export
    const topicNames = {
      'illness_care': 'Krankheit & Behandlung',
      'practical': 'Praktische und organisatorische Fragen',
      'dignity': 'Würde & persönliche Werte',
      'feelings': 'Gefühle, Beziehungen & Verbundenheit'
    };
    
    // Extrahiere gewählte Kategorien/Themen
    const selectedTopics = new Set();
    const topicEvaluations = {}; // topic -> { importance, cards }
    const discussions = []; // Diskussionsverläufe für sehr wichtige Karten
    const summaries = []; // Zusammenfassungen (summarize_topic)
    const actionOptions = []; // Handlungsoptionen (propose_action)
    
    // Tracke sehr wichtige Karten und deren Diskussionen
    const veryImportantCardIds = new Set();
    const veryImportantReasons = new Map();
    const actionOptionsByCard = new Map();
    
    turns.forEach((turn, index) => {
      // Gewählte Themen
      if (turn.target_topic && turn.target_topic !== "") {
        selectedTopics.add(turn.target_topic);
      }
      
      // Sehr wichtige Karten identifizieren
      if (turn.role === 'assistant' && turn.card_id) {
        if (turn.importance === 'very_important') {
          veryImportantCardIds.add(turn.card_id);
        }
        const textLower = turn.text.toLowerCase();
        if (textLower.includes('sehr wichtig') || textLower.includes('very important')) {
          veryImportantCardIds.add(turn.card_id);
        }
      }
      
      if (turn.role === 'user' && index > 0) {
        const prevTurn = turns[index - 1];
        if (prevTurn && prevTurn.role === 'assistant' && prevTurn.card_id) {
          const userText = turn.text.toLowerCase();
          if (userText.includes('sehr wichtig') || userText.includes('extrem wichtig')) {
            veryImportantCardIds.add(prevTurn.card_id);
          }
        }
      }
      
      // Begründungen für sehr wichtige Karten
      if (turn.role === 'assistant' && turn.card_id && turn.action === 'follow_up_card') {
        const nextUserTurn = turns.slice(index + 1).find(t => t.role === 'user');
        if (nextUserTurn && nextUserTurn.text) {
          veryImportantReasons.set(turn.card_id, nextUserTurn.text);
        }
      }
      
      // Handlungsoptionen
      if (turn.role === 'assistant' && turn.card_id && turn.action === 'propose_action') {
        const nextUserTurn = turns.slice(index + 1).find(t => t.role === 'user');
        actionOptionsByCard.set(turn.card_id, {
          question: turn.text,
          answer: nextUserTurn?.text || null
        });
      }
      
      // Zusammenfassungen
      if (turn.role === 'assistant' && turn.action === 'summarize_topic') {
        summaries.push({
          topic: turn.target_topic || activeTopic,
          summary: turn.text,
          timestamp: turn.ts || Date.now()
        });
      }
    });
    
    // Bewertungen der Themen/Karten
    turns.forEach((turn, index) => {
      if (turn.role === 'assistant' && turn.card_id) {
        const card = CARDS && CARDS.length > 0 ? CARDS.find(c => c.id === turn.card_id) : null;
        if (card) {
          const topic = card.topic;
          if (!topicEvaluations[topic]) {
            topicEvaluations[topic] = {
              topic: topic,
              topicName: topicNames[topic] || topic,
              cards: []
            };
          }
          
          // Finde User-Antwort
          const nextUserTurn = turns.slice(index + 1).find(t => t.role === 'user');
          let importance = turn.importance || '';
          if (!importance && nextUserTurn) {
            const userText = nextUserTurn.text.toLowerCase();
            if (userText.includes('sehr wichtig')) importance = 'very_important';
            else if (userText.includes('wichtig')) importance = 'important';
            else if (userText.includes('nicht wichtig')) importance = 'not_important';
            else if (userText.includes('ich weiß nicht') || userText.includes('unsure')) importance = 'unsure';
            else importance = 'neutral';
          }
          
          // Prüfe ob Karte bereits in Evaluations
          const existingCard = topicEvaluations[topic].cards.find(c => c.card_id === turn.card_id);
          if (!existingCard) {
            topicEvaluations[topic].cards.push({
              card_id: turn.card_id,
              card_title: card.title,
              importance: importance,
              user_response: nextUserTurn?.text || null,
              timestamp: turn.ts || Date.now()
            });
          }
        }
      }
    });
    
    // Diskussionsverläufe für sehr wichtige Karten
    veryImportantCardIds.forEach(cardId => {
      const card = CARDS && CARDS.length > 0 ? CARDS.find(c => c.id === cardId) : null;
      const reason = veryImportantReasons.get(cardId);
      const actionOption = actionOptionsByCard.get(cardId);
      
      if (card) {
        discussions.push({
          card_id: cardId,
          card_title: card.title,
          topic: card.topic,
          topic_name: topicNames[card.topic] || card.topic,
          why_important: reason || null,
          action_options: actionOption || null,
          timestamp: Date.now()
        });
      }
    });
    
    // Prüfe auf sensible Inhalte
    const sensitiveKeywords = ['suizid', 'selbstmord', 'töten', 'sterben', 'tod', 'krankheit', 'schmerz', 'angst', 'depression', 'verzweiflung'];
    const hasSensitiveContent = turns.some(turn => {
      const text = (turn.text || '').toLowerCase();
      return sensitiveKeywords.some(keyword => text.includes(keyword));
    });
    
    // Erstelle Export-Objekt
    const exportData = {
      version: "1.0.0",
      export_date: new Date().toISOString(),
      metadata: {
        app_name: "Reflecta - Lebensende Reflexion",
        app_version: "1.0.0",
        export_format: "json",
        phase: phase,
        active_topic: activeTopic || null,
        has_sensitive_content: hasSensitiveContent
      },
      conversation: {
        turns: turns
      },
      game_state: {
        selected_topics: Array.from(selectedTopics).map(t => ({
          topic: t,
          topic_name: topicNames[t] || t
        })),
        topic_evaluations: Object.values(topicEvaluations),
        phase: phase,
        active_topic: activeTopic || null
      },
      discussions: discussions,
      summaries: summaries,
      action_options: Array.from(actionOptionsByCard.values()),
      technical_notes: {
        total_turns: turns.length,
        total_cards_discussed: new Set(turns.filter(t => t.card_id).map(t => t.card_id)).size,
        very_important_cards_count: veryImportantCardIds.size,
        completed_topics: summaries.map(s => s.topic).filter((v, i, a) => a.indexOf(v) === i)
      },
      privacy_notice: {
        warning: "Diese Datei enthält persönliche und möglicherweise sensible Informationen. Bitte behandeln Sie sie vertraulich.",
        recommendation: "Bei sensiblen Inhalten wird empfohlen, diese mit einer Fachperson zu besprechen.",
        encryption: "Für zusätzliche Sicherheit können Sie diese Datei verschlüsseln."
      }
    };
    
    console.log('✅ JSON Export erfolgreich erstellt');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="reflexion-export.json"');
    res.json(exportData);
    
  } catch (err) {
    console.error('❌ JSON Export error:', err?.message || err);
    console.error('Stack:', err?.stack);
    res.status(500).json({ error: "json_export_failed", message: err?.message || "Unbekannter Fehler beim Export" });
  }
});

// JSON Import Endpoint
app.post('/api/import/json', async (req, res) => {
  try {
    const { exportData } = req.body || {};
    
    if (!exportData) {
      return res.status(400).json({ error: "missing_data", message: "Keine Export-Daten gefunden." });
    }
    
    // Validiere Export-Format
    if (!exportData.version || !exportData.conversation) {
      return res.status(400).json({ error: "invalid_format", message: "Ungültiges Export-Format." });
    }
    
    // Prüfe auf sensible Inhalte (einfache Heuristik)
    const sensitiveKeywords = ['suizid', 'selbstmord', 'töten', 'sterben', 'tod', 'krankheit', 'schmerz', 'angst', 'depression'];
    const hasSensitiveContent = exportData.conversation.turns.some(turn => {
      const text = (turn.text || '').toLowerCase();
      return sensitiveKeywords.some(keyword => text.includes(keyword));
    });
    
    // Wiederherstelle Conversation
    const restoredConversation = {
      turns: exportData.conversation.turns || [],
      activeTopic: exportData.game_state?.active_topic || exportData.metadata?.active_topic || "",
      phase: exportData.game_state?.phase || exportData.metadata?.phase || 1
    };
    
    res.json({
      success: true,
      conversation: restoredConversation,
      metadata: {
        version: exportData.version,
        export_date: exportData.export_date,
        restored_date: new Date().toISOString(),
        has_sensitive_content: hasSensitiveContent,
        recommendation: hasSensitiveContent ? "Diese Datei enthält möglicherweise sensible Inhalte. Es wird empfohlen, diese mit einer Fachperson zu besprechen." : null
      }
    });
    
  } catch (err) {
    console.error('JSON Import error:', err?.message || err);
    res.status(500).json({ error: "json_import_failed", message: err?.message });
  }
});

// PDF Export Endpoint
app.post('/api/export/pdf', async (req, res) => {
  try {
    const { turns = [], activeTopic = "", phase = 1 } = req.body || {};
    
    const topicNames = {
      'illness_care': 'Krankheit & Behandlung',
      'practical': 'Praktische und organisatorische Fragen',
      'dignity': 'Würde & persönliche Werte',
      'feelings': 'Gefühle, Beziehungen & Verbundenheit'
    };
    
    // Erstelle PDF
    const doc = new PDFDocument({ margin: 50 });
    
    // Setze Response Headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="reflexion-zusammenfassung.pdf"');
    
    // Pipe PDF direkt zum Response
    doc.pipe(res);
    
    // Titel
    doc.fontSize(22).text('Reflexion - Zusammenfassung', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Erstellt am: ${new Date().toLocaleDateString('de-CH')}`, { align: 'center' });
    doc.moveDown(2);
    
    // Analysiere Conversation
    const veryImportantReasons = new Map(); // Map von card_id zu Begründung
    const veryImportantCardIds = new Set(); // Set von card_ids, die aktuell als very_important markiert sind
    const summariesByCard = new Map(); // card_id -> summarize_topic Text (neutrale Zusammenfassungen)
    const actionOptionsByCard = new Map(); // card_id -> { question, answer, card_title }
    
    const currentImportanceByCard = buildCurrentCardImportanceState(turns);
    currentImportanceByCard.forEach((importance, cardId) => {
      if (importance === 'very_important') {
        veryImportantCardIds.add(cardId);
      }
    });
    
    console.log(`📊 PDF Export: ${veryImportantCardIds.size} wirklich als "sehr wichtig" markierte Karten: ${Array.from(veryImportantCardIds).join(', ')}`);
    
    // Extrahiere Begründungen für very_important Themen und ALLE Handlungsmöglichkeiten
    turns.forEach((turn, index) => {
      if (turn.role === 'assistant' && turn.card_id) {
        const textLower = turn.text.toLowerCase();
        // Prüfe, ob dies eine follow_up_card Frage ist (z.B. "Warum ist das so wichtig für Sie?")
        const isFollowUpQuestion = turn.action === 'follow_up_card' || 
                                   (textLower.includes('warum') && textLower.includes('wichtig')) ||
                                   (textLower.includes('grund') && textLower.includes('wichtig'));
        
        if (isFollowUpQuestion) {
          // Finde die nächste User-Antwort (die Begründung)
          const nextUserTurn = turns.slice(index + 1).find(t => t.role === 'user');
          if (nextUserTurn && nextUserTurn.text && nextUserTurn.text.trim().length > 0) {
            // Speichere die Begründung für dieses Thema
            veryImportantReasons.set(turn.card_id, nextUserTurn.text);
          }
        }
        
        // Prüfe auf Handlungsoptionen (propose_action)
        // KRITISCH: Sammle ALLE Handlungsoptionen, auch wenn sie mehrfach gefragt wurden
        // WICHTIG: Sammle ALLE Antworten, nicht nur die erste
        if (turn.action === 'propose_action' && turn.card_id) {
          const nextUserTurn = turns.slice(index + 1).find(t => t.role === 'user');
          const answer = nextUserTurn?.text || null;
          const card_title = CARDS.find(c => c.id === turn.card_id)?.title || turn.card_id;
          
          // Nur wenn eine Antwort vorhanden ist, speichere sie
          if (answer && answer.trim().length > 0) {
            // Wenn bereits eine Handlungsoption für diese card_id vorhanden ist, füge die neue hinzu
            if (actionOptionsByCard.has(turn.card_id)) {
              const existing = actionOptionsByCard.get(turn.card_id);
              // Wenn mehrere Antworten vorhanden sind, sammle sie alle
              if (existing.answer && existing.answer.trim().length > 0) {
                // Füge die neue Antwort hinzu (wenn sie unterschiedlich ist)
                if (!existing.answer.includes(answer)) {
                  actionOptionsByCard.set(turn.card_id, {
                    question: existing.question || turn.text,
                    answer: existing.answer + (existing.answer.endsWith('.') || existing.answer.endsWith('!') || existing.answer.endsWith('?') ? ' ' : '. ') + answer,
                    card_title: existing.card_title || card_title
                  });
                }
              } else {
                // Vorher keine Antwort, jetzt eine vorhanden
                actionOptionsByCard.set(turn.card_id, {
                  question: existing.question || turn.text,
                  answer: answer,
                  card_title: existing.card_title || card_title
                });
              }
            } else {
              // Neue Handlungsoption für diese card_id
              actionOptionsByCard.set(turn.card_id, {
                question: turn.text,
                answer: answer,
                card_title: card_title
              });
            }
          }
        }
        
        // Prüfe auf neutrale Zusammenfassungen (summarize_topic)
        if (turn.action === 'summarize_topic' && turn.card_id && turn.text) {
          summariesByCard.set(turn.card_id, turn.text);
        }
      }
    });
    
    // Erstelle strukturierte Zusammenfassung: Nur sehr wichtige Themen
    const veryImportantTopics = Array.from(veryImportantCardIds).map(cardId => {
      const card = CARDS.find(c => c.id === cardId);
      const reason = veryImportantReasons.get(cardId);
      const summary = summariesByCard.get(cardId);
      return { card, reason, summary, cardId };
    }).filter(item => item.card);
    
    // 1. WICHTIGSTE THEMEN
    if (veryImportantTopics.length > 0) {
      doc.fontSize(18).text('Wichtigste Themen', { underline: true });
      doc.moveDown(1);
      
      veryImportantTopics.forEach((item, idx) => {
        doc.fontSize(14).text(`${idx + 1}. ${item.card.title}`, { continued: false });
        doc.fontSize(11).text(`   Kategorie: ${topicNames[item.card.topic] || item.card.topic}`, { indent: 20 });
        if (item.reason) {
          doc.fontSize(11).text(`   Warum wichtig: ${item.reason}`, { indent: 20 });
        }
        doc.moveDown(0.8);
      });
      doc.moveDown(1.5);
    }
    
    // 2. DISKUSSIONSPUNKTE (neutrale Zusammenfassungen)
    const topicsWithSummaries = veryImportantTopics.filter(item => item.summary);
    if (topicsWithSummaries.length > 0) {
      doc.fontSize(18).text('Diskussionspunkte', { underline: true });
      doc.moveDown(1);
      
      topicsWithSummaries.forEach((item, idx) => {
        doc.fontSize(14).text(`${idx + 1}. ${item.card.title}`, { continued: false });
        // Kürze die Zusammenfassung auf maximal 200 Zeichen für Klarheit
        const summaryText = item.summary.length > 200 ? item.summary.substring(0, 200) + '...' : item.summary;
        doc.fontSize(11).text(`   ${summaryText}`, { indent: 20 });
        doc.moveDown(0.8);
      });
      doc.moveDown(1.5);
    }
    
    // 3. HANDLUNGSMÖGLICHKEITEN (alle Handlungsoptionen in einer konsolidierten Liste)
    const allActionOptions = Array.from(actionOptionsByCard.values()).filter(opt => opt.answer);
    if (allActionOptions.length > 0) {
      doc.fontSize(18).text('Handlungsmöglichkeiten', { underline: true });
      doc.moveDown(1);
      
      // Konsolidiere alle Handlungsoptionen in eine Liste (nicht gruppiert nach Thema)
      allActionOptions.forEach((option, idx) => {
        // Zeige nur die Antwort, nicht den Titel der Frage/Thema
        const answerText = option.answer.length > 200 ? option.answer.substring(0, 200) + '...' : option.answer;
        doc.fontSize(11).text(`${idx + 1}. ${answerText}`, { indent: 10 });
        doc.moveDown(0.8);
      });
      doc.moveDown(1.5);
    }
    
    // Footer mit Hinweis
    doc.moveDown(1);
    doc.fontSize(9).text(
      'Diese Zusammenfassung wurde lokal auf Ihrem Gerät erstellt. ' +
      'Keine Daten wurden gespeichert oder übertragen.',
      { align: 'center' }
    );
    doc.moveDown(0.5);
    doc.fontSize(9).text(
      'Bei sensiblen Inhalten wird empfohlen, diese mit einer Fachperson zu besprechen.',
      { align: 'center' }
    );
    
    // Finalisiere PDF
    doc.end();
    
  } catch (err) {
    console.error('PDF Export error:', err?.message || err);
    res.status(500).json({ error: "pdf_export_failed", message: err?.message });
  }
});

// Dev Tool: Markiere alle Karten als gespielt
app.post('/api/dev/mark-all-cards-played', async (req, res) => {
  try {
    if (!CARDS || CARDS.length === 0) {
      return res.status(503).json({ 
        error: "cards_not_loaded", 
        message: "Karten wurden noch nicht geladen. Bitte warten Sie, bis der Server vollständig gestartet ist." 
      });
    }
    
    const { turns = [] } = req.body || {};
    
    const topicNames = {
      'illness_care': 'Krankheit & Behandlung',
      'practical': 'Praktische und organisatorische Fragen',
      'dignity': 'Würde & persönliche Werte',
      'feelings': 'Gefühle, Beziehungen & Verbundenheit'
    };
    
    // Erstelle Turns für alle Karten
    const allCards = CARDS.sort((a, b) => (a.order || 0) - (b.order || 0));
    const devTurns = [...turns];
    
    allCards.forEach((card, index) => {
      // Prüfe, ob Karte bereits in Turns vorhanden
      const alreadyAsked = devTurns.some(t => t.card_id === card.id);
      if (!alreadyAsked) {
        // Füge ask_card Turn hinzu
        devTurns.push({
          role: 'assistant',
          text: card.prompt,
          ts: Date.now() + index * 1000,
          card_id: card.id,
          action: 'ask_card'
        });
        // Füge User-Antwort hinzu
        devTurns.push({
          role: 'user',
          text: 'wichtig',
          ts: Date.now() + index * 1000 + 500
        });
      }
    });
    
    // Füge summarize_topic für alle Themen hinzu
    const topics = ['illness_care', 'practical', 'dignity', 'feelings'];
    topics.forEach((topic, index) => {
      devTurns.push({
        role: 'assistant',
        text: `Wir haben alle Karten zu ${topicNames[topic]} besprochen.`,
        ts: Date.now() + allCards.length * 1000 + index * 1000,
        action: 'summarize_topic',
        target_topic: topic
      });
    });
    
    console.log(`✅ Dev Tool: ${allCards.length} Karten verarbeitet, ${devTurns.length} Turns erstellt`);
    
    res.json({ 
      success: true, 
      message: `Alle ${allCards.length} Karten wurden als gespielt markiert.`,
      turns: devTurns
    });
    
  } catch (err) {
    console.error('❌ Dev tool error:', err?.message || err);
    console.error('Stack:', err?.stack);
    res.status(500).json({ 
      error: "dev_tool_failed", 
      message: err?.message || 'Unbekannter Fehler',
      details: process.env.NODE_ENV === 'development' ? err?.stack : undefined
    });
  }
});

// Test-Endpoint um zu prüfen, ob Dev-Tool-Endpoints erreichbar sind
app.get('/api/dev/test', (_req, res) => {
  res.json({ success: true, message: 'Dev-Tool-Endpoints sind erreichbar' });
});

// Endpoint für LLM-Konfiguration (für Frontend)
app.get('/api/config', (_req, res) => {
  res.json({
    llmProvider: 'openai',
    model: MODEL
  });
});

// Health Check Endpoint
app.get('/api/health', (_req, res) => {
  res.json({ 
    status: 'ok', 
    cardsLoaded: CARDS.length,
    model: MODEL,
    timestamp: new Date().toISOString()
  });
});

// 404 Handler für nicht gefundene Routen (muss nach allen Routen kommen)
app.use((req, res) => {
  console.warn(`⚠️ Route nicht gefunden: ${req.method} ${req.path}`);
  res.status(404).json({ 
    error: 'Route nicht gefunden', 
    method: req.method, 
    path: req.path,
    availableRoutes: [
      'GET /api/health',
      'POST /api/plan',
      'GET /api/cards',
      'GET /api/cards/:id',
      'GET /api/config',
      'POST /api/export/pdf',
      'POST /api/export/json',
      'POST /api/import/json'
    ]
  });
});

app.listen(process.env.PORT || 8787, () => {
  console.log(`✅ Planner API ready on http://localhost:${process.env.PORT || 8787}`);
  console.log(`📋 Verfügbare Endpoints:`);
  console.log(`   GET  /api/health (Health Check)`);
  console.log(`   POST /api/plan`);
  console.log(`   GET  /api/cards`);
  console.log(`   GET  /api/cards/:id`);
  console.log(`   GET  /api/config`);
  console.log(`   POST /api/export/pdf`);
  console.log(`   POST /api/export/json`);
  console.log(`   POST /api/import/json`);
  console.log(`   POST /api/dev/mark-all-cards-played`);
  console.log(`   GET  /api/dev/test`);
  console.log(`📊 Status: ${CARDS.length} Karten geladen, Model: ${MODEL}`);
});
