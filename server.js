import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { calculateScore, hasPossibleMoves, isScoringSelection, DEFAULT_RULES } from './public/rules.js';
import { analytics } from './analytics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.enable("trust proxy");
app.use(express.json()); // Enable JSON body parsing for login

// Analytics Middleware
app.use((req, res, next) => {
    analytics.trackHit(req);
    next();
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

// --- Discord Auth API ---
import { db } from './db.js';
import 'dotenv/config';
// Note: dotenv config is loaded here, ensuring env vars are available

app.post('/api/token', async (req, res) => {
    const { code } = req.body;

    // Quick return for dev/mock mode
    if (code === 'mock_code') return res.json({ access_token: 'mock', user: { id: 'mock', username: 'MockUser', global_name: 'Mock User' } });

    if (!process.env.DISCORD_CLIENT_SECRET) {
        console.error("Missing DISCORD_CLIENT_SECRET in .env");
        return res.status(500).json({ error: "Server Configuration Error: Missing Client Secret" });
    }

    try {
        // 1. Exchange Code for Access Token
        const params = new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID || '1455067365694771364',
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            // IMPORTANT: In embedded apps, redirect_uri usually needs to match 
            // where the iframe is hosted. 
            // For strict mode, use your configured endpoint in Dev Portal.
            // We often infer it from the host to handle tunnel urls automatically.
            // However, for embedded apps, usually it's null or specific.
            // If this fails, user needs to check their Dev Portal "Redirects".
            redirect_uri: `https://${req.headers.host}`
            // Warning: If running mainly in Discord Activity, redirect_uri might need to be specific URL configured in portal.
            // If it fails with 'invalid_grant', check this.
        });

        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params,
        });

        const tokenData = await tokenResponse.json();

        if (!tokenData.access_token) {
            console.error("Token Exchange Failed:", tokenData);
            return res.status(400).json({ error: 'Failed to exchange token', details: tokenData });
        }

        // 2. Fetch User Profile
        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: { authorization: `Bearer ${tokenData.access_token}` },
        });
        const userData = await userResponse.json();

        // 3. Upsert User into Database
        await db.upsertUser(userData);

        // Return everything to frontend
        res.json({
            access_token: tokenData.access_token,
            user: userData,
            scopes: tokenData.scope ? tokenData.scope.split(' ') : []
        });

    } catch (err) {
        console.error("Auth Error:", err);
        res.status(500).json({ error: 'Internal Server Error' });
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
    }

    addPlayer(id, name, reconnectToken, dbId) {
        if (this.players.length >= 10) return false;
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
            dbId: dbId || null
        });
        return true;
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
        if (this.players.length >= 2) {
            this.gameStatus = 'playing';
            this.currentPlayerIndex = 0;
            this.resetRound();
            return true;
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
        return this.players[this.currentPlayerIndex];
    }

    roll(playerId, useHighStakes = false) {
        if (this.gameStatus !== 'playing') return { error: "Game not active" };
        const player = this.getCurrentPlayer();
        if (player.id !== playerId) return { error: "Not your turn" };

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
            hotDice: (triggeredHotDice && !farkle && this.boardClears > 1)
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
        if (this.gameStatus !== 'playing') return;
        const player = this.players[this.currentPlayerIndex];
        if (player.id !== playerId) return;

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
        player.hasOpened = true;
        this.farkleCount = 0;
        const remainingDiceCount = this.currentDice ? (this.currentDice.length - selected.length) : 0;
        this.previousPlayerLeftoverDice = (remainingDiceCount > 0 && remainingDiceCount < 6) ? remainingDiceCount : 0;

        this.checkWinCondition();

        if (this.gameStatus !== 'finished') {
            this.nextTurn();
        }

        return { success: true };
    }

    farkle() {
        if (this.farkleCount >= 3) {
            const penalty = this.rules.threeFarklesPenalty || 1000;
            console.log(`[Game ${this.roomCode}] Player penalty for 3 farkles: -${penalty}`);
            this.players[this.currentPlayerIndex].score -= penalty;
            this.farkleCount = 0;
        }

        this.previousPlayerLeftoverDice = 0;
        this.roundAccumulatedScore = 0;
        this.nextTurn();
    }

    nextTurn() {
        let attempts = 0;
        let p;
        const resultLoopLimit = this.players.length + 10;

        do {
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
            p = this.players[this.currentPlayerIndex];

            if (!p.connected) {
                p.missedTurns = (p.missedTurns || 0) + 1;
                console.log(`[Game ${this.roomCode}] Player ${p.name} missed turn ${p.missedTurns}`);
                // Disabling auto-kick slice to prevent index shifts/random movement issues
                /* 
                if (p.missedTurns >= 3) {
                    console.log(`[Game ${this.roomCode}] Marking ${p.name} as inactive/skipped.`);
                    // Don't splice. Just ignore.
                } 
                */
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

        if (this.isFinalRound && this.currentPlayerIndex === this.finalRoundTriggeredBy) {
            this.endGame();
        }
    }

    async endGame() {
        // Determine winner based on highest score
        let winner = this.players[0];
        for (const p of this.players) {
            if (p.score > winner.score) winner = p;
        }

        this.gameStatus = 'finished';
        this.winner = winner;

        // Record Stats for all players
        for (const p of this.players) {
            const isWin = (p.id === winner.id);
            try {
                if (p.dbId) {
                    await db.recordGameEnd(p.dbId, isWin, p.score, 0, p.farkles || 0);
                }
            } catch (e) { console.error("Stats Error", e); }
        }

        io.to(this.roomCode).emit('game_over', {
            winner: winner.name,
            scores: this.players.map(p => ({ name: p.name, score: p.score }))
        });
    }

    checkWinCondition() {
        const p = this.players[this.currentPlayerIndex];
        const winTarget = this.rules.winScore || 10000;
        if (p.score >= winTarget && !this.isFinalRound) {
            this.isFinalRound = true;
            this.finalRoundTriggeredBy = this.currentPlayerIndex;
        }
    }

    endGame() {
        this.gameStatus = 'finished';
        const sorted = [...this.players].sort((a, b) => b.score - a.score);
        this.winner = sorted[0];
        if (sorted.length > 1 && sorted[0].score === sorted[1].score) {
            this.winner = 'tie';
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
            hostId: this.hostId
        };
    }
}

// Game definitions moved to bottom of file

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.emit('room_list', getRoomList());

    socket.on('get_room_list', () => {
        socket.emit('room_list', getRoomList());
    });

    socket.on('join_game', (data) => {
        try {
            const requestedRoom = data?.roomCode;
            const isSpectator = data?.spectator === true;

            if (!requestedRoom || !games.has(requestedRoom)) {
                console.log(`[Join] Rejecting join request: No valid room code provided.`);
                socket.emit('error', 'Please select a room first');
                return;
            }
            let roomCode = requestedRoom;
            let game = games.get(roomCode);

            // Checking if already in as player (Reconnect Logic)
            let existingPlayer = null;

            // Check by reconnectToken first
            const token = data?.reconnectToken;
            if (token) {
                existingPlayer = game.players.find(p => p.reconnectToken === token && !p.connected);
                if (existingPlayer) {
                    console.log(`[Game ${roomCode}] Player Reconnected: ${existingPlayer.name}`);
                    existingPlayer.id = socket.id; // Update socket ID
                    existingPlayer.connected = true;
                    existingPlayer.missedTurns = 0; // Reset AFK counter
                    socket.join(roomCode);

                    // Restore host if needed
                    if (!game.hostId || !game.players.find(p => p.id === game.hostId && p.connected)) {
                        game.hostId = existingPlayer.id;
                    }

                    socket.emit('joined', { playerId: socket.id, state: game.getState(), isSpectator: false });
                    io.to(roomCode).emit('game_state_update', game.getState());
                    return;
                }
            }

            // Global Reconnect Search
            // If the user SPECIFICALLY asked for a room, we should respect that and not hijack them to an old room.
            if (!existingPlayer && token && !requestedRoom) {
                for (const [code, g] of games.entries()) {
                    if (code === roomCode) continue;
                    const p = g.players.find(p => p.reconnectToken === token && !p.connected);
                    if (p) {
                        console.log(`[Global Reconnect] Found player ${p.name} in ${code}`);
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
                        io.to(roomCode).emit('game_state_update', game.getState());
                        return;
                    }
                }
            }

            // Fallback: Check strictly by socket ID (unlikely on refresh, but good for same-session re-joins)
            existingPlayer = game.players.find(p => p.id === socket.id);
            if (existingPlayer) {
                existingPlayer.connected = true;
                if (data?.name && data.name !== existingPlayer.name) {
                    existingPlayer.name = data.name; // Update name (e.g. late Discord auth)
                }
                socket.join(roomCode);
                socket.emit('joined', { playerId: socket.id, state: game.getState(), isSpectator: false });
                io.to(roomCode).emit('game_state_update', game.getState());
                return;
            }

            if (isSpectator) {
                game.addSpectator(socket.id);
                socket.join(roomCode);
                socket.emit('joined', { playerId: socket.id, state: game.getState(), isSpectator: true });
                // Don't necessarily need to broadcast state update for spectator join, but good for count update
                io.to(roomCode).emit('game_state_update', game.getState());
                return;
            }

            let name = data?.name;
            if (!name) {
                for (let i = 1; i <= 10; i++) {
                    let candidate = `Player ${i}`;
                    if (!game.players.some(p => p.name === candidate)) {
                        name = candidate;
                        break;
                    }
                }
            }

            if (game.players.length >= 10) {
                socket.emit('error', 'Room Full');
                return;
            }

            game.addPlayer(socket.id, name, data?.reconnectToken, data?.dbId);
            socket.join(roomCode);
            socket.emit('joined', { playerId: socket.id, state: game.getState(), isSpectator: false });
            io.to(roomCode).emit('game_state_update', game.getState());
            io.emit('room_list', getRoomList());

            if (game.gameStatus === 'waiting' && game.players.length >= 2) {
                game.start();
                io.to(roomCode).emit('game_start', game.getState());
            }
        } catch (err) {
            console.error("Error in join_game:", err);
            socket.emit('error', "Server Error");
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
                p.reconnectToken = null; // Clear token on explicit leave
                if (game.gameStatus === 'waiting') {
                    game.players = game.players.filter(pl => pl.id !== socket.id);
                }
                const activeCount = game.players.filter(p => p.connected).length;
                if (activeCount === 0) {
                    // Grade period before wipe
                    setTimeout(() => {
                        const currentG = games.get(game.roomCode);
                        if (currentG && currentG.players.filter(pl => pl.connected).length === 0) {
                            console.log(`[Game ${game.roomCode}] Room empty for 15s. Resetting.`);
                            currentG.players = [];
                            currentG.gameStatus = 'waiting';
                            currentG.resetRound();
                            io.emit('room_list', getRoomList());
                        }
                    }, 15000);
                }
                socket.leave(game.roomCode);
                io.emit('room_list', getRoomList());
                io.to(game.roomCode).emit('game_state_update', game.getState());
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
            senderName = socket.handshake.auth.name || "Spectator";
            senderName = socket.handshake.auth.name || "Unknown";
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
            io.to(roomCode).emit('game_start', game.getState());
        }
    });

    socket.on('force_next_turn', ({ roomCode }) => {
        const game = games.get(roomCode);
        if (game && game.gameStatus === 'playing') {
            if (game.hostId !== socket.id) return; // Only host
            game.nextTurn();
            io.to(roomCode).emit('game_state_update', game.getState());
        }
    });

    socket.on('debug_restart_preserve', ({ roomCode }) => {
        const game = games.get(roomCode);
        if (game) {
            if (game.hostId !== socket.id) return; // Only host
            game.gameStatus = 'playing';
            game.players.forEach(p => p.score = 0);
            game.currentPlayerIndex = 0;
            game.resetRound();
            game.isFinalRound = false;
            game.winner = null;
            io.to(roomCode).emit('game_start', game.getState());
        }
    });

    socket.on('disconnect', () => {
        // console.log('Client disconnected:', socket.id);
        for (const game of games.values()) {
            if (game.spectators.includes(socket.id)) {
                game.removePlayer(socket.id); // Handles s removing
                continue;
            }
            const player = game.players.find(p => p.id === socket.id);
            if (player) {
                player.connected = false;
                const activeCount = game.players.filter(p => p.connected).length;
                if (activeCount === 0) {
                    setTimeout(() => {
                        const currentG = games.get(game.roomCode);
                        if (currentG && currentG.players.filter(pl => pl.connected).length === 0) {
                            console.log(`[Game ${game.roomCode}] Room empty (disconnect) for 15s. Resetting.`);
                            currentG.players = [];
                            currentG.gameStatus = 'waiting';
                            currentG.resetRound();
                            io.emit('room_list', getRoomList());
                        }
                    }, 15000);
                }
                io.emit('room_list', getRoomList());
                if (game.gameStatus === 'waiting') {
                    // In waiting lobby, remove immediately? Or keep same logic? 
                    // Usually waiting lobby allows instant drop so slots open up.
                    // But if it's 'waiting' (pre-game), we might want to keep the slot for a second?
                    // Actually, for pre-game, remove immediately is better to free slots.
                    // But if it's the ONLY player, we just reset above. 
                    // If others are there, we remove this player.
                    game.players = game.players.filter(pl => pl.id !== socket.id);
                    io.emit('room_list', getRoomList());
                }
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

app.get('/api/leaderboard', async (req, res) => {
    try {
        const board = await db.getLeaderboard();
        res.json(board);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
