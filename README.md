# Teacher Seating Planner (vertical slice)

A local-first desktop app for teachers to manage classroom seating. Electron + React + TypeScript + SQLite, with an OpenAI-powered natural-language seating assistant.

## Core loop

Create class → add students → generate seating → ask the AI for a change ("Move Alice to the front") → review the proposed diff → **Apply** or **Reject** → restart the app → data persists.

The app is fully functional without the AI. The LLM only translates the teacher's request into a small list of seating operations; it never writes to the database.

## Run

```bash
npm install        # also rebuilds better-sqlite3 for Electron
npm run dev        # dev mode with HMR
npm run build && npm run preview   # built app
```

Set your OpenAI API key in the app header (stored via Electron `safeStorage`, i.e. the macOS Keychain). Without a key, everything except the AI panel works.

## Tests

```bash
npm test       # vitest unit/integration tests (run under Electron's Node so the native SQLite module matches)
npm run smoke  # drives the built app through the full workflow, including a restart
npm run typecheck
```

## Architecture

- `src/main` — privileged: SQLite (`better-sqlite3`), LLM calls, secure API-key storage, IPC handlers.
- `src/preload` — a small fixed-channel bridge. The renderer gets no Node access.
- `src/renderer` — React UI: seating grid, click-to-move/swap, AI panel with proposal review.
- `src/shared` — pure seating engine (`generateSeating`, `applyOperations`, `validateArrangement`). Used by both processes, so manual moves and AI proposals pass through exactly the same validation.

### Data model

`classes`, `students`, `class_students` (composite PK), `seats` (unique per class/row/col, composite FK ensuring a seated student belongs to the class). Student ID is the identity; names are editable display data (duplicates allowed). All seating writes go through a transaction that also bumps `classes.seating_version`.

### How the AI stays safe

1. The teacher's request is scrubbed: student names are replaced with opaque IDs before anything leaves the machine (tested).
2. The LLM must answer with structured JSON (OpenAI strict `json_schema` output).
3. The response is validated locally (schema shape, known op types, IDs in the class roster, in-bounds targets, op-count limit).
4. Operations are applied to a *copy* of the seating; failures leave the current arrangement untouched.
5. The result is only a proposal — the teacher sees the before → after diff and must Apply or Reject.
6. Apply saves with the seating version the proposal was based on; if the arrangement changed in the meantime (or the teacher switched class), the apply is rejected as stale.

### Error handling

Missing/invalid API key, network failure, timeout, malformed responses, unknown students, and impossible operations all surface as a readable status message. The database is never modified by a failed request.

## Decisions & limitations

- **MOVE_STUDENT onto an occupied seat performs a swap** (the useful interpretation of "move X to the front" when the front row is full).
- **Name scrubbing is exact (case-insensitive)** on full names. A request mentioning only part of a name ("Alice" when the student is "Alice B") won't resolve; the AI is told to return an empty operation list, which shows up as "No changes proposed".
- **One grid per class**, no saved layouts, no import — deliberately deferred.
- Unseated students (added after generation, or when the grid is full) are shown as chips and can be placed into any empty seat.
- `npm test` must run under Electron's Node (see package.json) because `better-sqlite3` is compiled for Electron's ABI; a plain `vitest run` would fail to load the native module.
