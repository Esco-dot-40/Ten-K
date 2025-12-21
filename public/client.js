import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as CANNON from "cannon-es";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
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
            try { this.initGSAPBackground(); } catch (e) { console.error("GSAP Init Failed", e); }

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

    initGSAPBackground() {
        const select = (e) => document.querySelector(e);
        const gsapBody = select("#gsapBody");
        if (!gsapBody) return;

        const t0 = select("#t0"), t1 = select("#t1"), t2 = select("#t2");
        const svgs = ["svg00", "svg0", "svg1", "svg2", "svg2b", "svg2d", "svg3", "svg4", "svg5", "svg6"].map(id => select(`svg#${id}`));
        const bodyStyle = getComputedStyle(document.body);

        const closePath = (svg, fillColor) => {
            const path = svg.querySelector(".mPath");
            if (!path) return;
            const id = path.getAttribute("id");
            const oldPath = path.getAttribute("d");
            let boxPath = path.cloneNode(true);
            boxPath.id = id + "b";
            boxPath.classList.remove("mPath");
            boxPath.classList.add("mFill");
            if (fillColor.charAt(0) == "#") gsap.set(boxPath, { fill: fillColor });
            else boxPath.classList.add(fillColor);
            let newPath = oldPath + " V 1200 H -800 Z";
            gsap.set(boxPath, { attr: { d: newPath } });
            svg.appendChild(boxPath);
        };

        const createTrees = (svg, start, direction, division, numT, scale) => {
            const path = svg.querySelector(".mPath");
            if (!path) return;
            for (let i = 0; i < numT; i++) {
                let treeSource = null;
                if (scale <= 0.15) treeSource = t2;
                else if (scale <= 0.3) treeSource = t1;
                else treeSource = t0;

                if (!treeSource) continue;
                let newTree = treeSource.cloneNode(true);

                newTree.id = svg.id + "tb" + i;
                svg.appendChild(newTree);

                let startPos = (direction > 0) ? (0.5 - start + i * (1 / division)) : (0.5 + start - i * (1 / division));
                gsap.set(newTree, {
                    scale: scale,
                    motionPath: { path: path, align: path, alignOrigin: [0.5, 0.97], start: startPos, end: startPos, autoRotate: true }
                });
            }
        };

        // Initialize Background Elements
        const [s00, s0, s1, s2, s2b, s2d, s3, s4, s5, s6] = svgs;
        closePath(s00, "bgColor130"); closePath(s0, "bgColor130"); closePath(s1, "bgColor140");
        closePath(s2, "bgColor150"); closePath(s3, "bgColor130"); closePath(s4, "bgColor");
        closePath(s5, "bgColor90"); closePath(s6, "bgColor80");

        createTrees(s00, 0.49, 1, 1, 2, 2.1); createTrees(s00, 0.49, -1, 1, 2, 2.1);
        createTrees(s0, 0.42, 1, 20, 4, 2); createTrees(s0, 0.32, -1, 20, 3, 2);
        createTrees(s1, 0.30, 1, 34, 2, 1.5); createTrees(s2d, 0.42, 1, 13, 3, 2);
        createTrees(s2b, 0.42, 1, 18, 3, 1.5); createTrees(s2b, 0.3, -1, 18, 3, 1.5);
        createTrees(s2, 0.3, 1, 24, 3, 1); createTrees(s2, 0.32, 1, 24, 2, 1.25);
        createTrees(s2, 0.2, -1, 28, 2, 1); createTrees(s2, 0.1, 1, 1, 1, 1.5);
        createTrees(s3, 0.35, 1, 60, 8, 0.3); createTrees(s3, 0.3, -1, 60, 8, 0.3);
        createTrees(s4, 0.32, 1, 30, 3, 0.2); createTrees(s4, 0.34, 1, 38, 6, 0.2);
        createTrees(s4, 0.32, -1, 42, 5, 0.2); createTrees(s5, 0.18, 1, 40, 5, 0.15);
        createTrees(s5, 0.16, 1, 80, 3, 0.15); createTrees(s5, 0.1, 1, 30, 5, 0.15);
        createTrees(s6, 0.31, -1, 170, 4, 0.1); createTrees(s6, 0.3, -1, 120, 6, 0.1);
        createTrees(s6, 0.22, -1, 120, 6, 0.1);

        // Aurora Color Cycle
        gsap.timeline({
            repeat: -1, yoyo: true, defaults: { duration: 10, ease: 'none' },
            onUpdate() {
                const hexToRgb = (hex) => {
                    let c = hex.substring(1).split('');
                    if (c.length === 3) c = [c[0], c[0], c[1], c[1], c[2], c[2]];
                    c = '0x' + c.join('');
                    return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
                };

                const mix = (c1, c2, weight) => {
                    const r1 = c1[0], g1 = c1[1], b1 = c1[2];
                    const r2 = c2[0], g2 = c2[1], b2 = c2[2];
                    const w = 2 * weight - 1;
                    const a = 0;
                    const w1 = ((w * a === -1) ? w : (w + a) / (1 + w * a)) + 1;
                    const w2 = 1 - w1;
                    return [
                        Math.round((r1 * w1 + r2 * w2) / 2),
                        Math.round((g1 * w1 + g2 * w2) / 2),
                        Math.round((b1 * w1 + b2 * w2) / 2)
                    ];
                };

                const rgbToString = (rgb) => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
                const rgbToRgbaString = (rgb, alpha = 1) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;

                // Helper to parse "rgb(r, g, b)"
                const parseRgb = (str) => {
                    const m = str.match(/\d+/g);
                    return m ? m.map(Number) : [0, 0, 0];
                };

                const auroraColor1 = bodyStyle.getPropertyValue('--auroraColor1') || "rgb(0,0,0)";
                const ac1 = parseRgb(auroraColor1);

                const white = [255, 255, 255];
                const black = [0, 0, 0];

                const bg = mix(white, ac1, 0.4);
                const bgColor = mix(bg, black, 0.7);

                const colors = {
                    "--bg": rgbToString(bg),
                    "--bgColor": rgbToString(bgColor),
                    "--bgColor90": rgbToString(mix(bgColor, black, 0.1)),
                    "--bgColor80": rgbToString(mix(bgColor, black, 0.2)),
                    "--bgColor70": rgbToString(mix(bgColor, black, 0.3)),
                    "--bgColor60": rgbToString(mix(bgColor, black, 0.4)),
                    "--bgColor50": rgbToString(mix(bgColor, black, 0.5)),
                    "--bgColor110": rgbToString(mix(bgColor, white, 0.1)),
                    "--bgColor120": rgbToString(mix(bgColor, white, 0.2)),
                    "--bgColor130": rgbToString(mix(bgColor, white, 0.3)),
                    "--bgColor140": rgbToString(mix(bgColor, white, 0.4)),
                    "--bgColor150": rgbToString(mix(bgColor, white, 0.5))
                };
                const update = {};
                for (let k in colors) update[k] = colors[k];
                gsap.set("body", update);
            }
        })
            .to("body", { "--auroraColor0": "rgb(0 0 255)", "--auroraColor1": "rgb(255 0 0)", "--auroraColor2": "rgb(0 255 0)" })
            .to("body", { "--auroraColor0": "rgb(0 255 0)", "--auroraColor1": "rgb(0 0 255)", "--auroraColor2": "rgb(255 0 0)" })
            .to("body", { "--auroraColor0": "rgb(255 0 0)", "--auroraColor1": "rgb(0 255 0)", "--auroraColor2": "rgb(0 0 255)" });

        // Igloo Setup
        const svg2IglooWrapper = select("#svg2IglooWrapper");
        const land2Igloo = select("#land2Igloo");
        const newIgloo = select("#svg2Igloo");
        if (newIgloo && svg2IglooWrapper) {
            newIgloo.style.display = "block";
            svg2IglooWrapper.appendChild(newIgloo);
            gsap.set(newIgloo, {
                scale: 1,
                motionPath: { path: land2Igloo, align: land2Igloo, alignOrigin: [0.5, 0.5], start: 0.5, end: 0.5, autoRotate: true }
            });
        }

        gsap.set("#gsapWrapper", { autoAlpha: 1 });
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

            // Create pips for CSS dice
            for (let i = 0; i < 6; i++) { // Always create potential pips, handled by CSS visibility or grid logic
                const pip = document.createElement('div');
                pip.className = 'pip';
                die.appendChild(pip);
            }

            // Actually, my CSS uses grid areas which means I need correct number of pips or fixed 6?
            // The CSS I wrote uses nth-child selectors up to 6 for value 6.
            // Value 1 uses nth-child(1). Value 6 uses 6 pips.
            // So simply creating d.value pips works perfectly with that CSS logic.
            // Wait, for value 5, it used nth-child(5).
            // So just creating 'd.value' amount of pips is correct.
            /*
            die.innerHTML = ''; // Clear
            for(let i=0; i<d.value; i++){
               const pip = document.createElement('div');
               pip.className = 'pip';
               die.appendChild(pip);
            }
            */
            // Re-evaluating CSS logic:
            // .die[data-value="1"] .pip:nth-child(1) ...
            // If I have 1 pip, it is nth-child(1).
            // Perfect.
            die.innerHTML = '';
            for (let i = 0; i < d.value; i++) {
                const pip = document.createElement('div');
                pip.className = 'pip';
                die.appendChild(pip);
            }

            // Animation staggered entry
            die.style.animationDelay = `${index * 50}ms`;

            this.ui.diceContainer.appendChild(die);
        });
    }

    getDieChar(val) {
        // Unused now
        const chars = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
        return chars[val - 1] || val;
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
        this.world.gravity.set(0, -60, 0); // Stronger gravity for "quick" feel
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

            setTimeout(() => { if (this.isRunning) this.stopRoll(); }, 3500);
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

            body.velocity.set((Math.random() - 0.5) * 20, -30, (Math.random() - 0.5) * 20);
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
        if (allStopped && Date.now() - this.rollStartTime > 1000) this.stopRoll();
    }

    stopRoll() {
        if (!this.isRunning) return;
        this.isRunning = false;
        this.diceObjects.forEach(obj => { this.alignDie(obj); obj.body.sleep(); });
        if (this.resolveRoll) {
            const res = this.resolveRoll;
            this.resolveRoll = null;
            setTimeout(res, 600);
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
