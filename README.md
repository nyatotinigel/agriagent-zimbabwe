# AgriAgent by OGK

AgriAgent is a tomato-leaf diagnosis and management app for farmers in Zimbabwe. FastAPI serves both the existing CNN prediction route and the AgriAgent API; the React client is an installable PWA.

## Local setup

1. Install the Python dependencies into the API environment:

   ```powershell
   .\api\venv312\Scripts\python.exe -m pip install -r api/requirements.txt
   ```

2. Install and build the web client:

   ```powershell
   Push-Location frontend
   npm ci
   npm run build
   Pop-Location
   ```

3. Keep the trained model on your computer; it is intentionally excluded from GitHub. Set its path in PowerShell (replace the example with the path to your copy):

   ```powershell
   $env:TOMATO_MODEL_PATH = 'C:\path\to\mobileNetV3Large.keras'
   ```

   Optional integrations can be configured in a local `.env` copied from `.env.example`. Never commit `.env` or API keys.

4. Start the API from the repository root, bound to this PC:

   ```powershell
   .\api\venv312\Scripts\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8000
   ```

   Open [http://localhost:8000](http://localhost:8000). FastAPI serves the built PWA when `frontend/build` exists. The `127.0.0.1` binding keeps the app accessible only from your PC. For frontend development with live reload, run `npm start` from `frontend`; the CRA proxy forwards `/api` and `/predict` to port 8000.

## Configuration

- `TOMATO_MODEL_PATH`: path to the existing MobileNetV3 `.keras` model. Required; never retrained by this app.
- `DATABASE_URL`: PostgreSQL connection string. When configured, the API creates `farmers`, `diagnoses`, and `feedback` tables as needed. Image bytes are stored with the diagnosis.
- `GOOGLE_PLACES_API_KEY`: optional Google Places key. Without it, the diagnosis still works but nearby office/dealer search is unavailable.
- `GEMINI_API_KEY`: preferred optional explainer key. `GEMINI_MODEL` defaults to `gemini-2.5-flash`.
- `OPENAI_API_KEY`: optional explainer fallback when Gemini is not configured. `OPENAI_MODEL` defaults to `gpt-4o-mini`.
- `PORT`: API listen port; defaults to `8000`.
- `FRONTEND_ORIGIN`: optional additional CORS origin for a separately hosted frontend.
- `REACT_APP_API_URL`: frontend API origin only, for example `http://localhost:8000`; do not append `/predict`.

The LLM only phrases the diagnosis and supplied knowledge-base/Places data. It is instructed not to invent products, active ingredients, dosages, or cures. Viral results use management-only guidance; missing LLM credentials fall back to deterministic knowledge-base wording.

## Docker

The root `Dockerfile` builds the React bundle and installs the API into one image. The trained classifier model and `.env` secrets are excluded from the Git repository. For local Docker use, provide the model at the configured container path and pass any optional configuration securely at runtime.

## API

- `GET /api/health`
- `GET /api/locations`
- `POST /api/diagnose` with multipart fields `file`, `farmer_id`, `province`, `district`, `growth_point`, and optional `village`
- `POST /api/follow-up` with multipart fields `farmer_id`, `diagnosis_id`, and one of a question, updated location, or new `file`; requires a saved diagnosis
- `POST /api/feedback`
- Existing `POST /predict` remains the classifier contract

The app shell and static assets are cached by the service worker. Diagnosis, Places, and feedback API responses are never cached; a selected photo remains available for manual retry after a connection error.
