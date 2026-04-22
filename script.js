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
     * Fetch a range of dates sequentially
     */
    async fetchDateRange(startDateStr, endDateStr, onProgress) {
        const start = new Date(startDateStr);
        const end = new Date(endDateStr);
        const dates = [];
        // Generate dates
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            dates.push(new Date(d).toISOString().split('T')[0]);
        }
        
        const total = dates.length;
        let loaded = 0;

        for (const date of dates) {
            await this.loadDate(date);
            loaded++;
            if (onProgress) {
                onProgress(Math.round((loaded / total) * 100));
            }
        }
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

// Global State
let isRealtime = true;
let realtimeData = [];
let realtimeTimeStr = "未知";
let historyManager = new HistoryDataManager();
let playbackInterval = null;
let isPlaying = false;
let currentHistoryDate = new Date().toISOString().split('T')[0];
let currentHistoryTimeIndex = 0; // 0 (00:00) to 143 (23:50)

// Set initial date value
document.addEventListener('DOMContentLoaded', () => {
    const dateInput = document.getElementById('history-date');
    if (dateInput) {
        dateInput.value = currentHistoryDate;
    }
});

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


// --- UI Interaction Functions ---
window.closeStationPanel = function() {
    document.getElementById('station-details-panel').style.display = 'none';
    if (selectedMarker && selectedMarker.chartInstance) {
        selectedMarker.chartInstance.destroy();
        selectedMarker.chartInstance = null;
    }
    selectedMarker = null;
    
    // Clear highlight if any
    if (highlightCircle) {
        map.removeLayer(highlightCircle);
        highlightCircle = null;
    }
};

let selectedMarker = null;
let highlightCircle = null;

function getStationPopupContent(station, w) {
    let weatherHtml = "";
    if (w && w['站號']) {
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

    return `
        <b>${station.StationName} (${station.StationID})</b><br>
        經度: ${station.Longitude} °E<br>
        緯度: ${station.Latitude} °N<br>
        高度: ${station.Altitude_m} m<br>
        地址: ${station.Address}<br>
        ${weatherHtml}
        ${station.Notes ? `<br><i style="color: red;">備註：${station.Notes}</i>` : ''}
    `;
}

function handleMarkerClick(marker) {
    const isMobile = window.innerWidth <= 768;
    const station = marker.stationData;
    const w = marker.currentWeather || {};

    const content = getStationPopupContent(station, w);

    if (isMobile) {
        // Mobile: Use Popup
        // We add the chart container for popup mode
        const popupHtml = content + `<div class="chart-container"><canvas id="chart-${station.StationID}"></canvas></div>`;
        
        marker.unbindPopup();
        marker.bindPopup(popupHtml, { maxWidth: 300 }).openPopup();
    } else {
        // Desktop: Use Sidebar
        const panel = document.getElementById('station-details-panel');
        const title = document.getElementById('station-details-title');
        const contentDiv = document.getElementById('station-details-content');
        
        panel.style.display = 'block';
        title.innerText = ` - ${station.StationName}`;
        
        // Add chart container for sidebar mode
        contentDiv.innerHTML = content + `<div class="chart-container" style="width: 100%; height: 200px; margin-top: 10px;"><canvas id="chart-${station.StationID}"></canvas></div>`;

        selectedMarker = marker;

        // Visual Feedback (Highlight)
        if (highlightCircle) {
            map.removeLayer(highlightCircle);
        }
        highlightCircle = L.circleMarker([station.Latitude, station.Longitude], {
            radius: 20,
            color: '#ff9800',
            fillColor: 'transparent',
            weight: 3,
            dashArray: '5, 5'
        }).addTo(map);

        // If History Mode, render chart immediately
        if (!isRealtime) {
            updateChartForStation(marker, `chart-${station.StationID}`);
        }
    }
}

function updateChartForStation(marker, canvasId) {
    const stationId = marker.stationData.StationID;
    const canvas = document.getElementById(canvasId);
    
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
}

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
            <div style="line-height: 1.6; font-size: 1.1rem;">
                <h2 style="margin: 5px 0; font-size: 1.5rem; text-align: center;">${timeStr}</h2>
                <div style="text-align: center; color: #555;">資料來源: ${source}</div>
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

function createWindMarkerPresentation(station, w, options = {}) {
    const isMobile = options.isMobile ?? (window.innerWidth <= 768);
    const compact = options.compact === true;
    const arrowSize = compact ? 28 : (isMobile ? 24 : 36);
    const arrowAnchor = compact ? [14, 14] : (isMobile ? [12, 12] : [18, 18]);
    const noDataFontSize = compact ? '20px' : (isMobile ? '18px' : '26px');
    const noDataAnchor = compact ? [10, 10] : (isMobile ? [9, 9] : [13, 13]);
    const calmSize = compact ? 12 : (isMobile ? 10 : 14);

    let icon;
    let tooltipText = station.StationName;

    const speed = parseFloat(w['平均風(m/s)']);
    const direction = parseFloat(w['風向(degree)']);

    if (w['站號'] && !isNaN(speed) && !isNaN(direction) && direction >= 0 && direction <= 360) {
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
                iconAnchor: [(calmSize + 8) / 2, (calmSize + 8) / 2]
            });
            tooltipText += ` (靜風)`;
        } else {
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
            tooltipText += ` (${dirText}，${speed.toFixed(1)} m/s)`;
        }
    } else {
        icon = L.divIcon({
            className: 'no-data-icon',
            html: `<div style="
                 color: red;
                 font-size: ${noDataFontSize};
                 font-weight: bold;
                 line-height: ${noDataFontSize};
                ">&#10006;</div>`,
            iconSize: [parseInt(noDataFontSize, 10), parseInt(noDataFontSize, 10)],
            iconAnchor: noDataAnchor
        });
        tooltipText += ` (無風力資料)`;
    }

    return { icon, tooltipText };
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
        marker.currentWeather = {}; // Init empty

        // Remove initial bindPopup
        // Click listener
        marker.on('click', () => handleMarkerClick(marker));

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

    const isMobile = window.innerWidth <= 768;

    // Iterate over all initialized markers
    Object.keys(stationMarkers).forEach(stationID => {
        const marker = stationMarkers[stationID];
        const station = marker.stationData;
        const w = weatherMap[stationID] || {};
        
        // Store current weather on marker for click handler
        marker.currentWeather = w;
        
        const { icon, tooltipText } = createWindMarkerPresentation(station, w, { isMobile });

        marker.setIcon(icon);
        marker.setTooltipContent(tooltipText);

        // Update popup content if mobile popup is open
        if (isMobile && marker.isPopupOpen()) {
             const content = getStationPopupContent(station, w);
             const popupHtml = content + `<div class="chart-container"><canvas id="chart-${station.StationID}"></canvas></div>`;
             marker.setPopupContent(popupHtml);
             // Note: setPopupContent destroys the canvas context, so we might need to re-init chart?
             // But valid only if history mode.
             // Usually map.on('popupopen') handles chart init.
             // If we just change content, 'popupopen' might not fire again?
             // Leaflet fires 'popupopen' only on open. 
             // If we update content, we lose the chart.
             // We need to re-render the chart.
             setTimeout(() => {
                 if (!isRealtime) {
                     // Trigger chart render manually since popup is already open
                     // emulate popup open event logic?
                     // or just call updateChartForStation(marker, `chart-${station.StationID}`);
                     // But for mobile it's inside popup.
                     // The chart canvas needs to be in DOM.
                     updateChartForStation(marker, `chart-${station.StationID}`);
                 }
             }, 100);
        }
        
        // If this marker is selected and we are in desktop mode, update the panel
        if (selectedMarker === marker && !isMobile) {
             const panel = document.getElementById('station-details-panel');
             if (panel.style.display !== 'none') {
                 // Refresh content
                 handleMarkerClick(marker);
             }
        }
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

    // Toggle Legend functionality for mobile
    window.toggleLegend = function() {
        const legendDiv = document.querySelector('.legend');
        if (legendDiv) {
            legendDiv.classList.toggle('expanded');
        }
    };

}).catch(error => console.error('Error loading data:', error));

// Load Town Geometry and Create Mask
fetch('data/taoyuan_towns_moi.json')
    .then(res => res.json())
    .then(townData => {
        taoyuanTownGeoJson = townData;

        // A. Add Towns to Town Layer
        townLayer.addData(townData);
        if (statsMapTownLayer) {
            statsMapTownLayer.clearLayers();
            statsMapTownLayer.addData(townData);
        }

        // B. Create City Mask using Turf.js
        try {
            const dissolved = turf.dissolve(townData);
            const taoyuanFeature = dissolved.features[0];

            if (taoyuanFeature) {
                taoyuanBoundaryFeature = taoyuanFeature;

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

                if (statsMapMaskLayer) {
                    rebuildStatsMapMask(taoyuanFeature);
                }

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
                taoyuanBoundaryBounds = bounds;
                map.fitBounds(bounds);
                if (statsMap) {
                    statsMap.fitBounds(bounds, { padding: [20, 20] });
                }
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

    // Mobile Logic: usage of popup
    // Desktop Logic: handled by handleMarkerClick -> updateChartForStation
    // But check if we are actually in a popup (mobile)
    const isMobile = window.innerWidth <= 768;
    if (!isMobile) return; // Should not happen if we don't bind popup, but safety check

    const stationId = marker.stationData.StationID;
    updateChartForStation(marker, `chart-${stationId}`);
});

/* --- Statistics Dashboard Logic --- */

const STATS_MAP_MIN_ZOOM = 9;
const STATS_MAP_MAX_ZOOM = 13.5;
const STATS_MAP_ZOOM_STEP = 0.05;

let statsMap = null;
let statsMapStationsLayer = null;
let statsMapTownLayer = null;
let statsMapMaskLayer = null;
let statsMapZoomSlider = null;
let isSyncingStatsMapZoom = false;
let latestStats = null;
let taoyuanTownGeoJson = null;
let taoyuanBoundaryBounds = null;
let taoyuanBoundaryFeature = null;

function rebuildStatsMapMask(feature) {
    if (!feature || !statsMapMaskLayer) return;

    statsMapMaskLayer.clearLayers();

    const worldLatLngs = [
        [90, -180],
        [90, 180],
        [-90, 180],
        [-90, -180]
    ];

    const taoyuanLatLngs = [];
    const flipCoords = ring => ring.map(coord => [coord[1], coord[0]]);

    if (feature.geometry.type === 'Polygon') {
        taoyuanLatLngs.push(flipCoords(feature.geometry.coordinates[0]));
    } else if (feature.geometry.type === 'MultiPolygon') {
        feature.geometry.coordinates.forEach(poly => {
            taoyuanLatLngs.push(flipCoords(poly[0]));
        });
    }

    L.polygon([worldLatLngs, ...taoyuanLatLngs], {
        color: 'transparent',
        fillColor: '#ffffff',
        fillOpacity: 1,
        interactive: false
    }).addTo(statsMapMaskLayer);

    L.geoJSON(feature, {
        style: {
            color: 'black',
            weight: 3,
            fill: false,
            interactive: false
        }
    }).addTo(statsMapMaskLayer);
}

// Initial Date Setup
setTimeout(() => {
    const today = new Date().toISOString().split('T')[0];
    const prevDate = new Date();
    prevDate.setDate(prevDate.getDate() - 1);
    const yesterday = prevDate.toISOString().split('T')[0];
    
    const startInput = document.getElementById('stats-start-date');
    const endInput = document.getElementById('stats-end-date');
    
    // Set default range to past 3 days if inputs exist
    if (startInput && !startInput.value) {
         const d = new Date();
         d.setDate(d.getDate() - 3);
         startInput.value = d.toISOString().split('T')[0];
    }
    if (endInput && !endInput.value) endInput.value = today;
}, 1000);

window.openStatsModal = function() {
    document.getElementById('stats-modal').style.display = 'flex';
    ensureStatsMap();
    setTimeout(() => {
        if (statsMap) {
            statsMap.invalidateSize();
            if (taoyuanBoundaryBounds) {
                statsMap.fitBounds(taoyuanBoundaryBounds, { padding: [20, 20] });
            }
        }
    }, 0);
};

window.closeStatsModal = function() {
    document.getElementById('stats-modal').style.display = 'none';
};

function syncStatsMapZoomSlider(zoomLevel) {
    if (!statsMapZoomSlider) return;
    statsMapZoomSlider.value = Number(zoomLevel).toFixed(2);
}

function ensureStatsMap() {
    if (statsMap || !document.getElementById('stats-map')) return;

    statsMapZoomSlider = document.getElementById('stats-map-zoom-range');

    statsMap = L.map('stats-map', {
        zoomControl: true,
        attributionControl: false,
        zoomSnap: STATS_MAP_ZOOM_STEP,
        zoomDelta: 0.25,
        wheelPxPerZoomLevel: 90,
        minZoom: STATS_MAP_MIN_ZOOM,
        maxZoom: STATS_MAP_MAX_ZOOM
    }).setView([24.95, 121.20], 11);

    statsMapMaskLayer = L.layerGroup().addTo(statsMap);

    statsMapTownLayer = L.geoJSON(null, {
        style: {
            color: '#666',
            weight: 1,
            fill: false,
            dashArray: '5, 5'
        },
        interactive: false
    }).addTo(statsMap);

    statsMapStationsLayer = L.layerGroup().addTo(statsMap);

    if (statsMapZoomSlider) {
        syncStatsMapZoomSlider(statsMap.getZoom());
        statsMapZoomSlider.addEventListener('input', event => {
            if (!statsMap) return;
            isSyncingStatsMapZoom = true;
            statsMap.setZoom(parseFloat(event.target.value));
            isSyncingStatsMapZoom = false;
        });
    }

    statsMap.on('zoom', () => {
        if (!isSyncingStatsMapZoom) {
            syncStatsMapZoomSlider(statsMap.getZoom());
        }
    });

    if (taoyuanTownGeoJson) {
        statsMapTownLayer.addData(taoyuanTownGeoJson);
    }

    if (taoyuanBoundaryFeature) {
        rebuildStatsMapMask(taoyuanBoundaryFeature);
    }

    if (taoyuanBoundaryBounds) {
        statsMap.fitBounds(taoyuanBoundaryBounds, { padding: [20, 20] });
        syncStatsMapZoomSlider(statsMap.getZoom());
    }

    if (latestStats) {
        renderStatsMap(latestStats.stationAverages);
    }
}

function formatAverageWindValue(value, digits = 1) {
    return typeof value === 'number' && !isNaN(value) ? value.toFixed(digits) : '無資料';
}

function renderStatsMap(stationAverages) {
    ensureStatsMap();
    if (!statsMapStationsLayer) return;

    statsMapStationsLayer.clearLayers();

    Object.keys(stationMarkers).forEach(stationID => {
        const sourceMarker = stationMarkers[stationID];
        const station = sourceMarker.stationData;
        const stationAverage = stationAverages?.[stationID] || null;
        const weatherLikeData = stationAverage ? {
            '站號': stationID,
            '平均風(m/s)': stationAverage.avgSpeed,
            '風向(degree)': stationAverage.avgDirection
        } : {};

        const { icon, tooltipText } = createWindMarkerPresentation(station, weatherLikeData, { compact: true, isMobile: false });
        const marker = L.marker([station.Latitude, station.Longitude], { icon });
        const avgSpeedText = formatAverageWindValue(stationAverage?.avgSpeed, 2);
        const avgDirectionText = typeof stationAverage?.avgDirection === 'number'
            ? `${getWindDirection16(stationAverage.avgDirection)} (${stationAverage.avgDirection.toFixed(0)}°)`
            : '無資料';

        marker.bindTooltip(tooltipText, {
            direction: 'top',
            offset: [0, -14]
        });
        marker.bindPopup(`
            <b>${station.StationName} (${station.StationID})</b><br>
            平均風速: <b>${avgSpeedText}</b> m/s<br>
            平均風向: <b>${avgDirectionText}</b><br>
            有效樣本數: <b>${stationAverage?.sampleCount || 0}</b>
        `);
        marker.addTo(statsMapStationsLayer);
    });

    if (statsMap) {
        statsMap.invalidateSize();
    }
}

window.calculateStats = function() {
    const startStr = document.getElementById('stats-start-date').value;
    const endStr = document.getElementById('stats-end-date').value;
    
    if (!startStr || !endStr) {
        alert("請選擇日期範圍");
        return;
    }
    
    if (new Date(startStr) > new Date(endStr)) {
        alert("開始日期不能晚於結束日期");
        return;
    }

    // Show Progress
    document.getElementById('stats-progress').style.display = 'block';
    
    historyManager.fetchDateRange(startStr, endStr, (percent) => {
        document.getElementById('stats-progress-fill').style.width = percent + '%';
        document.getElementById('stats-status-text').innerText = `載入資料中... ${percent}%`;
    }).then(() => {
        document.getElementById('stats-status-text').innerText = "計算統計中...";
        // Small delay to allow UI render
        setTimeout(() => {
            const stats = calculateRangeStats(startStr, endStr);
            renderStats(stats);
            document.getElementById('stats-status-text').innerText = "完成！";
            setTimeout(() => {
                document.getElementById('stats-progress').style.display = 'none';
            }, 2000);
        }, 100);
    });
};

function calculateRangeStats(startStr, endStr) {
    const slots = [];
    // Generate all time slots in range
    const start = new Date(startStr);
    const end = new Date(endStr);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateIso = new Date(d).toISOString().split('T')[0];
        const daySlots = historyManager.generateTimeSlots(dateIso);
        slots.push(...daySlots);
    }
    
    // Aggregators
    const windDirCounts = new Array(16).fill(0);
    const diurnalSpeeds = new Array(144).fill(0); // Sum of speeds
    const diurnalCounts = new Array(144).fill(0); // Count of valid readings
    const maxGusts = []; // Keep top 5
    const stationAverages = {};

    slots.forEach(slot => {
        const rawData = historyManager.cache[slot.key];
        if (!rawData) return;
        
        // Normalize data (handle wrapped structure like {data: [...]})
        const data = Array.isArray(rawData) ? rawData : (rawData.data || []);

        // Extract HHmm index for diurnal
        const timePart = slot.key.split('_')[1];
        const hh = parseInt(timePart.substring(0, 2));
        const mm = parseInt(timePart.substring(2, 4));
        const timeIndex = (hh * 6) + (mm / 10);

        data.forEach(station => {
            const stationId = station['站號'];
            if (stationId && !stationAverages[stationId]) {
                stationAverages[stationId] = {
                    speedSum: 0,
                    speedCount: 0,
                    dirX: 0,
                    dirY: 0,
                    dirCount: 0,
                    yellowCount: 0,
                    orangeCount: 0,
                    redCount: 0,
                    alertSlotCount: 0
                };
            }

            // 1. Wind Rose (Direction)
            const dir = parseFloat(station['風向(degree)']);
            if (!isNaN(dir)) {
                const dirIndex = Math.round(dir / 22.5) % 16;
                windDirCounts[dirIndex]++;

                if (stationId) {
                    const dirRad = dir * Math.PI / 180;
                    stationAverages[stationId].dirX += Math.sin(dirRad);
                    stationAverages[stationId].dirY += Math.cos(dirRad);
                    stationAverages[stationId].dirCount++;
                }
            }

            // 2. Diurnal Trend (Avg Speed)
            const speed = parseFloat(station['平均風(m/s)']);
            if (!isNaN(speed)) {
                diurnalSpeeds[timeIndex] += speed;
                diurnalCounts[timeIndex]++;

                if (stationId) {
                    stationAverages[stationId].speedSum += speed;
                    stationAverages[stationId].speedCount++;
                }
            }

            // 3. Max Gusts & Alert Frequency
            const gust = parseFloat(station['陣風(m/s)']);

            // Alert frequency counting
            if (stationId) {
                const avgForAlert = isNaN(speed) ? -1 : speed;
                const gustForAlert = isNaN(gust) ? -1 : gust;
                if (avgForAlert >= 0 || gustForAlert >= 0) {
                    stationAverages[stationId].alertSlotCount++;
                    // Yellow: avg ≥ B6 (10.8 m/s) or gust ≥ B8 (17.2 m/s)
                    if (avgForAlert >= 10.8 || gustForAlert >= 17.2) stationAverages[stationId].yellowCount++;
                    // Orange: avg ≥ B9 (20.8 m/s) or gust ≥ B11 (28.5 m/s)
                    if (avgForAlert >= 20.8 || gustForAlert >= 28.5) stationAverages[stationId].orangeCount++;
                    // Red: avg ≥ B12 (32.7 m/s) or gust ≥ B14 (41.5 m/s)
                    if (avgForAlert >= 32.7 || gustForAlert >= 41.5) stationAverages[stationId].redCount++;
                }
            }

            if (!isNaN(gust)) {
                 if (maxGusts.length < 5 || gust > maxGusts[maxGusts.length - 1].speed) {
                    const rawDate = slot.key.split('_')[0]; // YYYYMMDD
                    const fmtDate = rawDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
                    
                    maxGusts.push({
                        station: station['站名'],
                        date: fmtDate,
                        time: `${hh.toString().padStart(2,'0')}:${mm.toString().padStart(2,'0')}`,
                        speed: gust
                    });
                    maxGusts.sort((a, b) => b.speed - a.speed);
                    if (maxGusts.length > 5) maxGusts.pop();
                }
            }
        });
    });

    const diurnalAvgFinal = diurnalSpeeds.map((sum, i) => diurnalCounts[i] > 0 ? (sum / diurnalCounts[i]) : 0);
    const stationAverageFinal = {};

    Object.keys(stationAverages).forEach(stationId => {
        const aggregate = stationAverages[stationId];
        const avgSpeed = aggregate.speedCount > 0 ? (aggregate.speedSum / aggregate.speedCount) : null;
        const vectorMagnitude = Math.hypot(aggregate.dirX, aggregate.dirY);
        const avgDirection = aggregate.dirCount > 0 && vectorMagnitude > 0.0001
            ? ((Math.atan2(aggregate.dirX, aggregate.dirY) * 180 / Math.PI) + 360) % 360
            : null;

        const total = aggregate.alertSlotCount;
        stationAverageFinal[stationId] = {
            avgSpeed,
            avgDirection,
            sampleCount: Math.max(aggregate.speedCount, aggregate.dirCount),
            alertFreq: {
                total,
                yellowCount: aggregate.yellowCount,
                orangeCount: aggregate.orangeCount,
                redCount: aggregate.redCount,
                yellow: total > 0 ? (aggregate.yellowCount / total * 100) : 0,
                orange: total > 0 ? (aggregate.orangeCount / total * 100) : 0,
                red: total > 0 ? (aggregate.redCount / total * 100) : 0
            }
        };
    });

    return {
        windDirCounts,
        diurnalAvg: diurnalAvgFinal,
        maxGusts,
        stationAverages: stationAverageFinal
    };
}

let windRoseChart = null;
let diurnalChart = null;

function renderStats(stats) {
    latestStats = stats;

    // 1. Wind Rose (Polar Area)
    const ctxWR = document.getElementById('chart-windrose');
    if (windRoseChart) windRoseChart.destroy();
    
    windRoseChart = new Chart(ctxWR, {
        type: 'polarArea',
        data: {
            labels: ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'],
            datasets: [{
                data: stats.windDirCounts,
                backgroundColor: [
                    'rgba(54, 162, 235, 0.6)',
                    'rgba(75, 192, 192, 0.6)',
                    'rgba(255, 206, 86, 0.6)',
                    'rgba(255, 99, 132, 0.6)',
                    'rgba(153, 102, 255, 0.6)',
                    'rgba(255, 159, 64, 0.6)'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', display: window.innerWidth > 768 },
                 title: { display: true, text: '風向頻率分佈' }
            },
            scales: {
                r: { 
                    ticks: { display: false, backdropColor: 'transparent' },
                    grid: { color: "#e5e5e5" } 
                }
            }
        }
    });

    // 2. Diurnal Trend (Line)
    const ctxDT = document.getElementById('chart-diurnal');
    if (diurnalChart) diurnalChart.destroy();
    
    const timeLabels = [];
    for(let i=0; i<144; i++) {
        const h = Math.floor((i * 10) / 60);
        const m = (i * 10) % 60;
        timeLabels.push(`${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`);
    }

    diurnalChart = new Chart(ctxDT, {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: [{
                label: '平均風速 (Avg Speed)',
                data: stats.diurnalAvg,
                borderColor: '#0078a8',
                backgroundColor: 'rgba(0, 120, 168, 0.1)',
                borderWidth: 2,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { 
                    ticks: { maxTicksLimit: 12, maxRotation: 0 },
                    grid: { display: false }
                },
                y: {
                     beginAtZero: true,
                     title: { display: true, text: 'm/s' }
                }
            },
            plugins: {
                tooltip: { mode: 'index', intersect: false }
            },
            interaction: { mode: 'nearest', axis: 'x', intersect: false }
        }
    });

    // 3. Leaderboard
    const tbody = document.querySelector('#table-gusts tbody');
    tbody.innerHTML = '';
    stats.maxGusts.forEach((item, index) => {
        const row = `<tr>
            <td>${index + 1}</td>
            <td>${item.station}</td>
            <td>${item.date} <span style="color:#666; font-size:0.9em">${item.time}</span></td>
            <td style="font-weight:bold; color:#e31a1c">${item.speed}</td>
        </tr>`;
        tbody.innerHTML += row;
    });

    renderStatsMap(stats.stationAverages);

    // 4. Alert Frequency Table
    renderAlertFrequency(stats.stationAverages);
}

function renderAlertFrequency(stationAverages) {
    const tbody = document.querySelector('#table-alert-freq tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const totalEl = document.getElementById('alert-freq-total');
    const totalValidRecords = Object.values(stationAverages || {}).reduce((sum, stationData) => {
        const total = stationData?.alertFreq?.total || 0;
        return sum + total;
    }, 0);
    if (totalEl) {
        totalEl.innerText = `有效資料總筆數：${totalValidRecords.toLocaleString('zh-TW')}`;
    }

    const getDistrict = (stationData) => {
        const addr = (stationData && stationData.Address) ? stationData.Address.trim() : '';
        if (!addr) return '未知';
        const match = addr.match(/^(.+?[區鄉鎮市])/);
        return match ? match[1] : '未知';
    };

    // Build rows with station name lookup from stationMarkers
    const rows = Object.keys(stationAverages).map(stationId => {
        const marker = stationMarkers[stationId];
        const name = marker ? marker.stationData.StationName : stationId;
        const district = marker ? getDistrict(marker.stationData) : '未知';
        const af = stationAverages[stationId].alertFreq;
        if (!af || af.total === 0) return null;
        if (af.yellowCount === 0 && af.orangeCount === 0 && af.redCount === 0) return null;
        return { stationId, name, district, af };
    }).filter(Boolean);

    // Sort by yellow count descending
    rows.sort((a, b) => {
        if (b.af.yellowCount !== a.af.yellowCount) return b.af.yellowCount - a.af.yellowCount;
        if (b.af.orangeCount !== a.af.orangeCount) return b.af.orangeCount - a.af.orangeCount;
        return b.af.redCount - a.af.redCount;
    });

    rows.forEach(({ name, district, af }) => {
        const fmt = (count, pct) => count > 0
            ? `${count} 次 <span style="color:#888;font-size:0.85em">(${pct.toFixed(1)}%)</span>`
            : `<span style="color:#bbb">—</span>`;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="text-align:left; font-weight:500">${name}</td>
            <td>${district}</td>
            <td class="alert-cell alert-yellow">${fmt(af.yellowCount, af.yellow)}</td>
            <td class="alert-cell alert-orange">${fmt(af.orangeCount, af.orange)}</td>
            <td class="alert-cell alert-red">${fmt(af.redCount, af.red)}</td>
        `;
        tbody.appendChild(row);
    });

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#aaa; padding:20px;">無達標測站</td></tr>';
    }
}
