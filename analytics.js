import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const geoip = require('geoip-lite');
const UAParser = require('ua-parser-js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'analytics_data.json');

// In-memory storage
let analyticsData = {
    hits: [],
    // We can aggregate stats on load or on the fly
};

// Load data on startup
try {
    if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        analyticsData = JSON.parse(raw);
    }
} catch (e) {
    console.error("Failed to load analytics data:", e);
}

// Save data periodically
setInterval(() => {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(analyticsData, null, 2));
    } catch (e) {
        console.error("Failed to save analytics data:", e);
    }
}, 60000); // Every minute

export const analytics = {
    trackHit: (req) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/socket.io') || req.path.startsWith('/libs') || req.path.includes('.')) {
            // Filter out assets like .css, .js unless it's the main page.
            if (req.path !== '/' && req.path !== '/index.html') return;
        }

        const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        const uaString = req.headers['user-agent'];
        const uaParser = new UAParser(uaString);
        const geo = geoip.lookup(ip);

        const hit = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            timestamp: Date.now(),
            path: req.path,
            ip: ip, // In production, might want to hash this for privacy, but user asked for IP
            geo: geo ? {
                country: geo.country,
                region: geo.region,
                city: geo.city,
                ll: geo.ll // [lat, long]
            } : null,
            ua: {
                browser: uaParser.getBrowser(),
                os: uaParser.getOS(),
                device: uaParser.getDevice()
            }
        };

        analyticsData.hits.push(hit);

        // Trim history if needed (e.g. keep last 10000)
        if (analyticsData.hits.length > 20000) {
            analyticsData.hits = analyticsData.hits.slice(-10000);
        }
    },

    getStats: (activeSocketCount = 0) => {
        // Aggregate Data
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        const last24h = analyticsData.hits.filter(h => now - h.timestamp < oneDay);

        // Group by Country
        const countries = {};
        last24h.forEach(h => {
            if (h.geo && h.geo.country) {
                countries[h.geo.country] = (countries[h.geo.country] || 0) + 1;
            }
        });

        // Group by City/Region for detailed view
        const cities = {};
        last24h.forEach(h => {
            if (h.geo && h.geo.city) {
                const key = `${h.geo.city}, ${h.geo.region || ''}, ${h.geo.country}`;
                cities[key] = (cities[key] || 0) + 1;
            }
        });

        // Group by OS/Browser
        const browsers = {};
        const os = {};
        last24h.forEach(h => {
            const b = h.ua.browser.name || 'Unknown';
            const o = h.ua.os.name || 'Unknown';
            browsers[b] = (browsers[b] || 0) + 1;
            os[o] = (os[o] || 0) + 1;
        });

        // Heatmap Data
        const mapData = last24h.map(h => h.geo ? h.geo.ll : null).filter(ll => ll);

        // Visits timeline
        const timeline = new Array(24).fill(0);
        last24h.forEach(h => {
            const diffHours = Math.floor((now - h.timestamp) / (1000 * 60 * 60));
            if (diffHours < 24) {
                // 0 is now-1h range. 23 is 23-24h ago range.
                timeline[diffHours]++;
            }
        });

        const chartData = timeline.reverse();

        // Recent Hits
        const recent = analyticsData.hits.slice(-50).reverse();

        return {
            totalHitsAllTime: analyticsData.hits.length,
            hits24h: last24h.length,
            activeUsers: activeSocketCount,
            countries,
            cities, // New
            browsers,
            os,
            mapData,
            timeline: chartData,
            recent
        };
    }
};
