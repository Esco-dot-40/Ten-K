// Game Rules (Merged from rules.js to avoid module resolution issues)
const SCORING_RULES = {
    TRIPLE_1: 1000,
    TRIPLE_2: 200,
    TRIPLE_3: 300,
    TRIPLE_4: 400,
    TRIPLE_5: 500,
    TRIPLE_6: 600,
    SINGLE_1: 100,
    SINGLE_5: 50
};

function calculateScore(dice) {
    if (!dice || dice.length === 0) return 0;
    const counts = {};
    for (const die of dice) counts[die] = (counts[die] || 0) + 1;
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
                playerNameInput: document.getElementById('player-name-input'),
                winnerText: document.getElementById('winner-text'),
                endP1Name: document.getElementById('end-p1-name'),
                endP1Score: document.getElementById('end-p1-score'),
                endP2Name: document.getElementById('end-p2-name'),
                endP2Score: document.getElementById('end-p2-score'),
                restartBtn: document.getElementById('restart-btn'),
                settingsBtn: document.getElementById('settings-btn'),
                settingsModal: document.getElementById('settings-modal'),
                diceThemeSelect: document.getElementById('dice-theme-select'),
                themeBtns: document.querySelectorAll('.theme-btn')
            };

            this.debugLog("UI Elements mapped");

            this.initListeners();
            this.initSettings();
            this.initBackgroundDice();

            this.debugLog("Internal modules inited");

            this.initDiscord().catch(err => {
                this.debugLog(`Discord Init Error: ${err.message}`);
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

    initBackgroundDice() {
        const container = document.getElementById('bg-dice-container');
        if (!container) return;
        const dieChars = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
        for (let i = 0; i < 15; i++) {
            const el = document.createElement('div');
            el.classList.add('bg-die');
            el.textContent = dieChars[Math.floor(Math.random() * 6)];
            el.style.left = Math.random() * 100 + '%';
            el.style.animationDuration = (20 + Math.random() * 30) + 's';
            el.style.animationDelay = (Math.random() * -30) + 's';
            el.style.fontSize = (24 + Math.random() * 40) + 'px';
            el.style.opacity = 0.1 + Math.random() * 0.1;
            container.appendChild(el);
        }
    }

    async initDiscord() {
        try {
            this.debugLog("Discord SDK: Loading...");
            const module = await import("@discord/embedded-app-sdk");
            DiscordSDK = module.DiscordSDK;

            this.discordSdk = new DiscordSDK(DISCORD_CLIENT_ID);

            // Timeout for ready check
            const readyPromise = this.discordSdk.ready();
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("SDK Timeout")), 5000));

            await Promise.race([readyPromise, timeoutPromise]);

            this.debugLog("Discord SDK: Ready!");
            console.log("Discord SDK Ready");
        } catch (e) {
            this.debugLog(`Discord SDK: ${e.message} (Skipped)`);
            console.warn("Discord SDK Init failed (expected locally):", e);
        }
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
                this.socket.emit('roll', { roomCode: this.roomCode });
            }
        });

        this.ui.bankBtn.addEventListener('click', () => {
            if (this.canInteract()) {
                this.socket.emit('bank', { roomCode: this.roomCode });
            }
        });

        this.ui.diceContainer.addEventListener('click', (e) => {
            const dieEl = e.target.closest('.die');
            if (dieEl && this.canInteract()) {
                const id = dieEl.dataset.id; // ID is string in dataset
                // Optimistic toggle? No, server is fast enough usually, or toggle locally and wait for correction?
                // Let's toggle locally for responsiveness, then sync.
                // Actually server is simple enough to just emit.
                this.socket.emit('toggle_die', { roomCode: this.roomCode, dieId: id });
            }
        });

        // Modals
        this.ui.rulesBtn.addEventListener('click', () => this.ui.rulesModal.classList.remove('hidden'));
        this.ui.rulesModal.querySelector('.close-modal').addEventListener('click', () => this.ui.rulesModal.classList.add('hidden'));

        // this.ui.startGameBtn.addEventListener('click', () => this.joinGame());

        this.ui.restartBtn.addEventListener('click', () => {
            this.socket.emit('restart', { roomCode: this.roomCode });
            this.ui.gameOverModal.classList.add('hidden');
        });
    }

    initSocketEvents() {
        this.socket.on('connect', () => {
            this.debugLog(`Connected! ID: ${this.socket.id}`);
            this.showFeedback("Connected!", "success");

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
            this.updateGameState(state);
            this.ui.setupModal.classList.add('hidden');
            this.showFeedback("Joined Room!", "success");
            this.renderControls();
        });

        this.socket.on('game_state_update', (state) => {
            this.updateGameState(state);
        });

        this.socket.on('game_start', (state) => {
            this.updateGameState(state);
            this.showFeedback("Game Started!", "success");
        });

        this.socket.on('roll_result', (data) => {
            this.animateRoll(data.dice).then(() => {
                this.updateGameState(data.state);
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

        // Find container in setup modal
        let container = document.getElementById('room-list-container');
        if (!container) {
            // Create if missing (replacing old input)
            const parent = this.ui.setupModal.querySelector('.modal-content');
            // Remove old inputs if present
            const oldInput = parent.querySelector('#room-code-input')?.closest('.input-group');
            if (oldInput) oldInput.remove();

            const oldBtn = parent.querySelector('#start-game-btn');
            if (oldBtn) oldBtn.remove();

            // Add label
            let label = parent.querySelector('#room-label');
            if (!label) {
                label = document.createElement('h3');
                label.id = 'room-label';
                label.textContent = "Select a Table";
                label.style.color = "var(--primary)";
                label.style.marginBottom = "10px";
                parent.appendChild(label);
            }

            container = document.createElement('div');
            container.id = 'room-list-container';
            container.className = 'room-grid';
            parent.appendChild(container);
        }

        if (rooms.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted); padding: 2rem; text-align: center;">No rooms available. Please wait...</p>';
            return;
        }

        container.innerHTML = '';
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
        const name = this.ui.playerNameInput.value.trim() || 'Player';
        this.roomCode = roomCode;
        this.playerName = name;
        this.socket.emit('join_game', { roomCode: roomCode, playerName: name });
    }

    joinGame() {
        // Legacy method, unused now
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

        // Dynamic rendering
        const container = this.ui.playerZonesContainer;
        if (!container) return;

        // Only rebuild if player count/names changed? For now, full rebuild is safer but maybe flashing?
        // We'll trust browser optimization for now.
        container.innerHTML = '';

        this.gameState.players.forEach((player, index) => {
            // For lobby view: show all.
            // For game view: show all.

            const isCurrent = this.gameState.currentPlayerIndex === index && this.gameState.gameStatus === 'playing';

            const card = document.createElement('div');
            card.className = `player-card ${isCurrent ? 'active' : ''}`;
            card.style.minWidth = "150px";
            if (!player.connected) card.style.opacity = "0.5";

            const info = document.createElement('div');
            info.className = 'player-info';

            const name = document.createElement('span');
            name.className = 'player-name';
            name.textContent = player.name;

            info.appendChild(name);

            const scoreDiv = document.createElement('div');
            scoreDiv.className = 'total-score';
            scoreDiv.textContent = player.score;

            // Round stats logic could be enhanced to show who just banked

            card.appendChild(info);
            card.appendChild(scoreDiv);

            container.appendChild(card);
        });
    }

    renderDice(dice) {
        this.ui.diceContainer.innerHTML = '';
        dice.forEach((d, index) => {
            const die = document.createElement('div');
            die.className = `die ${d.selected ? 'selected' : ''}`;
            die.dataset.id = d.id;
            die.dataset.value = d.value;

            // Create content for die (pips or text)
            // Using standard unicode for simplicity and robustness
            die.textContent = this.getDieChar(d.value);

            // Animation staggered entry
            die.style.animationDelay = `${index * 50}ms`;

            this.ui.diceContainer.appendChild(die);
        });
    }

    getDieChar(val) {
        const chars = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
        return chars[val - 1] || val;
    }

    animateRoll(dice) {
        return new Promise(resolve => {
            this.ui.diceContainer.classList.add('rolling');

            // Play sound if available? (Skipping for now)

            // Show temporary rolling state
            this.ui.diceContainer.innerHTML = '';
            for (let i = 0; i < dice.length; i++) {
                const die = document.createElement('div');
                die.className = 'die rolling';
                die.textContent = '🎲';
                die.style.animationDuration = '0.5s';
                this.ui.diceContainer.appendChild(die);
            }

            setTimeout(() => {
                this.ui.diceContainer.classList.remove('rolling');
                resolve();
            }, 600);
        });
    }

    updateGameState(state) {
        console.log("State Update:", state);
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
                const scoreText = `Score: ${myPlayer.score} vs ${opponent ? opponent.score : 0}`;
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
                if (hasSelected) {
                    this.ui.rollBtn.disabled = false;
                    this.ui.rollBtn.textContent = "Roll Remaining";
                    this.ui.bankBtn.disabled = false;
                } else {
                    this.ui.rollBtn.disabled = true; // Must select
                    this.ui.bankBtn.disabled = true;
                    // Check if we just rolled Hot Dice (6 fresh dice, score > 0 implied by round logic usually, but here we just check count)
                    if (this.gameState.currentDice.length === 6 && this.gameState.roundAccumulatedScore > 0) {
                        this.ui.actionText.textContent = "HOT DICE! Select scoring dice!";
                    } else {
                        this.ui.actionText.textContent = "Select dice to continue";
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
        setTimeout(() => {
            this.ui.feedback.classList.add('hidden');
        }, 1500);
    }
}

// Instantiate immediately since we are a module script (loaded after parsing)
window.farkle = new FarkleClient();
