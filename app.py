import os
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import crawler

DB_FILE = "weather.db"

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handles startup and shutdown lifecycle events."""
    # Run initial crawler if database is missing
    if not os.path.exists(DB_FILE):
        print("Database not found, running crawler initially...")
        try:
            crawler.run_crawler()
        except Exception as e:
            print("Initial crawling error during startup:", e)
    yield

app = FastAPI(lifespan=lifespan)

# Mount Static Files (CSS, JS)
app.mount("/static", StaticFiles(directory="static"), name="static")

def get_db_connection():
    """Establishes connection to the SQLite3 database."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

@app.get("/", response_class=FileResponse)
async def get_dashboard():
    """Serves the main dashboard page."""
    return FileResponse("templates/index.html")

@app.get("/api/temperature/latest")
async def get_latest_temperature():
    """GET /api/temperature/latest - Returns all latest station observations in normalized format."""
    if not os.path.exists(DB_FILE):
        try:
            crawler.run_crawler()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to run crawler: {str(e)}")
            
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT * FROM weather_observations")
        rows = cursor.fetchall()
    except sqlite3.OperationalError as e:
        conn.close()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
        
    stations = []
    latest_obs_time = None
    
    for row in rows:
        r = dict(row)
        # Skip stations with invalid temperature
        if r['temperature'] is None or r['temperature'] <= -90:
            continue
            
        # Keep track of the most recent observation time
        obs_time_str = r['obs_time']
        if obs_time_str:
            if not latest_obs_time or obs_time_str > latest_obs_time:
                latest_obs_time = obs_time_str
                
        stations.append({
            "station_id": r['station_id'],
            "station_name": r['station_name'],
            "county": r['county_name'],
            "town": r['town_name'],
            "lat": r['latitude'],
            "lon": r['longitude'],
            "altitude_m": r['altitude'],
            "observed_at": r['obs_time'],
            "temperature_c": r['temperature'],
            "humidity_percent": r['humidity'] if r['humidity'] >= 0 else None,
            "wind_speed_mps": r['wind_speed'] if r['wind_speed'] >= 0 else None,
            "precipitation_mm": r['precipitation'] if r['precipitation'] >= 0 else 0.0,
            "weather": r['weather']
        })
        
    conn.close()
    
    # Format the updated_at time
    updated_at_str = latest_obs_time if latest_obs_time else datetime.now().isoformat()
    
    return {
        "source": "CWA",
        "updated_at": updated_at_str,
        "count": len(stations),
        "stations": stations
    }

@app.get("/api/health")
async def get_health():
    """GET /api/health - Returns CWA cache and database status."""
    db_exists = os.path.exists(DB_FILE)
    latest_time = None
    cache_status = "stale"
    
    if db_exists:
        conn = get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT MAX(obs_time) FROM weather_observations")
            latest_time = cursor.fetchone()[0]
            cache_status = "fresh" if latest_time else "empty"
        except Exception:
            pass
        conn.close()
        
    return {
        "status": "ok" if db_exists else "initializing",
        "cwa_cache_status": cache_status,
        "latest_cwa_time": latest_time
    }

@app.get("/api/config")
async def get_config():
    """Returns frontend public configuration (like Windy API Key)."""
    # Look for WINDY_API_KEY in .env or environment
    windy_key = os.environ.get("WINDY_API_KEY") or os.environ.get("NEXT_PUBLIC_WINDY_API_KEY") or ""
    return {
        "windy_api_key": windy_key
    }

@app.post("/api/refresh")
async def refresh_weather():
    """API endpoint to trigger crawler refresh."""
    try:
        crawler.run_crawler()
        return await get_latest_temperature()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=5000, reload=True)
