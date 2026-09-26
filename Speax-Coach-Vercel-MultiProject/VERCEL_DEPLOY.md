# SPEAX Coach — Vercel Drop

## Vercel settings
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm install`

`vercel.json` is included.

## Required environment variable
Add this in **Vercel → Project → Settings → Environment Variables**:

`GEMINI_API_KEY`

Set it for Production. Add Preview/Development too if you want preview deployments to use Gemini.

Never put the real key in source code or a `VITE_*` variable.

## Local development

```bash
cp .env.example .env.local
# edit .env.local and set GEMINI_API_KEY
npm install
npm run dev
```

## Gemini Live authentication

The Vercel function `/api/live-token` uses the server-side `GEMINI_API_KEY` to mint a short-lived, single-use Gemini Live token. The browser receives only that temporary token.

## Data flow

PDF and ZIP extraction happens in the browser. The original uploaded files are not sent to a Vercel API endpoint by the extraction pipeline. The extracted context is supplied to the Gemini Live session.
