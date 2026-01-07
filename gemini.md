# Kontekst Projektu AirQuality (app.smogw.pl)

## Technologie
- **Backend**: Python 3.10 z frameworkiem **FastAPI**.
- **Frontend**: React z **Vite** i **Tailwind CSS**.
- **Baza danych**: **SQLite** (lokalny cache danych GIOS).
- **Deployment**: **Railway.app** przy użyciu Dockerfile.

## Architektura
- Projekt typu monorepo: `backend/` i `frontend/`.
- SQLite przechowuje zcache'owane pomiary jakości powietrza dla 10 największych miast w Polsce.
- Trwałe dane w Railway przechowywane są w wolumenie podmontowanym pod `/app/data`.

## Zasady i Preferencje
- Przed wypchnięciem zmian na produkcję (git push) agent musi zawsze uzyskać wyraźną zgodę użytkownika.
- Styl kodu backendu: zgodny z PEP8.
- Styl kodu frontendu: nowoczesny React (TypeScript), komponenty funkcyjne.
