import os
import urllib.request
import json
import csv
import sqlite3
import ssl

def load_cwa_api_key():
    """Reads the CWA_API_KEY from the .env file in the current directory."""
    if os.path.exists(".env"):
        with open(".env", "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("CWA_API_KEY="):
                    return line.split("=", 1)[1].strip()
    return os.environ.get("CWA_API_KEY")

def fetch_weather_data(api_key):
    """Fetches weather data from CWA Open Data API (O-A0001-001)."""
    url = f"https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/O-A0001-001?Authorization={api_key}&downloadType=WEB&format=JSON"
    
    # Create unverified SSL context to bypass SSL issues on local Windows environment
    context = ssl._create_unverified_context()
    
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, context=context) as response:
        content = response.read().decode('utf-8')
        return json.loads(content)

def parse_weather_data(json_data):
    """Parses CWA JSON data into a clean list of dictionaries."""
    try:
        stations = json_data['cwaopendata']['dataset']['Station']
    except KeyError:
        raise ValueError("Invalid CWA JSON response structure")

    parsed_stations = []
    
    for s in stations:
        station_id = s.get('StationId', '')
        station_name = s.get('StationName', '')
        
        obs_time = s.get('ObsTime', {}).get('DateTime', '')
        
        geo = s.get('GeoInfo', {})
        county = geo.get('CountyName', '')
        town = geo.get('TownName', '')
        altitude = geo.get('StationAltitude', '0.0')
        
        # Extract Coordinates (prefer WGS84)
        lat = 0.0
        lon = 0.0
        coords = geo.get('Coordinates', [])
        for coord in coords:
            if coord.get('CoordinateName') == 'WGS84':
                lat = coord.get('StationLatitude', 0.0)
                lon = coord.get('StationLongitude', 0.0)
                break
        if lat == 0.0 and coords:
            # Fallback to first coordinate if WGS84 not found
            lat = coords[0].get('StationLatitude', 0.0)
            lon = coords[0].get('StationLongitude', 0.0)
            
        weather_el = s.get('WeatherElement', {})
        weather = weather_el.get('Weather', '')
        temp = weather_el.get('AirTemperature', '-99')
        humidity = weather_el.get('RelativeHumidity', '-99')
        wind_speed = weather_el.get('WindSpeed', '-99')
        precip = weather_el.get('Now', {}).get('Precipitation', '-99')
        
        # Daily Extremes
        daily_high = '-99'
        daily_low = '-99'
        daily_extreme = weather_el.get('DailyExtreme', {})
        if daily_extreme:
            high_info = daily_extreme.get('DailyHigh', {}).get('TemperatureInfo', {})
            if high_info:
                daily_high = high_info.get('AirTemperature', '-99')
            low_info = daily_extreme.get('DailyLow', {}).get('TemperatureInfo', {})
            if low_info:
                daily_low = low_info.get('AirTemperature', '-99')
                
        # Clean data conversions
        try:
            temp_val = float(temp)
        except ValueError:
            temp_val = -99.0
            
        try:
            humidity_val = float(humidity)
        except ValueError:
            humidity_val = -99.0
            
        try:
            wind_val = float(wind_speed)
        except ValueError:
            wind_val = -99.0
            
        try:
            precip_val = float(precip)
        except ValueError:
            precip_val = -99.0
            
        try:
            high_val = float(daily_high)
        except ValueError:
            high_val = -99.0
            
        try:
            low_val = float(daily_low)
        except ValueError:
            low_val = -99.0
            
        parsed_stations.append({
            'station_id': station_id,
            'station_name': station_name,
            'county_name': county,
            'town_name': town,
            'latitude': float(lat),
            'longitude': float(lon),
            'altitude': float(altitude),
            'obs_time': obs_time,
            'weather': weather,
            'temperature': temp_val,
            'humidity': humidity_val,
            'wind_speed': wind_val,
            'precipitation': precip_val,
            'daily_high': high_val,
            'daily_low': low_val
        })
        
    return parsed_stations

def save_to_csv(data, filename="weather_data.csv"):
    """Saves parsed weather data list to a CSV file."""
    if not data:
        print("No data to save to CSV.")
        return
        
    headers = [
        'station_id', 'station_name', 'county_name', 'town_name', 
        'latitude', 'longitude', 'altitude', 'obs_time', 'weather', 
        'temperature', 'humidity', 'wind_speed', 'precipitation', 
        'daily_high', 'daily_low'
    ]
    
    with open(filename, 'w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        for row in data:
            writer.writerow(row)
            
    print(f"Data successfully saved to {filename}")

def save_to_sqlite(data, db_filename="weather.db"):
    """Imports parsed weather data into SQLite3 database."""
    if not data:
        print("No data to save to database.")
        return
        
    conn = sqlite3.connect(db_filename)
    cursor = conn.cursor()
    
    # Create weather_observations table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS weather_observations (
            station_id TEXT PRIMARY KEY,
            station_name TEXT,
            county_name TEXT,
            town_name TEXT,
            latitude REAL,
            longitude REAL,
            altitude REAL,
            obs_time TEXT,
            weather TEXT,
            temperature REAL,
            humidity REAL,
            wind_speed REAL,
            precipitation REAL,
            daily_high REAL,
            daily_low REAL
        )
    """)
    
    # Insert or Replace records
    insert_sql = """
        INSERT OR REPLACE INTO weather_observations (
            station_id, station_name, county_name, town_name,
            latitude, longitude, altitude, obs_time, weather,
            temperature, humidity, wind_speed, precipitation,
            daily_high, daily_low
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    
    records_to_insert = [
        (
            r['station_id'], r['station_name'], r['county_name'], r['town_name'],
            r['latitude'], r['longitude'], r['altitude'], r['obs_time'], r['weather'],
            r['temperature'], r['humidity'], r['wind_speed'], r['precipitation'],
            r['daily_high'], r['daily_low']
        )
        for r in data
    ]
    
    cursor.executemany(insert_sql, records_to_insert)
    conn.commit()
    
    # Verify count
    cursor.execute("SELECT COUNT(*) FROM weather_observations")
    count = cursor.fetchone()[0]
    conn.close()
    
    print(f"Data successfully saved/replaced in SQLite database '{db_filename}'. Total records: {count}")

def run_crawler():
    """Main crawler entry point that fetches, saves to CSV, and saves to SQLite."""
    print("Loading API key...")
    api_key = load_cwa_api_key()
    if not api_key:
        raise ValueError("API Key not found. Please set CWA_API_KEY in .env file.")
        
    print("Fetching weather data from CWA API...")
    json_data = fetch_weather_data(api_key)
    
    print("Parsing weather data...")
    parsed_data = parse_weather_data(json_data)
    
    print("Saving to CSV...")
    save_to_csv(parsed_data, "weather_data.csv")
    
    print("Saving to SQLite database...")
    save_to_sqlite(parsed_data, "weather.db")
    
    print("Crawler workflow finished successfully!")
    return parsed_data

if __name__ == "__main__":
    run_crawler()
