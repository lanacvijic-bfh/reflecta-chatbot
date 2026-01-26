# EOL Chat Frontend (Next.js)

This folder contains the Next.js frontend migrated from a plain HTML/CSS/JS prototype.

## Development

### Option 1: Start both servers together (Recommended)

From the `eol-chat-starter` directory, run:

```bash
npm run dev
```

This will start both:
- Backend (Planner API on http://localhost:8787)
- Frontend dev server (http://localhost:3000)

### Option 2: Start servers separately

If you prefer to run them in separate terminals:

1) Start the backend (Planner API on http://localhost:8787)

```bash
npm run dev:backend
```

2) Start the frontend dev server (http://localhost:3000)

```bash
npm run dev:frontend
```

**Important:** Ensure `Backend/development.env` contains a valid `OPENAI_API_KEY`.

## Notes

- UI and behavior match the original prototype (`index.html`, `styles.css`, `app.js`).
- The frontend calls `http://localhost:8787/api/plan` directly from the browser.

