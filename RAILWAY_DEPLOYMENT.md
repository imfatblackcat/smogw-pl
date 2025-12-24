# Instrukcja Wdrożenia smogw.pl na Railway.app

## Przegląd
Railway.app to platforma PaaS (Platform as a Service), która automatyzuje deployment, scaling i zarządzanie infrastrukturą. Idealna dla prostego wdrożenia bez konieczności zarządzania serwerem.

## Wymagania Wstępne
- Konto GitHub (darmowe)
- Konto Railway.app (darmowe do rozpoczęcia, $5/miesiąc dla produkcji)
- Repozytorium Git z kodem aplikacji

---

## Krok 1: Przygotowanie Repozytorium

### 1.1 Utwórz repozytorium na GitHub (jeśli jeszcze nie masz)

```bash
cd /Users/user/airquality

# Inicjalizuj git (jeśli nie jest już zainicjalizowane)
git init
git add .
git commit -m "Initial commit for smogw.pl"

# Utwórz repo na GitHub i połącz
gh repo create smogw-pl --public --source=. --remote=origin --push
# LUB ręcznie na https://github.com/new
```

### 1.2 Dodaj pliki konfiguracyjne (już utworzone)

Sprawdź czy masz te pliki w głównym katalogu projektu:
- ✅ `railway.json` - konfiguracja Railway
- ✅ `nixpacks.toml` - instrukcje builda
- ✅ `.env.railway.example` - przykładowe zmienne środowiskowe

### 1.3 Wypchnij zmiany do GitHub

```bash
git add .
git commit -m "Add Railway.app configuration for smogw.pl"
git push origin main
```

---

## Krok 2: Konfiguracja Railway.app

### 2.1 Załóż konto Railway

1. Przejdź na https://railway.app
2. Kliknij **"Start a New Project"** lub **"Login"**
3. Zaloguj się przez GitHub
4. Autoryzuj Railway do dostępu do twoich repozytoriów

### 2.2 Utwórz nowy projekt

1. W Railway dashboard kliknij **"New Project"**
2. Wybierz **"Deploy from GitHub repo"**
3. Znajdź i wybierz repozytorium `smogw-pl` (lub jak je nazwałeś)
4. Railway automatycznie wykryje konfigurację i rozpocznie build

### 2.3 Dodaj Volume (Persistent Storage dla SQLite)

**WAŻNE:** SQLite wymaga trwałego storage!

1. W Railway dashboard, kliknij na swój service
2. Przejdź do zakładki **"Variables"**
3. Kliknij **"New Variable"**
4. W górnym menu kliknij **"+ New"** → **"Volume"**
5. Skonfiguruj volume:
   - **Mount Path**: `/app/data`
   - **Name**: `smogw-cache-db`
6. Zapisz

---

## Krok 3: Zmienne Środowiskowe

W Railway dashboard → twój service → **"Variables"** dodaj:

| Nazwa | Wartość | Opis |
|-------|---------|------|
| `ENVIRONMENT` | `production` | Tryb produkcyjny |
| `PORT` | `8000` | Port aplikacji (Railway używa $PORT) |
| `DATABASE_PATH` | `/app/data/cache.db` | Ścieżka do SQLite (w volume) |
| `AIRQUALITY_SQLITE_BUSY_TIMEOUT_MS` | `10000` | Timeout dla SQLite |
| `ALLOWED_ORIGINS` | `https://smogw.pl` | CORS - zaktualizuj po dodaniu domeny |
| `LOG_LEVEL` | `INFO` | Poziom logowania |

**Uwaga:** Po pierwszym deploy dostaniesz Railway URL (np. `smogw-production.up.railway.app`). Dodaj go do `ALLOWED_ORIGINS`:
```
ALLOWED_ORIGINS=https://smogw.pl,https://smogw-production.up.railway.app
```

---

## Krok 4: Pierwszy Deploy

Railway automatycznie:
1. ✅ Wykryje `nixpacks.toml`
2. ✅ Zainstaluje Python i Node.js
3. ✅ Zainstaluje zależności backendu (`pip install`)
4. ✅ Zbuduje frontend (`npm run build`)
5. ✅ Uruchomi aplikację (`uvicorn`)

### 4.1 Sprawdź logi

W Railway dashboard → twój service → **"Deployments"** → kliknij najnowszy deployment → **"View Logs"**

Powinieneś zobaczyć:
```
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

### 4.2 Testuj aplikację

Railway automatycznie generuje URL (np. `https://smogw-production.up.railway.app`)

Otwórz w przeglądarce:
- Aplikacja: `https://smogw-production.up.railway.app`
- API Docs: `https://smogw-production.up.railway.app/docs`
- Health Check: `https://smogw-production.up.railway.app/health`

---

## Krok 5: Dodaj Własną Domenę (smogw.pl)

### 5.1 Kup domenę smogw.pl

Możesz kupić domenę u:
- **home.pl** (~40 PLN/rok)
- **OVH** (~30 PLN/rok)
- **nazwa.pl** (~50 PLN/rok)

### 5.2 Skonfiguruj domenę w Railway

1. W Railway dashboard → twój service → **"Settings"**
2. Scrolluj do sekcji **"Domains"**
3. Kliknij **"+ Custom Domain"**
4. Wpisz: `smogw.pl`
5. Railway pokaże wymagane rekordy DNS

### 5.3 Dodaj rekordy DNS u dostawcy domeny

W panelu zarządzania domeną dodaj:

**Opcja A: CNAME (zalecane)**
```
Typ:   CNAME
Nazwa: @  (lub pozostaw puste dla root)
Cel:   <twoja-nazwa>.up.railway.app
TTL:   3600
```

**Opcja B: A Record**
```
Typ:   A
Nazwa: @
IP:    <Railway pokaze IP>
TTL:   3600
```

**Dodatkowo www:**
```
Typ:   CNAME
Nazwa: www
Cel:   smogw.pl
TTL:   3600
```

### 5.4 Zaktualizuj CORS

W Railway Variables dodaj nową domenę do `ALLOWED_ORIGINS`:
```
ALLOWED_ORIGINS=https://smogw.pl,https://www.smogw.pl,https://smogw-production.up.railway.app
```

### 5.5 Poczekaj na propagację DNS (5-30 minut)

Sprawdź status:
```bash
dig smogw.pl
# lub
nslookup smogw.pl
```

Railway automatycznie wygeneruje **darmowy SSL certyfikat** (Let's Encrypt).

---

## Krok 6: Automatyczne Deploymenty (CI/CD)

Railway automatycznie deployuje przy każdym `git push` do `main`!

### Workflow:
```bash
# 1. Wprowadź zmiany w kodzie
vim backend/app/main.py

# 2. Commit i push
git add .
git commit -m "Update API endpoint"
git push origin main

# 3. Railway automatycznie:
#    - Wykryje zmiany
#    - Zbuduje nowy obraz
#    - Uruchomi deployment (zero-downtime)
```

### Wyłącz auto-deploy (opcjonalnie):
Railway dashboard → Settings → **"Source Repo"** → Wyłącz **"Auto Deploy"**

---

## Krok 7: Monitoring i Logi

### 7.1 Logi w czasie rzeczywistym

Railway dashboard → twój service → **"Logs"**

### 7.2 Metryki

Railway dashboard → twój service → **"Metrics"**
- CPU usage
- Memory usage
- Network traffic

### 7.3 Alerty (opcjonalnie)

Railway dashboard → Settings → **"Webhooks"**
- Możesz podłączyć Discord/Slack dla alertów o downtime

---

## Krok 8: Backupy

### 8.1 Backup Volume (SQLite database)

Railway nie oferuje automatycznych backupów volume - musisz to zrobić sam.

**Opcja 1: Cron job lokalnie**
```bash
# Codziennie o 3:00 pobieraj backup przez API
# (wymaga dodania endpointu /api/backup w aplikacji)
```

**Opcja 2: Dodaj service do backupu**
Utwórz prosty Python script który:
1. Loguje się do Railway Volume
2. Kopiuje `cache.db` do zewnętrznego storage (S3, Dropbox)
3. Uruchamiany przez Railway Cron

### 8.2 Backup kodu

Kod jest bezpieczny na GitHub, więc masz automatyczne wersjonowanie.

---

## Krok 9: Skalowanie

### 9.1 Zwiększ zasoby (jeśli potrzebujesz)

Railway dashboard → Settings → **"Resources"**
- Zwiększ CPU/RAM
- Dodaj repliki (horizontal scaling)

### 9.2 Koszty

Railway cennik (2024):
- **Free tier**: $5 kredytu/miesiąc (dla testów)
- **Hobby Plan**: $5/miesiąc + usage
- **Pro Plan**: $20/miesiąc + usage

Szacunkowe koszty dla smogw.pl:
- Aplikacja (1 instance): ~$5-10/miesiąc
- Volume (5 GB): ~$1/miesiąc
- Transfer: zazwyczaj w cenie
- **Łącznie: $6-11/miesiąc** (~25-45 PLN)

---

## Aktualizacje Aplikacji

### Standardowy workflow:

```bash
# 1. Wprowadź zmiany
git pull origin main
# ... edytuj pliki ...

# 2. Testuj lokalnie
cd frontend && npm run dev &
cd backend && python -m app.main

# 3. Deploy
git add .
git commit -m "Add new feature"
git push origin main

# Railway automatycznie zdeployuje w ~2-5 minut
```

### Rollback (jeśli coś pójdzie nie tak):

1. Railway dashboard → **"Deployments"**
2. Znajdź poprzedni działający deployment
3. Kliknij **"..."** → **"Redeploy"**

---

## Rozwiązywanie Problemów

### Problem: Build się nie powiedzie

**Sprawdź logi:**
Railway → Deployments → View Logs

**Częste przyczyny:**
- Brak `requirements.txt` lub `package.json`
- Błędy w `nixpacks.toml`
- Timeout podczas instalacji zależności

**Rozwiązanie:**
```bash
# Testuj build lokalnie
nixpacks build . --name smogw-test
```

### Problem: Aplikacja nie startuje

**Sprawdź:**
1. Zmienna `PORT` ustawiona na `8000`
2. Volume zamontowany w `/app/data`
3. `DATABASE_PATH=/app/data/cache.db`

**Logi powinny pokazać dokładny błąd.**

### Problem: CORS errors

**Dodaj Railway URL do CORS:**
```
ALLOWED_ORIGINS=https://smogw.pl,https://<twoj-deployment>.up.railway.app
```

### Problem: Brak danych w bazie po restarcie

**Volume nie jest zamontowany!**
1. Utwórz Volume w Railway
2. Ustaw Mount Path: `/app/data`
3. Restart service

---

## Porównanie z VPS

| Cecha | Railway.app | VPS (home.pl) |
|-------|-------------|---------------|
| **Setup** | 15 minut | 1-2 godziny |
| **Zarządzanie** | Zero | Średnie (systemd, nginx) |
| **Auto-deploy** | ✅ Tak | Trzeba skonfigurować |
| **SSL** | ✅ Automatyczny | Certbot (manual) |
| **Monitoring** | ✅ Wbudowany | Trzeba dodać |
| **Backupy** | Manual volume backup | Full control (cron) |
| **Koszt** | $6-11/miesiąc | ~30 PLN/miesiąc |
| **Lokalizacja** | USA/EU (wybierasz region) | Polska |
| **Skalowalność** | ✅ Łatwe | Trzeba migrować |

---

## Checklist Wdrożenia Railway

- [ ] Utwórz konto GitHub
- [ ] Wypchnij kod do GitHub repo
- [ ] Załóż konto Railway.app
- [ ] Połącz Railway z GitHub
- [ ] Deploy projektu z repo
- [ ] Dodaj Volume dla SQLite
- [ ] Ustaw zmienne środowiskowe
- [ ] Przetestuj Railway URL
- [ ] Kup domenę smogw.pl
- [ ] Dodaj custom domain w Railway
- [ ] Skonfiguruj DNS u dostawcy domeny
- [ ] Zaktualizuj CORS z nową domeną
- [ ] Przetestuj https://smogw.pl
- [ ] Ustaw monitoring/alerty
- [ ] Zaplanuj strategię backupów

---

## Dodatkowe Zasoby

- Railway Documentation: https://docs.railway.app
- Railway Discord: https://discord.gg/railway
- Nixpacks Docs: https://nixpacks.com/docs

---

## Wsparcie

Jeśli masz problemy:
1. Sprawdź logi w Railway dashboard
2. Przeczytaj dokumentację: https://docs.railway.app
3. Discord community: https://discord.gg/railway
4. GitHub Issues (jeśli problem z kodem)

---

**Sukces!** 🎉 Twoja aplikacja smogw.pl działa na Railway.app z automatycznymi deploymentami, SSL i monitoringiem.
