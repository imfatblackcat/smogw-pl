"""Main FastAPI application for Air Quality monitoring."""
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path
from .api_routes import router

app = FastAPI(
    title="app.smogw.pl - Air Quality Poland API",
    description="API for air quality data visualization in 10 largest Polish cities",
    version="1.0.0"
)

# CORS middleware for frontend
# Get allowed origins from environment or use defaults
allowed_origins = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:3000"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(router)

# Serve frontend static files (after building)
# In Docker: /app/backend/dist, locally: ../frontend/dist
frontend_dist = Path(__file__).parent.parent / "dist"
if not frontend_dist.exists():
    frontend_dist = Path(__file__).parent.parent.parent / "frontend" / "dist"

if frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="assets")
    
    @app.get("/")
    async def serve_frontend():
        return FileResponse(frontend_dist / "index.html")


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "app.smogw.pl API"}


# SPA fallback for client-side routes (e.g. /ranking).
# Must be defined AFTER other routes to avoid intercepting them.
@app.get("/{full_path:path}", include_in_schema=False)
async def serve_spa(full_path: str):
    if not frontend_dist.exists():
        raise HTTPException(status_code=404, detail="Not Found")

    # Try to serve the static file if it exists (e.g. favicon), otherwise serve SPA index.
    candidate = (frontend_dist / full_path).resolve()
    try:
        candidate.relative_to(frontend_dist.resolve())
    except ValueError:
        raise HTTPException(status_code=404, detail="Not Found")

    if candidate.exists() and candidate.is_file():
        return FileResponse(candidate)

    return FileResponse(frontend_dist / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
