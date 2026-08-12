# UzGrems

UzGrems React + Node.js application prepared for GitHub and 24/7 hosting.

## Local
1. Copy `.env.example` to `.env` and fill secrets.
2. `npm run build`
3. `npm start`

The server exposes:
- `/api/health`
- `/api/auth/*`
- `/api/storage/*`
- `/api/upload`
- `/api/claude`

## Important
Do not commit real passwords, API keys, or uploaded files.
For production, use persistent storage/object storage for uploads and a persistent database.
