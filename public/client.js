import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as CANNON from "cannon-es";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";

gsap.registerPlugin(ScrollTrigger, MotionPathPlugin);

// Game Rules (Merged from rules.js to avoid module resolution issues)
const SCORING_RULES = {
    TRIPLE_1: 1000,
    TRIPLE_2: 200,
    TRIPLE_3: 300,
    TRIPLE_4: 400,
    TRIPLE_5: 500,
    TRIPLE_6: 600,
    SINGLE_1: 100,
    SINGLE_5: 50,
    STRAIGHT: 1500
};

function isScoringSelection(dice) {
    if (!dice || dice.length === 0) return false;
    const counts = {};
    for (const die of dice) counts[die] = (counts[die] || 0) + 1;

    // Check Straight
    if (dice.length === 6) {
        const isStraight = (counts[1] === 1 && counts[2] === 1 && counts[3] === 1 && counts[4] === 1 && counts[5] === 1 && counts[6] === 1);
        if (isStraight) return true;
    }

    for (let face = 1; face <= 6; face++) {
        const count = counts[face] || 0;
        if (count > 0) {
            if (count < 3 && face !== 1 && face !== 5) return false;
        }
    }
    return true;
}

function calculateScore(dice) {
    if (!dice || dice.length === 0) return 0;
    const counts = {};
    for (const die of dice) counts[die] = (counts[die] || 0) + 1;

    // Check Straight
    if (dice.length === 6) {
        const isStraight = (counts[1] === 1 && counts[2] === 1 && counts[3] === 1 && counts[4] === 1 && counts[5] === 1 && counts[6] === 1);
        if (isStraight) return SCORING_RULES.STRAIGHT;
    }

    let score = 0;
    for (let face = 1; face <= 6; face++) {
        const count = counts[face] || 0;
        let tripleValue = 0;
        if (face === 1) tripleValue = SCORING_RULES.TRIPLE_1;
        else if (face === 2) tripleValue = SCORING_RULES.TRIPLE_2;
        else if (face === 3) tripleValue = SCORING_RULES.TRIPLE_3;
        else if (face === 4) tripleValue = SCORING_RULES.TRIPLE_4;
        else if (face === 5) tripleValue = SCORING_RULES.TRIPLE_5;
        else if (face === 6) tripleValue = SCORING_RULES.TRIPLE_6;
        if (count >= 3) {
            let multiplier = 0;
            if (count === 3) multiplier = 1;
            else if (count === 4) multiplier = 2;
            else if (count === 5) multiplier = 3;
            else if (count === 6) multiplier = 4;
            score += tripleValue * multiplier;
        } else {
            if (face === 1) score += count * SCORING_RULES.SINGLE_1;
            if (face === 5) score += count * SCORING_RULES.SINGLE_5;
        }
    }
    return score;
}

// Global reference for Discord SDK (dynamically imported)
let DiscordSDK = null;
const DISCORD_CLIENT_ID = '1317075677927768074'; // Real Client ID

console.log("Farkle Client Execution Started");

class FarkleClient {
    constructor() {
        console.log("FarkleClient constructor start");

        // Immediate UI feedback
        const loadingContainer = document.getElementById('room-list-container');
        if (loadingContainer) {
            loadingContainer.innerHTML = `
                <p style="color:var(--primary);">Script Running...</p>
                <p style="color:var(--text-muted); font-size: 0.8rem;">Connecting to server...</p>
            `;
        }
        // Global error handler for this instance
        window.onerror = (msg, url, line) => {
            this.debugLog(`JS Error: ${msg} at ${line}`);
            return false;
        };

        try {
            this.roomCode = null;
            this.playerId = null;
            this.gameState = null;
            this.discordSdk = null;
            this.playerName = null;
            this.isRolling = false;
            this.pendingState = null;

            // UI Elements
            this.ui = {
                app: document.getElementById('app'),
                diceContainer: document.getElementById('dice-container'),
                rollBtn: document.getElementById('roll-btn'),
                bankBtn: document.getElementById('bank-btn'),
                playerZonesContainer: document.getElementById('player-zones-container'),
                actionText: document.getElementById('action-text'),
                currentScoreDisplay: document.getElementById('current-score-display'),
                feedback: document.getElementById('feedback-message'),
                rulesBtn: document.getElementById('rules-btn'),
                rulesModal: document.getElementById('rules-modal'),
                setupModal: document.getElementById('setup-modal'),
                gameOverModal: document.getElementById('game-over-modal'),
                endP1Name: document.getElementById('end-p1-name'),
                endP1Score: document.getElementById('end-p1-score'),
                endP2Name: document.getElementById('end-p2-name'),
                endP2Score: document.getElementById('end-p2-score'),
                winnerText: document.getElementById('winner-text'),
                restartBtn: document.getElementById('restart-btn'),
                settingsBtn: document.getElementById('settings-btn'),
                settingsModal: document.getElementById('settings-modal'),
                diceThemeSelect: document.getElementById('dice-theme-select'),
                themeBtns: document.querySelectorAll('.theme-btn'),
                threeCanvasContainer: document.getElementById('three-canvas-container'),
                startGameBtn: document.getElementById('start-game-btn')
            };

            // Hook up start button
            if (this.ui.startGameBtn) {
                this.ui.startGameBtn.addEventListener('click', () => {
                    this.joinGame();
                });
            }

            this.playerName = null;

            this.dice3D = new Dice3DManager(this.ui.threeCanvasContainer);

            try { this.initListeners(); } catch (e) { console.error("Listeners Init Failed", e); }
            try { this.initSettings(); } catch (e) { console.error("Settings Init Failed", e); }
            try { this.initSimpleBackground(); } catch (e) { console.error("Background Init Failed", e); }


            this.debugLog("Modules initialized");

            this.initDiscord().catch(err => {
                this.debugLog(`Discord Init Catch: ${err.message}`);
            });

            if (typeof io === 'undefined') {
                this.debugLog("CRITICAL: Socket.io (io) is not defined!");
                return;
            }

            // Initialize socket and events carefully
            this.debugLog("Connecting to server...");
            this.socket = io({
                reconnectionAttempts: 10,
                reconnectionDelay: 1000,
                autoConnect: false,
                transports: ['websocket', 'polling'] // Try both
            });

            this.initSocketEvents();
            this.socket.connect();
            this.debugLog("Socket connect() called");

        } catch (err) {
            console.error("Init Error:", err);
            this.debugLog(`Init Failed: ${err.message}`);
        }
    }

    debugLog(msg) {
        console.log(`[Debug] ${msg}`);
        const container = document.getElementById('room-list-container');
        if (container) {
            const status = container.querySelector('.connection-status') || document.createElement('div');
            if (!status.classList.contains('connection-status')) {
                status.className = 'connection-status';
                status.style.fontSize = '0.75rem';
                status.style.color = 'var(--text-muted)';
                status.style.marginTop = '10px';
                container.appendChild(status);
            }
            status.textContent = `Status: ${msg}`;
        }
    }

    initSettings() {
        // Toggle Modal
        this.ui.settingsBtn.addEventListener('click', () => this.ui.settingsModal.classList.remove('hidden'));
        this.ui.settingsModal.querySelector('.close-modal').addEventListener('click', () => this.ui.settingsModal.classList.add('hidden'));

        // Theme Buttons
        this.ui.themeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const theme = btn.dataset.theme;
                let color = '#0f3d24'; // default green
                if (theme === 'blue') color = '#0f172a';
                if (theme === 'red') color = '#450a0a';
                if (theme === 'purple') color = '#3b0764';

                document.body.style.setProperty('--felt-color', color);

                this.ui.themeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                localStorage.setItem('farkle-theme', theme);
            });
        });

        // Dice Theme
        this.ui.diceThemeSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            document.body.setAttribute('data-dice-theme', val);
            localStorage.setItem('farkle-dice-theme', val);
        });

        // Load saved
        const savedTheme = localStorage.getItem('farkle-theme');
        if (savedTheme) {
            const btn = document.querySelector(`.theme-btn[data-theme="${savedTheme}"]`);
            if (btn) btn.click();
        }
        const savedDice = localStorage.getItem('farkle-dice-theme');
        if (savedDice) {
            this.ui.diceThemeSelect.value = savedDice;
            document.body.setAttribute('data-dice-theme', savedDice);
        }
    }



    initSimpleBackground() {
        const container = document.getElementById('bg-dice-container');
        if (!container) return;

        const diceChars = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
        const numDice = 20;

        for (let i = 0; i < numDice; i++) {
            const die = document.createElement('div');
            die.classList.add('bg-die');
            die.textContent = diceChars[Math.floor(Math.random() * diceChars.length)];

            // Randomize position and animation
            die.style.left = `${Math.random() * 100}%`;
            die.style.fontSize = `${Math.random() * 2 + 1}rem`;
            die.style.opacity = '0.05';
            die.style.animationDuration = `${Math.random() * 10 + 15}s`; // Slow float
            die.style.animationDelay = `-${Math.random() * 20}s`; // Start at random times

            container.appendChild(die);
        }
    }

    async initDiscord() {
        // Disabled as requested: "i dont care about getting the discord usernames of the players rn"
        this.debugLog("Discord Integration: Manual Mode");
        this.playerName = `Player ${Math.floor(Math.random() * 1000)}`;
    }

    async updateDiscordPresence(details, state) {
        if (!this.discordSdk) return;
        try {
            // This requires rpc.activities.write scope and valid auth
            await this.discordSdk.commands.setActivity({
                activity: {
                    details: details,
                    state: state,
                    assets: {
                        large_image: "farkle_icon", // Asset key from Discord Dev Portal
                        large_text: "Farkle"
                    }
                }
            });
        } catch (e) {
            // console.warn("Failed to set activity", e);
        }
    }

    initListeners() {
        this.ui.rollBtn.addEventListener('click', () => {
            if (this.canInteract()) {
                // Send what the user SEES as selected to prevent lag issues
                const selectedIds = Array.from(document.querySelectorAll('.die.selected'))
                    .map(el => el.dataset.id)
                    .filter(id => id); // remove null/undefined

                this.socket.emit('roll', { roomCode: this.roomCode, confirmedSelections: selectedIds });
            }
        });

        this.ui.bankBtn.addEventListener('click', () => {
            if (this.canInteract()) {
                const selectedIds = Array.from(document.querySelectorAll('.die.selected'))
                    .map(el => el.dataset.id)
                    .filter(id => id);
                this.socket.emit('bank', { roomCode: this.roomCode, confirmedSelections: selectedIds });
            }
        });

        this.ui.diceContainer.addEventListener('click', (e) => {
            const dieEl = e.target.closest('.die');
            if (dieEl && this.canInteract()) {
                const id = dieEl.dataset.id;

                // Optimistic UI Toggle
                dieEl.classList.toggle('selected');

                this.socket.emit('toggle_die', { roomCode: this.roomCode, dieId: id });
            }
        });

        // Modals
        this.ui.rulesBtn.addEventListener('click', () => this.ui.rulesModal.classList.remove('hidden'));
        this.ui.rulesModal.querySelector('.close-modal').addEventListener('click', () => this.ui.rulesModal.classList.add('hidden'));

        this.ui.startGameBtn.addEventListener('click', () => this.joinGame());

        this.ui.restartBtn.addEventListener('click', () => {
            this.socket.emit('restart', { roomCode: this.roomCode });
            this.ui.gameOverModal.classList.add('hidden');
        });
    }

    initSocketEvents() {
        this.socket.on('connect', () => {
            this.debugLog(`Connected! ID: ${this.socket.id}`);
            this.showFeedback("Connected!", "success");

            // Enable Button
            if (this.ui.startGameBtn) {
                this.ui.startGameBtn.textContent = "JOIN TABLE";
                this.ui.startGameBtn.disabled = false;
                this.ui.startGameBtn.style.opacity = "1";
                this.ui.startGameBtn.style.cursor = "pointer";
            }
            const debugEl = document.getElementById('connection-debug');
            if (debugEl) debugEl.textContent = "Connected to server.";

            // Explicitly request room list to avoid race conditions
            this.socket.emit('get_room_list');

            if (this.roomCode && this.playerName) {
                console.log('Attempting auto-rejoin...');
                this.socket.emit('join_game', { roomCode: this.roomCode, playerName: this.playerName });
                this.showFeedback("Reconnecting...", "info");
            }
        });

        this.socket.on('connect_error', (err) => {
            this.debugLog(`Connection Error: ${err.message}`);
            console.error("Socket Connection Error:", err);

            const container = document.getElementById('room-list-container');
            if (container && container.innerText.includes('Loading')) {
                container.innerHTML = `<p style="color:var(--danger)">Connection Failed. <button class="btn secondary" onclick="location.reload()">Retry</button></p>`;
            }
            const debugEl = document.getElementById('connection-debug');
            if (debugEl) debugEl.textContent = `Connection Error: ${err.message}`;

            this.showFeedback("Connection Error!", "error");
        });

        this.socket.on('room_list', (rooms) => {
            this.debugLog(`Received ${rooms.length} tables`);
            this.renderRoomList(rooms);
        });

        this.socket.on('disconnect', (reason) => {
            this.debugLog(`Disconnected: ${reason}`);
            console.log('Disconnected from server');
            this.showFeedback("Connection Lost! Reconnecting...", "error");
        });

        this.socket.on('joined', ({ playerId, state }) => {
            this.playerId = playerId;
            this.roomCode = state.roomCode; // Save assigned room
            this.updateGameState(state);
            this.ui.setupModal.classList.add('hidden');
            this.showFeedback("Joined Room!", "success");
            this.renderControls();
        });

        this.socket.on('game_state_update', (state) => {
            if (this.isRolling) {
                this.pendingState = state;
            } else {
                this.updateGameState(state);
            }
        });

        this.socket.on('game_start', (state) => {
            this.updateGameState(state);
            this.showFeedback("Game Started!", "success");
        });

        this.socket.on('roll_result', (data) => {
            const diceValues = data.dice.map(d => d.value);
            this.isRolling = true;
            if (this.ui.diceContainer) this.ui.diceContainer.classList.add('rolling');

            this.dice3D.roll(diceValues).then(() => {
                this.isRolling = false;
                if (this.ui.diceContainer) this.ui.diceContainer.classList.remove('rolling');

                // Use the latest state we received during animation, or the one from the roll result
                const finalState = this.pendingState || data.state;
                this.pendingState = null;

                this.updateGameState(finalState);
                if (data.farkle) {
                    this.showFeedback("FARKLE!", "error");
                }
                if (data.hotDice) {
                    this.showFeedback("HOT DICE!", "success");
                }
            });
        });

        this.socket.on('error', (msg) => {
            if (msg === "Game not active" || msg === "Room full" || msg === "Room Full") {
                console.error("Game Error:", msg);
                this.showFeedback(msg, "error");
            } else {
                alert(msg);
            }
        });
    }

    renderRoomList(rooms) {
        if (!Array.isArray(rooms)) {
            this.debugLog(`Error: Invalid room list data received`);
            return;
        }

        const container = document.getElementById('room-list-container');
        if (!container) return;

        if (rooms.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted); padding: 1rem; text-align: center; font-size: 0.8rem;">No active public tables.</p>';
            return;
        }

        container.innerHTML = '<p style="color:var(--text-muted); font-size: 0.8rem; grid-column: 1/-1; margin-bottom: 0.5rem;">Or select active table:</p>';
        rooms.forEach(room => {
            const card = document.createElement('div');
            card.className = `room-card ${room.count >= room.max ? 'full' : ''}`;

            const title = document.createElement('h3');
            title.textContent = room.name;

            const status = document.createElement('div');
            status.className = 'room-status';
            status.textContent = `${room.count} / ${room.max} Players`;

            if (room.status === 'playing') {
                status.textContent += ' (In Progress)';
            }

            card.appendChild(title);
            card.appendChild(status);

            if (room.count < room.max || (room.count >= room.max && room.status === 'waiting')) {
                card.addEventListener('click', () => {
                    this.joinRoom(room.name);
                });
            } else {
                card.title = "Room Full";
            }

            container.appendChild(card);
        });
    }

    joinRoom(roomCode) {
        this.debugLog(`Joining ${roomCode}...`);
        this.socket.emit('join_game', { roomCode: roomCode });
    }

    joinGame() {
        this.debugLog(`Joining Game...`);
        this.socket.emit('join_game');
    }

    canInteract() {
        if (!this.gameState) {
            // console.log("canInteract: No gameState");
            return false;
        }
        if (this.gameState.gameStatus !== 'playing') {
            // console.log("canInteract: Status not playing", this.gameState.gameStatus);
            return false;
        }
        if (!this.socket || !this.socket.id) return false;

        const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
        const isMyTurn = currentPlayer && currentPlayer.id === this.socket.id;

        return isMyTurn;
    }

    renderPlayers() {
        if (!this.gameState || !this.gameState.players) return;

        const container = this.ui.playerZonesContainer;
        if (!container) return;

        const players = this.gameState.players;
        const children = Array.from(container.children);

        // 1. Remove excess cards
        while (container.children.length > players.length) {
            container.removeChild(container.lastChild);
        }

        // 2. Update or Create cards
        players.forEach((player, index) => {
            let card = container.children[index];
            const isCurrent = this.gameState.currentPlayerIndex === index && this.gameState.gameStatus === 'playing';

            if (!card) {
                // Create new card structure
                card = document.createElement('div');
                card.className = 'player-card';
                card.style.minWidth = "150px";

                const info = document.createElement('div');
                info.className = 'player-info';

                const name = document.createElement('span');
                name.className = 'player-name';

                info.appendChild(name);

                const scoreDiv = document.createElement('div');
                scoreDiv.className = 'total-score';

                card.appendChild(info);
                card.appendChild(scoreDiv);

                container.appendChild(card);
            }

            // Update Content safely
            const nameEl = card.querySelector('.player-name');
            const scoreEl = card.querySelector('.total-score');

            if (nameEl && nameEl.textContent !== player.name) nameEl.textContent = player.name;
            if (scoreEl && scoreEl.textContent != player.score) scoreEl.textContent = player.score;

            // Update Classes
            const isActive = card.classList.contains('active');
            if (isCurrent && !isActive) card.classList.add('active');
            if (!isCurrent && isActive) card.classList.remove('active');

            // Update Opacity
            const targetOpacity = player.connected ? "1" : "0.5";
            if (card.style.opacity !== targetOpacity) card.style.opacity = targetOpacity;
        });
    }

    renderDice(dice) {
        if (!this.ui.diceContainer) return;

        const container = this.ui.diceContainer;

        // 1. Remove excess dice
        while (container.children.length > dice.length) {
            container.removeChild(container.lastChild);
        }

        // 2. Update or Create dice
        dice.forEach((d, index) => {
            let die = container.children[index];

            if (!die) {
                die = document.createElement('div');
                die.className = 'die';
                container.appendChild(die);
            }

            // Update Class for Selection
            const isSelected = d.selected;
            if (isSelected && !die.classList.contains('selected')) die.classList.add('selected');
            if (!isSelected && die.classList.contains('selected')) die.classList.remove('selected');

            // Update Identifiers
            if (die.dataset.id !== d.id) die.dataset.id = d.id;

            // Update Value and Pips only if changed
            if (die.dataset.value != d.value) {
                die.dataset.value = d.value;
                die.innerHTML = '';
                for (let i = 0; i < d.value; i++) {
                    const pip = document.createElement('div');
                    pip.className = 'pip';
                    die.appendChild(pip);
                }
                // Reset animation only on value update/creation
                die.style.animation = 'none';
                die.offsetHeight; /* trigger reflow */
                die.style.animation = null;
            }
        });
    }

    getDieChar(val) {
        // Unused now
        const chars = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
        return chars[val - 1] || val;
    }

    updateGameState(state) {
        // console.log("State Update:", state);
        this.gameState = state;
        this.renderPlayers();
        this.renderControls();
        this.renderDice(state.currentDice);
        this.checkGameOver(state);

        // Update Discord Rich Presence
        if (this.gameState.gameStatus === 'playing') {
            const myPlayer = this.gameState.players.find(p => p.id === this.socket.id);
            if (myPlayer) {
                const opponent = this.gameState.players.find(p => p.id !== this.socket.id);
                const scoreText = `Score: ${myPlayer.score}`;
                const roundText = `Round: ${state.roundAccumulatedScore > 0 ? '+' + state.roundAccumulatedScore : 'Rolling'}`;
                this.updateDiscordPresence(scoreText, roundText);
            }
        } else {
            this.updateDiscordPresence("In Lobby", "Waiting for game");
        }
    }

    renderControls() {
        if (!this.gameState) return;

        // Handle Waiting State
        if (this.gameState.gameStatus === 'waiting') {
            this.ui.currentScoreDisplay.textContent = "Waiting for players...";
            this.ui.rollBtn.style.display = 'none';
            this.ui.bankBtn.style.display = 'none';

            // Check for existing start button or create one
            let startBtn = document.getElementById('lobby-start-btn');
            if (!startBtn) {
                startBtn = document.createElement('button');
                startBtn.id = 'lobby-start-btn';
                startBtn.className = 'btn primary';
                startBtn.textContent = 'Start Game';
                startBtn.onclick = () => {
                    this.socket.emit('start_game', { roomCode: this.roomCode });
                };
                // Inject into button group
                if (this.ui.rollBtn.parentElement) {
                    this.ui.rollBtn.parentElement.appendChild(startBtn);
                }
            }

            if (this.gameState.players.length >= 2) {
                startBtn.style.display = 'block';
                startBtn.disabled = false;
                this.ui.actionText.textContent = "Ready to start!";
            } else {
                startBtn.style.display = 'block';
                startBtn.disabled = true;
                this.ui.actionText.textContent = `Need ${2 - this.gameState.players.length} more player(s)`;
            }
            return;
        }

        // Debug Panel Injection
        let debugPanel = document.getElementById('debug-panel');
        if (!debugPanel && this.ui.bankBtn.parentElement && this.ui.bankBtn.parentElement.parentElement) { // Append to control container
            debugPanel = document.createElement('div');
            debugPanel.id = 'debug-panel';
            debugPanel.className = 'tools-panel';

            const forceBtn = document.createElement('button');
            forceBtn.className = 'btn micro';
            forceBtn.textContent = 'Force Next';
            forceBtn.onclick = () => this.socket.emit('force_next_turn', { roomCode: this.roomCode });

            const restartBtn = document.createElement('button');
            restartBtn.className = 'btn micro';
            restartBtn.textContent = 'Fix/Restart';
            restartBtn.title = "Restart round without losing scores/players";
            restartBtn.onclick = () => {
                if (confirm("Restart round? Scores will be preserved.")) {
                    this.socket.emit('debug_restart_preserve', { roomCode: this.roomCode });
                }
            };

            debugPanel.appendChild(forceBtn);
            debugPanel.appendChild(restartBtn);

            // Insert after button group
            this.ui.bankBtn.parentElement.parentElement.appendChild(debugPanel);
        }

        // Playing State
        const startBtn = document.getElementById('lobby-start-btn');
        if (startBtn) startBtn.style.display = 'none';

        this.ui.rollBtn.style.display = 'inline-block';
        this.ui.bankBtn.style.display = 'inline-block';

        const isMyTurn = this.canInteract();
        const selectedDice = this.gameState.currentDice.filter(d => d.selected);
        const selectedScore = calculateScore(selectedDice.map(d => d.value));
        const totalRound = this.gameState.roundAccumulatedScore + selectedScore;

        // Score Display
        this.ui.currentScoreDisplay.textContent = `Selection: ${selectedScore} (Round: ${totalRound})`;

        if (!isMyTurn) {
            this.ui.rollBtn.disabled = true;
            this.ui.bankBtn.disabled = true;

            const currentPlayerName = this.gameState.players[this.gameState.currentPlayerIndex]?.name || "Someone";
            this.ui.actionText.textContent = `Waiting for ${currentPlayerName}...`;
            this.ui.rollBtn.textContent = 'Roll';
        } else {
            this.ui.actionText.textContent = "Your turn";

            const hasSelected = selectedDice.length > 0;

            if (this.gameState.currentDice.length === 0) {
                this.ui.rollBtn.disabled = false;
                this.ui.rollBtn.textContent = "Roll Dice";
                this.ui.bankBtn.disabled = true;
            } else {
                const isValid = isScoringSelection(selectedDice.map(d => d.value));
                if (isValid) {
                    this.ui.rollBtn.disabled = false;
                    this.ui.rollBtn.textContent = "Roll Remaining";
                    this.ui.bankBtn.disabled = false;
                } else {
                    this.ui.rollBtn.disabled = true; // Must select
                    this.ui.bankBtn.disabled = true;
                    // Check if we just rolled Hot Dice (6 fresh dice, score > 0 implied by round logic usually, but here we just check count)
                    if (this.gameState.currentDice.length === 6 && this.gameState.roundAccumulatedScore > 0 && selectedDice.length === 0) {
                        this.ui.actionText.textContent = "HOT DICE! Select scoring dice!";
                    } else {
                        this.ui.actionText.textContent = "Select scoring dice!";
                    }
                }

                if (this.gameState.currentDice.length > 0 && selectedDice.length === this.gameState.currentDice.length) {
                    this.ui.rollBtn.textContent = "Roll Hot Dice!";
                }
            }
        }
    }

    checkGameOver(state) {
        if (state.gameStatus === 'finished') {
            this.ui.gameOverModal.classList.remove('hidden');

            const winner = state.winner;
            let title = "";
            if (winner === 'tie') title = "It's a Tie!";
            else if (winner) title = `${winner.name} Wins!`;

            this.ui.winnerText.textContent = title;

            const p1 = state.players[0];
            const p2 = state.players[1];
            if (p1) {
                this.ui.endP1Name.textContent = p1.name;
                this.ui.endP1Score.textContent = p1.score;
            }
            if (p2) {
                this.ui.endP2Name.textContent = p2.name;
                this.ui.endP2Score.textContent = p2.score;
            }
        } else {
            this.ui.gameOverModal.classList.add('hidden');
        }
    }

    showFeedback(text, type = "info") {
        if (!this.ui.feedback) return;
        this.ui.feedback.textContent = text;
        this.ui.feedback.classList.remove('hidden');
        if (type === 'error') this.ui.feedback.classList.add('error');
        else if (type === 'success') this.ui.feedback.classList.add('success');
        else {
            this.ui.feedback.classList.remove('error', 'success');
        }

        setTimeout(() => {
            this.ui.feedback.classList.add('hidden');
        }, 2000);
    }
}

class Dice3DManager {
    constructor(container) {
        if (!container) return;
        this.container = container;
        this.diceObjects = [];
        this.isRunning = false;
        this.targetValues = [];
        this.resolveRoll = null;
        this.rollStartTime = 0;
        this.palette = [
            "#EAA14D", "#E05A47", "#4D9BEA", "#5FB376",
            "#D869A8", "#F2C94C", "#9B51E0", "#FFFFFF"
        ];

        this.faceNormals = [
            new THREE.Vector3(1, 0, 0),  // 1
            new THREE.Vector3(-1, 0, 0), // 6
            new THREE.Vector3(0, 1, 0),  // 2
            new THREE.Vector3(0, -1, 0), // 5
            new THREE.Vector3(0, 0, 1),  // 3
            new THREE.Vector3(0, 0, -1)  // 4
        ];
        this.faceValues = [1, 6, 2, 5, 3, 4];

        this.init();
    }

    init() {
        const width = this.container.clientWidth || 600;
        const height = this.container.clientHeight || 400;
        const aspect = width / height;
        const FRUSTUM = 20;

        this.scene = new THREE.Scene();

        // Orthographic camera for that arcade look from the CodePen
        this.camera = new THREE.OrthographicCamera(
            -FRUSTUM * aspect / 2, FRUSTUM * aspect / 2,
            FRUSTUM / 2, -FRUSTUM / 2,
            1, 1000
        );
        this.camera.position.set(40, 40, 40);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.domElement.style.touchAction = 'none';
        this.container.appendChild(this.renderer.domElement);

        this.world = new CANNON.World();
        this.world.gravity.set(0, -200, 0); // Much stronger gravity for "snappy" feel
        this.world.allowSleep = true;

        const floorMat = new CANNON.Material();
        const floorBody = new CANNON.Body({ mass: 0, material: floorMat });
        floorBody.addShape(new CANNON.Plane());
        floorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
        this.world.addBody(floorBody);

        const wallMat = new CANNON.Material();
        const wallDist = 12;
        const createWall = (x, z, rot) => {
            const body = new CANNON.Body({ mass: 0, material: wallMat });
            body.addShape(new CANNON.Plane());
            body.position.set(x, 0, z);
            body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rot);
            this.world.addBody(body);
        };
        createWall(wallDist, 0, -Math.PI / 2);
        createWall(-wallDist, 0, Math.PI / 2);
        createWall(0, -wallDist, 0);
        createWall(0, wallDist, Math.PI);

        this.diceMat = new CANNON.Material();
        this.world.addContactMaterial(new CANNON.ContactMaterial(floorMat, this.diceMat, { friction: 0.2, restitution: 0.4 }));
        this.world.addContactMaterial(new CANNON.ContactMaterial(wallMat, this.diceMat, { friction: 0.1, restitution: 0.6 }));

        this.scene.add(new THREE.AmbientLight(0xffffff, 1.2));
        const dir = new THREE.DirectionalLight(0xffffff, 0.5);
        dir.position.set(10, 20, 10);
        this.scene.add(dir);

        this.animate();

        window.addEventListener('resize', () => {
            const w = this.container.clientWidth;
            const h = this.container.clientHeight;
            const asp = w / h;
            this.camera.left = -FRUSTUM * asp / 2;
            this.camera.right = FRUSTUM * asp / 2;
            this.camera.top = FRUSTUM / 2;
            this.camera.bottom = -FRUSTUM / 2;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(w, h);
        });
    }

    createDiceTexture(number, color = "#ffffff") {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = color;
        ctx.fillRect(0, 0, size, size);

        const isWhite = (color.toLowerCase() === "#ffffff" || color.toLowerCase() === "white");
        ctx.fillStyle = isWhite ? "#E03E3E" : "#ffffff";
        if (number !== 1 && number !== 4 && isWhite) ctx.fillStyle = "#331e18";

        const dot = (x, y, r) => {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        };

        const c = size / 2, q1 = size / 4, q3 = size * 3 / 4;
        const dotSize = 25;
        const bigDot = 35;

        if (number === 1) dot(c, c, bigDot);
        else if (number === 2) { dot(q1, q1, dotSize); dot(q3, q3, dotSize); }
        else if (number === 3) { dot(q1, q1, dotSize); dot(c, c, dotSize); dot(q3, q3, dotSize); }
        else if (number === 4) { dot(q1, q1, dotSize); dot(q3, q1, dotSize); dot(q1, q3, dotSize); dot(q3, q3, dotSize); }
        else if (number === 5) { dot(q1, q1, dotSize); dot(q3, q1, dotSize); dot(c, c, dotSize); dot(q1, q3, dotSize); dot(q3, q3, dotSize); }
        else if (number === 6) { dot(q1, q1, dotSize); dot(q3, q1, dotSize); dot(q1, c, dotSize); dot(q3, c, dotSize); dot(q1, q3, dotSize); dot(q3, q3, dotSize); }

        return new THREE.CanvasTexture(canvas);
    }

    roll(values) {
        return new Promise(resolve => {
            this.targetValues = values;
            this.resolveRoll = resolve;
            this.clearDice();
            this.spawnDice(values);
            this.isRunning = true;
            this.rollStartTime = Date.now();

            setTimeout(() => { if (this.isRunning) this.stopRoll(); }, 1200);
        });
    }

    clearDice() {
        this.diceObjects.forEach(obj => { this.scene.remove(obj.mesh); this.world.removeBody(obj.body); });
        this.diceObjects = [];
    }

    spawnDice(values) {
        const theme = document.body.getAttribute('data-dice-theme') || 'classic';
        const geom = new RoundedBoxGeometry(2.2, 2.2, 2.2, 4, 0.4);

        values.forEach((val, i) => {
            let diceColor = "#ffffff";
            if (theme === 'classic') diceColor = this.palette[i % this.palette.length];
            else if (theme === 'gold') diceColor = "#ffd700";
            else if (theme === 'dark') diceColor = "#111111";

            const materials = [];
            for (let j = 1; j <= 6; j++) {
                materials.push(new THREE.MeshStandardMaterial({
                    map: this.createDiceTexture(j, diceColor),
                    roughness: 0.3,
                    metalness: theme === 'gold' ? 0.7 : 0.1
                }));
            }
            const matArray = [materials[0], materials[5], materials[1], materials[4], materials[2], materials[3]];

            const mesh = new THREE.Mesh(geom, matArray);
            this.scene.add(mesh);

            const shape = new CANNON.Box(new CANNON.Vec3(1.1, 1.1, 1.1));
            const body = new CANNON.Body({
                mass: 5,
                shape: shape,
                material: this.diceMat,
                position: new CANNON.Vec3((Math.random() - 0.5) * 5, 15 + i * 2, (Math.random() - 0.5) * 5)
            });

            body.velocity.set((Math.random() - 0.5) * 20, -60, (Math.random() - 0.5) * 20);
            body.angularVelocity.set((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40);

            this.world.addBody(body);
            this.diceObjects.push({ mesh, body, targetVal: val });
        });
    }

    checkStopped() {
        if (!this.isRunning) return;
        let allStopped = true;
        this.diceObjects.forEach(obj => {
            if (obj.body.velocity.lengthSquared() > 0.2 || obj.body.angularVelocity.lengthSquared() > 0.2) allStopped = false;
        });
        if (allStopped && Date.now() - this.rollStartTime > 500) this.stopRoll();
    }

    stopRoll() {
        if (!this.isRunning) return;
        this.isRunning = false;
        this.diceObjects.forEach(obj => { this.alignDie(obj); obj.body.sleep(); });
        if (this.resolveRoll) {
            const res = this.resolveRoll;
            this.resolveRoll = null;
            setTimeout(res, 300);
        }
    }

    alignDie(obj) {
        const bodyQ = obj.body.quaternion;
        const targetVal = obj.targetVal;
        let bestIndex = 0;
        let maxUp = -1;
        for (let i = 0; i < this.faceNormals.length; i++) {
            const normal = this.faceNormals[i].clone().applyQuaternion(bodyQ);
            if (normal.y > maxUp) { maxUp = normal.y; bestIndex = i; }
        }
        let targetIndex = this.faceValues.indexOf(targetVal);
        if (targetIndex !== bestIndex) {
            const from = this.faceNormals[targetIndex];
            const to = this.faceNormals[bestIndex];
            const correction = new THREE.Quaternion().setFromUnitVectors(from, to);
            obj.mesh.quaternion.copy(bodyQ).multiply(correction);
        } else {
            obj.mesh.quaternion.copy(bodyQ);
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (this.isRunning) {
            this.world.step(1 / 60);
            this.diceObjects.forEach(obj => {
                obj.mesh.position.copy(obj.body.position);
                obj.mesh.quaternion.copy(obj.body.quaternion);
            });
            this.checkStopped();
        }
        this.renderer.render(this.scene, this.camera);
    }
}

// Instantiate immediately since we are a module script
window.farkle = new FarkleClient();
