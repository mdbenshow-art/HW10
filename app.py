import os
import json
import sqlite3
from pywebio import start_server
from pywebio.output import put_html
from pywebio.session import set_env, run_js
from pywebio.pin import put_input, pin_wait_change
import crawler

DB_FILE = "weather.db"

def query_latest_stations():
    """Queries all observations from the SQLite database."""
    if not os.path.exists(DB_FILE):
        try:
            crawler.run_crawler()
        except Exception as e:
            print("Initial crawler execution failed:", e)
            
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    stations = []
    try:
        cursor.execute("SELECT * FROM weather_observations")
        rows = cursor.fetchall()
        for row in rows:
            r = dict(row)
            if r['temperature'] is None or r['temperature'] <= -90:
                continue
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
    except sqlite3.OperationalError as e:
        print("Database query failed:", e)
    finally:
        conn.close()
        
    return stations

def main_app():
    """PyWebIO Main Web Application Entry Point."""
    # Set PyWebIO environment settings
    set_env(title="臺灣即時氣象觀測與 Windy 視覺化地圖 (PyWebIO)", auto_scroll_to_bottom=False)
    
    # Load templates/index.html
    html_path = os.path.join("templates", "index.html")
    if os.path.exists(html_path):
        with open(html_path, "r", encoding="utf-8") as f:
            html_content = f.read()
    else:
        html_content = "<h2>Error: templates/index.html not found.</h2>"
        
    # Render the main dashboard HTML content
    put_html(html_content)
    
    # Render hidden PyWebIO input pin to receive refresh events from JavaScript
    put_html('<div style="display:none;">')
    put_input('refresh_trigger', value='')
    put_html('</div>')
    
    # Get latest weather data from database
    stations = query_latest_stations()
    
    # Push initial CWA station list into browser Leaflet Map
    run_js(f"window.updateCwaMapData({json.dumps(stations)});")
    
    # Event loop listening for client-side refresh triggers
    while True:
        pin_wait_change('refresh_trigger')
        try:
            # Sync fresh CWA data in Python
            crawler.run_crawler()
            # Query updated records
            new_stations = query_latest_stations()
            # Push updated data to Leaflet in the browser
            run_js(f"window.updateCwaMapData({json.dumps(new_stations)});")
            run_js("showToast('同步成功，已寫入 SQLite3 資料庫與 CSV 檔案');")
        except Exception as e:
            run_js(f"showToast('資料同步失敗: {str(e)}', 'error');")
        finally:
            # Tell JavaScript to disable loading states
            run_js("toggleLoading(false);")

if __name__ == "__main__":
    print("Starting PyWebIO weather server on http://127.0.0.1:5000...")
    # Start PyWebIO standalone server serving './static' as static dir
    start_server(main_app, port=5000, static_dir='static', debug=True)
