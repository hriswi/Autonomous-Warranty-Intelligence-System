# Autonomous Warranty Intelligence System

A local-first, zero-cost warranty tracking platform with a fully autonomous,
rule-based AI reasoning agent. No paid APIs, no cloud LLMs, no backend server —
every intelligence decision (OCR parsing, classification, fraud detection, risk
scoring, claim eligibility, conversational reasoning) runs in the browser as
deterministic JavaScript.

## Structure

```
Autonomous-Warranty-Intelligence-System/
├── frontend/          Vite + React app (UI + local AI engine)
│   └── src/lib/engine/  Browser-side intelligence modules
└── backend/           Engine source + test harness (no server)
```

## Architecture

```
Vercel Frontend
    ↓
React App
    ↓
Browser-side Local AI Engine (Tesseract OCR + rule engines)
    ↓
Firebase Authentication
    ↓
Firestore Database
```

No Express, Render, Cloud Functions, or HTTP API layer.

## Frontend — `frontend/`

Vite + React 18, Tailwind, Firebase Auth/Firestore/Storage, GSAP, OGL.

```bash
cd frontend
npm install
cp .env.example .env.local   # fill in Firebase config
npm run dev
npm run build
```

The intelligence engine lives at `frontend/src/lib/engine/` and is re-exported
via `frontend/src/lib/warrantyEngine.js`.

## Backend tests — `backend/`

Pure Node.js ESM modules for running the engine test suite locally:

```bash
cd backend
npm install
npm test
```

## Deployment

- **Vercel** — static frontend (`frontend/vercel.json`)
- **Firebase Auth** — email/password + Google sign-in
- **Firestore** — per-user product data (`frontend/firestore.rules`)
- **Firebase Storage** — invoice file uploads (`frontend/storage.rules`)

```bash
cd frontend
npm run build
firebase deploy --only hosting,firestore,storage
```

## Security notes

- 3MB file upload limit enforced at dropzone validator, magic-byte check,
  OCR pipeline guard, pre-upload guard, and Firebase Storage rules.
- Firestore/Storage rules enforce strict per-user data isolation.
- No invoice or product data is sent to third-party AI APIs.
