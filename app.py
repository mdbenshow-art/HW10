import os
import json
import sqlite3
from datetime import datetime
from pywebio import start_server
from pywebio.output import put_html, put_buttons, clear
import pywebio.session
import crawler

DB_FILE = "weather.db"

def get_db_connection():
    """Establishes connection to the SQLite3 database."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def get_latest_temperature_data():
    """Retrieves weather observations from SQLite3 and structures them for front-end."""
    if not os.path.exists(DB_FILE):
        crawler.run_crawler()
        
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM weather_observations")
        rows = cursor.fetchall()
    except sqlite3.OperationalError:
        conn.close()
        # Fallback in case table doesn't exist
        crawler.run_crawler()
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM weather_observations")
        rows = cursor.fetchall()
        
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

def main_app():
    """Main PyWebIO Web Application Entry Point."""
    # Set PyWebIO page title
    pywebio.session.set_env(title="臺灣即時氣象觀測與 Windy 視覺化地圖")
    
    # Clear the PyWebIO session
    clear()
    
    # 1. Fetch latest data from database
    weather_data = get_latest_temperature_data()
    
    # 2. Read templates/index.html
    with open("templates/index.html", "r", encoding="utf-8") as f:
        html_template = f.read()
        
    # 3. Inject CWA weather data and Windy API Key as global JS variables
    windy_key = os.environ.get("WINDY_API_KEY") or os.environ.get("NEXT_PUBLIC_WINDY_API_KEY") or ""
    
    injected_js = f"""
    <script>
        window.initialWeatherData = {json.dumps(weather_data)};
        window.windyApiKey = "{windy_key}";
    </script>
    """
    
    html_content = html_template.replace("</head>", injected_js + "</head>")
    
    # 4. Render the dashboard layout via put_html()
    put_html(html_content)
    
    # 5. Render a hidden PyWebIO button to handle asynchronous JS sync/refresh actions
    def handle_refresh():
        try:
            crawler.run_crawler()
            # Force browser reload to get fresh CWA data
            pywebio.session.run_js("window.location.reload();")
        except Exception as e:
            pywebio.session.run_js(f"alert('Refresh failed: {str(e)}');")
            
    put_buttons(['pywebio_refresh'], onclick=[handle_refresh]).style('display: none;')
    
    # Keep session alive to handle onclick callbacks
    pywebio.session.hold()

if __name__ == "__main__":
    start_server(main_app, host="127.0.0.1", port=5000, debug=True, static_dir="static")
