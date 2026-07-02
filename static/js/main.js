// Temperature Color Scale & Descriptions
const TEMP_RANGES = [
    { max: 10, color: '#2b6cb0', label: '< 10°C (寒冷)' },
    { min: 10, max: 15, color: '#3182ce', label: '10–15°C (涼爽)' },
    { min: 15, max: 20, color: '#38a169', label: '15–20°C (溫和)' },
    { min: 20, max: 25, color: '#ecc94b', label: '20–25°C (舒適)' },
    { min: 25, max: 30, color: '#ed8936', label: '25–30°C (溫暖)' },
    { min: 30, max: 35, color: '#e53e3e', label: '30–35°C (炎熱)' },
    { min: 35, color: '#9b2c2c', label: '> 35°C (酷熱)' }
];

function colorByTemperature(temp) {
    if (temp < 10) return '#2b6cb0';
    if (temp < 15) return '#3182ce';
    if (temp < 20) return '#38a169';
    if (temp < 25) return '#ecc94b';
    if (temp < 30) return '#ed8936';
    if (temp < 35) return '#e53e3e';
    return '#9b2c2c';
}

// Global Variables
let map = null;
let windyStore = null;
let allStations = [];
let stationMarkers = [];
let stationLabels = [];
let mapLayerGroup = null;
let mapLabelGroup = null;
let currentBaseTileLayer = null;
let rainRadarLayer = null;

// Initial Entry
document.addEventListener('DOMContentLoaded', () => {
    initLegend();
    initCollapsibleTable();
    loadDashboard();
    
    // Auto refresh every 5 minutes
    setInterval(loadDashboard, 300000);
});

// Build Legend UI
function initLegend() {
    const legendContainer = document.getElementById('temp-legend');
    legendContainer.innerHTML = '';
    TEMP_RANGES.forEach(range => {
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = `
            <div class="legend-color" style="background-color: ${range.color};"></div>
            <span>${range.label}</span>
        `;
        legendContainer.appendChild(item);
    });
}

// Initialize Collapsible Table UI
function initCollapsibleTable() {
    const header = document.getElementById('table-toggle-btn');
    const body = document.getElementById('table-body-container');
    const arrow = document.getElementById('table-arrow');
    
    header.addEventListener('click', () => {
        const isCollapsed = body.classList.contains('collapsed');
        if (isCollapsed) {
            body.classList.remove('collapsed');
            arrow.style.transform = 'rotate(180deg)';
        } else {
            body.classList.add('collapsed');
            arrow.style.transform = 'rotate(0deg)';
        }
    });
}

// Main Ingestion Workflow
async function loadDashboard() {
    toggleLoading(true, "正在獲取氣象署即時觀測數據...");
    
    try {
        // Fetch API key and observations in parallel
        const [configRes, weatherRes] = await Promise.all([
            fetch('/api/config'),
            fetch('/api/temperature/latest')
        ]);
        
        const config = await configRes.json();
        const weather = await weatherRes.json();
        
        if (weather.source) {
            allStations = weather.stations;
            
            // Populate County dropdown filters
            populateCountyFilter(allStations);
            
            // Render side tables (Top 5 Hottest / Coldest)
            renderExtremes(allStations);
            
            // Render Bottom Table rows
            renderTable(allStations);
            
            // Render Map View
            initOrUpdateMap(config.windy_api_key, allStations);
            
            // Status bar updates
            document.getElementById('last-update-time').innerText = `資料時間：${formatTime(weather.updated_at)}`;
            document.getElementById('cache-status').innerText = `系統狀態：觀測中 (${allStations.length} 站)`;
        }
    } catch (err) {
        console.error("Dashboard ingestion failed:", err);
        showToast("資料讀取失敗，使用快取或重新連線", "error");
    } finally {
        toggleLoading(false);
    }
}

// Populating County Dropdown
function populateCountyFilter(stations) {
    const select = document.getElementById('county-select');
    // Keep first option
    const firstOption = select.options[0];
    select.innerHTML = '';
    select.appendChild(firstOption);
    
    const counties = [...new Set(stations.map(s => s.county).filter(Boolean))];
    counties.sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    
    counties.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.innerText = c;
        select.appendChild(opt);
    });
}

// Render Top 5 extremes Lists
function renderExtremes(stations) {
    const hottestList = document.getElementById('hottest-list');
    const coldestList = document.getElementById('coldest-list');
    
    hottestList.innerHTML = '';
    coldestList.innerHTML = '';
    
    // Sort stations
    const sorted = [...stations].sort((a, b) => b.temperature_c - a.temperature_c);
    
    // Top 5 hottest
    const hottest = sorted.slice(0, 5);
    hottest.forEach(s => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div>
                <span class="ext-station">${s.station_name}</span>
                <span class="ext-county">${s.county || ''}</span>
            </div>
            <span class="ext-temp" style="color: #ef4444;">${s.temperature_c.toFixed(1)}°C</span>
        `;
        hottestList.appendChild(li);
    });
    
    // Top 5 coldest
    const coldest = [...sorted].reverse().slice(0, 5);
    coldest.forEach(s => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div>
                <span class="ext-station">${s.station_name}</span>
                <span class="ext-county">${s.county || ''}</span>
            </div>
            <span class="ext-temp" style="color: #3b82f6;">${s.temperature_c.toFixed(1)}°C</span>
        `;
        coldestList.appendChild(li);
    });
}

// Render Bottom Table rows
function renderTable(stations) {
    const container = document.getElementById('station-rows-container');
    container.innerHTML = '';
    
    document.getElementById('total-stations-count').innerText = stations.length;
    
    stations.forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-family: var(--font-outfit); font-weight: 550;">${s.station_id}</td>
            <td style="font-weight: 700;">${s.station_name}</td>
            <td>${s.county || '-'}</td>
            <td>${s.town || '-'}</td>
            <td style="font-family: var(--font-outfit);">${s.altitude_m !== null ? s.altitude_m + 'm' : '-'}</td>
            <td style="font-family: var(--font-outfit); font-weight: 800; color: ${colorByTemperature(s.temperature_c)}">${s.temperature_c.toFixed(1)} °C</td>
            <td style="font-family: var(--font-outfit);">${s.humidity_percent !== null ? s.humidity_percent + '%' : '-'}</td>
            <td style="font-family: var(--font-outfit);">${s.wind_speed_mps !== null ? s.wind_speed_mps + ' m/s' : '-'}</td>
            <td style="font-family: var(--font-outfit); color: #3b82f6;">${s.precipitation_mm !== null ? s.precipitation_mm + ' mm' : '0.0'}</td>
            <td style="font-family: var(--font-outfit); font-size: 0.8rem; color: var(--text-muted);">${formatTime(s.observed_at)}</td>
        `;
        container.appendChild(tr);
    });
}

// Map Initialization & Updates (Windy Map with Leaflet Fallback)
function initOrUpdateMap(windyKey, stations) {
    if (map) {
        // Map is already initialized, just redraw CWA markers
        drawCwaOverlay();
        return;
    }
    
    const mapBadge = document.getElementById('map-status-text');
    
    // Check if Windy script loaded and key exists
    if (typeof windyInit !== 'undefined' && windyKey && windyKey.trim() !== '' && windyKey !== 'your_windy_api_key_here') {
        const options = {
            key: windyKey,
            lat: 23.7,
            lon: 121.0,
            zoom: 7,
            overlay: "wind",
            verbose: false
        };
        
        mapBadge.innerHTML = `<i class="fa-solid fa-wind fa-spin"></i> 載入 Windy 氣象地圖中...`;
        
        windyInit(options, windyAPI => {
            map = windyAPI.map;
            windyStore = windyAPI.store;
            
            // Mount Leaflet layer groups on Windy Leaflet instance
            mapLayerGroup = L.layerGroup().addTo(map);
            mapLabelGroup = L.layerGroup().addTo(map);
            
            mapBadge.innerHTML = `<i class="fa-solid fa-earth-asia"></i> 觀測地圖：Windy Map API`;
            
            setupMapListeners();
            drawCwaOverlay();
        });
    } else {
        // Fallback to standard Leaflet Map (Using CartoDB Voyager/Dark basemaps)
        mapBadge.innerHTML = `<i class="fa-solid fa-map-location-dot"></i> 載入 Leaflet 本地底圖...`;
        
        map = L.map('windy', {
            zoomControl: true,
            minZoom: 6,
            maxZoom: 12
        }).setView([23.7, 121.0], 7.8);
        
        // Add light CartoDB Positron tiles as initial layer (matches "wind" overlay design)
        currentBaseTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap contributors &copy; CartoDB'
        }).addTo(map);
        
        mapLayerGroup = L.layerGroup().addTo(map);
        mapLabelGroup = L.layerGroup().addTo(map);
        
        mapBadge.innerHTML = `<i class="fa-solid fa-map-location-dot"></i> 觀測地圖：Leaflet (亮色底圖模式)`;
        
        setupMapListeners();
        drawCwaOverlay();
    }
}

// Drawing custom overlay markers and text labels
function drawCwaOverlay() {
    if (!map || !mapLayerGroup || !mapLabelGroup) return;
    
    // Clear old drawings
    mapLayerGroup.clearLayers();
    mapLabelGroup.clearLayers();
    
    const searchQuery = document.getElementById('search-input').value.toLowerCase().trim();
    const selectedCounty = document.getElementById('county-select').value;
    const showLabels = document.getElementById('toggle-labels').checked;
    
    // Filter stations based on criteria
    const filtered = allStations.filter(s => {
        const matchesSearch = s.station_name.toLowerCase().includes(searchQuery) || 
                              s.station_id.toLowerCase().includes(searchQuery) ||
                              (s.county && s.county.toLowerCase().includes(searchQuery)) ||
                              (s.town && s.town.toLowerCase().includes(searchQuery));
                              
        const matchesCounty = selectedCounty === 'all' || s.county === selectedCounty;
        
        return matchesSearch && matchesCounty;
    });
    
    filtered.forEach(s => {
        // 1. Draw Circle Marker
        const marker = L.circleMarker([s.lat, s.lon], {
            radius: 8,
            fillColor: colorByTemperature(s.temperature_c),
            fillOpacity: 0.85,
            color: '#120907',
            weight: 1.5
        });
        
        // Detailed Popup Content
        marker.bindPopup(`
            <strong>${s.station_name} 觀測站</strong>
            <b>縣市：</b>${s.county || '-'}<br/>
            <b>鄉鎮：</b>${s.town || '-'}<br/>
            <b>氣溫：</b><span style="font-family: var(--font-outfit); font-weight: 700; color: ${colorByTemperature(s.temperature_c)}">${s.temperature_c.toFixed(1)} °C</span><br/>
            <b>相對濕度：</b>${s.humidity_percent !== null ? s.humidity_percent + ' %' : '-'}<br/>
            <b>即時風速：</b>${s.wind_speed_mps !== null ? s.wind_speed_mps + ' m/s' : '-'}<br/>
            <b>累積雨量：</b>${s.precipitation_mm !== null ? s.precipitation_mm + ' mm' : '0.0 mm'}<br/>
            <b>觀測時間：</b><span style="font-family: var(--font-outfit); font-size: 0.75rem;">${formatTime(s.observed_at)}</span>
        `);
        
        marker.addTo(mapLayerGroup);
        
        // 2. Draw Text Temperature label (Using L.divIcon) if checked
        if (showLabels) {
            const labelIcon = L.divIcon({
                className: 'cwa-marker-label-wrapper',
                html: `<div class="cwa-marker-label" style="border-color: ${colorByTemperature(s.temperature_c)}">${Math.round(s.temperature_c)}°</div>`,
                iconSize: [20, 14],
                iconAnchor: [-8, 8] // Shift offset to avoid overlay overlap
            });
            
            const labelMarker = L.marker([s.lat, s.lon], { icon: labelIcon });
            labelMarker.addTo(mapLabelGroup);
        }
    });
}

// Map Action Listeners
function setupMapListeners() {
    // Checkbox toggle for Labels
    document.getElementById('toggle-labels').addEventListener('change', (e) => {
        if (e.target.checked) {
            map.addLayer(mapLabelGroup);
            drawCwaOverlay();
        } else {
            map.removeLayer(mapLabelGroup);
        }
    });
    
    // Select County
    document.getElementById('county-select').addEventListener('change', () => {
        drawCwaOverlay();
    });
    
    // Search Box Listener
    document.getElementById('search-input').addEventListener('input', () => {
        drawCwaOverlay();
    });
    
    // Manual sync refresh
    document.getElementById('refresh-btn').addEventListener('click', () => {
        refreshWeatherData();
    });
    
    // Setup Windy background switcher if Windy is running, otherwise use Leaflet simulation
    document.querySelectorAll('.windy-layer-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const overlay = btn.getAttribute('data-overlay');
            
            document.querySelectorAll('.windy-layer-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            if (windyStore) {
                // Windy Map Mode
                windyStore.set('overlay', overlay);
                showToast(`Windy 底圖切換為：${btn.innerText.trim()}`);
            } else {
                // Leaflet Fallback Mode
                switchLeafletWeatherLayer(overlay);
                showToast(`地圖氣象模擬切換為：${btn.innerText.trim()}`);
            }
        });
    });
}

// Refresh Data (API post)
async function refreshWeatherData() {
    toggleLoading(true, "正在與中央氣象署同步最新測站數據...");
    const icon = document.querySelector('#refresh-btn i');
    icon.classList.add('fa-spin');
    
    try {
        const res = await fetch('/api/refresh', { method: 'POST' });
        const weather = await res.json();
        
        if (weather.source) {
            allStations = weather.stations;
            renderExtremes(allStations);
            renderTable(allStations);
            drawCwaOverlay();
            
            document.getElementById('last-update-time').innerText = `資料時間：${formatTime(weather.updated_at)}`;
            showToast('同步成功，已寫入 SQLite3 資料庫與 CSV 檔案');
        }
    } catch (e) {
        console.error("Manual refresh failed:", e);
        showToast("同步失敗，請檢查 API 連接", "error");
    } finally {
        toggleLoading(false);
        icon.classList.remove('fa-spin');
    }
}

// Toggle loading overlay
function toggleLoading(show, text = "") {
    const spinner = document.getElementById('loading-spinner');
    const loadingText = document.getElementById('loading-text');
    if (show) {
        if (text) loadingText.innerText = text;
        spinner.classList.add('active');
    } else {
        spinner.classList.remove('active');
    }
}

// Helper: format datetime display
function formatTime(isoStr) {
    if (!isoStr) return '--';
    try {
        const d = new Date(isoStr);
        return `${d.getFullYear()}/${(d.getMonth()+1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    } catch (e) {
        return isoStr;
    }
}

// Floating Toast Alert
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast-alert');
    const toastMsg = document.getElementById('toast-message');
    
    toastMsg.innerText = message;
    
    if (type === 'success') {
        toast.style.background = 'rgba(255, 255, 255, 0.95)'; // Frosted white toast
        toast.style.boxShadow = '0 8px 24px rgba(14, 165, 233, 0.12)';
        toast.style.border = '1px solid rgba(14, 165, 233, 0.2)';
        toast.querySelector('i').className = 'fa-solid fa-circle-check';
        toast.querySelector('i').style.color = '#10b981';
    } else {
        toast.style.background = 'rgba(255, 255, 255, 0.95)'; // Frosted white error toast
        toast.style.boxShadow = '0 8px 24px rgba(239, 68, 68, 0.12)';
        toast.style.border = '1px solid rgba(239, 68, 68, 0.2)';
        toast.querySelector('i').className = 'fa-solid fa-triangle-exclamation';
        toast.querySelector('i').style.color = '#ef4444';
    }
    
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}

// Leaflet Weather Layer Switcher (Fallback Mode)
function switchLeafletWeatherLayer(overlay) {
    const mapElement = document.getElementById('windy');
    
    // Clear dynamic radar layer
    if (rainRadarLayer && map.hasLayer(rainRadarLayer)) {
        map.removeLayer(rainRadarLayer);
    }
    
    // Remove previous base tile layer
    if (currentBaseTileLayer) {
        map.removeLayer(currentBaseTileLayer);
    }
    
    // Reset filters
    mapElement.style.filter = 'none';
    
    if (overlay === 'wind') {
        // Wind: Dark matter tiles + cool/blue saturation filter (looks like windy currents)
        currentBaseTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap contributors &copy; CartoDB'
        }).addTo(map);
        mapElement.style.filter = 'saturate(1.2) hue-rotate(15deg) brightness(0.85)';
        
    } else if (overlay === 'temp') {
        // Temp: Voyager warm maps + sepia thermal filter
        currentBaseTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap contributors &copy; CartoDB'
        }).addTo(map);
        mapElement.style.filter = 'sepia(0.4) hue-rotate(-15deg) saturate(1.4) brightness(0.95)';
        
    } else if (overlay === 'rain') {
        // Rain: Clean Positron light maps + Live RainViewer Precipitation Radar overlay!
        currentBaseTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap contributors &copy; CartoDB'
        }).addTo(map);
        addRainViewerRadar(map);
        
    } else if (overlay === 'clouds') {
        // Clouds: Grayscale overcast filter on light maps
        currentBaseTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap contributors &copy; CartoDB'
        }).addTo(map);
        mapElement.style.filter = 'grayscale(0.8) contrast(1.1) brightness(0.85)';
    }
    
    // Bring CWA point markers/labels to front
    if (mapLayerGroup) {
        mapLayerGroup.remove();
        mapLayerGroup.addTo(map);
    }
    if (mapLabelGroup && document.getElementById('toggle-labels').checked) {
        mapLabelGroup.remove();
        mapLabelGroup.addTo(map);
    }
}

// RainViewer Radar Integration (No API Key Required)
async function addRainViewerRadar(mapInstance) {
    try {
        const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        const data = await res.json();
        
        if (data && data.radar && data.radar.past && data.radar.past.length > 0) {
            // Get the latest radar frame timestamp path
            const latestRadar = data.radar.past[data.radar.past.length - 1];
            const radarPath = latestRadar.path;
            
            rainRadarLayer = L.tileLayer(`https://tilecache.rainviewer.com${radarPath}/256/{z}/{x}/{y}/2/1_1.png`, {
                opacity: 0.55,
                attribution: 'Radar &copy; <a href="https://www.rainviewer.com/">RainViewer</a>'
            });
            
            rainRadarLayer.addTo(mapInstance);
        }
    } catch (e) {
        console.error("Failed to load RainViewer radar layer:", e);
    }
}
