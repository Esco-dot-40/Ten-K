import { calculateScore } from './rules.js';
import { DiscordSDK } from "@discord/embedded-app-sdk";

const DISCORD_CLIENT_ID = '1317075677927768074'; // Real Client ID

class FarkleClient {
    constructor() {
        this.socket = io();
        this.roomCode = null;
        this.playerId = null;
        this.gameState = null;
        this.discordSdk = null;

        // UI Elements

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
            startGameBtn: document.getElementById('start-game-btn'),
            playerNameInput: document.getElementById('player-name-input'),
            roomCodeInput: document.getElementById('room-code-input'),
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

        this.initListeners();
        this.initSettings();
        this.initBackgroundDice();
        this.initDiscord(); // Try to init Discord
        this.initSocketEvents();
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
            // Note: This requires the valid Client ID to be set in DISCORD_CLIENT_ID
            this.discordSdk = new DiscordSDK(DISCORD_CLIENT_ID);
            await this.discordSdk.ready();
            console.log("Discord SDK Ready");

            // Authenticate purely for retrieving user info if needed, but for RP we might need scope
            // For now, we just log readiness. Implementing full OAuth requires backend handshake.

            // Example activity update (mocked as it might fail without auth)
            // this.updateDiscordPresence("In Menu");
        } catch (e) {
            console.log("Discord SDK Init skipped/failed (expected locally):", e);
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
            console.log('Connected to server with ID:', this.socket.id);
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
            console.error("Socket Connection Error:", err);
            const container = document.getElementById('room-list-container');
            if (container && container.innerText.includes('Loading')) {
                container.innerHTML = `<p style="color:var(--danger)">Connection Failed. <button class="btn secondary" onclick="location.reload()">Retry</button></p>`;
            }
            this.showFeedback("Connection Error!", "error");
        });

        this.socket.on('room_list', (rooms) => {
            this.renderRoomList(rooms);
        });

        this.socket.on('disconnect', () => {
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

            // Re-order inputs if needed, but append is fine. Name input is first.
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
        this.ui.feedback.textContent = text;
        this.ui.feedback.classList.remove('hidden');
        setTimeout(() => {
            this.ui.feedback.classList.add('hidden');
        }, 1500);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new FarkleClient();
});
