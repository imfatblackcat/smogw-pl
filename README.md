# smogw.pl - Jakość Powietrza w Polsce

Aplikacja webowa do wizualizacji danych o jakości powietrza w 10 największych miastach Polski za ostatnie 5 lat.

**Domena produkcyjna:** https://smogw.pl

## Funkcjonalności

✅ Wybór wielu miast jednocześnie (Warszawa, Kraków, Łódź, Wrocław, Poznań, Gdańsk, Szczecin, Bydgoszcz, Lublin, Katowice)
✅ Wybór typu zanieczyszczenia (PM10, PM2.5, NO2, SO2, O3, CO, C6H6)
✅ Wybór zakresu dat (do 5 lat wstecz)
✅ Agregacja danych (godzinowa, dzienna, tygodniowa, miesięczna)
✅ Automatyczne cachowanie danych w SQLite
✅ Interaktywne wykresy z Recharts
✅ Dane z oficjalnego API GIOŚ (Główny Inspektorat Ochrony Środowiska)

## Architektura

- **Backend**: FastAPI + Python
- **Frontend**: React + Vite + Recharts
- **Cache**: SQLite
- **API**: GIOŚ API v1 (api.gios.gov.pl)

## Wymagania

- Python 3.8+
- Node.js 16+
- npm lub yarn

## Instalacja i Uruchomienie

### 1. Backend

```bash
# Zainstaluj zależności Python
cd backend
pip install -r requirements.txt

# Uruchom serwer FastAPI
python -m app.main
# lub
uvicorn app.main:app --reload
```

Backend będzie dostępny na: http://localhost:8000
Dokumentacja API: http://localhost:8000/docs

### 2. Frontend

```bash
# Zainstaluj zależności Node.js
cd frontend
npm install

# Uruchom serwer deweloperski
npm run dev
```

Frontend będzie dostępny na: http://localhost:5173

### 3. Build produkcyjny

```bash
# Build frontendu
cd frontend
npm run build

# Uruchom backend (będzie serwował frontend)
cd ../backend
python -m app.main
```

Aplikacja będzie dostępna na: http://localhost:8000

## Użycie

1. **Wybierz miasta** - zaznacz checkboxy dla miast, które chcesz porównać
2. **Wybierz zanieczyszczenie** - PM10, PM2.5, NO2, SO2, O3, CO lub C6H6
3. **Ustaw zakres dat** - możesz wybrać ręcznie lub użyć presetów (ostatni miesiąc/rok/5 lat)
4. **Wybierz agregację** - jak dane mają być grupowane
5. **Kliknij "Pobierz dane"** - pierwsza pobieranie może zająć kilka minut

## Struktura projektu

```
airquality/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # Główna aplikacja FastAPI
│   │   ├── api_routes.py        # Endpointy API
│   │   ├── cache_manager.py     # Zarządzanie cache SQLite
│   │   ├── data_fetcher.py      # Pobieranie danych z GIOŚ API
│   │   ├── data_processor.py    # Przetwarzanie i agregacja
│   │   └── models.py            # Modele Pydantic
│   ├── data/
│   │   └── cache.db             # Baza danych SQLite (tworzona automatycznie)
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   └── AirQualityChart.jsx
│   │   ├── services/
│   │   │   └── api.js
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
└── README.md
```

## API Endpoints

- `GET /api/cities` - Lista miast z liczbą stacji
- `GET /api/stations?city={city}` - Stacje dla danego miasta
- `GET /api/pollutants` - Lista dostępnych zanieczyszczeń
- `GET /api/data` - Pobierz dane o jakości powietrza
  - Parametry: `cities`, `pollutant`, `start_date`, `end_date`, `aggregation`
- `GET /health` - Health check

## Cache

Dane są automatycznie cachowane w SQLite (`backend/data/cache.db`):
- **Stacje** - pobierane raz przy starcie
- **Sensory** - pobierane raz dla każdej stacji
- **Pomiary** - pobierane na żądanie i zapisywane na zawsze

Pierwsze zapytanie o dane historyczne może trwać kilka minut, kolejne są błyskawiczne.

## Rozwiązywanie problemów

### Backend nie startuje
```bash
# Sprawdź czy masz zainstalowane wszystkie zależności
pip install -r backend/requirements.txt

# Sprawdź logi
python -m app.main
```

### Frontend nie łączy się z backendem
- Sprawdź czy backend działa na porcie 8000
- Sprawdź CORS w `backend/app/main.py`

### Brak danych dla miasta
- Nie wszystkie miasta mają stacje pomiarowe
- API GIOŚ może nie mieć danych historycznych dla starszych okresów

## Źródło danych

Dane pochodzą z oficjalnego API Głównego Inspektoratu Ochrony Środowiska (GIOŚ):
https://api.gios.gov.pl/pjp-api/swagger-ui/

## Wdrożenie Produkcyjne

Przeczytaj instrukcję wdrożenia:
- **Railway.app (PaaS):** [RAILWAY_DEPLOYMENT.md](RAILWAY_DEPLOYMENT.md)
- **VPS (pełna kontrola):** Zobacz plan wdrożenia w katalogu projektu

## Licencja

MIT

## Współtworzenie

Co-Authored-By: Warp <agent@warp.dev>
