// app.js
let authToken = localStorage.getItem('admin_token');
const loginOverlay = document.getElementById('login-overlay');
const dashboard = document.getElementById('dashboard');

// Init
if (authToken) {
    verifyToken();
} else {
    showLogin();
}

function showLogin() {
    loginOverlay.classList.remove('hidden');
    dashboard.classList.add('hidden');
}

function showDashboard() {
    loginOverlay.classList.add('hidden');
    dashboard.classList.remove('hidden');
    loadStats();
    // Auto refresh
    setInterval(loadStats, 10000);
}

document.getElementById('login-btn').addEventListener('click', async () => {
    const pass = document.getElementById('admin-pass').value;
    try {
        const res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pass })
        });
        const data = await res.json();
        if (data.success) {
            authToken = data.token;
            localStorage.setItem('admin_token', authToken);
            showDashboard();
        } else {
            document.getElementById('login-error').style.display = 'block';
        }
    } catch (e) {
        console.error(e);
        document.getElementById('login-error').textContent = "Connection Error";
        document.getElementById('login-error').style.display = 'block';
    }
});

async function verifyToken() {
    // Optimistic load
    showDashboard();
}

document.getElementById('refresh-btn').addEventListener('click', loadStats);

// --- Charts & Map ---
let trafficChart, browserChart, osChart, map;

function initCharts() {
    // Traffic
    const ctxT = document.getElementById('traffic-chart').getContext('2d');
    trafficChart = new Chart(ctxT, {
        type: 'line',
        data: { labels: Array.from({ length: 24 }, (_, i) => `${23 - i}h`), datasets: [{ label: 'Hits', data: [], borderColor: '#4d9bea', tension: 0.4, fill: true, backgroundColor: 'rgba(77, 155, 234, 0.1)' }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#2a2d35' } }, x: { grid: { display: false } } } }
    });

    // Browser
    const ctxB = document.getElementById('browser-chart').getContext('2d');
    browserChart = new Chart(ctxB, {
        type: 'doughnut',
        data: { labels: [], datasets: [{ data: [], backgroundColor: ['#4d9bea', '#5fb376', '#e05a47', '#f2c94c', '#d869a8'] }] },
        options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: '#888' } } }, cutout: '70%', borderWidth: 0 }
    });

    // OS
    const ctxO = document.getElementById('os-chart').getContext('2d');
    osChart = new Chart(ctxO, {
        type: 'doughnut',
        data: { labels: [], datasets: [{ data: [], backgroundColor: ['#4d9bea', '#5fb376', '#e05a47', '#f2c94c', '#d869a8'] }] },
        options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: '#888' } } }, cutout: '70%', borderWidth: 0 }
    });

    // Map
    map = L.map('map').setView([20, 0], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);
}

let chartsInited = false;

async function loadStats() {
    if (!authToken) return;
    try {
        const res = await fetch('/api/admin/stats', {
            headers: { 'Authorization': authToken }
        });
        if (res.status === 401) {
            localStorage.removeItem('admin_token');
            authToken = null;
            showLogin();
            return;
        }
        const data = await res.json();
        renderStats(data);
    } catch (e) {
        console.error("Load Stats Error", e);
    }
}

function renderStats(data) {
    document.getElementById('stat-active').textContent = data.activeUsers;
    document.getElementById('stat-unique').textContent = data.uniqueVisitors || 0;
    document.getElementById('stat-new-ret').textContent = `${data.newVisitors || 0}/${data.returningVisitors || 0}`;

    // Top Device
    const devices = data.deviceTypes || {};
    const topDevice = Object.entries(devices).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Desktop';
    document.getElementById('stat-device').textContent = topDevice;

    if (!chartsInited) {
        initCharts();
        chartsInited = true;
    }

    // Update Chart themes/colors
    trafficChart.data.datasets[0].borderColor = '#00f2ff';
    trafficChart.data.datasets[0].backgroundColor = 'rgba(0, 242, 255, 0.05)';

    // Traffic
    trafficChart.data.datasets[0].data = data.timeline;
    trafficChart.update();

    // Browser
    browserChart.data.labels = Object.keys(data.browsers);
    browserChart.data.datasets[0].data = Object.values(data.browsers);
    browserChart.update();

    // OS
    osChart.data.labels = Object.keys(data.os);
    osChart.data.datasets[0].data = Object.values(data.os);
    osChart.update();

    // Map
    // Clear markers?
    map.eachLayer((layer) => {
        if (layer instanceof L.Marker || layer instanceof L.CircleMarker) {
            map.removeLayer(layer);
        }
    });

    // Add markers (heatmap style circles)
    // Consolidate identical locations?
    const counts = {};
    data.mapData.forEach(ll => {
        const key = ll.join(',');
        counts[key] = (counts[key] || 0) + 1;
    });

    Object.entries(counts).forEach(([key, count]) => {
        const [lat, lng] = key.split(',').map(Number);
        const size = Math.min(20, 5 + (count * 2));
        L.circleMarker([lat, lng], {
            radius: size,
            color: '#4d9bea',
            fillColor: '#4d9bea',
            fillOpacity: 0.5,
            weight: 0
        }).addTo(map).bindPopup(`Visits: ${count}`);
    });

    // Top Locations List
    const countryContainer = document.getElementById('country-list');
    countryContainer.innerHTML = '';
    // Use the cities data which contains City, Region, Country
    const sortedLocations = Object.entries(data.cities || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
    sortedLocations.forEach(([loc, count]) => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `<span style="font-size: 0.8rem;">${loc || 'Unknown'}</span> <span>${count}</span>`;
        countryContainer.appendChild(div);
    });

    // Recent Table
    const tableBody = document.getElementById('recent-table');
    tableBody.innerHTML = '';
    data.recent.forEach(hit => {
        const tr = document.createElement('tr');
        const date = new Date(hit.timestamp).toLocaleTimeString();

        const city = hit.geo?.city || 'Unknown';
        const region = hit.geo?.regionName || hit.geo?.region || '';
        const country = hit.geo?.countryCode || hit.geo?.country || '';
        const locString = `${city}${region ? ', ' + region : ''} (${country})`;
        const isp = hit.geo?.isp || hit.geo?.org || '';

        tr.innerHTML = `
            <td>${date}</td>
            <td>${hit.ip}</td>
            <td style="font-size: 0.75rem; color: var(--text-muted); max-width: 100px; overflow: hidden; text-overflow: ellipsis;">${hit.path}</td>
            <td title="${isp}">${locString}</td>
            <td style="font-size: 0.8rem;">${hit.ua.os.name || '??'} / ${hit.ua.browser.name || '??'}</td>
        `;
        tableBody.appendChild(tr);
    });
}
