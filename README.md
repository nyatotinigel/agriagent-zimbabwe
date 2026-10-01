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

3. Copy `.env.example` to `.env`, then set `TOMATO_MODEL_PATH` to the supplied trained model file. The current model file is outside this repository, so the app does not copy or retrain it.

4. Start the API from the repository root:

   ```powershell
   .\api\venv312\Scripts\python.exe -m uvicorn api.main:app --host 0.0.0.0 --port 8000
   ```

   Open [http://localhost:8000](http://localhost:8000). FastAPI serves the built PWA when `frontend/build` exists. For frontend development with live reload, run `npm start` from `frontend`; the CRA proxy forwards `/api` and `/predict` to port 8000.

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

## Railway / Docker

The root `Dockerfile` builds the React bundle and installs the API into one image. Configure a Railway PostgreSQL service and set `DATABASE_URL`. Set `TOMATO_MODEL_PATH` to the model file's path inside the container or mounted volume. Do not commit model weights or API keys. Add `GOOGLE_PLACES_API_KEY` and either `GEMINI_API_KEY` or `OPENAI_API_KEY` to enable those optional integrations.

The current model artifact is not inside this workspace. A deployable Railway service therefore needs that file made available at runtime before the container can start. The exact upload/mount location depends on where you choose to store the model.

## API

- `GET /api/health`
- `GET /api/locations`
- `POST /api/diagnose` with multipart fields `file`, `farmer_id`, `province`, `district`, `growth_point`, and optional `village`
- `POST /api/follow-up` with multipart fields `farmer_id`, `diagnosis_id`, and one of a question, updated location, or new `file`; requires a saved diagnosis
- `POST /api/feedback`
- Existing `POST /predict` remains the classifier contract

The app shell and static assets are cached by the service worker. Diagnosis, Places, and feedback API responses are never cached; a selected photo remains available for manual retry after a connection error.
