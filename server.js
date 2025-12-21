import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { calculateScore, hasPossibleMoves, isScoringSelection, SCORING_RULES } from './public/rules.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.enable("trust proxy");
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Allow all origins for Discord Activity & Testing
        methods: ["GET", "POST"],
        allowedHeaders: ["my-custom-header"],
        credentials: true
    }
});

// Serve static files
app.use(express.static(join(__dirname, 'public')));
app.use('/libs', express.static(join(__dirname, 'node_modules')));

class GameState {
    constructor(roomCode) {
        this.roomCode = roomCode;
        this.players = []; // { id, name, score, connected }
        this.currentPlayerIndex = 0;

        // Turn State
        this.roundAccumulatedScore = 0;
        this.diceCountToRoll = 6;
        this.currentDice = []; // { id, value, selected }
        this.isFinalRound = false;
        this.finalRoundTriggeredBy = null;

        this.gameStatus = 'waiting'; // waiting, playing, finished
        this.winner = null;
    }

    addPlayer(id, name) {
        if (this.players.length >= 10) return false;
        this.players.push({ id, name, score: 0, connected: true });
        return true;
    }

    removePlayer(id) {
        const p = this.players.find(p => p.id === id);
        if (p) p.connected = false;
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
    }

    getCurrentPlayer() {
        return this.players[this.currentPlayerIndex];
    }

    roll(playerId) {
        if (this.gameStatus !== 'playing') return { error: "Game not active" };
        if (this.getCurrentPlayer().id !== playerId) return { error: "Not your turn" };

        let scoreFromSelection = 0;
        if (this.currentDice.length > 0) {
            const selected = this.currentDice.filter(d => d.selected);
            if (selected.length === 0) return { error: "Must select dice to re-roll" };

            // Validate selection
            const values = selected.map(d => d.value);
            if (!isScoringSelection(values)) return { error: "Invalid selection" };

            scoreFromSelection = calculateScore(values);
            this.roundAccumulatedScore += scoreFromSelection;

            const remaining = this.currentDice.length - selected.length;
            if (remaining === 0) {
                this.diceCountToRoll = 6;
            } else {
                this.diceCountToRoll = remaining;
            }
        } else {
            if (this.currentDice.length === 0) this.diceCountToRoll = 6;
        }

        // Perform Roll
        const newDice = [];
        for (let i = 0; i < this.diceCountToRoll; i++) {
            newDice.push({
                id: Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
                value: Math.floor(Math.random() * 6) + 1,
                selected: false
            });
        }
        this.currentDice = newDice;

        // Check Farkle
        const rolledValues = newDice.map(d => d.value);
        let farkle = false;
        if (!hasPossibleMoves(rolledValues)) {
            farkle = true;
        }

        return {
            success: true,
            dice: newDice,
            farkle,
            roundScore: this.roundAccumulatedScore,
            hotDice: (scoreFromSelection > 0 && this.diceCountToRoll === 6)
        };
    }

    toggleSelection(playerId, dieId) {
        if (this.gameStatus !== 'playing') return;
        if (this.getCurrentPlayer().id !== playerId) return;

        const die = this.currentDice.find(d => d.id == dieId);
        if (die) {
            die.selected = !die.selected;
        }
        return true;
    }

    syncSelections(playerId, selectedIds) {
        if (this.gameStatus !== 'playing') return;
        if (this.getCurrentPlayer().id !== playerId) return;

        const setIds = new Set(selectedIds.map(String));
        this.currentDice.forEach(die => {
            // Only update selection if it's currently available to select
            // (Actually server is truth, but client is telling us intent)
            // We just blindly set selected state based on ID match
            die.selected = setIds.has(String(die.id));
        });
    }

    bank(playerId) {
        if (this.gameStatus !== 'playing') return;
        if (this.getCurrentPlayer().id !== playerId) return;

        const selected = this.currentDice.filter(d => d.selected);
        const values = selected.map(d => d.value);

        let scoreToAdd = 0;
        if (selected.length > 0) {
            if (isScoringSelection(values)) {
                scoreToAdd = calculateScore(values);
            } else {
                return { error: "Invalid selection" };
            }
        } else if (this.currentDice.length > 0 && this.roundAccumulatedScore === 0) {
            return { error: "Cannot bank 0" };
        }

        this.roundAccumulatedScore += scoreToAdd;
        this.players[this.currentPlayerIndex].score += this.roundAccumulatedScore;

        this.checkWinCondition();

        if (this.gameStatus !== 'finished') {
            this.nextTurn();
        }

        return { success: true };
    }

    farkle() {
        this.roundAccumulatedScore = 0;
        this.nextTurn();
    }

    nextTurn() {
        let attempts = 0;
        do {
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
            attempts++;
        } while (!this.players[this.currentPlayerIndex].connected && attempts < this.players.length);

        this.resetRound();

        if (this.isFinalRound) {
            if (this.currentPlayerIndex === this.finalRoundTriggeredBy) {
                this.endGame();
            }
        }
    }

    checkWinCondition() {
        const p = this.players[this.currentPlayerIndex];
        if (p.score >= 10000 && !this.isFinalRound) {
            this.isFinalRound = true;
            this.finalRoundTriggeredBy = this.currentPlayerIndex;
        }
    }

    endGame() {
        this.gameStatus = 'finished';
        // Simple winner determination
        const sorted = [...this.players].sort((a, b) => b.score - a.score);
        this.winner = sorted[0];
        // Handle ties? 
        if (sorted.length > 1 && sorted[0].score === sorted[1].score) {
            this.winner = 'tie';
        }
    }

    getState() {
        return {
            roomCode: this.roomCode,
            players: this.players,
            currentPlayerIndex: this.currentPlayerIndex,
            roundAccumulatedScore: this.roundAccumulatedScore,
            diceCountToRoll: this.diceCountToRoll,
            currentDice: this.currentDice,
            gameStatus: this.gameStatus,
            winner: this.winner,
            isFinalRound: this.isFinalRound
        };
    }
}

// Initialize 5 fixed rooms
const games = new Map();
const ROOM_NAMES = ['Table 1', 'Table 2', 'Table 3', 'Table 4', 'Table 5'];

ROOM_NAMES.forEach(name => {
    games.set(name, new GameState(name));
});

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Send initial room list
    socket.emit('room_list', getRoomList());

    socket.on('get_room_list', () => {
        const rooms = getRoomList();
        console.log(`[Server] Room list requested by ${socket.id}. Sending ${rooms.length} rooms.`);
        socket.emit('room_list', rooms);
    });

    socket.on('join_game', (data) => {
        try {
            const requestedRoom = data?.roomCode;
            let roomCode = requestedRoom && games.has(requestedRoom) ? requestedRoom : ROOM_NAMES[0];
            let game = games.get(roomCode);

            if (!game) {
                console.error(`[Server] Error: Game not found for room ${roomCode}`);
                socket.emit('error', 'Game Room Error');
                return;
            }

            console.log(`[Server] Socket ${socket.id} joining ${roomCode}`);

            // 1. Try to find a disconnected slot with this socket ID (for quick reconnects)
            let existingPlayer = game.players.find(p => p.id === socket.id);
            if (existingPlayer) {
                existingPlayer.connected = true;
                socket.join(roomCode);
                socket.emit('joined', { playerId: socket.id, state: game.getState() });
                io.to(roomCode).emit('game_state_update', game.getState());
                return;
            }

            // 2. Try to find any disconnected slot to reclaim
            let disconnectedPlayer = game.players.find(p => !p.connected);
            if (disconnectedPlayer) {
                console.log(`[Server] Reclaiming ${disconnectedPlayer.name} in ${roomCode} for ${socket.id}`);
                disconnectedPlayer.id = socket.id;
                disconnectedPlayer.connected = true;

                socket.join(roomCode);
                socket.emit('joined', { playerId: socket.id, state: game.getState() });
                io.to(roomCode).emit('game_state_update', game.getState());
                io.emit('room_list', getRoomList());
                return;
            }

            // 3. New Player assignment
            let name;
            for (let i = 1; i <= 10; i++) {
                let candidate = `Player ${i}`;
                if (!game.players.some(p => p.name === candidate)) {
                    name = candidate;
                    break;
                }
            }

            if (!name || game.players.length >= 10) {
                socket.emit('error', 'Room Full');
                return;
            }

            game.addPlayer(socket.id, name);
            console.log(`[Server] Assigned ${name} to ${socket.id} in ${roomCode}`);

            socket.join(roomCode);
            socket.emit('joined', { playerId: socket.id, state: game.getState() });
            // Immediate broadcast to room so others see the new player
            io.to(roomCode).emit('game_state_update', game.getState());
            io.emit('room_list', getRoomList());

            // Auto-Start if we have enough players and game is waiting
            if (game.gameStatus === 'waiting' && game.players.length >= 2) {
                console.log(`[Game ${roomCode}] Auto-starting with ${game.players.length} players.`);
                game.start();
                io.to(roomCode).emit('game_start', game.getState());
            }
        } catch (err) {
            console.error("[Server] Crash prevented in join_game:", err);
            socket.emit('error', "Server Internal Error during Join");
        }
    });

    socket.on('start_game', ({ roomCode }) => {
        const game = games.get(roomCode);
        if (game) {
            game.start();
            io.to(roomCode).emit('game_start', game.getState());
            io.emit('room_list', getRoomList());
        }
    });

    socket.on('leave_game', () => {
        for (const game of games.values()) {
            const p = game.players.find(p => p.id === socket.id);
            if (p) {
                p.connected = false;
                if (game.gameStatus === 'waiting') {
                    game.players = game.players.filter(pl => pl.id !== socket.id);
                }

                // Auto-Reset if empty
                const activeCount = game.players.filter(p => p.connected).length;
                if (activeCount === 0) {
                    console.log(`[Game ${game.roomCode}] Resetting empty room.`);
                    game.players = [];
                    game.gameStatus = 'waiting';
                    game.resetRound();
                }

                socket.leave(game.roomCode);
                io.emit('room_list', getRoomList());
                io.to(game.roomCode).emit('game_state_update', game.getState());
            }
        }
    });

    socket.on('roll', ({ roomCode, confirmedSelections }) => {
        const game = games.get(roomCode);
        if (!game) return;

        // Robustness: Sync server state to user's view (if valid)
        if (confirmedSelections && Array.isArray(confirmedSelections)) {
            game.syncSelections(socket.id, confirmedSelections);
        }

        const result = game.roll(socket.id);
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
                console.log(`[Game ${roomCode}] Farkle detected for ${socket.id}. Advancing turn in 3s...`);
                setTimeout(() => {
                    try {
                        console.log(`[Game ${roomCode}] Executing Farkle logic (next turn)...`);
                        game.farkle();
                        const newState = game.getState();
                        console.log(`[Game ${roomCode}] Turn advanced to Index ${newState.currentPlayerIndex}`);
                        io.to(roomCode).emit('game_state_update', newState);
                    } catch (err) {
                        console.error(`[Game ${roomCode}] Error processing Farkle:`, err);
                    }
                }, 3000); // 3s allows animation to comfortably finish mostly
            }
        }
    });

    socket.on('toggle_die', ({ roomCode, dieId }) => {
        const game = games.get(roomCode);
        if (game) {
            game.toggleSelection(socket.id, dieId);
            io.to(roomCode).emit('game_state_update', game.getState());
        }
    });

    socket.on('bank', ({ roomCode, confirmedSelections }) => {
        const game = games.get(roomCode);
        if (game) {
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

    socket.on('restart', ({ roomCode }) => {
        const game = games.get(roomCode);
        if (game && game.gameStatus === 'finished') {
            game.gameStatus = 'playing';
            game.players.forEach(p => p.score = 0);
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
            console.log(`[Game ${roomCode}] Force Next Turn triggered by ${socket.id}`);
            game.nextTurn();
            io.to(roomCode).emit('game_state_update', game.getState());
        }
    });

    socket.on('debug_restart_preserve', ({ roomCode }) => {
        const game = games.get(roomCode);
        if (game) {
            console.log(`[Game ${roomCode}] Debug Restart (Preserve) triggered by ${socket.id}`);
            // Reset round state but keep scores and connections
            game.resetRound();
            game.currentPlayerIndex = 0; // Optional: Reset to first player or keep current? User said "no-status-loss", usually implies keep scores. 
            // If they mean "restart game but keep players", then scores should reset? 
            // "no-status-loss" likely means "don't disconnect us".
            // "restart function" implies scores go to 0. 
            // "debug no-status-loss restart" -> "status" could mean "connection status".
            // I will reset scores to 0 because it's a "restart", but explicitly NOT kick players.
            // Wait, "no-status-loss" might mean "keep my accumulated score but fix the broken state".
            // Let's implement a "Soft Reset" that creates a fresh round state but keeps scores.
            // Actually, usually "Restart" means new game. "No status loss" might mean "Don't make me rejoin".
            // Let's do a Full Game Restart (Scores 0) but keep the room populated.
            // The existing 'restart' already does this but only if 'finished'.
            // This debug one will force it anytime.

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
        console.log('Client disconnected:', socket.id);
        for (const game of games.values()) {
            const player = game.players.find(p => p.id === socket.id);
            if (player) {
                player.connected = false;

                // Auto-Reset if empty
                const activeCount = game.players.filter(p => p.connected).length;
                if (activeCount === 0) {
                    console.log(`[Game ${game.roomCode}] Resetting empty room.`);
                    game.players = [];
                    game.gameStatus = 'waiting';
                    game.resetRound();
                }

                io.emit('room_list', getRoomList());

                if (game.gameStatus === 'waiting') {
                    game.players = game.players.filter(pl => pl.id !== socket.id);
                    io.emit('room_list', getRoomList());
                }
            }
        }
    });
});

function getRoomList() {
    return Array.from(games.values()).map(g => ({
        name: g.roomCode,
        count: g.players.filter(p => p.connected).length,
        max: 10,
        status: g.gameStatus
    }));
}

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
