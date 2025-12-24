"""Temporary endpoint for database upload - REMOVE AFTER USE!"""
import os
from fastapi import APIRouter, UploadFile, File, HTTPException
from pathlib import Path

router = APIRouter()

# Only enable in production with secret token
UPLOAD_TOKEN = os.getenv("DB_UPLOAD_TOKEN")
DB_PATH = os.getenv("DATABASE_PATH", "/app/data/cache.db")


@router.post("/admin/upload-db")
async def upload_database(
    file: UploadFile = File(...),
    token: str = None
):
    """Upload SQLite database. TEMPORARY ENDPOINT - REMOVE AFTER USE!"""
    
    if not UPLOAD_TOKEN:
        raise HTTPException(status_code=403, detail="Upload disabled")
    
    if token != UPLOAD_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid token")
    
    if not file.filename.endswith('.db'):
        raise HTTPException(status_code=400, detail="Only .db files allowed")
    
    # Ensure directory exists
    db_dir = Path(DB_PATH).parent
    db_dir.mkdir(parents=True, exist_ok=True)
    
    # Save uploaded file
    with open(DB_PATH, "wb") as f:
        content = await file.read()
        f.write(content)
    
    file_size = len(content) / (1024 * 1024)  # MB
    
    return {
        "status": "success",
        "message": f"Database uploaded successfully ({file_size:.2f} MB)",
        "path": DB_PATH
    }
