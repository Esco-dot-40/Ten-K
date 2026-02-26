import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { UAParser } from 'ua-parser-js';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'analytics_data.json');

// In-memory storage
let analyticsData = {
    hits: [],
    blockedIPs: [],
    blockedCountries: []
};

// Load data on startup
try {
    if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        analyticsData = {
            hits: parsed.hits || [],
            blockedIPs: parsed.blockedIPs || [],
            blockedCountries: parsed.blockedCountries || []
        };
    }
} catch (e) {
    // Analytics load fail
}

// Save data periodically
setInterval(() => {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(analyticsData, null, 2));
    } catch (e) {
        // Analytics save fail
    }
}, 60000); // Every minute

export const analytics = {
    getIP: (req) => {
        return (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    },

    checkAllowed: async (req) => {
        const ip = analytics.getIP(req);

        // Block IPv6 localhost if preferred (optional)
        if (analyticsData.blockedIPs.includes(ip)) return false;

        // For Geolocation blocking, we need to know the country
        // We can cache this in the request object to avoid double lookups
        if (!req.geo) {
            req.geo = await analytics.lookupGeo(ip);
        }

        if (req.geo && analyticsData.blockedCountries.includes(req.geo.countryCode)) {
            console.log(`[FIREWALL] Blocked request from ${ip} (${req.geo.countryCode})`);
            return false;
        }

        return true;
    },

    lookupGeo: async (ip) => {
        if (ip === '::1' || ip === '127.0.0.1') return null;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,proxy,query`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            const data = await response.json();
            if (data.status === 'success') {
                return {
                    country: data.country,
                    countryCode: data.countryCode,
                    region: data.region,
                    city: data.city,
                    lat: data.lat,
                    lon: data.lon,
                    ll: [data.lat, data.lon],
                    isp: data.isp,
                    proxy: data.proxy || false
                };
            }
        } catch (e) {
            // Silently fail geo-lookup
        }
        return null;
    },

    trackHit: async (req) => {
        try {
            // Simplify: ignore internal assets
            if (req.path.includes('.') && !req.path.endsWith('.html')) return;
            if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return;

            const ip = analytics.getIP(req);
            const uaString = req.headers['user-agent'];
            const uaParser = new UAParser(uaString);

            if (!req.geo) {
                req.geo = await analytics.lookupGeo(ip);
            }

            const hit = {
                id: Date.now().toString(36) + Math.random().toString(36).substr(2),
                timestamp: Date.now(),
                path: req.path,
                ip: ip,
                deviceType: uaParser.getDevice().type || 'Desktop',
                trafficSource: req.headers['referer'] || 'Direct',
                geo: req.geo,
                ua: {
                    browser: uaParser.getBrowser().name,
                    os: uaParser.getOS().name
                }
            };

            analyticsData.hits.push(hit);
            if (analyticsData.hits.length > 10000) {
                analyticsData.hits = analyticsData.hits.slice(-5000);
            }
        } catch (err) {
            // track hit fail
        }
    },

    trackEvent: (type, data) => {
        const event = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            timestamp: Date.now(),
            type: type,
            data: data
        };
        analyticsData.hits.push(event);
    },

    // Firewall management
    blockIP: (ip) => {
        if (!analyticsData.blockedIPs.includes(ip)) {
            analyticsData.blockedIPs.push(ip);
            return true;
        }
        return false;
    },
    unblockIP: (ip) => {
        analyticsData.blockedIPs = analyticsData.blockedIPs.filter(i => i !== ip);
    },
    blockCountry: (code) => {
        if (!analyticsData.blockedCountries.includes(code)) {
            analyticsData.blockedCountries.push(code);
            return true;
        }
        return false;
    },
    unblockCountry: (code) => {
        analyticsData.blockedCountries = analyticsData.blockedCountries.filter(c => c !== code);
    },

    getStats: (activeSocketCount = 0) => {
        try {
            const now = Date.now();
            const oneDay = 24 * 60 * 60 * 1000;
            const hits = analyticsData.hits.filter(h => !h.type);
            const last24h = hits.filter(h => now - h.timestamp < oneDay);

            // Calculate aggregate stats
            const browsers = {};
            const os = {};
            const deviceTypes = {};
            const cities = {};
            const mapData = [];

            last24h.forEach(h => {
                const bName = typeof h.ua?.browser === 'object' ? h.ua.browser.name : h.ua?.browser;
                const oName = typeof h.ua?.os === 'object' ? h.ua.os.name : h.ua?.os;

                if (bName) browsers[bName] = (browsers[bName] || 0) + 1;
                if (oName) os[oName] = (os[oName] || 0) + 1;
                deviceTypes[h.deviceType] = (deviceTypes[h.deviceType] || 0) + 1;

                if (h.geo) {
                    const loc = h.geo.city ? `${h.geo.city}, ${h.geo.countryCode}` : h.geo.country;
                    if (loc) cities[loc] = (cities[loc] || 0) + 1;
                    if (h.geo.ll) mapData.push(h.geo.ll);
                }
            });

            // Count unique visitors by IP
            const uniqueVisitors = new Set(hits.map(h => h.ip)).size;
            const returningVisitors = hits.length - uniqueVisitors; // Naive approximation

            return {
                totalHitsAllTime: hits.length,
                hits24h: last24h.length,
                activeUsers: activeSocketCount,
                uniqueVisitors: uniqueVisitors,
                newVisitors: uniqueVisitors,
                returningVisitors: returningVisitors,
                blockedCountries: analyticsData.blockedCountries,
                recent: analyticsData.hits.slice(-50).reverse(),
                timeline: analytics.getTimeline(last24h),
                browsers,
                os,
                deviceTypes,
                cities,
                mapData
            };
        } catch (err) {
            console.error("Analytics Stats Error", err);
            return { error: true, message: err.message };
        }
    },

    getTimeline: (hits) => {
        const now = Date.now();
        const timeline = new Array(24).fill(0);
        hits.forEach(h => {
            const diffHours = Math.floor((now - h.timestamp) / (1000 * 60 * 60));
            if (diffHours < 24) {
                timeline[23 - diffHours]++;
            }
        });
        return timeline;
    }
};
