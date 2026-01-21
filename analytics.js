import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const UAParser = require('ua-parser-js');
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'analytics_data.json');

// In-memory storage
let analyticsData = {
    hits: [],
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
    trackHit: async (req) => {
        try {
            if (req.path.startsWith('/api') || req.path.startsWith('/socket.io') || req.path.startsWith('/libs') || req.path.includes('.')) {
                if (req.path !== '/' && req.path !== '/index.html') return;
            }

            const ip = (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
            const uaString = req.headers['user-agent'];
            const uaParser = new UAParser(uaString);

            // Use ip-api.com for accurate geolocation (free, no key, 45 req/min)
            let geo = null;
            try {
                // ip-api.com works via HTTP by default for free tier
                const geoResponse = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,proxy,query`);
                const geoData = await geoResponse.json();

                if (geoData.status === 'success') {
                    geo = {
                        country: geoData.country,
                        countryCode: geoData.countryCode,
                        region: geoData.region,
                        regionName: geoData.regionName,
                        city: geoData.city,
                        zip: geoData.zip,
                        lat: geoData.lat,
                        lon: geoData.lon,
                        ll: [geoData.lat, geoData.lon],
                        timezone: geoData.timezone,
                        isp: geoData.isp,
                        org: geoData.org,
                        as: geoData.as,
                        proxy: geoData.proxy || false
                    };
                }
            } catch (e) {
                console.warn('[ANALYTICS] ip-api.com lookup failed, trying fallback:', e.message);
                try {
                    const fbResponse = await fetch(`https://ipapi.co/${ip}/json/`);
                    const fbData = await fbResponse.json();
                    if (!fbData.error) {
                        geo = {
                            country: fbData.country_name,
                            countryCode: fbData.country_code,
                            region: fbData.region_code,
                            regionName: fbData.region,
                            city: fbData.city,
                            zip: fbData.postal,
                            lat: fbData.latitude,
                            lon: fbData.longitude,
                            ll: [fbData.latitude, fbData.longitude],
                            timezone: fbData.timezone,
                            isp: fbData.org,
                            org: fbData.org,
                            as: fbData.asn,
                            proxy: false // ipapi.co free doesn't easily show proxy in basic json
                        };
                    }
                } catch (fbErr) {
                    console.warn('[ANALYTICS] Full geolocation failure:', fbErr.message);
                }
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

            // Session tracking
            const sessionId = req.headers['cookie']?.match(/farkle_session=([^;]+)/)?.[1] ||
                `session_${Date.now()}_${Math.random().toString(36)}`;

            // Check if returning visitor
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
                geo: geo,
                ua: {
                    browser: uaParser.getBrowser(),
                    os: uaParser.getOS(),
                    device: uaParser.getDevice(),
                    engine: uaParser.getEngine()
                }
            };

            analyticsData.hits.push(hit);

            // Trim history
            if (analyticsData.hits.length > 20000) {
                analyticsData.hits = analyticsData.hits.slice(-10000);
            }
        } catch (err) {
            console.error('[ANALYTICS] Full TrackHit Failure:', err);
        }
    },

    trackEvent: (type, data) => {
        const hit = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            timestamp: Date.now(),
            type: type,
            data: data,
            ua: { browser: {}, os: {}, device: {} },
            geo: {}
        };
        analyticsData.hits.push(hit);
        if (analyticsData.hits.length > 20000) analyticsData.hits = analyticsData.hits.slice(-10000);
    },

    getStats: (activeSocketCount = 0) => {
        try {
            const now = Date.now();
            const oneDay = 24 * 60 * 60 * 1000;

            // Filter hits
            const hits = analyticsData.hits.filter(h => !h.type || h.type === 'hit');
            const last24h = hits.filter(h => now - h.timestamp < oneDay);

            // Unique visitors
            const uniqueIPs = new Set(last24h.map(h => h.ip)).size;

            // New vs Returning
            const newVisitors = last24h.filter(h => !h.isReturning).length;
            const returningVisitors = last24h.filter(h => h.isReturning).length;

            // Device Types
            const deviceTypes = {};
            last24h.forEach(h => {
                const type = h.deviceType || 'Desktop';
                deviceTypes[type] = (deviceTypes[type] || 0) + 1;
            });

            // Traffic Sources
            const trafficSources = {};
            last24h.forEach(h => {
                const source = h.trafficSource || 'Direct';
                trafficSources[source] = (trafficSources[source] || 0) + 1;
            });

            // Countries
            const countries = {};
            last24h.forEach(h => {
                if (h.geo && h.geo.countryCode) {
                    countries[h.geo.countryCode] = (countries[h.geo.countryCode] || 0) + 1;
                } else if (h.geo && h.geo.country) {
                    countries[h.geo.country] = (countries[h.geo.country] || 0) + 1;
                }
            });

            // Cities
            const cities = {};
            last24h.forEach(h => {
                if (h.geo && h.geo.city) {
                    const key = `${h.geo.city}, ${h.geo.regionName || h.geo.region || ''}, ${h.geo.country}`;
                    cities[key] = (cities[key] || 0) + 1;
                }
            });

            // Browsers/OS
            const browsers = {};
            const os = {};
            last24h.forEach(h => {
                const b = h.ua?.browser?.name || 'Unknown';
                const o = h.ua?.os?.name || 'Unknown';
                browsers[b] = (browsers[b] || 0) + 1;
                os[o] = (os[o] || 0) + 1;
            });

            // Heatmap
            const mapData = last24h.map(h => h.geo ? h.geo.ll : null).filter(ll => ll);

            // Timeline
            const timeline = new Array(24).fill(0);
            last24h.forEach(h => {
                const diffHours = Math.floor((now - h.timestamp) / (1000 * 60 * 60));
                if (diffHours < 24) {
                    timeline[diffHours]++;
                }
            });

            const chartData = timeline.reverse();
            const recent = analyticsData.hits.slice(-50).reverse();

            return {
                totalHitsAllTime: hits.length,
                hits24h: last24h.length,
                activeUsers: activeSocketCount,
                uniqueVisitors: uniqueIPs,
                newVisitors,
                returningVisitors,
                deviceTypes,
                trafficSources,
                countries,
                cities,
                browsers,
                os,
                mapData,
                timeline: chartData,
                recent
            };
        } catch (err) {
            console.error('[ANALYTICS] GetStats Error:', err);
            return { error: true, message: err.message };
        }
    }
};
