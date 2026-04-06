# Architecture Deep Dive: Frontend, Backend & LLM Configuration

This document provides a comprehensive explanation of how the Reflecta application is built, covering the frontend, backend, and LLM integration.

---

## Table of Contents

1. [Overview](#overview)
2. [Frontend Architecture](#frontend-architecture)
3. [Backend Architecture](#backend-architecture)
4. [LLM Configuration](#llm-configuration)
5. [Data Flow & Communication](#data-flow--communication)
6. [State Management](#state-management)
7. [Conversation Flow & State Machine](#conversation-flow--state-machine)

---

## Overview

Reflecta is a conversational reflection platform for end-of-life planning. It uses:
- **Frontend**: Next.js 16 with React 19, TypeScript, Tailwind CSS
- **Backend**: Express.js (Node.js) with ES modules
- **LLM**: OpenAI API (standard or Azure OpenAI)
- **Communication**: RESTful API between frontend and backend

```
┌─────────────┐         HTTP/REST          ┌─────────────┐         OpenAI API          ┌─────────────┐
│   Browser   │ ◄─────────────────────────► │   Backend   │ ◄─────────────────────────► │   OpenAI    │
│  (Next.js)  │     (JSON messages)        │  (Express)  │     (Chat completions)      │   (GPT-4)   │
└─────────────┘                             └─────────────┘                             └─────────────┘
```

---

## Frontend Architecture

### Tech Stack

- **Framework**: Next.js 16 (App Router)
- **UI Library**: React 19
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **Build Tool**: Next.js built-in (Turbopack in dev mode)

### Project Structure

```
frontend/
├── src/
│   ├── app/
│   │   ├── page.tsx          # Main page (Home component)
│   │   ├── layout.tsx        # Root layout with fonts
│   │   ├── globals.css       # Global styles
│   │   └── agb/              # Terms & conditions page
│   └── components/
│       ├── Chat.tsx          # Main chat component (1200+ lines)
│       └── ConsentModal.tsx  # Data consent modal
├── public/                   # Static assets (logo, etc.)
├── package.json
├── next.config.ts
└── tsconfig.json
```

### Key Components

#### 1. `page.tsx` (Home Page)

**Purpose**: Root component that orchestrates the application

**Key Features**:
- Manages consent modal state
- Fetches LLM provider configuration from backend (`/api/config`)
- Provides import/export handlers to Chat component
- Displays header with logo and import/export buttons
- Shows footer with LLM provider info

**State Management**:
```typescript
const [llmProvider, setLlmProvider] = useState<string | null>(null);
const [importExportHandlers, setImportExportHandlers] = useState<ImportExportHandlers | null>(null);
```

**API Base URL Detection**:
- Development: Always uses `http://localhost:8787`
- Production: Uses `NEXT_PUBLIC_API_URL` env variable or same origin
- Handles client-side vs server-side rendering differences

#### 2. `Chat.tsx` (Main Chat Component)

**Purpose**: Core conversation interface (1271 lines)

**Key Responsibilities**:
- Manages conversation state (turns, phase, activeTopic)
- Handles user input (text and voice)
- Communicates with backend `/api/plan` endpoint
- Renders chat messages (bubbles)
- Manages card display (question details sidebar)
- Handles import/export functionality
- Console log interception for debugging

**Core State Types**:
```typescript
type Turn = { 
  role: "user" | "assistant"; 
  text: string; 
  ts: number; 
  card_id?: string; 
  action?: string; 
  importance?: string 
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
```

**State Management**:
- Uses `useState` for conversation, cards, input value
- Uses `useRef` for API URL caching (prevents re-initialization)
- Uses `useCallback` for memoized functions (askPlanner, addTurn, etc.)
- Conversation ref (`conversationRef`) to access latest state in callbacks

**Key Functions**:

1. **`askPlanner(conversation)`**: 
   - Sends POST request to `/api/plan` with conversation state
   - Returns next step (action, utterance, card_id, etc.)
   - Handles errors gracefully

2. **`addTurn(role, text, card_id, action)`**:
   - Adds a turn to conversation state
   - Handles array utterances (multiple bubbles)
   - Updates conversation ID if needed

3. **`onSubmit(e)`**:
   - Handles form submission
   - Adds user turn
   - Calls `askPlanner` to get next assistant response
   - Updates conversation state

4. **`loadCards()`** (useEffect):
   - Fetches cards from `/api/cards` on mount
   - Populates cards state for display

**UI Features**:
- Chat bubbles (user = right, assistant = left)
- Card details sidebar (slides in from right)
- Input form with textarea and "Weiter" button
- Voice mode (ASR/TTS) - uses Web Speech API
- Import/Export buttons (JSON)
- Debug panel (expandable, shows console logs)

**Responsive Design**:
- Animated sidebar width changes
- Auto-scroll to bottom on new messages
- Mobile-friendly layout

#### 3. `ConsentModal.tsx`

**Purpose**: GDPR-compliant data consent modal

**Features**:
- Shows on first visit
- Stores consent in localStorage
- Can be revoked from footer
- Prevents interaction until consent given

---

## Backend Architecture

### Tech Stack

- **Runtime**: Node.js 20+ (ES modules)
- **Framework**: Express.js 4.18
- **LLM SDK**: OpenAI SDK 4.20
- **Additional**: dotenv, cors, pdfkit

### Project Structure

```
Backend/
├── server.mjs              # Main server (2246 lines)
├── cards/
│   └── cards.de.json       # Question cards (400+ cards)
├── prompts/
│   └── system-prompt.txt   # LLM system prompt
├── development.env         # Environment variables (gitignored)
├── development.env.template # Template for env file
├── package.json
└── .deployment             # Optional Azure deployment metadata
```

### Server Initialization (`server.mjs`)

#### 1. **Imports & Setup**
```javascript
import express from 'express';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import cors from 'cors';
```

#### 2. **Environment Configuration**
```javascript
dotenv.config({ path: path.join(__dirname, 'development.env') });
```
- Loads environment variables from `development.env`
- Required: `OPENAI_API_KEY`, `PORT`, `MODEL`

#### 3. **Data Loading**
- **Cards**: Loads `cards.de.json` (400+ question cards)
- **System Prompt**: Loads `prompts/system-prompt.txt`
- Both loaded synchronously at startup

#### 4. **Express App Setup**
```javascript
const app = express();
app.use(cors());              // Enable CORS for frontend
app.use(express.json());      // Parse JSON bodies
```

#### 5. **OpenAI Client Initialization**
```javascript
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
  maxRetries: 2,
  timeout: 30000
});
```

**Current Implementation**: Only supports standard OpenAI
- **Note**: Azure OpenAI support mentioned in docs but not implemented in code
- Would require additional configuration (endpoint, deployment name, API version)

#### 6. **Model Configuration**
```javascript
const MODEL = process.env.MODEL || 'gpt-5.1';  // Default: gpt-5.1
```
- Uses environment variable or defaults to `gpt-5.1`
- **Note**: `gpt-5.1` doesn't exist - likely should be `gpt-4` or `gpt-4-turbo`

---

## API Endpoints

### 1. `POST /api/plan` (Main Planning Endpoint)

**Purpose**: Determines next conversation step using LLM

**Request Body**:
```typescript
{
  turns: Turn[];        // Conversation history
  activeTopic: string;  // Current topic (illness_care, practical, dignity, feelings)
  phase: 1 | 2 | 3;    // Current phase
}
```

**Response**:
```typescript
{
  action: string;              // Action type (ask_card, follow_up_card, etc.)
  utterance: string | string[]; // Message(s) to display (can be array for bubbles)
  target_topic?: string;       // Topic to switch to
  card_id?: string;            // Card/question ID
  importance?: string;         // Importance level (very_important, important, etc.)
  navigation?: string;         // Navigation instruction
  propose_action_now?: boolean;
  auto_show_card?: boolean;    // Auto-show card details
}
```

**Flow**:
1. **Early Returns** (no LLM call):
   - Empty conversation → Welcome message
   - Topic detected → First unasked card for that topic
   - Empty user input → Guidance message

2. **LLM Call**:
   - Constructs prompt with system prompt + conversation context
   - Calls `callPlanner()` → `openai.chat.completions.create()` or `openai.responses.create()`
   - Parses JSON response (with fallback parsing logic)
   - Validates response structure

3. **Response Processing**:
   - Extracts action, utterance, card_id, etc.
   - Handles multi-bubble utterances (array of strings)
   - Returns structured response

**Key Logic**:
- Tracks asked/answered cards per topic
- Detects topic from user message (keyword matching)
- Filters cards by topic and order
- Prevents duplicate questions
- Manages phase transitions (1 → 2 → 3)

### 2. `GET /api/cards`

**Purpose**: Returns all question cards

**Response**:
```json
[
  {
    "id": "illness_1",
    "topic": "illness_care",
    "order": 1,
    "title": "...",
    "prompt": "...",
    "description": "...",
    "example_actions": [...]
  },
  ...
]
```

### 3. `GET /api/cards/:id`

**Purpose**: Returns single card by ID

**Response**: Single card object

### 4. `GET /api/config`

**Purpose**: Returns backend configuration

**Response**:
```json
{
  "llmProvider": "openai"  // or "azure-openai" (if implemented)
}
```

### 5. `POST /api/export/json`

**Purpose**: Exports conversation as JSON

**Request Body**: Full conversation object

**Response**: JSON file download

### 6. `POST /api/import/json`

**Purpose**: Imports conversation from JSON

**Request Body**: JSON conversation object

**Response**: Validated conversation object

### 7. `POST /api/export/pdf`

**Purpose**: Generates PDF export of conversation

**Request Body**: Conversation data

**Response**: PDF file (using pdfkit)

### 8. `GET /api/health`

**Purpose**: Health check endpoint

**Response**:
```json
{
  "status": "ok",
  "cardsLoaded": 400,
  "model": "gpt-5.1",
  "timestamp": "2024-..."
}
```

---

## LLM Configuration

### Current Implementation

**Provider**: Standard OpenAI API

**Configuration** (in `development.env`):
```env
OPENAI_API_KEY=sk-...
PORT=8787
MODEL=gpt-4  # or gpt-4-turbo, etc.
```

**Client Setup**:
```javascript
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
  maxRetries: 2,
  timeout: 30000
});
```

### LLM Call Function (`callPlanner`)

**Purpose**: Wraps LLM API calls with timeout and format handling

**Implementation**:
```javascript
async function callPlanner(requestPayload, useNewFormat, fallbackPayload) {
  // Try new format (responses.create) for GPT-5.1
  if (useNewFormat && openai.responses?.create) {
    return await withTimeout(
      openai.responses.create(requestPayload),
      30000
    );
  }
  
  // Fallback to standard chat.completions
  return await withTimeout(
    openai.chat.completions.create(requestPayload),
    30000
  );
}
```

**Timeout Handling**: 30-second timeout using `Promise.race`

### Prompt Construction

**System Prompt**: Loaded from `prompts/system-prompt.txt`
- Defines LLM's role and behavior
- Specifies action types and rules
- Defines 3-phase conversation structure
- Contains safety guidelines (no medical advice)

**User Prompt** (constructed in `/api/plan`):
- Includes conversation history (last 6 turns)
- Includes current phase, active topic
- Includes available/unasked cards per topic
- Includes instructions for next step

**Example Prompt Structure**:
```
System: [system-prompt.txt contents]

User: 
- Phase: 1
- Active Topic: illness_care
- Asked Cards: [illness_1, illness_2]
- Unasked Cards: [illness_3, illness_4, ...]
- Last 6 Turns: [...]
- Instruction: Determine next step based on user's last message
```

### Response Parsing

**JSON Extraction**:
1. Direct JSON.parse (if valid JSON)
2. Extract JSON object from text (first `{` to last `}`)
3. Remove code fences (```json ... ```)
4. Fallback to error handling

**Response Validation**:
- Ensures required fields (action, utterance)
- Validates action types
- Handles array utterances (multiple bubbles)

### Azure OpenAI (Planned but Not Implemented)

**Documentation exists** (`AZURE_OPENAI_SETUP.md`) but code doesn't implement it yet.

**Would require**:
```javascript
const openai = new OpenAI({
  apiKey: AZURE_OPENAI_API_KEY,
  baseURL: `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}`,
  defaultQuery: { 'api-version': AZURE_OPENAI_API_VERSION },
  defaultHeaders: { 'api-key': AZURE_OPENAI_API_KEY }
});
```

---

## Data Flow & Communication

### Request Flow

```
User Types Message
       ↓
Chat.tsx: onSubmit()
       ↓
Add user turn to conversation state
       ↓
askPlanner(conversation)
       ↓
POST /api/plan
  {
    turns: [...],
    activeTopic: "...",
    phase: 1
  }
       ↓
Backend: server.mjs
  - Parse request
  - Detect topic (if new)
  - Build LLM prompt
  - Call OpenAI API
  - Parse response
       ↓
Response:
  {
    action: "ask_card",
    utterance: "...",
    card_id: "illness_3",
    ...
  }
       ↓
Chat.tsx: addTurn("assistant", utterance, card_id, action)
       ↓
Update conversation state
       ↓
Render new message bubble
```

### Card Loading Flow

```
App Start
       ↓
Chat.tsx: useEffect (on mount)
       ↓
GET /api/cards
       ↓
Backend: Returns all cards from cards.de.json
       ↓
Chat.tsx: setCards([...])
       ↓
Cards available for:
  - Display in sidebar
  - Topic filtering
  - Card lookup by ID
```

### State Synchronization

**Frontend State**:
- Conversation (turns, phase, activeTopic) stored in React state
- Sent to backend on each `/api/plan` request
- Backend doesn't store state (stateless API)

**Backend Logic**:
- Analyzes conversation history from request
- Determines next step based on:
  - Asked/unasked cards
  - Phase (1, 2, 3)
  - User's last message
  - Topic detection

---

## State Management

### Frontend State

**Conversation State** (`Chat.tsx`):
```typescript
const [conversation, setConversation] = useState<Conversation>({
  id: "...",
  phase: 1,
  activeTopic: "",
  turns: []
});
```

**Key State Updates**:
- User sends message → Add user turn → Call API → Add assistant turn
- Phase changes (1 → 2 → 3) based on backend response
- Topic changes when user selects new topic

**State Persistence**:
- Export/Import via JSON
- Stored in browser (not in backend database)
- Can be exported and imported later

### Backend State (Stateless)

**No persistent state storage**
- Cards loaded at startup (in memory)
- System prompt loaded at startup
- Conversation state passed in each request

**In-Memory State**:
- `CARDS`: Array of all cards
- `SYSTEM_PROMPT`: String content
- `MODEL`: Current model name

---

## Conversation Flow & State Machine

### 3-Phase Structure

#### **Phase 1: Alle Themen durchgehen** (Explore All Topics)

**Goal**: User sees all topics/questions (card game principle)

**States**:
- `WELCOME` → Welcome message
- `TOPIC_SELECTION` → Present topics
- `ASKING_CARD` → Ask question, ask about importance
- `FOLLOW_UP_WHY` → Follow-up for "very important"
- `EXPLAINING` → Explanation for "unsure"
- `PARKING_TOPIC` → Mark topic as not important

**Allowed Actions**:
- `present_topics`: Present topics
- `ask_card`: Ask question
- `follow_up_card`: Ask "Why is this important?"
- `park_topic`: Mark topic as not important
- `return_to_cards`: Return to topic selection

**Forbidden Actions**:
- `propose_action`: No action recommendations
- `wrap`: Not at end yet

**Importance Handling**:
- `very_important` → Auto `follow_up_card` next step
- `important` → Continue to next question
- `neutral` / `not_important` → Continue to next question
- `unsure` → Give explanation, then continue

#### **Phase 2: Diskussion der sehr wichtigen Themen** (Discuss Very Important Topics)

**Goal**: Only very important topics (discussion: true) are discussed

**States**:
- `DISCUSSING_WHY` → Discuss "why important"
- `PROPOSING_ACTIONS` → Suggest action options
- `SUMMARIZING_TOPIC` → Summarize topic
- `CONFIRMING_SUMMARY` → Confirm summary

**Allowed Actions**:
- `follow_up_card`: Start discussion "Why is this important?"
- `propose_action`: Suggest action options
- `summarize_topic`: Summarize topic

**Flow**:
1. Discuss "why important" (`follow_up_card`)
2. Suggest actions (`propose_action`)
3. Summarize topic (`summarize_topic`)
4. Confirm summary
5. Move to next very important topic

#### **Phase 3: Spielende** (Wrap-up)

**Goal**: Create comprehensive summary

**States**:
- `WRAPPING_UP` → Final summary

**Actions**:
- `wrap`: Comprehensive summary
  - All very important topics + reasons
  - All action options
  - Export options (JSON, PDF)

### Phase Transitions

**Phase 1 → Phase 2**:
- Trigger: All cards asked OR all topics completed
- Condition: No unasked cards remaining

**Phase 2 → Phase 3**:
- Trigger: All very important topics discussed
- Condition: All discussion: true topics completed

### Action Types

| Action | Phase 1 | Phase 2 | Phase 3 | Description |
|--------|---------|---------|---------|-------------|
| `present_topics` | ✅ | ❌ | ❌ | Present topics |
| `ask_card` | ✅ | ❌ | ❌ | Ask question, ask about importance |
| `follow_up_card` | ✅ | ✅ | ❌ | "Why is this important?" |
| `propose_action` | ❌ | ✅ | ❌ | Suggest action options |
| `summarize_topic` | ❌ | ✅ | ❌ | Summarize topic |
| `return_to_cards` | ✅ | ❌ | ❌ | Return to topic selection |
| `park_topic` | ✅ | ❌ | ❌ | Mark topic as not important |
| `wrap` | ❌ | ❌ | ✅ | Final summary |

### Topics

- **`illness_care`**: Krankheit & Behandlung (Illness & Treatment)
- **`practical`**: Praktisches & Organisatorisches (Practical & Organizational)
- **`dignity`**: Würde & Werte (Dignity & Values)
- **`feelings`**: Gefühle & Beziehungen (Feelings & Relationships)

---

## Key Design Decisions

### 1. **Stateless Backend**
- No database, no session storage
- Conversation state sent with each request
- Enables horizontal scaling
- Trade-off: Larger request payloads

### 2. **Client-Side State Management**
- React state for conversation
- Export/import for persistence
- No backend persistence
- Trade-off: Data lost if browser cleared

### 3. **LLM-Driven Planning**
- Every step planned by LLM
- System prompt defines behavior
- Flexible but depends on LLM quality
- Trade-off: Less predictable than hard-coded logic

### 4. **Multi-Bubble Utterances**
- Assistant messages can be arrays
- Improves readability
- Each bubble rendered separately
- Trade-off: More complex rendering logic

### 5. **Topic Detection**
- Keyword-based detection in backend
- Falls back to LLM if needed
- Speeds up topic selection
- Trade-off: May miss nuanced selections

---

## Environment Configuration

### Frontend (`frontend/`)

**Development**: No `.env` file needed (uses `localhost:8787`)

**Production**: 
```env
NEXT_PUBLIC_API_URL=https://api.example.com
```

### Backend (`Backend/`)

**Required** (`development.env`):
```env
OPENAI_API_KEY=sk-...
PORT=8787
MODEL=gpt-4
```

**Optional** (for Azure OpenAI - not yet implemented):
```env
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://...
AZURE_OPENAI_DEPLOYMENT=gpt-4
AZURE_OPENAI_API_VERSION=2024-02-15-preview
```

---

## Development Workflow

### Starting the Application

1. **Backend**:
   ```bash
   cd Backend
   npm install
   # Create development.env with OPENAI_API_KEY
   node server.mjs
   # Runs on http://localhost:8787
   ```

2. **Frontend**:
   ```bash
   cd frontend
   npm install
   npm run dev
   # Runs on http://localhost:3000
   ```

### Testing the Flow

1. Open `http://localhost:3000`
2. Accept consent modal
3. Welcome message appears (from backend)
4. Type topic name (e.g., "Krankheit")
5. First question appears
6. Answer with importance level
7. Continue through conversation
8. Export conversation as JSON/PDF

---

## Summary

This architecture provides:
- ✅ **Separation of Concerns**: Frontend (UI), Backend (LLM logic), LLM (planning)
- ✅ **Scalability**: Stateless backend can scale horizontally
- ✅ **Flexibility**: LLM-driven planning allows natural conversations
- ✅ **Maintainability**: Clear structure, TypeScript for type safety
- ✅ **User Experience**: Smooth chat interface with card details sidebar

**Key Strengths**:
- Clean API design
- Comprehensive state machine
- Rich conversation capabilities
- Export/import functionality

**Potential Improvements**:
- Implement Azure OpenAI support
- Add backend state persistence (optional)
- Add authentication (for multi-user)
- Add analytics/logging
- Optimize LLM prompt length (currently sends full context)

