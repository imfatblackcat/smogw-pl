---
description: Deployment workflow - jak wdrażać zmiany w aplikacji smogw.pl
---

# Przepływ Wdrażania Zmian

## Zasady

1. **NIGDY** nie pushuj bezpośrednio na produkcję (Railway) bez zgody użytkownika
2. **ZAWSZE** pytaj o sprawdzenie lokalnie przed pushem na produkcję

## Kroki

### 1. Wdrożenie Lokalne
- Wprowadź zmiany w kodzie
- Zrestartuj backend/frontend jeśli potrzebne
- Upewnij się że aplikacja działa lokalnie

### 2. Poproś o Sprawdzenie Lokalne
- Powiadom użytkownika: "Sprawdź na http://localhost:5173 (frontend) lub http://localhost:8000 (backend)"
- **CZEKAJ** na feedback użytkownika

### 3. Po Akceptacji Lokalnej
- Użytkownik mówi "ok", "wygląda dobrze", "pushuj" itp.
- **ZAPYTAJ**: "Czy mam wdrożyć na produkcję (Railway)?"

### 4. Push na Produkcję
- Dopiero po jawnej zgodzie użytkownika
- `git add`, `git commit`, `git push origin main`
- Railway automatycznie zrobi redeploy

## Produkcja = Railway

- Produkcja to serwer Railway
- URL: https://app.smogw.pl lub https://smogw-pl-production.up.railway.app
- Redeploy ręczny: `railway redeploy --yes`
