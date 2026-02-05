// Initialize Map with responsive zoom/center
const isMobileInit = window.innerWidth < 768;
const map = L.map('map').setView([24.95, 121.20], isMobileInit ? 10 : 11);

// --- History Data Manager ---
class HistoryDataManager {
    constructor() {
        this.cache = {}; // Key: "YYYYMMDD_HHmm", Value: Data Array or null
        this.loadedDates = new Set(); // Tracks fully loaded dates (YYYY-MM-DD)
    }

    /**
     * Helper to format numbers with leading zero
     */
    pad(num) {
        return num.toString().padStart(2, '0');
    }

    /**
     * Generate list of time slots and URLs for a given date
     * @param {string} dateStr - Date string "YYYY-MM-DD"
     */
    generateTimeSlots(dateStr) {
        const cleanDate = dateStr.replace(/-/g, ''); // YYYYMMDD
        const slots = [];
        
        for (let h = 0; h < 24; h++) {
            for (let m = 0; m < 60; m += 10) {
                const timeStr = `${this.pad(h)}${this.pad(m)}`;
                const key = `${cleanDate}_${timeStr}`;
                slots.push({
                    key: key,
                    url: `history/${key}.json`
                });
            }
        }
        return slots;
    }

    /**
     * Load all data for a specific date in batches
     * @param {string} dateStr - "YYYY-MM-DD"
     * @param {function} onProgress - Callback (percentage)
     */
    async loadDate(dateStr, onProgress) {
        if (this.loadedDates.has(dateStr)) {
            if (onProgress) onProgress(100);
            return;
        }

        const slots = this.generateTimeSlots(dateStr);
        const total = slots.length;
        const batchSize = 12; // Fetch 12 files at a time
        
        // Filter slots that are not in cache (though likely all will be needed if date not loaded)
        const pendingSlots = slots.filter(s => this.cache[s.key] === undefined);
        let completed = slots.length - pendingSlots.length; // Count already cached

        for (let i = 0; i < pendingSlots.length; i += batchSize) {
            const batch = pendingSlots.slice(i, i + batchSize);
            
            await Promise.all(batch.map(slot => 
                fetch(slot.url)
                    .then(response => {
                        if (!response.ok) throw new Error(response.statusText);
                        return response.json();
                    })
                    .then(data => {
                        // Validate data structure if needed, or assume array/object
                        this.cache[slot.key] = data;
                    })
                    .catch(e => {
                        // Graceful failure: store null so we don't retry endlessly
                        // console.warn(`Missing data for ${slot.key}:`, e);
                        this.cache[slot.key] = null;
                    })
            ));

            completed += batch.length;
            if (onProgress) {
                const percent = Math.round((completed / total) * 100);
                onProgress(percent);
            }
            
            // Optional: Small delay to yield to UI thread if needed
            // await new Promise(r => setTimeout(r, 10));
        }

        this.loadedDates.add(dateStr);
    }

    getStationTimeSeries(dateStr, stationId) {
        const slots = this.generateTimeSlots(dateStr);
        const labels = [];
        const windSpeeds = [];
        const gusts = [];
        
        slots.forEach(slot => {
            // Parse time from key (e.g., 20260205_0010 -> 00:10)
            const timePart = slot.key.split('_')[1];
            const displayTime = `${timePart.substring(0,2)}:${timePart.substring(2,4)}`;
            labels.push(displayTime);
            
            const data = this.cache[slot.key];
            let found = false;
            
            if (data) {
                // Determine if data is array or object with data property
                const list = Array.isArray(data) ? data : (data.data || []);
                const stationData = list.find(s => s['站號'] === stationId);
                
                if (stationData) {
                    const ws = parseFloat(stationData['平均風(m/s)']);
                    const gs = parseFloat(stationData['陣風(m/s)']);
                    
                    windSpeeds.push(isNaN(ws) ? null : ws);
                    gusts.push(isNaN(gs) ? null : gs);
                    found = true;
                }
            }
            
            if (!found) {
                windSpeeds.push(null);
                gusts.push(null);
            }
        });
        
        return { labels, windSpeeds, gusts };
    }

    /**
     * Retrieve data synchronously from cache
     * @param {string} dateStr - "YYYY-MM-DD"
     * @param {string} timeStr - "HHmm"
     * @returns {Array|null} Weather data array or null
     */
    getDataAtTime(dateStr, timeStr) {
        const cleanDate = dateStr.replace(/-/g, '');
        const key = `${cleanDate}_${timeStr}`;
        return this.cache[key] || null;
    }
}

// Info Control (Bottom Left)
const infoControl = L.control({ position: 'bottomleft' });

// Global State
let isRealtime = true;
let realtimeData = [];
let realtimeTimeStr = "未知";
let historyManager = new HistoryDataManager();
let playbackInterval = null;
let isPlaying = false;
let currentHistoryDate = new Date().toISOString().split('T')[0];
let currentHistoryTimeIndex = 0; // 0 (00:00) to 143 (23:50)

// Helper: Convert Index to Time String (HHmm) and Display (HH:mm)
function indexToTimeStr(index) {
    const totalMin = index * 10;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h.toString().padStart(2, '0')}${m.toString().padStart(2, '0')}`;
}

function indexToDisplayTime(index) {
    const totalMin = index * 10;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

infoControl.onAdd = function(map) {
    this._div = L.DomUtil.create('div', 'info-control');
    // Styles moved to CSS for responsiveness
    
    // Initial HTML Structure
    this._div.innerHTML = `
        <div class="control-header">
            <b>資料來源</b>
            <div>
                <span id="btn-realtime" class="mode-btn active" onclick="setRealtimeMode()">即時</span>
                <span id="btn-history" class="mode-btn" onclick="setHistoryMode()">歷史</span>
            </div>
        </div>

        <!-- Content Area -->
        <div id="info-content">
            <div style="font-size: 12px; line-height: 1.4;">
                <h4 style="margin: 0;">載入中...</h4>
            </div>
        </div>

        <!-- History Controls (Hidden by default) -->
        <div id="history-controls" class="history-controls" style="display: none;">
            <div class="control-row">
                <input type="date" id="history-date" class="date-input" value="${currentHistoryDate}">
            </div>
            <div class="control-row">
                <button id="play-btn" class="play-btn" onclick="togglePlay()">&#9654;</button> <!-- Play Icon -->
                <input type="range" id="time-slider" class="time-slider" min="0" max="143" value="0" step="1" oninput="handleSliderChange(this.value)">
                <span id="time-display" class="time-display">00:00</span>
            </div>
            <div id="progress-container" style="display:none;">
                <div class="progress-bar"><div id="progress-fill" class="progress-fill"></div></div>
                <div id="loading-text" class="loading-text">載入資料中... 0%</div>
            </div>
        </div>
    `;
    
    // Prevent Map Click propagation
    L.DomEvent.disableClickPropagation(this._div);

    return this._div;
};
infoControl.addTo(map);

// --- UI Interaction Functions ---
window.setRealtimeMode = function() {
    if (isRealtime) return;
    isRealtime = true;
    
    // Update UI
    document.getElementById('btn-realtime').classList.add('active');
    document.getElementById('btn-history').classList.remove('active');
    document.getElementById('history-controls').style.display = 'none';
    
    // Stop Playback
    stopPlayback();

    // Restore Realtime Data
    updateInfoContent(realtimeTimeStr, "CWA QPEPlus");
    updateStationData(realtimeData);
};

window.setHistoryMode = function() {
    if (!isRealtime) return;
    isRealtime = false;

    // Update UI
    document.getElementById('btn-realtime').classList.remove('active');
    document.getElementById('btn-history').classList.add('active');
    document.getElementById('history-controls').style.display = 'block';

    // Check Data
    const dateInput = document.getElementById('history-date');
    if (dateInput) {
        currentHistoryDate = dateInput.value;
        loadHistoryDate(currentHistoryDate);
    }
};

window.togglePlay = function() {
    if (isPlaying) {
        stopPlayback();
    } else {
        startPlayback();
    }
};

window.handleSliderChange = function(val) {
    currentHistoryTimeIndex = parseInt(val);
    updateHistoryView();
};

// Add Event Listener to Date Input dynamically
setTimeout(() => {
    const dateInput = document.getElementById('history-date');
    if (dateInput) {
        dateInput.addEventListener('change', (e) => {
            currentHistoryDate = e.target.value;
            loadHistoryDate(currentHistoryDate);
        });
    }
}, 1000); // Slight delay to ensure DOM is ready

function startPlayback() {
    if (isPlaying) return;
    isPlaying = true;
    document.getElementById('play-btn').innerHTML = '&#10074;&#10074;'; // Pause Icon
    
    playbackInterval = setInterval(() => {
        if (currentHistoryTimeIndex >= 143) {
            currentHistoryTimeIndex = 0; // Loop back to start
        } else {
            currentHistoryTimeIndex++;
        }
        
        // Update Slider UI
        document.getElementById('time-slider').value = currentHistoryTimeIndex;
        updateHistoryView();
    }, 1000); // 1 Second per frame
}

function stopPlayback() {
    isPlaying = false;
    document.getElementById('play-btn').innerHTML = '&#9654;'; // Play Icon
    if (playbackInterval) {
        clearInterval(playbackInterval);
        playbackInterval = null;
    }
}

function updateInfoContent(timeStr, source) {
    const content = document.getElementById('info-content');
    if (content) {
        content.innerHTML = `
            <div style="font-size: 12px; line-height: 1.4;">
                <b>資料時間:</b> ${timeStr}<br>
                <b>資料來源:</b> ${source}
            </div>
        `;
    }
}

function loadHistoryDate(dateStr) {
    // Show Loading
    document.getElementById('progress-container').style.display = 'block';
    
    // Disable controls
    document.getElementById('time-slider').disabled = true;
    document.getElementById('play-btn').disabled = true;

    historyManager.loadDate(dateStr, (percent) => {
        const fill = document.getElementById('progress-fill');
        const text = document.getElementById('loading-text');
        if (fill) fill.style.width = `${percent}%`;
        if (text) {
            text.style.display = 'block';
            text.innerText = `載入資料中... ${percent}%`;
        }
        
        if (percent >= 100) {
            setTimeout(() => {
                document.getElementById('progress-container').style.display = 'none';
                document.getElementById('time-slider').disabled = false;
                document.getElementById('play-btn').disabled = false;
                
                // Refresh View
                updateHistoryView();
            }, 500);
        }
    });
}

function updateHistoryView() {
    const timeStr = indexToTimeStr(currentHistoryTimeIndex);
    const displayTime = indexToDisplayTime(currentHistoryTimeIndex);
    
    // Update Time Display
    document.getElementById('time-display').innerText = displayTime;
    
    // Fetch Data from Cache
    const data = historyManager.getDataAtTime(currentHistoryDate, timeStr);
    
    if (data) {
        updateStationData(data);
        updateInfoContent(`${currentHistoryDate} ${displayTime}`, "歷史資料");
    } else {
        // Show No Data or hold previous?
        // updateStationData([]); // Clear map? Or just show empty?
        // Let's keep markers but show "No Data" content if array is empty
        updateInfoContent(`${currentHistoryDate} ${displayTime}`, `<span style="color:red">無資料</span>`);
    }
}


// Base Layers
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
});

const emptyLayer = L.tileLayer('', {
    attribution: ''
}).addTo(map);

// Overlay Groups
const stationsLayer = L.layerGroup().addTo(map);
const maskLayer = L.layerGroup().addTo(map); // Default On
const labelsLayer = L.layerGroup().addTo(map); // For Town Labels
const stationMarkers = {};

// Town Layer (Lines)
const townLayer = L.geoJSON(null, {
    style: function(feature) {
        return {
            color: '#666',
            weight: 1,
            fill: false,
            dashArray: '5, 5' // Dashed line for districts
        };
    },
    onEachFeature: function(feature, layer) {
        const townName = feature.properties.TOWNNAME;
        const shortName = townName.replace(/[鄉鎮市區]$/, "");
        const center = layer.getBounds().getCenter();

        const labelIcon = L.divIcon({
            className: 'town-label-marker',
            html: `<div class="town-label">${shortName}</div>`,
            iconSize: [40, 20],
            iconAnchor: [20, 10]
        });

        // Add label to the separate labelsLayer
        L.marker(center, {
            icon: labelIcon,
            interactive: false
        }).addTo(labelsLayer);
    }
}).addTo(map);

// Layer Control
const baseMaps = {
    "OpenStreetMap": osmLayer,
    "無地圖 (White)": emptyLayer
};

const overlayMaps = {
    "鄉鎮市區界線": townLayer,
    "鄉鎮市區標籤": labelsLayer,
    "地面測站": stationsLayer,
    "僅桃園 (Focus Mode)": maskLayer
};

L.control.layers(baseMaps, overlayMaps).addTo(map);

// --- Helpers ---
function getWindColor(speed) {
    if (speed < 1.6) return '#92efd9';
    if (speed < 5.5) return '#00a5e1';
    if (speed < 10.8) return '#1b467a';
    if (speed < 17.2) return '#fec44f';
    if (speed < 24.5) return '#e31a1c';
    return '#99000d';
}

function getWindDirection16(d) {
    if (isNaN(d)) return "未知";
    const directions = ['北', '北北東', '東北', '東北東', '東', '東南東', '東南', '南南東', '南', '南南西', '西南', '西南西', '西', '西北西', '西北', '北北西'];
    const index = Math.round(d / 22.5) % 16;
    return directions[index];
}

function initStations(stations) {
    stations.forEach(function(station) {
        // Default No Data Icon
        const icon = L.divIcon({
            className: 'no-data-icon',
            html: `<div style="
                 color: red; 
                 font-size: 26px; 
                 font-weight: bold; 
                 line-height: 26px;
                ">&#10006;</div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13]
        });

        const marker = L.marker([station.Latitude, station.Longitude], {
            icon: icon
        });
        
        // Store static data for updates
        marker.stationData = station;

        // Initial Popup (Static info)
        const popupContent = `
            <b>${station.StationName} (${station.StationID})</b><br>
            經度: ${station.Longitude} °E<br>
            緯度: ${station.Latitude} °N<br>
            高度: ${station.Altitude_m} m<br>
            地址: ${station.Address}<br>
            <hr><i style="color:gray">等待資料...</i>
            ${station.Notes ? `<br><i style="color: red;">備註：${station.Notes}</i>` : ''}
            <div class="chart-container"><canvas id="chart-${station.StationID}"></canvas></div>
        `;

        marker.bindPopup(popupContent);
        marker.bindTooltip(station.StationName + " (無資料)", {
            direction: 'top',
            offset: [0, -20]
        });
        
        marker.addTo(stationsLayer);
        stationMarkers[station.StationID] = marker;
    });
}

function updateStationData(incomingData) {
    let weatherData = incomingData;
    // Handle wrapped data structure (e.g. { data: [...] })
    if (!Array.isArray(incomingData) && incomingData && incomingData.data && Array.isArray(incomingData.data)) {
        weatherData = incomingData.data;
    }

    // Ensure we have an array
    if (!Array.isArray(weatherData)) {
        console.warn("updateStationData: Invalid data format", incomingData);
        return;
    }

    // Lookup Map for incoming data
    const weatherMap = {};
    weatherData.forEach(w => {
        weatherMap[w['站號']] = w;
    });

    // Dynamic Icon Sizing
    const isMobile = window.innerWidth <= 768;
    const arrowSize = isMobile ? 24 : 36;
    const arrowAnchor = isMobile ? [12, 12] : [18, 18];
    const noDataFontSize = isMobile ? '18px' : '26px';
    const noDataAnchor = isMobile ? [9, 9] : [13, 13];
    const calmSize = isMobile ? 10 : 14; // Smaller dot for calm

    // Iterate over all initialized markers
    Object.keys(stationMarkers).forEach(stationID => {
        const marker = stationMarkers[stationID];
        const station = marker.stationData;
        const w = weatherMap[stationID] || {};
        
        let icon;
        let tooltipText = station.StationName;

        const speed = parseFloat(w['平均風(m/s)']);
        const direction = parseFloat(w['風向(degree)']);

        if (w['站號'] && !isNaN(speed) && !isNaN(direction) && direction >= 0 && direction <= 360) {
            // Calm Wind
            if (speed <= 0.2) {
                icon = L.divIcon({
                    className: 'calm-icon',
                    html: `<div style="
                        width: ${calmSize}px; 
                        height: ${calmSize}px; 
                        background: white; 
                        border: 4px solid black; 
                        border-radius: 50%; 
                        box-shadow: 0 0 4px rgba(255,255,255,0.8);
                    "></div>`,
                    iconSize: [calmSize + 8, calmSize + 8],
                    iconAnchor: [(calmSize + 8)/2, (calmSize + 8)/2]
                });
                tooltipText += ` (靜風)`;
            } else {
                // Wind Arrow
                const color = getWindColor(speed);
                const rotation = direction + 180;

                icon = L.divIcon({
                    className: 'wind-arrow-icon',
                    html: `<div style="transform: rotate(${rotation}deg); filter: drop-shadow(1px 1px 3px rgba(0,0,0,0.6));">
                            <svg viewBox="0 0 24 24" width="${arrowSize}" height="${arrowSize}">
                              <path d="M12 2L4.5 20.29L5.21 21L12 18L18.79 21L19.5 20.29L12 2Z" 
                                    fill="${color}" 
                                    stroke="white" 
                                    stroke-width="2" 
                                    stroke-linejoin="round"/>
                            </svg>
                          </div>`,
                    iconSize: [arrowSize, arrowSize],
                    iconAnchor: arrowAnchor
                });

                const dirText = getWindDirection16(direction);
                tooltipText += ` (${dirText}，${speed} m/s)`;
            }

        } else {
            // No Data
            icon = L.divIcon({
                className: 'no-data-icon',
                html: `<div style="
                     color: red; 
                     font-size: ${noDataFontSize}; 
                     font-weight: bold; 
                     line-height: ${noDataFontSize};
                    ">&#10006;</div>`,
                iconSize: [parseInt(noDataFontSize), parseInt(noDataFontSize)],
                iconAnchor: noDataAnchor
            });
            tooltipText += ` (無風力資料)`;
        }

        marker.setIcon(icon);

        // Popup Content
        let weatherHtml = "";
        if (w['站號']) {
            weatherHtml = `
                <hr style="margin: 5px 0;">
                <b>即時天氣觀測</b><br>
                溫度: <b>${w['溫度(°C)']}</b> °C<br>
                累積雨量: <b>${w['當日累積雨量(mm)']}</b> mm<br>
                平均風速: ${w['平均風(m/s)']} m/s (風向 ${w['風向(degree)']}°)<br>
                最大陣風: ${w['陣風(m/s)']} m/s (${w['陣風時間(HH:MM)']})<br>
            `;
        } else {
            weatherHtml = `<hr><i style="color:gray">無即時資料</i>`;
        }

        const popupContent = `
            <b>${station.StationName} (${station.StationID})</b><br>
            經度: ${station.Longitude} °E<br>
            緯度: ${station.Latitude} °N<br>
            高度: ${station.Altitude_m} m<br>
            地址: ${station.Address}<br>
            ${weatherHtml}
            ${station.Notes ? `<br><i style="color: red;">備註：${station.Notes}</i>` : ''}
            <div class="chart-container"><canvas id="chart-${station.StationID}"></canvas></div>
        `;

        marker.setPopupContent(popupContent);
        marker.setTooltipContent(tooltipText);
    });
}

// --- Data Loading ---
Promise.all([
    fetch('data/taoyuan_stations.json').then(r => r.json()),
    fetch('taoyuan_realtime_weather.json').then(r => r.json()).catch(e => {
        console.warn("Realtime weather data not found or invalid", e);
        return [];
    })
]).then(([stations, weatherResponse]) => {

    initStations(stations);

    let weatherData = [];
    let dataTime = "時間未存 (請更新資料)";

    if (Array.isArray(weatherResponse)) {
        weatherData = weatherResponse;
        if (weatherData.length > 0 && weatherData[0]['陣風時間(HH:MM)']) {
            dataTime = "今日 " + weatherData[0]['陣風時間(HH:MM)'] + " (僅時間)";
        }
    } else if (weatherResponse && weatherResponse.data) {
        weatherData = weatherResponse.data;
        dataTime = weatherResponse.updated_at || "未知";
    }
    
    // Store Realtime State
    realtimeData = weatherData;
    realtimeTimeStr = dataTime;

    // Update Info Control Content via Helper
    updateInfoContent(realtimeTimeStr, "CWA QPEPlus");

    // Initial Render
    updateStationData(weatherData);

    // Valid Legend Control
    const legend = L.control({ position: 'bottomleft' });

    // Toggle Legend functionality for mobile
    window.toggleLegend = function() {
        const legendDiv = document.querySelector('.info.legend');
        if (legendDiv) {
            legendDiv.classList.toggle('expanded');
        }
    };

    legend.onAdd = function(map) {
        const div = L.DomUtil.create('div', 'info legend');
        
        // Prevent click propagation for the whole control to avoid map interaction
        L.DomEvent.disableClickPropagation(div);

        div.innerHTML = `
            <div class="legend-toggle" onclick="toggleLegend()">i</div>
            
            <div class="legend-content">
                <div class="legend-header-mobile">
                    <h4>風級圖示說明 (蒲福氏)</h4>
                    <span class="legend-close" onclick="toggleLegend()">&times;</span>
                </div>
                <h4 class="legend-header-desktop">風級圖示說明 (蒲福氏)</h4>
            
            <div class="l-grid">
                <!-- 0 Level -->
                <div class="l-icon"><i style="background: white; border: 3px solid black; border-radius: 50%; width: 10px; height: 10px; box-shadow: 0 0 2px gray;"></i></div>
                <div class="l-lvl">0</div>
                <div class="l-unit">級</div>
                <div class="l-sep">（</div>
                <div class="l-spd">&lt; 0.3</div>
                <div class="l-unit">m/s）</div>

                <!-- General Header -->
                <div class="l-head">一般風況</div>

                <!-- 1 Level -->
                <div class="l-icon"><i style="background: #92efd9; border: 1px solid #333;"></i></div>
                <div class="l-lvl">1</div>
                <div class="l-unit">級</div>
                <div class="l-sep">（</div>
                <div class="l-spd">0.3-1.5</div>
                <div class="l-unit">m/s）</div>

                <!-- 2-3 Level -->
                <div class="l-icon"><i style="background: #00a5e1; border: 1px solid #333;"></i></div>
                <div class="l-lvl">2-3</div>
                <div class="l-unit">級</div>
                <div class="l-sep">（</div>
                <div class="l-spd">1.6-5.4</div>
                <div class="l-unit">m/s）</div>

                <!-- 4-5 Level -->
                <div class="l-icon"><i style="background: #1b467a; border: 1px solid #333;"></i></div>
                <div class="l-lvl">4-5</div>
                <div class="l-unit">級</div>
                <div class="l-sep">（</div>
                <div class="l-spd">5.5-10.7</div>
                <div class="l-unit">m/s）</div>

                <!-- Warning Header -->
                <div class="l-head l-warn">強風警示</div>

                <!-- 6-7 Level -->
                <div class="l-icon"><i style="background: #fec44f; border: 1px solid #333;"></i></div>
                <div class="l-lvl">6-7</div>
                <div class="l-unit">級</div>
                <div class="l-sep">（</div>
                <div class="l-spd">10.8-17.1</div>
                <div class="l-unit">m/s）</div>

                <!-- 8-9 Level -->
                <div class="l-icon"><i style="background: #e31a1c; border: 1px solid #333;"></i></div>
                <div class="l-lvl">8-9</div>
                <div class="l-unit">級</div>
                <div class="l-sep">（</div>
                <div class="l-spd">17.2-24.4</div>
                <div class="l-unit">m/s）</div>

                <!-- 10+ Level -->
                <div class="l-icon"><i style="background: #99000d; border: 1px solid #333;"></i></div>
                <div class="l-lvl">10+</div>
                <div class="l-unit">級</div>
                <div class="l-sep">（</div>
                <div class="l-spd">≥ 24.5</div>
                <div class="l-unit">m/s）</div>
            </div>

            <div class="legend-section" style="margin-top: 8px; border-top: 1px solid #eee; padding-top: 5px;">
                <i style="color: red; font-weight: bold; background: none; width: auto; text-align: center;">&#10006;</i> 無資料 / 離線
            </div>
            </div> <!-- End legend-content -->
        `;
        return div;
    };
    legend.addTo(map);

}).catch(error => console.error('Error loading data:', error));

// Load Town Geometry and Create Mask
fetch('data/taoyuan_towns_moi.json')
    .then(res => res.json())
    .then(townData => {
        // A. Add Towns to Town Layer
        townLayer.addData(townData);

        // B. Create City Mask using Turf.js
        try {
            const dissolved = turf.dissolve(townData);
            const taoyuanFeature = dissolved.features[0];

            if (taoyuanFeature) {
                // Prepare Mask Geometry (World minus Taoyuan)
                const worldLatLngs = [
                    [90, -180],
                    [90, 180],
                    [-90, 180],
                    [-90, -180]
                ];

                const taoyuanLatLngs = [];

                function flipCoords(ring) {
                    return ring.map(coord => [coord[1], coord[0]]);
                }

                if (taoyuanFeature.geometry.type === 'Polygon') {
                    taoyuanLatLngs.push(flipCoords(taoyuanFeature.geometry.coordinates[0]));
                } else if (taoyuanFeature.geometry.type === 'MultiPolygon') {
                    taoyuanFeature.geometry.coordinates.forEach(poly => {
                        taoyuanLatLngs.push(flipCoords(poly[0]));
                    });
                }

                // Create Mask Polygon (White background with a hole)
                const mask = L.polygon([worldLatLngs, ...taoyuanLatLngs], {
                    color: 'transparent',
                    fillColor: '#ffffff',
                    fillOpacity: 1,
                    interactive: false
                }).addTo(maskLayer);

                // Create Thick Black Border for Taoyuan City
                L.geoJSON(taoyuanFeature, {
                    style: {
                        color: 'black',
                        weight: 3,
                        fill: false,
                        interactive: false
                    }
                }).addTo(maskLayer);

                // Fit Bounds
                const bounds = L.geoJSON(taoyuanFeature).getBounds();
                map.fitBounds(bounds);
            }
        } catch (e) {
            console.error("Turf.js operation failed:", e);
        }
    })
    .catch(err => console.error("Error loading local town geojson:", err));
// --- Chart Integration ---
map.on('popupopen', function(e) {
    // Only available in History Mode
    if (isRealtime) {
        const container = e.popup.getElement().querySelector('.chart-container');
        if (container) container.style.display = 'none';
        return;
    }

    const marker = e.popup._source;
    if (!marker || !marker.stationData) return;

    const stationId = marker.stationData.StationID;
    const canvas = document.getElementById(`chart-${stationId}`);
    
    if (!canvas) return;

    // Use current history date
    const dateStr = currentHistoryDate; 
    const data = historyManager.getStationTimeSeries(dateStr, stationId);

    // Destroy existing chart if any
    if (marker.chartInstance) {
        marker.chartInstance.destroy();
        marker.chartInstance = null;
    }

    // Render Chart
    marker.chartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels: data.labels,
            datasets: [
                {
                    label: '平均風速',
                    data: data.windSpeeds,
                    borderColor: '#0078a8',
                    backgroundColor: 'rgba(0, 120, 168, 0.1)',
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0.1,
                    fill: false
                },
                {
                    label: '陣風',
                    data: data.gusts,
                    borderColor: '#e31a1c',
                    backgroundColor: 'rgba(227, 26, 28, 0.1)',
                    borderWidth: 1,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0.1,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                x: {
                    ticks: {
                        maxTicksLimit: 6,
                        maxRotation: 0,
                        font: { size: 10 }
                    },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'm/s', font: { size: 10 } },
                    ticks: { font: { size: 10 } }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    labels: { boxWidth: 10, usePointStyle: true, font: { size: 10 } }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });
});
