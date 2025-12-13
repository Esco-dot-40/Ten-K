import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { calculateScore, hasPossibleMoves, isScoringSelection, SCORING_RULES } from './public/rules.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
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
        if (this.players.length >= 5) return false;
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
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
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
        socket.emit('room_list', getRoomList());
    });

    socket.on('join_game', ({ roomCode, playerName }) => {
        let game = games.get(roomCode);

        if (!game) {
            socket.emit('error', 'Invalid Room');
            return;
        }

        // Reconnect logic or new player
        let existingPlayer = game.players.find(p => p.name === playerName);

        // Check for takeover of disconnected player
        if (!existingPlayer && game.players.length >= 5) {
            const disconnectedPlayer = game.players.find(p => !p.connected);
            if (disconnectedPlayer) {
                disconnectedPlayer.id = socket.id;
                disconnectedPlayer.name = playerName;
                disconnectedPlayer.connected = true;
                disconnectedPlayer.score = 0;
                existingPlayer = disconnectedPlayer;
            }
        }

        if (game.players.length >= 5 && !existingPlayer) {
            socket.emit('error', 'Room Full');
            return;
        }

        if (existingPlayer) {
            existingPlayer.id = socket.id;
            existingPlayer.connected = true;
        } else {
            // New player
            if (!game.addPlayer(socket.id, playerName)) {
                socket.emit('error', 'Room Full');
                return;
            }
        }

        socket.join(roomCode);
        socket.emit('joined', { playerId: socket.id, state: game.getState() });
        io.to(roomCode).emit('game_state_update', game.getState());

        // Broadcast updated room list to everyone in lobby
        io.emit('room_list', getRoomList());

        // No auto-start
    });

    socket.on('start_game', ({ roomCode }) => {
        const game = games.get(roomCode);
        if (game && game.players.length >= 2) {
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
                socket.leave(game.roomCode);
                io.emit('room_list', getRoomList());
                io.to(game.roomCode).emit('game_state_update', game.getState());
            }
        }
    });

    socket.on('roll', ({ roomCode }) => {
        const game = games.get(roomCode);
        if (!game) return;

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
                setTimeout(() => {
                    game.farkle();
                    io.to(roomCode).emit('game_state_update', game.getState());
                }, 2000);
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

    socket.on('bank', ({ roomCode }) => {
        const game = games.get(roomCode);
        if (game) {
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

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        for (const game of games.values()) {
            const player = game.players.find(p => p.id === socket.id);
            if (player) {
                player.connected = false;
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
        max: 5,
        status: g.gameStatus
    }));
}

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
