# Autonomous Warranty Intelligence System

A local-first, zero-cost warranty tracking platform with a fully autonomous,
rule-based AI reasoning agent. No paid APIs, no cloud LLMs — every
intelligence decision (OCR parsing, classification, fraud detection, risk
scoring, claim eligibility, conversational reasoning) runs as real,
deterministic JavaScript.

## Structure

```
Autonomous-Warranty-Intelligence-System/
├── frontend/          Vite + React app (landing, auth, dashboard, AI agent UI)
├── backend/           Smart Warranty Intelligence Engine (Phase 1 + 1.5)
├── docs/              Additional documentation
└── architecture/      Architecture notes and diagrams
```

## Backend — `backend/`

Pure Node.js ESM modules, zero external AI dependency.

- `ocr/` — Tesseract.js integration (real OCR pipeline)
- `parsers/` — Invoice field extraction, warranty duration detection
- `classifier/` — Product category + brand classification
- `rules-engine/` — Warranty claim eligibility decision engine + rules DB
- `ai-engine/` — Risk scoring, fraud detection, advisor engine, pipeline orchestrator
- `ai-engine/assistant/` — Autonomous Warranty Intelligence Agent (NLU, knowledge graph,
  multi-stage reasoning, memory, failure prediction, autonomous monitoring,
  external knowledge retrieval)
- `tests/` — 186 passing tests (`run-all.js` for Phase 1, `run-agent-tests.js` for Phase 1.5)

```bash
cd backend
npm install
npm test
```

## Frontend — `frontend/`

Vite + React 18, Tailwind, Firebase Auth/Firestore/Storage, GSAP, OGL.

```bash
cd frontend
npm install
cp .env.example .env.local   # fill in Firebase config
npm run dev
```

The frontend imports the backend engine directly from a local path — see
`frontend/src/lib/warrantyEngine.js`. Before building the frontend, copy the
backend engine into `frontend/src/lib/engine/` (excluding `tests/` and
`package.json`), or configure a workspace/symlink so the import resolves:

```bash
cp -r backend/* frontend/src/lib/engine/
rm -rf frontend/src/lib/engine/tests frontend/src/lib/engine/package.json
```

## Deployment (free tier only)

- Firebase Hosting — static frontend
- Firebase Auth — email/password + Google sign-in
- Firestore — per-user product data, locked by security rules in `frontend/firestore.rules`
- Firebase Storage — invoice uploads, 3MB hard limit enforced in `frontend/storage.rules`
- Cloud Functions — server-side upload validation mirror (`frontend/functions/`)

```bash
cd frontend
npm run build
firebase deploy
```

## Security notes

- 3MB file upload limit enforced at 5 independent layers: dropzone validator,
  magic-byte signature check, OCR pipeline guard, pre-upload guard, and
  Firebase Storage rules — plus a Cloud Function with streaming 413 enforcement.
- Firestore/Storage rules enforce strict per-user data isolation.
- No invoice or product data is ever sent to a third-party AI API.
