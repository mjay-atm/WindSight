// Initialize Map
const map = L.map('map').setView([24.95, 121.20], 11);

// Info Control (Bottom Left)
const infoControl = L.control({ position: 'bottomleft' });
infoControl.onAdd = function(map) {
    this._div = L.DomUtil.create('div', 'info-control');
    this._div.style.padding = '6px 8px';
    this._div.style.background = 'white';
    this._div.style.boxShadow = '0 0 15px rgba(0,0,0,0.2)';
    this._div.style.borderRadius = '5px';
    this._div.innerHTML = '<h4>載入中...</h4>';
    return this._div;
};
infoControl.addTo(map);

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

// --- Data Loading ---
Promise.all([
    fetch('data/taoyuan_stations.json').then(r => r.json()),
    fetch('taoyuan_realtime_weather.json').then(r => r.json()).catch(e => {
        console.warn("Realtime weather data not found or invalid", e);
        return [];
    })
]).then(([stations, weatherResponse]) => {

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

    // Lookup Map
    const weatherMap = {};
    weatherData.forEach(w => {
        weatherMap[w['站號']] = w;
    });

    // Update Info Control
    const infoDiv = document.querySelector('.info-control');
    if (weatherData.length > 0) {
        infoDiv.innerHTML = `
            <div style="font-size: 12px; line-height: 1.4;">
                <b>資料時間:</b> ${dataTime}<br>
                <b>資料來源:</b> CWA QPEPlus
            </div>
         `;
    } else {
        infoDiv.innerHTML = `
            <div style="font-size: 12px; line-height: 1.4;">
                <b>資料來源:</b> CWA QPEPlus<br>
                <span style="color:red">無法載入即時資料</span>
            </div>
         `;
    }

    // Render Stations
    stations.forEach(function(station) {
        const w = weatherMap[station.StationID] || {};
        let icon;
        let tooltipText = station.StationName;

        const speed = parseFloat(w['平均風(m/s)']);
        const direction = parseFloat(w['風向(degree)']);

        if (w && !isNaN(speed) && !isNaN(direction) && direction >= 0 && direction <= 360) {
            // Calm Wind
            if (speed <= 0.2) {
                icon = L.divIcon({
                    className: 'calm-icon',
                    html: `<div style="
                        width: 14px; 
                        height: 14px; 
                        background: white; 
                        border: 4px solid black; 
                        border-radius: 50%; 
                        box-shadow: 0 0 4px rgba(255,255,255,0.8);
                    "></div>`,
                    iconSize: [22, 22],
                    iconAnchor: [11, 11]
                });
                tooltipText += ` (靜風)`;
            } else {
                // Wind Arrow
                const color = getWindColor(speed);
                const rotation = direction + 180;

                icon = L.divIcon({
                    className: 'wind-arrow-icon',
                    html: `<div style="transform: rotate(${rotation}deg); filter: drop-shadow(1px 1px 3px rgba(0,0,0,0.6));">
                            <svg viewBox="0 0 24 24" width="36" height="36">
                              <path d="M12 2L4.5 20.29L5.21 21L12 18L18.79 21L19.5 20.29L12 2Z" 
                                    fill="${color}" 
                                    stroke="white" 
                                    stroke-width="2" 
                                    stroke-linejoin="round"/>
                            </svg>
                          </div>`,
                    iconSize: [36, 36],
                    iconAnchor: [18, 18]
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
                     font-size: 26px; 
                     font-weight: bold; 
                     line-height: 26px;
                    ">&#10006;</div>`,
                iconSize: [26, 26],
                iconAnchor: [13, 13]
            });
            tooltipText += ` (無風力資料)`;
        }

        const marker = L.marker([station.Latitude, station.Longitude], {
            icon: icon
        });

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
        `;

        marker.bindPopup(popupContent);
        marker.bindTooltip(tooltipText, {
            direction: 'top',
            offset: [0, -20]
        });
        marker.addTo(stationsLayer);
    });

    // Valid Legend Control
    const legend = L.control({ position: 'bottomleft' });
    legend.onAdd = function(map) {
        const div = L.DomUtil.create('div', 'info legend');
        div.innerHTML = `
            <h4>風級圖示說明 (蒲福氏)</h4>
            
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