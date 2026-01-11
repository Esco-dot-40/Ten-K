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

        // Log for debugging
        if (process.env.NODE_ENV !== 'production') {
            console.log('[ANALYTICS] IP:', ip, 'Geo:', geo);
        }

        // Device type detection
        const device = uaParser.getDevice();
        let deviceType = 'Desktop';
        if (device.type === 'mobile') deviceType = 'Mobile';
        else if (device.type === 'tablet') deviceType = 'Tablet';

        // Traffic source detection
        const referrer = req.headers['referer'] || req.headers['referrer'] || 'Direct';
        let trafficSource = 'Direct';
        if (referrer !== 'Direct') {
            try {
                const refUrl = new URL(referrer);
                trafficSource = refUrl.hostname;
            } catch (e) {
                trafficSource = 'Unknown';
            }
        }

        // Session tracking (using cookies if available)
        const sessionId = req.headers['cookie']?.match(/farkle_session=([^;]+)/)?.[1] ||
            `session_${Date.now()}_${Math.random().toString(36)}`;

        // Check if returning visitor (basic heuristic: same IP in last 30 days)
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const isReturning = analyticsData.hits.some(h =>
            h.ip === ip && h.timestamp > thirtyDaysAgo
        );

        const hit = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            timestamp: Date.now(),
            path: req.path,
            ip: ip,
            sessionId: sessionId,
            isReturning: isReturning,
            deviceType: deviceType,
            trafficSource: trafficSource,
            referrer: referrer,
            geo: geo ? {
                country: geo.country,
                region: geo.region,
                city: geo.city,
                timezone: geo.timezone,
                ll: geo.ll // [lat, long]
            } : null,
            ua: {
                browser: uaParser.getBrowser(),
                os: uaParser.getOS(),
                device: uaParser.getDevice(),
                engine: uaParser.getEngine()
            }
        };

        analyticsData.hits.push(hit);

        // Trim history if needed
        if (analyticsData.hits.length > 20000) {
            analyticsData.hits = analyticsData.hits.slice(-10000);
        }
    },

    trackEvent: (type, data) => {
        const hit = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            timestamp: Date.now(),
            type: type,
            data: data,
            // Minimal shell for compatibility
            ua: { browser: {}, os: {}, device: {} },
            geo: {}
        };
        analyticsData.hits.push(hit);
        if (analyticsData.hits.length > 20000) analyticsData.hits = analyticsData.hits.slice(-10000);
    },

    getStats: (activeSocketCount = 0) => {
        // Aggregate Data
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;

        // Filter standard hits for visitors stats
        const hits = analyticsData.hits.filter(h => !h.type || h.type === 'hit');
        const last24h = hits.filter(h => now - h.timestamp < oneDay);

        // Group by Country
        const countries = {};
        last24h.forEach(h => {
            if (h.geo && h.geo.country) countries[h.geo.country] = (countries[h.geo.country] || 0) + 1;
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
            const b = h.ua?.browser?.name || 'Unknown';
            const o = h.ua?.os?.name || 'Unknown';
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
                timeline[diffHours]++;
            }
        });

        const chartData = timeline.reverse();

        // Recent Hits (Mix of everything for the table)
        const recent = analyticsData.hits.slice(-50).reverse();

        return {
            totalHitsAllTime: hits.length,
            hits24h: last24h.length,
            activeUsers: activeSocketCount,
            countries,
            cities,
            browsers,
            os,
            mapData,
            timeline: chartData,
            recent
        };
    }
};
