/**
 * SYNC VERIFIED: 2026-02-10 07:50
 * This comment proves the push is working.
 */
console.log("------------------------------------------");
console.log("🚀 SERVER STARTING UP...");
console.log("Time:", new Date().toISOString());
console.log("------------------------------------------");

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';
import { calculateScore, hasPossibleMoves, isScoringSelection, DEFAULT_RULES } from './public/rules.js';
import { analytics } from './analytics.js';
import { db, database } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Enable dynamic MIME types for ESM modules
express.static.mime.define({ 'application/javascript': ['mjs'] });

const app = express();
app.enable("trust proxy");

// 1. Global CORS Middleware (Crucial for Discord Activities)
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    // Security headers for Discord
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
});

app.use(express.json());

// Log incoming requests for debugging
app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.url} from ${req.ip} | UA: ${req.get('user-agent')}`);
    next();
});

// Health Check for Deployment Platforms
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// 🛡️ Firewall & Analytics Middleware
app.use(async (req, res, next) => {
    // 1. Firewall Check (IP & Geo-Blocking)
    const isAllowed = await analytics.checkAllowed(req);
    if (!isAllowed) {
        console.warn(`[FIREWALL] Would block request from ${req.ip} to ${req.url} (currently non-blocking)`);
    }

    // 2. Track Analytics (Simplified)
    analytics.trackHit(req).catch(() => { });
    next();
});

// New Endpoint: Identify User for Analytics
app.post('/api/analytics/identify', (req, res) => {
    const { userId, username, globalName } = req.body;
    if (userId) {
        analytics.trackEvent('identify', { userId, username, globalName });
    }
    res.json({ success: true });
});

// Stats/Leaderboard Endpoint
app.get('/api/stats/leaderboard', async (req, res) => {
    try {
        const leaderboard = await db.getLeaderboard();
        res.json(leaderboard);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

app.get('/api/stats/:userId', async (req, res) => {
    try {
        const user = await db.getUser(req.params.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch user stats' });
    }
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        allowedHeaders: ["my-custom-header"],
        credentials: true
    }
});



app.use(express.static(join(__dirname, 'public')));
app.use('/libs', express.static(join(__dirname, 'node_modules')));

// --- Admin API ---
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123'; // Default password

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASS) {
        // Simple token: just the password (for now) or a fixed string
        // If "like others", maybe session? But token is easier for SPA
        res.json({ success: true, token: 'valid-token-' + ADMIN_PASS });
    } else {
        res.status(401).json({ success: false });
    }
});

app.get('/api/admin/stats', (req, res) => {
    const auth = req.headers['authorization'];
    if (auth === 'valid-token-' + ADMIN_PASS) {
        res.json(analytics.getStats(io.engine.clientsCount));
    } else {
        res.status(401).json({ error: "Unauthorized" });
    }
});

// Firewall Management API
app.post('/api/admin/firewall/block-ip', (req, res) => {
    const auth = req.headers['authorization'];
    if (auth !== 'valid-token-' + ADMIN_PASS) return res.status(401).json({ error: "Unauthorized" });
    const { ip } = req.body;
    analytics.blockIP(ip);
    res.json({ success: true });
});

app.post('/api/admin/firewall/unblock-ip', (req, res) => {
    const auth = req.headers['authorization'];
    if (auth !== 'valid-token-' + ADMIN_PASS) return res.status(401).json({ error: "Unauthorized" });
    const { ip } = req.body;
    analytics.unblockIP(ip);
    res.json({ success: true });
});

app.post('/api/admin/firewall/block-country', (req, res) => {
    const auth = req.headers['authorization'];
    if (auth !== 'valid-token-' + ADMIN_PASS) return res.status(401).json({ error: "Unauthorized" });
    const { countryCode } = req.body;
    analytics.blockCountry(countryCode);
    res.json({ success: true });
});

app.post('/api/admin/firewall/unblock-country', (req, res) => {
    const auth = req.headers['authorization'];
    if (auth !== 'valid-token-' + ADMIN_PASS) return res.status(401).json({ error: "Unauthorized" });
    const { countryCode } = req.body;
    analytics.unblockCountry(countryCode);
    res.json({ success: true });
});



app.post('/api/token', async (req, res) => {
    const { code } = req.body;
    let { redirectUri } = req.body;
    const secret = process.env.DISCORD_CLIENT_SECRET || process.env.DISCORD_SECRET;

    if (code === 'mock_code') return res.json({ access_token: 'mock', user: { id: 'mock', username: 'MockUser', global_name: 'Mock User' } });

    if (!secret) return res.status(500).json({ error: "Server Configuration Error" });

    // Note: For Discord Activities, we usually don't need redirect_uri if it wasn't used in authorize()
    // By NOT defaulting to .env here, we allow the SDK to work without a strict redirect mapping if not needed.

    try {
        const paramsData = {
            client_id: process.env.DISCORD_CLIENT_ID || '1455067365694771364',
            client_secret: secret,
            grant_type: 'authorization_code',
            code
        };
        if (redirectUri) paramsData.redirect_uri = redirectUri;

        const params = new URLSearchParams(paramsData);
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params,
        });

        const tokenData = await tokenResponse.json();
        if (!tokenData.access_token) throw new Error(JSON.stringify(tokenData));

        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: { authorization: `Bearer ${tokenData.access_token}` },
        });
        const userData = await userResponse.json();

        await db.upsertUser(userData);
        res.json({ access_token: tokenData.access_token, user: userData });
    } catch (err) {
        res.status(500).json({ error: 'Auth Failed' });
    }
});

// Web Discord Auth Routes
app.get('/api/access/auth/discord', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID || '1455588853254717510';

    // Priority Detection for Redirect URI: Use environment variable if available, 
    // otherwise reconstruct from the current request to ensure it matches the domain the user is on.
    let redirectUri = process.env.DISCORD_CALLBACK_URL;

    const host = req.get('x-forwarded-host') || req.get('host') || '';
    let protocol = req.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');

    // Safety check: If we're on the production domain but somehow getting 'http', force 'https'
    if (host.includes('velarixsolutions.nl') || host.includes('veroe.space')) {
        protocol = 'https';
    }

    // If not using the environment variable, or if we want to be dynamic for known domains
    if (!redirectUri || host.includes('veroe.space') || host.includes('localhost') || host.includes('velarixsolutions.nl')) {
        redirectUri = `${protocol}://${host}/api/access/auth/discord/callback`;
    }

    const scope = encodeURIComponent('identify guilds');
    const url = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}`;
    console.log(`[AUTH-DEBUG] Initiating login | Host: ${host} | ID: ${clientId} | Generated URI: ${redirectUri}`);
    res.redirect(url);
});

app.get('/api/access/auth/discord/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.send("Auth failed: No code");

    const secret = process.env.DISCORD_CLIENT_SECRET || process.env.DISCORD_SECRET;
    const clientId = process.env.DISCORD_CLIENT_ID || '1455588853254717510';

    const host = req.get('x-forwarded-host') || req.get('host') || '';
    let protocol = req.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
    if (host.includes('velarixsolutions.nl') || host.includes('veroe.space')) {
        protocol = 'https';
    }
    let redirectUri = process.env.DISCORD_CALLBACK_URL;

    if (!redirectUri || host.includes('veroe.space') || host.includes('localhost') || host.includes('velarixsolutions.nl')) {
        redirectUri = `${protocol}://${host}/api/access/auth/discord/callback`;
    }

    try {
        const params = new URLSearchParams({
            client_id: clientId,
            client_secret: secret,
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri
        });

        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params,
        });

        const tokenData = await tokenResponse.json();
        if (!tokenData.access_token) throw new Error(JSON.stringify(tokenData));

        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: { authorization: `Bearer ${tokenData.access_token}` },
        });
        const userData = await userResponse.json();

        await db.upsertUser(userData);

        res.send(`
            <script>
                window.opener.postMessage({
                    type: 'DISCORD_AUTH_SUCCESS',
                    token: "${tokenData.access_token}",
                    user: ${JSON.stringify(userData)}
                }, "*");
                window.close();
            </script>
        `);
    } catch (err) {
        console.error("Web Auth Callback Error:", err);
        res.status(500).send(`Auth Failed: ${err.message}`);
    }
});

// Bug Report Endpoint
app.post('/api/bug-report', async (req, res) => {
    const { username, userId, problem, description, reproduction, severity, timestamp, userAgent } = req.body;

    try {
        // Log the bug report (you can also store it in the database)
        console.log('[BUG REPORT]', {
            username,
            userId,
            problem,
            severity,
            timestamp: new Date(timestamp).toISOString()
        });

        // Store in database if you have a bug_reports table
        // await db.createBugReport({ username, userId, problem, description, reproduction, severity, timestamp, userAgent });

        // For now, just acknowledge receipt
        res.json({ success: true, message: 'Bug report received' });
    } catch (error) {
        console.error('Error processing bug report:', error);
        res.status(500).json({ success: false, error: 'Failed to submit bug report' });
    }
});

class GameState {
    constructor(roomCode, rules = DEFAULT_RULES) {
        this.roomCode = roomCode;
        this.players = [];
        this.spectators = []; // New spectator list
        this.currentPlayerIndex = 0;
        this.rules = { ...rules };

        this.roundAccumulatedScore = 0;
        this.diceCountToRoll = 6;
        this.currentDice = [];
        this.isFinalRound = false;
        this.finalRoundTriggeredBy = null;
        this.farkleCount = 0;

        // High Stakes State
        this.previousPlayerLeftoverDice = 0;
        this.canHighStakes = false;

        this.gameStatus = 'waiting';
        this.winner = null;
        this.hostId = null; // Track Host
        this.boardClears = 0; // Track how many times board was cleared in a turn
        this.locked = false; // Prevent actions during delays (farkle timeouts, etc)

        this.votes = {
            reset: new Set(),
            next: new Set(),
            type: null // 'reset' or 'next'
        };
        this.turnStartTime = Date.now();
        this.reminded = false;
        this.persistence = {}; // Key: dbId or reconnectToken, Value: player data
    }

    startVote(type, playerId) {
        if (this.votes.type) return { error: "A vote is already in progress" };
        if (type !== 'reset' && type !== 'next') return { error: "Invalid vote type" };

        this.votes.type = type;
        this.votes[type] = new Set([playerId]);
        return { success: true };
    }

    castVote(playerId) {
        if (!this.votes.type) return { error: "No vote in progress" };
        this.votes[this.votes.type].add(playerId);
        return { success: true };
    }

    checkVotePassed() {
        if (!this.votes.type) return false;
        const connectedPlayers = this.players.filter(p => p.connected);
        const total = connectedPlayers.length;
        const count = this.votes[this.votes.type].size;

        if (total === 2) {
            return count === 2;
        } else {
            return count / total >= 0.6;
        }
    }

    clearVotes() {
        this.votes.type = null;
        this.votes.reset = new Set();
        this.votes.next = new Set();
    }

    addPlayer(id, name, reconnectToken, dbId) {
        if (this.players.length >= 10) return false;

        // Find first available seat
        const takenSeats = new Set(this.players.map(p => p.seat));
        let seat = 0;
        while (takenSeats.has(seat)) {
            seat++;
        }

        // Assign host if first player (or if host left and this is first new joiner, though logic handles host migration on leave)
        if (this.players.length === 0) {
            this.hostId = id;
        }

        this.players.push({
            id,
            name,
            score: 0,
            connected: true,
            farkles: 0,
            hasOpened: false,
            reconnectToken: reconnectToken || null,
            missedTurns: 0,
            dbId: dbId || null,
            farkles: 0,
            maxRoundScore: 0,
            seat: seat // Assign seat
        });

        // Keep players sorted by seat for consistent turn order
        this.players.sort((a, b) => a.seat - b.seat);

        return true;
    }

    // ... (addSpectator, removePlayer unchanged)

    switchSeat(playerId, targetSeat) {
        if (this.gameStatus !== 'waiting') return { error: "Game already in progress" };

        const player = this.players.find(p => p.id === playerId);
        if (!player) return { error: "Player not found" };

        if (targetSeat < 0 || targetSeat >= 10) return { error: "Invalid seat" };

        const targetTaken = this.players.find(p => p.seat === targetSeat);
        if (targetTaken) return { error: "Seat taken" };

        player.seat = targetSeat;
        this.players.sort((a, b) => a.seat - b.seat);
        return { success: true };
    }

    addSpectator(id) {
        if (!this.spectators.includes(id)) {
            this.spectators.push(id);
        }
    }

    removePlayer(id) {
        const p = this.players.find(p => p.id === id);
        if (p) {
            p.connected = false;
            // If host left, reassign host to next connected player
            if (this.hostId === id) {
                const nextHost = this.players.find(pl => pl.connected && pl.id !== id);
                this.hostId = nextHost ? nextHost.id : null;
            }
        }
        this.spectators = this.spectators.filter(s => s !== id);
    }

    start() {
        const connectedCount = this.players.filter(p => p.connected).length;
        if (connectedCount >= 2) {
            this.gameStatus = 'playing';
            this.currentPlayerIndex = 0;
            this.turnStartTime = Date.now(); // Reset AFK timer on start
            this.reminded = false;

            // Reset Final Round State for new game
            this.isFinalRound = false;
            this.finalRoundTriggeredBy = null;

            this.resetRound();
            console.log(`[Game ${this.roomCode}] Started with ${connectedCount} players.`);
            return true;
        }
        return false;
    }

    checkAutoStart(io) {
        if (this.gameStatus === 'waiting' && this.players.filter(p => p.connected).length >= 2) {
            if (this.start()) {
                io.to(this.roomCode).emit('game_start', this.getState());
                io.emit('room_list', getRoomList());
                return true;
            }
        }
        return false;
    }

    resetRound() {
        this.roundAccumulatedScore = 0;
        this.diceCountToRoll = 6;
        this.currentDice = [];
        this.canHighStakes = false;
        this.boardClears = 0;

        if (this.rules.highStakes && this.previousPlayerLeftoverDice > 0 && this.previousPlayerLeftoverDice < 6) {
            this.canHighStakes = true;
        } else {
            this.previousPlayerLeftoverDice = 0;
        }
    }

    getCurrentPlayer() {
        if (!this.players || this.players.length === 0) return null;
        return this.players[this.currentPlayerIndex];
    }

    roll(playerId, useHighStakes = false) {
        if (this.gameStatus !== 'playing' || this.locked) return { error: "Game not active or busy" };
        const player = this.getCurrentPlayer();
        if (!player || player.id !== playerId) return { error: "Not your turn" };

        let scoreFromSelection = 0;
        let isFirstRollOfTurn = (this.currentDice.length === 0 && this.roundAccumulatedScore === 0);
        let triggeredHotDice = false;

        if (this.currentDice.length > 0) {
            // Re-rolling 
            const selected = this.currentDice.filter(d => d.selected);
            if (selected.length === 0) return { error: "Must select dice to re-roll" };

            const values = selected.map(d => d.value);
            if (!isScoringSelection(values, this.rules)) return { error: "Invalid selection" };

            scoreFromSelection = calculateScore(values, this.rules);
            this.roundAccumulatedScore += scoreFromSelection;

            const remaining = this.currentDice.length - selected.length;
            this.diceCountToRoll = remaining === 0 ? 6 : remaining;

            if (remaining === 0) {
                triggeredHotDice = true;
                this.boardClears++;
                if (this.rules.hotDiceBonus) {
                    this.roundAccumulatedScore += 1000;
                }
            }

        } else {
            // First Roll
            if (useHighStakes && this.canHighStakes) {
                console.log(`[Game ${this.roomCode}] Player ${playerId} chose High Stakes! Rolling ${this.previousPlayerLeftoverDice} dice.`);
                this.diceCountToRoll = this.previousPlayerLeftoverDice;
                this.roundAccumulatedScore = 0;
                this.highStakesAttempt = true;
            } else {
                this.diceCountToRoll = 6;
                this.highStakesAttempt = false;
            }
        }

        this.turnStartTime = Date.now();
        this.reminded = false;
        const newDice = [];
        for (let i = 0; i < this.diceCountToRoll; i++) {
            newDice.push({
                id: Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
                value: Math.floor(Math.random() * 6) + 1,
                selected: false
            });
        }
        this.currentDice = newDice;

        const rolledValues = newDice.map(d => d.value);
        let farkle = false;
        if (!hasPossibleMoves(rolledValues, this.rules)) {
            farkle = true;
        }

        if (this.rules.toxicTwos) {
            const twoCount = rolledValues.filter(v => v === 2).length;
            if (twoCount >= 4) {
                console.log(`[Game ${this.roomCode}] Toxic Twos triggered!`);
                farkle = true;
            }
        }

        if (farkle && isFirstRollOfTurn && this.rules.noFarkleFirstRoll) {
            let attempts = 0;
            // Increased attempts and added fallback to ensure it is IMPOSSIBLE to Farkle on first roll
            while (farkle && attempts < 100) {
                console.log(`[Game ${this.roomCode}] First Roll Farkle prevented (Rule Active). Rerolling (Attempt ${attempts + 1}).`);
                for (let d of newDice) d.value = Math.floor(Math.random() * 6) + 1;
                const newVals = newDice.map(d => d.value);
                farkle = !hasPossibleMoves(newVals, this.rules);
                if (this.rules.toxicTwos && newVals.filter(v => v === 2).length >= 4) farkle = true;
                attempts++;
            }
            // Fallback: If 100 random attempts fail (astronomically unlikely), force a scoring hand (Straight)
            if (farkle) {
                console.log(`[Game ${this.roomCode}] Force-fixing Farkle after 100 attempts.`);
                for (let i = 0; i < newDice.length && i < 6; i++) newDice[i].value = i + 1;
                farkle = false;
            }
        }

        if (farkle) {
            this.farkleCount++;
        } else {
            this.farkleCount = 0;
            if (this.highStakesAttempt) {
                console.log(`[Game ${this.roomCode}] High Stakes Successful! Adding 1000 bonus.`);
                this.roundAccumulatedScore += 1000;
                this.highStakesAttempt = false;
            }
        }

        return {
            success: true,
            dice: newDice,
            farkle,
            roundScore: this.roundAccumulatedScore,
            hotDice: (triggeredHotDice && !farkle)
        };
    }

    toggleSelection(playerId, dieId) {
        if (this.gameStatus !== 'playing') return;
        const die = this.currentDice.find(d => d.id == dieId);
        if (die) die.selected = !die.selected;
        return true;
    }

    syncSelections(playerId, selectedIds) {
        if (this.gameStatus !== 'playing') return;
        const setIds = new Set(selectedIds.map(String));
        this.currentDice.forEach(die => die.selected = setIds.has(String(die.id)));
    }

    bank(playerId) {
        if (this.gameStatus !== 'playing' || this.locked) return;
        const player = this.players[this.currentPlayerIndex];
        if (!player || player.id !== playerId) return;

        const selected = this.currentDice.filter(d => d.selected);
        const values = selected.map(d => d.value);

        let scoreToAdd = 0;
        if (selected.length > 0) {
            if (isScoringSelection(values, this.rules)) {
                scoreToAdd = calculateScore(values, this.rules);
            } else {
                return { error: "Invalid selection" };
            }
        } else if (this.currentDice.length > 0 && this.roundAccumulatedScore === 0) {
            return { error: "Cannot bank 0" };
        }

        const potentialTotal = this.roundAccumulatedScore + scoreToAdd;

        if (!player.hasOpened) {
            if (potentialTotal < this.rules.openingScore) {
                return { error: `Must score at least ${this.rules.openingScore} to open.` };
            }
        }

        if (this.rules.welfareMode) {
            const projectedScore = player.score + potentialTotal;
            if (projectedScore > 10000) {
                const lowest = this.players.reduce((prev, curr) => (prev.score < curr.score) ? prev : curr);
                lowest.score += potentialTotal;
                this.roundAccumulatedScore = 0;
                this.nextTurn();
                return { success: true, message: "Welfare Wipeout! Points given to lowest." };
            }
        }

        this.roundAccumulatedScore = potentialTotal;
        player.score += this.roundAccumulatedScore;
        player.maxRoundScore = Math.max(player.maxRoundScore || 0, this.roundAccumulatedScore);
        player.hasOpened = true;
        this.farkleCount = 0;
        const remainingDiceCount = this.currentDice ? (this.currentDice.length - selected.length) : 0;
        this.previousPlayerLeftoverDice = (remainingDiceCount > 0 && remainingDiceCount < 6) ? remainingDiceCount : 0;

        this.checkWinCondition();

        if (this.gameStatus !== 'finished') {
            this.nextTurn();
        } else {
            this.turnStartTime = Date.now();
            this.reminded = false;
        }

        return { success: true };
    }

    farkle() {
        const player = this.players[this.currentPlayerIndex];
        if (player) {
            if (this.farkleCount >= 3) {
                const penalty = this.rules.threeFarklesPenalty || 1000;
                console.log(`[Game ${this.roomCode}] Player penalty for 3 farkles: -${penalty}`);
                player.score -= penalty;
                this.farkleCount = 0;
            }
            player.farkles++;
        }

        this.previousPlayerLeftoverDice = 0;
        this.roundAccumulatedScore = 0;
        this.nextTurn();
    }

    nextTurn() {
        if (this.players.length === 0) {
            this.gameStatus = 'waiting';
            this.resetRound();
            return;
        }

        let attempts = 0;
        let p;
        const resultLoopLimit = this.players.length + 10;

        do {
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
            p = this.players[this.currentPlayerIndex];

            if (!p.connected) {
                p.missedTurns = (p.missedTurns || 0) + 1;
                console.log(`[Game ${this.roomCode}] Player ${p.name} missed turn ${p.missedTurns}`);
            } else {
                p.missedTurns = 0;
            }

            attempts++;
        } while ((!p || !p.connected) && attempts < resultLoopLimit);
        // Safety break


        if (this.players.length < 2 && this.gameStatus === 'playing') {
            // Not enough players to continue? Or just wait?
            // Usually wait or keep playing solo? For now, keep state but maybe warn.
        }

        this.resetRound();
        this.turnStartTime = Date.now();
        this.reminded = false;

        if (this.isFinalRound && this.currentPlayerIndex === this.finalRoundTriggeredBy) {
            this.endGame();
        }
    }

    async endGame() {
        if (this.gameStatus === 'finished') return;
        this.gameStatus = 'finished';

        // Determine winner
        if (this.players.length === 0) {
            this.winner = null;
            return;
        }
        const sorted = [...this.players].sort((a, b) => b.score - a.score);
        this.winner = (sorted.length > 1 && sorted[0].score === sorted[1].score) ? 'tie' : sorted[0];

        // Record Stats
        for (const p of this.players) {
            const isWin = (this.winner !== 'tie' && p.id === this.winner.id);
            try {
                if (p.dbId) {
                    await db.recordGameEnd(p.dbId, isWin, p.score, p.maxRoundScore || 0, p.farkles || 0);
                }
            } catch (e) { console.error("Stats Error:", e); }
        }

        io.to(this.roomCode).emit('game_over', {
            winner: this.winner === 'tie' ? 'Tie' : this.winner.name,
            scores: this.players.map(p => ({ name: p.name, score: p.score }))
        });
    }

    checkWinCondition() {
        const p = this.players[this.currentPlayerIndex];
        const winTarget = this.rules.winScore || 10000;
        if (p.score >= winTarget && !this.isFinalRound) {
            this.isFinalRound = true;
            this.finalRoundTriggeredBy = this.currentPlayerIndex;
            console.log(`[Game ${this.roomCode}] Final Round Triggered by ${p.name}`);
        }
    }

    getState() {
        return {
            roomCode: this.roomCode,
            players: this.players,
            spectatorCount: this.spectators.length,
            currentPlayerIndex: this.currentPlayerIndex,
            roundAccumulatedScore: this.roundAccumulatedScore,
            diceCountToRoll: this.diceCountToRoll,
            currentDice: this.currentDice,
            gameStatus: this.gameStatus,
            winner: this.winner,
            isFinalRound: this.isFinalRound,
            canHighStakes: this.canHighStakes,
            rules: this.rules,
            hostId: this.hostId,
            activeVote: this.votes.type ? {
                type: this.votes.type,
                count: this.votes[this.votes.type].size,
                needed: this.players.filter(p => p.connected).length === 2 ? 2 : Math.ceil(this.players.filter(p => p.connected).length * 0.6),
                voters: Array.from(this.votes[this.votes.type])
            } : null,
            timer: Math.max(0, 60 - Math.floor((Date.now() - this.turnStartTime) / 1000))
        };
    }

    checkAFK(io) {
        const now = Date.now();

        if (this.gameStatus === 'playing') {
            const idleTime = (now - this.turnStartTime) / 1000;
            const player = this.players[this.currentPlayerIndex];

            if (player) {
                // 60s Reminder
                if (idleTime >= 60 && !this.reminded) {
                    this.reminded = true;
                    if (player.connected) {
                        io.to(player.id).emit('turn_reminder');
                        console.log(`[Game ${this.roomCode}] Reminded ${player.name} to take turn.`);
                    }
                }

                // Auto-skip after 90s
                if (idleTime >= 90) {
                    const skipName = player.name;
                    console.log(`[Game ${this.roomCode}] Auto-skipping ${skipName} due to inactivity (90s).`);
                    this.nextTurn();
                    io.to(this.roomCode).emit('chat_message', {
                        sender: "System",
                        message: `${skipName}'s turn was skipped due to inactivity.`,
                        isSystem: true
                    });
                    io.to(this.roomCode).emit('game_state_update', this.getState());
                }
            }
        }


        // Clean up disconnected players after 3 minutes (180s)
        for (let i = this.players.length - 1; i >= 0; i--) {
            const p = this.players[i];
            if (!p.connected && p.disconnectTime && (now - p.disconnectTime) > 180000) {
                console.log(`[Game ${this.roomCode}] Removing ${p.name} (3 mins disconnected). Saving to persistence.`);

                // Save to persistence before removing
                const key = p.dbId || p.reconnectToken;
                if (key) {
                    this.persistence[key] = {
                        name: p.name,
                        score: p.score,
                        farkles: p.farkles,
                        hasOpened: p.hasOpened,
                        maxRoundScore: p.maxRoundScore,
                        seat: p.seat,
                        dbId: p.dbId,
                        reconnectToken: p.reconnectToken
                    };
                }

                const wasCurrent = (i === this.currentPlayerIndex);
                this.players.splice(i, 1);

                if (this.players.length === 0) {
                    this.gameStatus = 'waiting';
                    this.resetRound();
                } else {
                    if (wasCurrent) {
                        this.currentPlayerIndex = this.currentPlayerIndex % this.players.length;
                        this.nextTurn();
                    } else if (i < this.currentPlayerIndex) {
                        this.currentPlayerIndex--;
                    }
                }

                io.to(this.roomCode).emit('game_state_update', this.getState());
                io.emit('room_list', getRoomList());
            }
        }
    }
}

// Game definitions moved to bottom of file

// Discord Activity instance → room code mapping
const activityRooms = new Map();

io.on('connection', (socket) => {

    socket.emit('room_list', getRoomList());

    socket.on('get_room_list', () => {
        socket.emit('room_list', getRoomList());
    });

    // Discord Activity room coordination
    socket.on('join_activity', async (data) => {
        try {
            const instanceId = data?.instanceId;
            if (!instanceId) {
                socket.emit('error', 'No Activity instance ID');
                return;
            }

            let roomCode = activityRooms.get(instanceId);

            // If no room mapped yet, find the first casual room with space
            if (!roomCode || !games.has(roomCode)) {
                // Find a casual room with the fewest players (or empty)
                let bestRoom = null;
                let bestCount = Infinity;
                for (const [code, game] of games.entries()) {
                    if (game.rules.category === 'casual') {
                        const count = game.players.filter(p => p.connected).length;
                        if (count < bestCount && count < 10) {
                            bestRoom = code;
                            bestCount = count;
                        }
                    }
                }
                roomCode = bestRoom || 'Classic 1';
                activityRooms.set(instanceId, roomCode);
                console.log(`[Activity] Mapped instance ${instanceId.substring(0, 8)} → room ${roomCode}`);
            }

            // Now join the player to this room (reuse join_game logic)
            const game = games.get(roomCode);
            if (!game) {
                socket.emit('error', 'Room not found');
                return;
            }

            // Check for reconnect
            const token = data?.reconnectToken;
            let existingPlayer = null;
            if (token) {
                existingPlayer = game.players.find(p => p.reconnectToken === token && !p.connected);
            }

            if (existingPlayer) {
                existingPlayer.id = socket.id;
                existingPlayer.connected = true;
                existingPlayer.missedTurns = 0;
                if (data?.dbId) {
                    try {
                        const user = await db.getUser(data.dbId);
                        if (user && user.display_name) {
                            existingPlayer.name = user.display_name;
                        }
                    } catch (e) { }
                } else if (data?.name && data.name !== existingPlayer.name) {
                    existingPlayer.name = data.name;
                }
                socket.join(roomCode);
                socket.emit('activity_room', { roomCode });
                socket.emit('joined', { playerId: socket.id, state: game.getState(), isSpectator: false });
                if (!game.checkAutoStart(io)) {
                    io.to(roomCode).emit('game_state_update', game.getState());
                }
                return;
            }

            // New player
            let name = data?.name;

            // Priority 1: Verified DB Name
            const dbId = data?.dbId;
            if (dbId) {
                try {
                    const user = await db.getUser(dbId);
                    if (user && user.display_name) {
                        name = user.display_name;
                        console.log(`[Activity] Verified Discord Name for ${dbId}: ${name}`);
                    }
                } catch (e) {
                    console.error("Activity Name Lookup Failed", e);
                }
            }

            if (!name) {
                for (let i = 1; i <= 10; i++) {
                    let candidate = `Player ${i}`;
                    if (!game.players.some(p => p.name === candidate)) {
                        name = candidate;
                        break;
                    }
                }
            }

            if (!name) name = `Player ${Math.floor(Math.random() * 9000) + 1000}`;

            // Ensure uniqueness
            let baseName = name;
            let counter = 1;
            while (game.players.some(p => p.name === name)) {
                name = `${baseName} (${++counter})`;
            }

            if (game.players.length >= 10) {
                socket.emit('error', 'Room Full');
                return;
            }

            socket.playerName = name;
            game.addPlayer(socket.id, name, data?.reconnectToken, data?.dbId);
            socket.join(roomCode);
            socket.emit('activity_room', { roomCode });
            socket.emit('joined', { playerId: socket.id, state: game.getState(), isSpectator: false });

            if (!game.checkAutoStart(io)) {
                io.to(roomCode).emit('game_state_update', game.getState());
            }
            io.emit('room_list', getRoomList());

            console.log(`[Activity] Player ${name} joined room ${roomCode} via instance ${instanceId.substring(0, 8)}`);
        } catch (err) {
            console.error('Error in join_activity:', err);
            socket.emit('error', 'Server Error');
        }
    });

    // Update player name after Discord auth completes
    socket.on('update_name', async (data) => {
        const newName = data?.name;
        const dbId = data?.dbId;
        if (!newName) return;

        for (const game of games.values()) {
            const player = game.players.find(p => p.id === socket.id);
            if (player) {
                if (dbId && !player.dbId) {
                    player.dbId = dbId;
                }

                // If we have a DB ID, verify the name is actually correct
                if (player.dbId) {
                    try {
                        const user = await db.getUser(player.dbId);
                        if (user && user.display_name) {
                            player.name = user.display_name;
                        }
                    } catch (e) { }
                } else if (newName) {
                    player.name = newName;
                }

                io.to(game.roomCode).emit('game_state_update', game.getState());
                break;
            }
        }
    });

    socket.on('join_game', async (data) => {
        try {
            const requestedRoom = data?.roomCode;
            const isSpectator = data?.spectator === true;

            if (!requestedRoom || !games.has(requestedRoom)) {

                socket.emit('error', 'Please select a room first');
                return;
            }
            let roomCode = requestedRoom;
            let game = games.get(roomCode);

            // Checking if already in as player (Reconnect Logic)
            let existingPlayer = null;
            const token = data?.reconnectToken;
            const dbId = data?.dbId;

            // 1. Check active players list (even if marked as disconnected)
            // We search by token or dbId to recognize the returning player
            existingPlayer = game.players.find(p =>
                (token && p.reconnectToken === token) ||
                (dbId && p.dbId === dbId)
            );

            if (existingPlayer) {
                console.log(`[Game ${roomCode}] Player Reconnected (In-Game): ${existingPlayer.name}`);
                existingPlayer.id = socket.id; // Update socket ID
                existingPlayer.connected = true;
                existingPlayer.missedTurns = 0; // Reset AFK counter

                // Update name if provided and likely fresher
                if (dbId) {
                    try {
                        const user = await db.getUser(dbId);
                        if (user && user.display_name) {
                            existingPlayer.name = user.display_name;
                            console.log(`[Game ${roomCode}] Verified Reconnect Name for ${dbId}: ${existingPlayer.name}`);
                        }
                    } catch (e) {
                        console.error("Reconnect Name Lookup Failed", e);
                    }
                } else if (data?.name && data.name !== existingPlayer.name) {
                    existingPlayer.name = data.name;
                }

                if (dbId && !existingPlayer.dbId) existingPlayer.dbId = dbId;

                socket.join(roomCode);

                // Restore host if needed
                if (!game.hostId || !game.players.find(p => p.id === game.hostId && p.connected)) {
                    game.hostId = existingPlayer.id;
                }

                socket.emit('joined', { playerId: socket.id, state: game.getState(), isSpectator: false });
                if (!game.checkAutoStart(io)) {
                    io.to(roomCode).emit('game_state_update', game.getState());
                }
                return;
            }

            // 2. Check persistence list (players who were purged from active list after 3 mins)
            const persistKey = dbId || token;
            if (persistKey && game.persistence[persistKey]) {
                const pData = game.persistence[persistKey];
                console.log(`[Game ${roomCode}] Restoring player ${pData.name} from persistence.`);

                // Ensure room is not full before restoring
                if (game.players.length < 10) {
                    // Find available seat (prefer old one if possible)
                    let seat = pData.seat;
                    if (game.players.some(p => p.seat === seat)) {
                        seat = 0;
                        while (game.players.some(p => p.seat === seat)) seat++;
                    }

                    const restoredPlayer = {
                        id: socket.id,
                        name: data?.name || pData.name,
                        score: pData.score,
                        connected: true,
                        farkles: pData.farkles,
                        hasOpened: pData.hasOpened,
                        reconnectToken: token || pData.reconnectToken,
                        dbId: dbId || pData.dbId,
                        missedTurns: 0,
                        maxRoundScore: pData.maxRoundScore,
                        seat: seat
                    };

                    game.players.push(restoredPlayer);
                    game.players.sort((a, b) => a.seat - b.seat);
                    delete game.persistence[persistKey];

                    socket.join(roomCode);
                    if (!game.hostId || !game.players.find(p => p.id === game.hostId && p.connected)) {
                        game.hostId = socket.id;
                    }

                    socket.emit('joined', { playerId: socket.id, state: game.getState(), isSpectator: false });
                    if (!game.checkAutoStart(io)) {
                        io.to(roomCode).emit('game_state_update', game.getState());
                    }
                    return;
                }
            }

            // 3. Global Reconnect Search (Check other rooms if user refreshed but didn't specify room)
            if (token && !requestedRoom) {
                for (const [code, g] of games.entries()) {
                    const p = g.players.find(p => p.reconnectToken === token);
                    if (p) {
                        game = g;
                        roomCode = code;
                        existingPlayer = p;

                        existingPlayer.id = socket.id;
                        existingPlayer.connected = true;
                        existingPlayer.missedTurns = 0;
                        socket.join(roomCode);

                        if (!game.hostId || !game.players.find(hp => hp.id === game.hostId && hp.connected)) {
                            game.hostId = existingPlayer.id;
                        }

                        socket.emit('joined', { playerId: socket.id, state: game.getState(), isSpectator: false });

                        if (!game.checkAutoStart(io)) {
                            io.to(roomCode).emit('game_state_update', game.getState());
                        }
                        return;
                    }
                }
            }

            if (isSpectator) {
                socket.playerName = data?.name || "Spectator";
                game.addSpectator(socket.id);
                socket.join(roomCode);
                socket.emit('joined', { playerId: socket.id, state: game.getState(), isSpectator: true });
                // Don't necessarily need to broadcast state update for spectator join, but good for count update
                io.to(roomCode).emit('game_state_update', game.getState());
                return;
            }

            let name = data?.name;

            // Priority 1: If we have a DB ID, trust the database name over the client-sent name
            if (dbId) {
                try {
                    const user = await db.getUser(dbId);
                    if (user && user.display_name) {
                        name = user.display_name;
                        console.log(`[Game ${roomCode}] Verified Discord Name for ${dbId}: ${name}`);
                    }
                } catch (e) {
                    console.error("DB Name Lookup Failed", e);
                }
            }

            if (!name) {
                for (let i = 1; i <= 10; i++) {
                    let candidate = `Player ${i}`;
                    if (!game.players.some(p => p.name === candidate)) {
                        name = candidate;
                        break;
                    }
                }
            }

            if (!name) name = `Player ${Math.floor(Math.random() * 9000) + 1000}`;

            // Ensure name is unique in this room (prevent duplicates)
            let baseName = name;
            let counter = 1;
            while (game.players.some(p => p.name === name)) {
                name = `${baseName} (${++counter})`;
            }

            if (game.players.length >= 10) {
                socket.emit('error', 'Room Full');
                return;
            }

            socket.playerName = name;
            game.addPlayer(socket.id, name, data?.reconnectToken, data?.dbId);
            socket.join(roomCode);
            socket.emit('joined', { playerId: socket.id, state: game.getState(), isSpectator: false });

            // Try to auto-start if possible
            if (!game.checkAutoStart(io)) {
                // If not auto-started, just broadcast normal update
                io.to(roomCode).emit('game_state_update', game.getState());
            }

            io.emit('room_list', getRoomList());
        } catch (err) {
            console.error("Error in join_game:", err);
            socket.emit('error', "Server Error");
        }
    });

    socket.on('switch_seat', (data) => {
        const game = Array.from(games.values()).find(g => g.players.some(p => p.id === socket.id));
        if (game) {
            const { seatIndex } = data;
            const res = game.switchSeat(socket.id, seatIndex);
            if (res && res.error) {
                socket.emit('feedback', { message: res.error, type: 'error' });
            } else {
                io.to(game.roomCode).emit('game_state_update', game.getState());
            }
        }
    });

    socket.on('leave_game', () => {
        // Handle leaving for players and spectators
        for (const game of games.values()) {
            if (game.spectators.includes(socket.id)) {
                game.removePlayer(socket.id); // removes from spectators too
                socket.leave(game.roomCode);
                continue;
            }
            const p = game.players.find(p => p.id === socket.id);
            if (p) {
                p.connected = false;
                p.disconnectTime = Date.now();
                p.reconnectToken = null; // Clear token on explicit leave
                if (game.gameStatus === 'waiting') {
                    game.players = game.players.filter(pl => pl.id !== socket.id);
                }
                const activeCount = game.players.filter(p => p.connected).length;
                if (activeCount === 0) {
                    // Grace period before wipe - increased to 120s
                    setTimeout(() => {
                        const currentG = games.get(game.roomCode);
                        if (currentG && currentG.players.filter(pl => pl.connected).length === 0) {
                            currentG.players = [];
                            currentG.gameStatus = 'waiting';
                            currentG.isFinalRound = false;
                            currentG.finalRoundTriggeredBy = null;
                            currentG.resetRound();
                            io.emit('room_list', getRoomList());
                        }
                    }, 120000);
                }
                socket.leave(game.roomCode);
                io.emit('room_list', getRoomList());
                io.to(game.roomCode).emit('game_state_update', game.getState());
            }
        }
    });

    socket.on('start_game', ({ roomCode }) => {
        const game = games.get(roomCode);
        if (game && game.gameStatus === 'waiting') {
            const started = game.start();
            if (started) {
                io.to(roomCode).emit('game_start', game.getState());
                io.emit('room_list', getRoomList());
            } else {
                socket.emit('error', 'Need at least 2 players to start');
            }
        }
    });

    socket.on('roll', ({ roomCode, confirmedSelections, useHighStakes }) => {
        const game = games.get(roomCode);
        if (!game) return;
        // Verify player is not spectator
        if (game.spectators.includes(socket.id)) return;

        if (confirmedSelections && Array.isArray(confirmedSelections)) {
            game.syncSelections(socket.id, confirmedSelections);
        }

        const result = game.roll(socket.id, useHighStakes);
        if (result.error) {
            socket.emit('error', result.error);
        } else {
            if (result.farkle) game.locked = true;

            io.to(roomCode).emit('roll_result', {
                dice: result.dice,
                farkle: result.farkle,
                hotDice: result.hotDice,
                state: game.getState()
            });

            if (result.farkle) {
                const delay = (game.rules.category === 'speed') ? 1000 : 2500;
                setTimeout(() => {
                    game.farkle();
                    game.locked = false;
                    io.to(roomCode).emit('game_state_update', game.getState());
                }, delay);
            }
        }
    });

    socket.on('toggle_die', ({ roomCode, dieId }) => {
        const game = games.get(roomCode);
        if (game) {
            if (game.spectators.includes(socket.id)) return;
            game.toggleSelection(socket.id, dieId);
            io.to(roomCode).emit('game_state_update', game.getState());
        }
    });

    socket.on('bank', ({ roomCode, confirmedSelections }) => {
        const game = games.get(roomCode);
        if (game) {
            if (game.spectators.includes(socket.id)) return;
            if (confirmedSelections && Array.isArray(confirmedSelections)) {
                game.syncSelections(socket.id, confirmedSelections);
            }
            const res = game.bank(socket.id);
            if (res && res.error) {
                socket.emit('error', res.error);
            } else {
                io.to(roomCode).emit('game_state_update', game.getState());
            }
        }
    });

    socket.on('send_chat', ({ roomCode, message }) => {
        if (!games.has(roomCode)) return;
        const game = games.get(roomCode);

        let senderName = "Anonymous";
        const player = game.players.find(p => p.id === socket.id);
        if (player) {
            senderName = player.name;
        } else if (game.spectators.includes(socket.id)) {
            // Try to resolve spectator name if possible, or Spectator
            // We can check local socket auth or map if we stored it, but simplified:
            // The client sent 'name' on join, but we might not have stored it for spectators easily in this minimal object
            // Let's rely on GameState players. For spectators, maybe we can't get name easily without storage.
            // Actually join_game for spectator doesn't store name in game object explicitly other than potentially in a spectator list if we extended it.
            // For now, let's assume players only or generic.
            // Wait, join_game stores players. Spectators are just IDs in array in this implementation?
            // Checking join_game: "spectators.push(socket.id)" - yes just IDs.
            // So spectators are anonymous in chat unless `socket.handshake.auth.name` or similar was persisted.
            // socket.handshake.auth.name is sent by client on connection!
            senderName = socket.playerName || socket.handshake.auth.name || "Spectator";
        }

        // Sanitize?
        if (!message || message.trim().length === 0) return;
        const safeMessage = message.substring(0, 200);

        io.to(roomCode).emit('chat_message', {
            sender: senderName,
            message: safeMessage,
            isSystem: false
        });
    });

    // Assuming this endGame method is part of the GameState class,
    // but since the GameState class definition is not provided in the snippet,
    // this block is placed here as per the user's instruction,
    // acknowledging it might be intended for a different file or class context.
    // If GameState class is in this file, it should be moved there.


    socket.on('restart', ({ roomCode }) => {
        const game = games.get(roomCode);
        if (game && game.gameStatus === 'finished') {
            // Only players can restart? Or anyone?
            // Host only restriction
            const gameHost = game.hostId;
            if (gameHost !== socket.id) {
                socket.emit('error', "Only Host can restart");
                return;
            }

            game.gameStatus = 'playing';
            game.players.forEach(p => { p.score = 0; p.farkles = 0; p.hasOpened = false; });
            game.currentPlayerIndex = 0;
            game.resetRound();
            game.isFinalRound = false;
            game.winner = null;
            game.persistence = {}; // Clear persistence on full restart
            io.to(roomCode).emit('game_start', game.getState());
        }
    });

    socket.on('start_vote', ({ roomCode, type }) => {
        const game = games.get(roomCode);
        if (!game) return;
        const res = game.startVote(type, socket.id);
        if (res.error) {
            socket.emit('error', res.error);
        } else {
            const userName = game.players.find(p => p.id === socket.id)?.name || "A player";
            io.to(roomCode).emit('chat_message', {
                sender: "System",
                message: `${userName} started a vote to ${type === 'next' ? 'skip turn' : 'restart game'}.`,
                isSystem: true
            });
            io.to(roomCode).emit('game_state_update', game.getState());
        }
    });

    socket.on('cast_vote', ({ roomCode }) => {
        const game = games.get(roomCode);
        if (!game) return;
        const res = game.castVote(socket.id);
        if (res.error) {
            socket.emit('error', res.error);
        } else {
            if (game.checkVotePassed()) {
                const type = game.votes.type;
                io.to(roomCode).emit('chat_message', {
                    sender: "System",
                    message: `Vote passed! Executing ${type} (will reset scores)...`,
                    isSystem: true
                });

                if (type === 'next') {
                    game.nextTurn();
                } else {
                    game.gameStatus = 'playing';
                    game.players.forEach(p => p.score = 0);
                    game.currentPlayerIndex = 0;
                    game.resetRound();
                    game.isFinalRound = false;
                    game.winner = null;
                    game.persistence = {}; // Clear persistence on vote-reset
                }
                game.clearVotes();
                io.to(roomCode).emit('game_state_update', game.getState());
            } else {
                io.to(roomCode).emit('game_state_update', game.getState());
            }
        }
    });

    socket.on('force_next_turn', ({ roomCode }) => {
        const game = games.get(roomCode);
        if (game && game.gameStatus === 'playing') {
            // Keep host override but encourage voting
            if (game.hostId === socket.id) {
                game.nextTurn();
                game.clearVotes();
                io.to(roomCode).emit('game_state_update', game.getState());
            } else {
                socket.emit('error', "Use the Vote button or ask the Host.");
            }
        }
    });

    socket.on('debug_restart_preserve', ({ roomCode }) => {
        const game = games.get(roomCode);
        if (game) {
            if (game.hostId === socket.id) {
                game.gameStatus = 'playing';
                game.players.forEach(p => p.score = 0);
                game.currentPlayerIndex = 0;
                game.resetRound();
                game.isFinalRound = false;
                game.winner = null;
                game.persistence = {}; // Clear persistence on debug restart
                game.clearVotes();
                io.to(roomCode).emit('game_start', game.getState());
            } else {
                socket.emit('error', "Use the Vote button or ask the Host.");
            }
        }
    });

    socket.on('disconnect', () => {

        for (const game of games.values()) {
            if (game.spectators.includes(socket.id)) {
                game.removePlayer(socket.id); // Handles s removing
                continue;
            }
            const player = game.players.find(p => p.id === socket.id);
            if (player) {
                player.connected = false;
                player.disconnectTime = Date.now();
                const activeCount = game.players.filter(p => p.connected).length;
                if (activeCount === 0) {
                    // Grace period before wipe - increased to 120s
                    setTimeout(() => {
                        const currentG = games.get(game.roomCode);
                        if (currentG && currentG.players.filter(pl => pl.connected).length === 0) {
                            currentG.players = [];
                            currentG.gameStatus = 'waiting';
                            currentG.isFinalRound = false;
                            currentG.finalRoundTriggeredBy = null;
                            currentG.resetRound();
                            io.emit('room_list', getRoomList());
                        }
                    }, 120000);
                }
                io.emit('room_list', getRoomList());
                // No longer remove immediately in 'waiting' to allow for refreshes/reconnects
                io.to(game.roomCode).emit('game_state_update', game.getState());
            }
        }
    });
});

// --- Setup Games ---
const games = new Map();

// 1. Speed Run Mode (6000 pts)
// 1. Speed Run Mode
games.set('Speed 1', new GameState('Speed 1', {
    ...DEFAULT_RULES,
    winScore: 5000,
    openingScore: 0,
    category: 'speed',
    description: "Blitz • 5k Win • No Opening Req"
}));
games.set('Speed 2', new GameState('Speed 2', {
    ...DEFAULT_RULES,
    winScore: 7500,
    openingScore: 0,
    category: 'speed',
    description: "Race • 7.5k Win • Standard"
}));

// 2. Casual Standard
games.set('Classic 1', new GameState('Classic 1', {
    ...DEFAULT_RULES,
    winScore: 10000,
    openingScore: 0,
    category: 'casual',
    description: "Standard • 10k Win • No Open"
}));
games.set('Classic 2', new GameState('Classic 2', {
    ...DEFAULT_RULES,
    winScore: 10000,
    openingScore: 0,
    threeFarklesPenalty: 500, // Reduced penalty
    category: 'casual',
    description: "Friendly • 10k Win • No Open"
}));
games.set('Classic 3', new GameState('Classic 3', {
    ...DEFAULT_RULES,
    winScore: 10000,
    openingScore: 1000,
    category: 'casual',
    description: "Pro • 10k Win • 1000 Open"
}));

// 3. Casual House Rules (Custom Logic)
games.set('House 1', new GameState('House 1', {
    ...DEFAULT_RULES,
    winScore: 10000,
    openingScore: 0,
    enableThreePairs: true,
    threePairs: 750,
    enable4Straight: true,
    fourStraight: 500,
    enable5Straight: true,
    fiveStraight: 1000,
    category: 'casual',
    description: "Combo King • Pairs & Runs"
}));
games.set('House 2', new GameState('House 2', {
    ...DEFAULT_RULES,
    winScore: 10000,
    openingScore: 0,
    highStakes: true,
    toxicTwos: true,
    category: 'casual',
    description: "Risky • High Stakes & Toxic 2s"
}));
games.set('House 3', new GameState('House 3', {
    ...DEFAULT_RULES,
    winScore: 10000,
    openingScore: 0,
    welfareMode: true,
    enableSixOnesInstantWin: true,
    category: 'casual',
    description: "Chaos • Welfare & Instant Win"
}));

function getRoomList() {
    return Array.from(games.values()).map(g => ({
        name: g.roomCode,
        count: g.players.filter(p => p.connected).length,
        spectators: g.spectators.length,
        max: 10,
        status: g.gameStatus,
        category: g.rules.category || 'casual',
        rulesSummary: g.rules.description || 'Standard'
    }));
}

// API Routes for Stats
app.get('/api/stats/:id', async (req, res) => {
    try {
        const user = await db.getUser(req.params.id);
        if (user) res.json(user);
        else res.status(404).json({ error: "User not found" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// app.get('/api/leaderboard') removed in favor of /api/stats/leaderboard defined earlier

// --- Game Loop ---
setInterval(() => {
    for (const game of games.values()) {
        try {
            game.checkAFK(io);
        } catch (err) {
            console.error("AFK Check Error:", err);
        }
    }
}, 5000); // Check every 5s

const PORT = process.env.PORT || 3000;
console.log(`[SYSTEM] Attempting to listen on port ${PORT}...`);
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
// sync-trigger: 02/10/2026 06:34:23
// push-trigger: 02/10/2026 08:18:37
