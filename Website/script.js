document.addEventListener('DOMContentLoaded', () => {
  // --- GLOBAL VARIABLES ---
  let analyticsChart = null;
  let historicalData = []; // To store a history of live data points for charts
  let map, mainMarker;
  const userDetails = JSON.parse(localStorage.getItem('userDetails'));
  let activeAlerts = [];
  let unreadAlertCount = 0;

  // --- DOM Elements ---
  const alertBellBtn = document.getElementById('alert-bell-btn');
  const alertCountBadge = document.getElementById('alert-count-badge');
  const alertModal = document.getElementById('alert-modal');
  const closeAlertModalBtn = document.getElementById('close-alert-modal-btn');
  const alertsList = document.getElementById('alerts-list');
  const noAlertsMessage = document.getElementById('no-alerts-message');
  const clearAllAlertsBtn = document.getElementById('clear-all-alerts-btn');
  const mapLegend = document.getElementById('map-legend');

  // --- THEME & TABS ---
  const themeSwitcherBtn = document.getElementById('theme-switcher-btn');
  themeSwitcherBtn.addEventListener('click', (event) => { const currentTheme = document.body.getAttribute('data-theme') || 'light'; setTheme(currentTheme === 'light' ? 'dark' : 'light', event); });
  function setTheme(themeId, event) { if (event && document.startViewTransition) { const x = event.clientX; const y = event.clientY; document.documentElement.style.setProperty('--ripple-x', x + 'px'); document.documentElement.style.setProperty('--ripple-y', y + 'px'); document.startViewTransition(() => { document.body.setAttribute('data-theme', themeId); }); } else { document.body.setAttribute('data-theme', themeId); } localStorage.setItem('theme', themeId); themeSwitcherBtn.innerHTML = themeId === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>'; if (analyticsChart) { renderAnalyticsChart(); } }
  const tabs = { gauge: { btn: document.getElementById('tab-gauge'), content: document.getElementById('tab-content-gauge') }, analytics: { btn: document.getElementById('tab-analytics'), content: document.getElementById('tab-content-analytics') } };
  Object.keys(tabs).forEach(key => { tabs[key].btn.addEventListener('click', () => { Object.values(tabs).forEach(t => { t.btn.classList.remove('tab-active'); t.content.classList.add('hidden'); }); tabs[key].btn.classList.add('tab-active'); tabs[key].content.classList.remove('hidden'); if (key === 'analytics') { renderAnalyticsChart(); } }); });

  // --- GEOCODING ---
  async function getAddressFromCoords(lat, lng) { try { const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`); if (!response.ok) return "Address lookup failed."; const data = await response.json(); return data.display_name || "Unknown Location"; } catch (error) { console.error("Geocoding error:", error); return "Address not found."; } }

  // --- LIVE FIREBASE DATA FETCHING ---
  async function fetchData() {
    try {
      const response = await fetch('https://gas-value-33f5a-default-rtdb.firebaseio.com/SensorData.json');
      if (!response.ok) throw new Error(`Network Error: ${response.statusText}`);
      const liveData = await response.json();
      
      if (liveData && liveData.location) {
        const [lat, lng] = liveData.location.split(',').map(Number);
        const address = await getAddressFromCoords(lat, lng);
        const formattedData = {
          temperature: liveData.temperature, humidity: liveData.humidity, carbon: liveData.carbon,
          latitude: lat, longitude: lng,
          locationName: address, timestamp: liveData.timestamp
        };

        updateDashboard(formattedData);
        checkThresholds(formattedData);
        
        historicalData.push(formattedData);
        if (historicalData.length > 20) { // Keep history limited to the last 20 data points
            historicalData.shift();
        }

        if (!tabs.analytics.content.classList.contains('hidden')) { renderAnalyticsChart(); }
        updateAllHeatmaps();
      }
    } catch (error) { console.error("Failed to fetch live data:", error); }
  }

  // --- DATA INSIGHTS ---
  function updateStatusPanel(data) {
    const statusPanel = document.getElementById('status-panel');
    const statusIcon = document.getElementById('status-icon');
    const statusText = document.getElementById('status-text');
    const statusSuggestion = document.getElementById('status-suggestion');

    if (data.carbon > THRESHOLDS.co2) {
        statusPanel.className = 'flex items-center p-4 rounded-lg transition-all duration-500 bg-red-500 bg-opacity-20';
        statusIcon.innerHTML = '<i class="fas fa-wind text-red-500"></i>';
        statusText.textContent = 'High CO₂ Levels Detected!';
        statusSuggestion.textContent = 'Suggestion: Ensure proper ventilation. High CO₂ can affect cognitive function.';
    } else if (data.temperature > THRESHOLDS.temp) {
        statusPanel.className = 'flex items-center p-4 rounded-lg transition-all duration-500 bg-red-500 bg-opacity-20';
        statusIcon.innerHTML = '<i class="fas fa-temperature-high text-red-500"></i>';
        statusText.textContent = 'High Temperature Alert!';
        statusSuggestion.textContent = 'Suggestion: Check for potential fire hazards or malfunctioning cooling systems.';
    } else if (data.humidity > THRESHOLDS.humidity) {
        statusPanel.className = 'flex items-center p-4 rounded-lg transition-all duration-500 bg-yellow-500 bg-opacity-20';
        statusIcon.innerHTML = '<i class="fas fa-tint text-yellow-500"></i>';
        statusText.textContent = 'High Humidity Detected.';
        statusSuggestion.textContent = 'Suggestion: Monitor for conditions that could lead to mold growth or equipment damage.';
    } else {
        statusPanel.className = 'flex items-center p-4 rounded-lg transition-all duration-500 bg-green-500 bg-opacity-20';
        statusIcon.innerHTML = '<i class="fas fa-check-circle text-green-500"></i>';
        statusText.textContent = 'All Systems Normal.';
        
        if (historicalData.length > 5) {
            const oldCarbon = historicalData[0].carbon;
            const trend = data.carbon - oldCarbon;
            if (trend > 50) {
                 statusSuggestion.textContent = `Observation: CO₂ levels are trending upwards (increased by ${trend.toFixed(0)} ppm recently).`;
            } else if (trend < -50) {
                 statusSuggestion.textContent = `Observation: CO₂ levels are trending downwards. Air quality is improving.`;
            } else {
                 statusSuggestion.textContent = 'Environmental conditions are stable.';
            }
        } else {
             statusSuggestion.textContent = 'Environmental conditions are stable.';
        }
    }
  }

  // --- ACTIVITY SUGGESTIONS ---
  function updateActivitySuggestions(data) {
      const iconEl = document.getElementById('activity-icon');
      const titleEl = document.getElementById('activity-title');
      const descriptionEl = document.getElementById('activity-description');
      const { temperature, humidity, carbon } = data;

      if (carbon > 600 || temperature > 38) {
          iconEl.innerHTML = '<i class="fas fa-house-user text-blue-500"></i>';
          titleEl.textContent = "Best to Stay Indoors";
          descriptionEl.textContent = `High CO₂ (${carbon}ppm) or extreme heat (${temperature}°C) makes outdoor activities unsafe. Consider a museum or mall.`;
      } else if (temperature > 20 && temperature < 30 && humidity < 70 && carbon < 450) {
          iconEl.innerHTML = '<i class="fas fa-campground text-green-500"></i>';
          titleEl.textContent = "Perfect for a Picnic or Camping!";
          descriptionEl.textContent = "Ideal weather and excellent air quality. A great opportunity for jogging, camping, or a family picnic.";
      } else if (carbon > 450) {
          iconEl.innerHTML = '<i class="fas fa-mask-face text-yellow-500"></i>';
          titleEl.textContent = "Air Quality is Moderate";
          descriptionEl.textContent = "Sensitive groups should consider limiting prolonged outdoor exertion. Light activities should be fine.";
      } else if (temperature > 32 || humidity > 75) {
          iconEl.innerHTML = '<i class="fas fa-cloud-sun text-orange-500"></i>';
          titleEl.textContent = "Caution: Heat and Humidity";
          descriptionEl.textContent = "It's quite warm and humid. If you're planning an event, ensure there's plenty of shade and water.";
      } else {
          iconEl.innerHTML = '<i class="fas fa-city text-gray-500"></i>';
          titleEl.textContent = "Conditions are Average";
          descriptionEl.textContent = "No major alerts. Most outdoor activities are suitable with standard precautions.";
      }
  }
  
  // --- Personalize to User's Location ---
  async function getUserLocationAndPersonalize() {
    if (!navigator.geolocation) {
      console.log("Geolocation is not supported by this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(async (position) => {
      const { latitude, longitude } = position.coords;
      const address = await getAddressFromCoords(latitude, longitude);
      document.getElementById("sensorLocationVal").textContent = `${latitude.toFixed(4)}, ${longitude.toFixed(4)} (Your Location)`;
      document.getElementById("sensorLocationName").textContent = address;
      
      // Add a small disclaimer
      const nameElement = document.getElementById("sensorLocationName");
      let disclaimer = nameElement.querySelector('.disclaimer');
      if (!disclaimer) {
          disclaimer = document.createElement('p');
          disclaimer.className = 'text-xs text-text-secondary italic mt-1 disclaimer';
          nameElement.appendChild(disclaimer);
      }
      disclaimer.textContent = '*Suggestions use your location with data from a central demo sensor.';

    }, () => {
      console.log("Unable to retrieve your location. Showing default sensor location.");
    });
  }


  // --- DASHBOARD UPDATE ---
  function updateGauge(fillId, coverId, value, max, unit, gaugeType) {
    const fillEl = document.getElementById(fillId);
    const coverEl = document.getElementById(coverId);
    if (!fillEl || !coverEl) return;

    // Update color based on the new logic
    let color;
    if (gaugeType === 'temperature') {
        color = getTemperatureColor(value);
    } else if (gaugeType === 'carbon') {
        color = getCO2Color(value);
    }
    // For humidity, we keep the gradient, but we can set a solid color if needed
    if (color) {
        fillEl.style.background = color;
    }

    const percentage = Math.max(0, Math.min(1, value / max));
    fillEl.style.transform = `rotate(${percentage / 2}turn)`;

    const coverValueEl = coverEl.firstChild; 
    const startValue = parseFloat(coverValueEl?.nodeValue) || 0;
    const endValue = value;

    if (startValue === endValue) {
        coverEl.innerHTML = `${endValue.toFixed(0)}<span>${unit}</span>`;
        return;
    }
    
    const duration = 800;
    let startTime = null;

    function animationStep(timestamp) {
        if (!startTime) startTime = timestamp;
        const progress = Math.min((timestamp - startTime) / duration, 1);
        const currentValue = startValue + (endValue - startValue) * progress;
        coverEl.innerHTML = `${currentValue.toFixed(0)}<span>${unit}</span>`;
        if (progress < 1) {
            requestAnimationFrame(animationStep);
        }
    }
    requestAnimationFrame(animationStep);
  }
  
  function updateDashboard(data) {
    document.getElementById("lastUpdated").textContent = new Date(data.timestamp).toLocaleTimeString('en-US');
    updateGauge('temp-gauge-fill', 'temp-gauge-cover', data.temperature, 100, '°C', 'temperature');
    updateGauge('humidity-gauge-fill', 'humidity-gauge-cover', data.humidity, 100, '%', 'humidity');
    updateGauge('carbon-gauge-fill', 'carbon-gauge-cover', data.carbon, 800, 'ppm', 'carbon');
    
    // Only update map marker, not the location text which is now personalized
    mainMarker.setLatLng([data.latitude, data.longitude]);

    updateStatusPanel(data);
    updateActivitySuggestions(data); 
  }

  // --- ALERTING SYSTEM ---
  const THRESHOLDS = { temp: 45, co2: 500, humidity: 80 }; let lastAlertTimes = { temp: 0, co2: 0, humidity: 0 }; const ALERT_COOLDOWN = 300000;
  function checkThresholds(data) { const now = Date.now(); if (data.temperature > THRESHOLDS.temp && (now - lastAlertTimes.temp > ALERT_COOLDOWN)) { sendAlert('Temperature', `${data.temperature}°C`, 'error'); lastAlertTimes.temp = now; } if (data.carbon > THRESHOLDS.co2 && (now - lastAlertTimes.co2 > ALERT_COOLDOWN)) { sendAlert('CO2 Level', `${data.carbon} ppm`, 'error'); lastAlertTimes.co2 = now; } if (data.humidity > THRESHOLDS.humidity && (now - lastAlertTimes.humidity > ALERT_COOLDOWN)) { sendAlert('Humidity', `${data.humidity}%`, 'warning'); lastAlertTimes.humidity = now; } }
  function sendAlert(metric, value, type) { const location = document.getElementById('sensorLocationName').textContent.split('*')[0]; const message = `High ${metric} detected: ${value} at ${location}.`; const timestamp = new Date().toLocaleString(); console.log(`--- ALERT: SIMULATING SMS to ${userDetails?.phone} and Email to ${userDetails?.email} ---`); console.log(message); showToast(message, type); activeAlerts.unshift({ metric, value, type, location, timestamp }); unreadAlertCount++; updateAlertBadge(); }
  function showToast(message, type = 'error') { const container = document.getElementById('toast-container'); const toast = document.createElement('div'); toast.className = `toast toast-${type}`; toast.innerHTML = `<strong><i class="fas fa-exclamation-triangle mr-2"></i>Alert!</strong><p class="text-sm">${message}</p>`; container.appendChild(toast); setTimeout(() => toast.classList.add('show'), 100); setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 5000); }

  // --- Alert Modal Logic ---
  alertBellBtn.addEventListener('click', () => { renderAlertsInModal(); alertModal.classList.remove('hidden'); unreadAlertCount = 0; updateAlertBadge(); });
  closeAlertModalBtn.addEventListener('click', () => { alertModal.classList.add('hidden'); });
  clearAllAlertsBtn.addEventListener('click', () => { activeAlerts = []; renderAlertsInModal(); unreadAlertCount = 0; updateAlertBadge(); });
  function updateAlertBadge() { if (unreadAlertCount > 0) { alertCountBadge.textContent = unreadAlertCount; alertCountBadge.classList.remove('hidden'); } else { alertCountBadge.classList.add('hidden'); } }
  function renderAlertsInModal() { alertsList.innerHTML = ''; if (activeAlerts.length === 0) { noAlertsMessage.classList.remove('hidden'); alertsList.appendChild(noAlertsMessage); } else { noAlertsMessage.classList.add('hidden'); activeAlerts.forEach(alert => { const alertDiv = document.createElement('div'); alertDiv.className = `bg-card-header p-3 rounded-md border-l-4 ${alert.type === 'error' ? 'border-red-500' : 'border-yellow-500'}`; alertDiv.innerHTML = `<p class="font-semibold text-text-primary">${alert.metric}: ${alert.value}</p><p class="text-xs text-text-secondary">${alert.location}</p><p class="text-xs text-text-secondary">${alert.timestamp}</p>`; alertsList.appendChild(alertDiv); }); } }
  
  // --- COLOR HELPER FUNCTIONS ---
  function interpolateColor(color1, color2, factor) {
      const r1 = parseInt(color1.substring(1, 3), 16);
      const g1 = parseInt(color1.substring(3, 5), 16);
      const b1 = parseInt(color1.substring(5, 7), 16);
      const r2 = parseInt(color2.substring(1, 3), 16);
      const g2 = parseInt(color2.substring(3, 5), 16);
      const b2 = parseInt(color2.substring(5, 7), 16);
      const r = Math.round(r1 + factor * (r2 - r1));
      const g = Math.round(g1 + factor * (g2 - g1));
      const b = Math.round(b1 + factor * (b2 - b1));
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  function getTemperatureColor(value) {
      const blue = "#3b82f6", green = "#22c55e", yellow = "#eab308";
      const lightRed = "#f87171", midRed = "#ef4444", darkRed = "#b91c1c";

      if (value <= 25) return interpolateColor(blue, green, value / 25);
      if (value <= 40) return interpolateColor(green, yellow, (value - 25) / 15);
      if (value <= 50) return interpolateColor(yellow, lightRed, (value - 40) / 10);
      if (value <= 70) return interpolateColor(lightRed, midRed, (value - 50) / 20);
      return interpolateColor(midRed, darkRed, (value - 70) / 30);
  }

  function getCO2Color(value) {
      const green = "#22c55e", yellow = "#eab308";
      const lightRed = "#f87171", midRed = "#ef4444", darkRed = "#b91c1c";

      if (value < 350) return green;
      if (value <= 450) return interpolateColor(green, yellow, (value - 350) / 100);
      if (value <= 500) return interpolateColor(yellow, lightRed, (value - 450) / 50);
      if (value <= 700) return interpolateColor(lightRed, midRed, (value - 500) / 200);
      return interpolateColor(midRed, darkRed, (value - 700) / 100);
  }


  // --- GLOBAL MAP VARIABLES ---
  let tempHeatLayer, humidityHeatLayer, co2HeatLayer, layerControl;

  // --- HEATMAP LOGIC ---
  function getGradient(type) {
      if (type === 'temperature') { return { 0.4: '#0000ff', 0.8: '#ffff00', 1.0: '#ff0000' }; }
      if (type === 'humidity') { return { 0.4: '#ffff00', 0.8: '#0000ff', 1.0: '#00008b' }; }
      if (type === 'co2') { return { 0.4: '#008000', 0.8: '#ffff00', 1.0: '#ff0000' }; }
      return {};
  }

  function updateAllHeatmaps() {
      if (historicalData.length > 0) {
          const tempPoints = historicalData.map(d => [d.latitude, d.longitude, d.temperature]);
          const humidityPoints = historicalData.map(d => [d.latitude, d.longitude, d.humidity]);
          const co2Points = historicalData.map(d => [d.latitude, d.longitude, d.carbon]);

          tempHeatLayer.setLatLngs(tempPoints);
          humidityHeatLayer.setLatLngs(humidityPoints);
          co2HeatLayer.setLatLngs(co2Points);
      }
  }

  function updateLegend(type) {
      const legend = document.getElementById('map-legend');
      if (!type) {
          legend.classList.add('hidden');
          return;
      }
      
      let legendContent = `<h4 class="font-bold text-xs mb-1">${type.charAt(0).toUpperCase() + type.slice(1)}</h4>`;
      let gradientStyle = '';

      if (type === 'temperature') {
          gradientStyle = 'linear-gradient(to right, #0000ff, #ffff00, #ff0000)';
          legendContent += `<div class="w-full h-3 rounded-md" style="background: ${gradientStyle};"></div><div class="flex justify-between text-xs mt-1"><span>25°C</span><span>45°C</span></div>`;
      } else if (type === 'humidity') {
          gradientStyle = 'linear-gradient(to right, #ffff00, #0000ff, #00008b)';
          legendContent += `<div class="w-full h-3 rounded-md" style="background: ${gradientStyle};"></div><div class="flex justify-between text-xs mt-1"><span>30%</span><span>80%</span></div>`;
      } else if (type === 'co2') {
          gradientStyle = 'linear-gradient(to right, #008000, #ffff00, #ff0000)';
          legendContent += `<div class="w-full h-3 rounded-md" style="background: ${gradientStyle};"></div><div class="flex justify-between text-xs mt-1"><span>200</span><span>500+</span></div>`;
      }
      legend.innerHTML = legendContent;
      legend.classList.remove('hidden');
  }

  // --- ANALYTICS CHART LOGIC ---
  const chartCanvas = document.getElementById('analytics-chart');
  const chartTimeFilter = document.getElementById('chart-time-filter');
  const chartDataFilter = document.getElementById('chart-data-filter');
  chartTimeFilter.addEventListener('change', renderAnalyticsChart);
  chartDataFilter.addEventListener('change', renderAnalyticsChart);
  function renderAnalyticsChart() {
    if (historicalData.length === 0) return;
    if (analyticsChart) { analyticsChart.destroy(); }
    const timeFilter = chartTimeFilter.value;
    const now = new Date();
    let filteredData = historicalData;
    if (timeFilter === '24h') { const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000); filteredData = filteredData.filter(d => new Date(d.timestamp) > oneDayAgo); }
    else if (timeFilter === '7d') { const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); filteredData = filteredData.filter(d => new Date(d.timestamp) > sevenDaysAgo); }
    const theme = document.body.getAttribute('data-theme') || 'light';
    const gridColor = theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    const fontColor = theme === 'dark' ? '#f9fafb' : '#1f2937';
    const selectedDataKey = chartDataFilter.value;
    const labels = filteredData.map(d => new Date(d.timestamp));
    const dataPoints = filteredData.map(d => d[selectedDataKey]);
    analyticsChart = new Chart(chartCanvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: chartDataFilter.options[chartDataFilter.selectedIndex].text,
          data: dataPoints,
          borderColor: 'var(--color-primary)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true, tension: 0.3, pointRadius: 2, borderWidth: 1.5
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { x: { type: 'time', time: { unit: 'hour' }, grid: { color: gridColor }, ticks: { color: fontColor } }, y: { beginAtZero: false, grid: { color: gridColor }, ticks: { color: fontColor } } }, plugins: { legend: { labels: { color: fontColor } } }, }
    });
  }
  
  // --- INITIALIZATION ---
  function initializeDashboard() {
    setTheme(localStorage.getItem('theme') || 'light');
    getUserLocationAndPersonalize(); // Ask for user's location
    const initialCoords = [10.9085, 76.9098];
    map = L.map('map').setView(initialCoords, 15);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    mainMarker = L.marker(initialCoords).addTo(map).bindPopup("Live Data Point");

    const heatOptions = { radius: 25, blur: 15, maxZoom: 18, minOpacity: 0.6 };
    tempHeatLayer = L.heatLayer([], { ...heatOptions, gradient: getGradient('temperature'), max: 50 });
    humidityHeatLayer = L.heatLayer([], { ...heatOptions, gradient: getGradient('humidity'), max: 100 });
    co2HeatLayer = L.heatLayer([], { ...heatOptions, gradient: getGradient('co2'), max: 600 }).addTo(map);

    const overlayMaps = {
        "<i class='fas fa-thermometer-half mr-2 text-red-500'></i> Temperature": tempHeatLayer,
        "<i class='fas fa-tint mr-2 text-blue-500'></i> Humidity": humidityHeatLayer,
        "<i class='fas fa-wind mr-2 text-gray-500'></i> CO₂": co2HeatLayer
    };
    
    layerControl = L.control.layers(null, overlayMaps, { position: 'topright', collapsed: false }).addTo(map);
    
    let visibleLayer = 'co2';
    updateLegend(visibleLayer);

    map.on('overlayadd', function(e) {
        if (e.name.includes('Temperature')) visibleLayer = 'temperature';
        else if (e.name.includes('Humidity')) visibleLayer = 'humidity';
        else if (e.name.includes('CO₂')) visibleLayer = 'co2';
        updateLegend(visibleLayer);
    });
    
    map.on('overlayremove', function(e) {
        updateLegend(null);
    });

    fetchData();
    setInterval(fetchData, 5000);
  }

  initializeDashboard();
});