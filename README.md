# Chatting App (Vercel + Render Ready)

A simple realtime chat app:
- Frontend: React + Vite + Socket.IO client (deploy to Vercel)
- Backend: Express + Socket.IO (deploy to Render)

## Project Structure

- `frontend/` - web client
- `backend/` - API + websocket server

## Local Setup

1. Install dependencies (already installed once if you used this workspace directly):

```bash
cd frontend
npm install
cd ../backend
npm install
```

2. Create env files:

- Copy `frontend/.env.example` to `frontend/.env`
- Copy `backend/.env.example` to `backend/.env`

3. Run backend:

```bash
cd backend
npm start
```

4. Run frontend:

```bash
cd frontend
npm run dev
```

Frontend default URL: `http://localhost:5173`
Backend default URL: `http://localhost:4000`

## Deploy Backend on Render

1. Push this repo to GitHub.
2. In Render, create a new Web Service from the repo.
3. Set:
   - Root Directory: `backend`
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Add env var:
   - `CLIENT_ORIGIN=https://your-vercel-domain.vercel.app`
5. Deploy and copy backend URL, for example:
   - `https://your-backend.onrender.com`

`backend/render.yaml` is included if you prefer Blueprint deploy.

## Deploy Frontend on Vercel

1. Import the same repo into Vercel.
2. Set project root directory to `frontend`.
3. Add environment variable:
   - `VITE_API_URL=https://your-backend.onrender.com`
4. Deploy.

## Notes

- The chat is realtime but in-memory only (no database/history persistence).
- If your backend is sleeping on free Render tier, first message may be delayed while waking up.
