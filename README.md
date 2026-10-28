# Agent Harness — Test Frontend

Vanilla HTML/JS test UI for the [Agent Harness](../Basic_Harness) API. No build step, no dependencies.

## Features

- OTP login (email + 6-digit code)
- SSE streaming chat with real-time tool call display
- Gated tool confirmation (approve/deny writes)
- Live log panel — collapsible right sidebar streaming structured backend logs via SSE, with level filtering, auto-scroll, expandable detail rows, and unread badge

## Setup

### 1. Start the backend

```bash
cd ../Basic_Harness
uv run uvicorn main:app --reload   # runs on :8000
```

Make sure `CORS_ORIGINS` includes the frontend origin (default: `http://localhost:3000`).

### 2. Start the frontend

```bash
python3 -m http.server 3000
```

### 3. Open

Navigate to [http://localhost:3000](http://localhost:3000).

## Configuration

The frontend connects to `http://localhost:8000` by default. To change this, edit `API_BASE` at the top of `app.js`.
