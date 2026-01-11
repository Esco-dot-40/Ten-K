import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as CANNON from "cannon-es";

// Removed GSAP imports as they were unused and causing loading issues
import { calculateScore, isScoringSelection } from './rules.js';

// Removed inlined rules in favor of shared module


// Discord SDK integration refactored to use dynamic import

// Global reference
const DISCORD_CLIENT_ID = "1455067365694771364"; // Replace with your Application ID
console.log("Farkle Client Execution Started");

class FarkleClient {
    constructor() {
        console.log("FarkleClient constructor start");

        // Immediate UI feedback
        const loadingContainer = document.getElementById('connection-debug');
        if (loadingContainer) {
            loadingContainer.textContent = "Script Running...";
        }
        window.onerror = (msg, url, line) => {
            this.debugLog(`JS Error: ${msg} at ${line}`);
            return false;
        };

        try {
            this.roomCode = null;
            this.roomId = null;

            // Priority: URL param > Session Storage
            const urlParams = new URLSearchParams(window.location.search);
            const urlRoom = urlParams.get('room');
            this.roomCode = urlRoom || sessionStorage.getItem('farkle-room-code') || null;

            this.playerId = null;
            this.gameState = null;
            this.gameState = null;
            this.discordSdk = null;
            // Load preserved name or default
            const storedName = localStorage.getItem('farkle-username');
            this.playerName = storedName || `Player ${Math.floor(Math.random() * 1000)}`;
            this.isRolling = false;
            this.pendingState = null;
            this.rules = {}; // Will load from server state
            this.isSpeedMode = false;
            this.isSpectator = false; // NEW
            this.reconnectToken = localStorage.getItem('farkle-reconnect-token') || null;
            if (!this.reconnectToken) {
                this.reconnectToken = 'rt_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
                localStorage.setItem('farkle-reconnect-token', this.reconnectToken);
            }

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
                leaveBtn: document.getElementById('leave-btn'),
                diceThemeSelect: document.getElementById('dice-theme-select'),
                themeBtns: document.querySelectorAll('.theme-btn'),
                threeCanvasContainer: document.getElementById('three-canvas-container'),
                startGameBtn: document.getElementById('start-game-btn'),
                chatPanel: document.getElementById('chat-panel'),
                chatToggleBtn: document.getElementById('chat-toggle-btn'),
                chatCloseBtn: document.getElementById('chat-close-btn'),
                chatInput: document.getElementById('chat-input'),
                chatSendBtn: document.getElementById('chat-send-btn'),
                chatMessages: document.getElementById('chat-messages'),
                roomDisplay: document.getElementById('room-display'),
                spectatorDisplay: document.getElementById('spectator-display'),
                gameInfoBar: document.getElementById('game-info-bar'),
                leaveText: document.getElementById('leave-text')
            };

            // Hook up start button
            if (this.ui.startGameBtn) {
                this.ui.startGameBtn.addEventListener('click', () => {
                    // No-op, managed by logic
                });
            }

            this.dice3D = new Dice3DManager(this.ui.threeCanvasContainer);

            // Speed Mode Hookup
            const speedBtn = document.getElementById('mode-speed-btn');
            const casualBtn = document.getElementById('mode-casual-btn');
            const modeSelection = document.getElementById('mode-selection');
            const roomList = document.getElementById('room-list-container');

            if (speedBtn && casualBtn) {
                speedBtn.addEventListener('click', () => {
                    this.isSpeedMode = true;
                    this.dice3D.setSpeed(true);
                    modeSelection.style.display = 'none';
                    roomList.style.display = 'grid';
                    this.socket.emit('get_room_list');
                    history.pushState({ view: 'room-list', mode: 'speed' }, "", "?view=rooms&mode=speed");
                });
                casualBtn.addEventListener('click', () => {
                    this.isSpeedMode = false;
                    this.dice3D.setSpeed(false);
                    modeSelection.style.display = 'none';
                    roomList.style.display = 'grid';
                    this.socket.emit('get_room_list');
                    history.pushState({ view: 'room-list', mode: 'casual' }, "", "?view=rooms&mode=casual");
                });
            }


            try { this.initListeners(); } catch (e) { console.error("Listeners Init Failed", e); }
            try { this.initSettings(); } catch (e) { console.error("Settings Init Failed", e); }
            try { this.initHistory(); } catch (e) { console.error("History Init Failed", e); }
            this.debugLog("Modules initialized");
            // Fall through to Discord Init immediately


            // Init Discord with Timeout THEN Socket
            const discordPromise = this.initDiscord();
            const timeoutPromise = new Promise(resolve => setTimeout(resolve, 3000));

            Promise.race([discordPromise, timeoutPromise]).finally(() => {
                // Ensure socket always inits even if discord hangs or fails
                if (!this.socket) {
                    this.initSocket();
                }
            });


        } catch (err) {
            this.debugLog("Init Error: " + err.message);
            console.error("FarkleClient Init Error:", err);
        }
    }

    // --- Discord Integration ---
    async initDiscord() {
        try {
            // Check if running in iframe (Discord env) - simplistic check
            if (window.self === window.top && !window.location.search.includes('frame_id')) {
                this.debugLog("Not in Discord (Standalone). Using Random Name.");
                console.log('[WELCOME-TRIGGER] In standalone mode, playerName:', this.playerName);
                // Show welcome screen anyway for testing
                console.log('[WELCOME-TRIGGER] Setting timeout to show welcome');
                setTimeout(() => {
                    console.log('[WELCOME-TRIGGER] Timeout fired, calling showWelcome');
                    this.showWelcome(this.playerName, null, null);
                }, 500);
                return;
            }

            this.debugLog("Loading Discord SDK...");
            let DiscordSDK;
            try {
                // Dynamic Import
                const module = await import("/libs/@discord/embedded-app-sdk/output/index.mjs");
                DiscordSDK = module.DiscordSDK;
            } catch (importErr) {
                this.debugLog(`SDK Import Failed: ${importErr.message}`);
                return; // Fallback to Player N
            }

            this.debugLog("Initializing Discord SDK...");
            this.discordSdk = new DiscordSDK(DISCORD_CLIENT_ID);

            // 1. Check for existing local session
            const savedToken = localStorage.getItem('farkle_auth_token');
            const savedUser = localStorage.getItem('farkle_user_data');

            if (savedToken && savedUser) {
                try {
                    const user = JSON.parse(savedUser);
                    this.playerName = user.global_name || user.username;
                    this.discordId = user.id;
                    this.debugLog(`Restored session for ${this.playerName}`);

                    // Verify token validity with backend (optional but recommended)
                    // For speed, we trust local first, then verify async if needed.
                    // Or just proceed.

                    // Show Welcome
                    this.showWelcome(this.playerName, user.avatar, user.id);

                    // Helper to track analytics for restored session
                    this.identifyAnalytics(user);
                    return;
                } catch (e) {
                    console.warn("Invalid saved session", e);
                    localStorage.removeItem('farkle_auth_token');
                    localStorage.removeItem('farkle_user_data'); // Also remove user data
                }
            }

            // 2. Proceed with Discord SDK Auth if no session
            if (!this.discordSdk) {
                const { DiscordSDK } = await import("https://cdn.jsdelivr.net/npm/@discord/embedded-app-sdk@1.0.0/output/index.mjs");
                this.discordSdk = new DiscordSDK(DISCORD_CLIENT_ID);
            }

            await this.discordSdk.ready();

            // Authorize with Discord Client
            // Let Discord SDK handle prompting intelligently
            const { code } = await this.discordSdk.commands.authorize({
                client_id: DISCORD_CLIENT_ID,
                response_type: "code",
                state: "",
                // No prompt specified = SDK decides (smart behavior)
                scope: [
                    "identify",
                    "guilds",
                    "guilds.members.read"
                ],
            });

            // Exchange code for token via backend
            const response = await fetch("/api/token", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    code,
                }),
            });

            const { access_token, user } = await response.json();

            // Authenticate with Discord SDK (for channel interactions if needed later)
            const auth = await this.discordSdk.commands.authenticate({
                access_token,
            });

            if (auth == null) {
                throw new Error("Authenticate command failed via SDK");
            }

            // Success! Store session.
            localStorage.setItem('farkle_auth_token', access_token);
            localStorage.setItem('farkle_user_data', JSON.stringify(user));

            this.playerName = user.global_name || user.username;
            this.discordId = user.id;

            this.debugLog(`Authenticated as ${this.playerName}`);
            console.log('[WELCOME] Calling showWelcome with:', this.playerName, user.avatar, user.id);
            this.showWelcome(this.playerName, user.avatar, user.id);
            this.identifyAnalytics(user);

        } catch (err) {
            console.error("Discord Auth Failed/Cancelled", err);
            this.debugLog(`Discord Auth Failed: ${err.message} - Using Default Name`);
            // Fallback to random guest if auth fails
            if (!this.playerName) {
                // Fallback is already set in constructor
            }
        }
    }

    identifyAnalytics(user) {
        fetch('/api/analytics/identify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: user.id,
                username: user.username,
                globalName: user.global_name
            })
        }).catch(e => console.warn("Analytics Identify Error", e));
    }

    showWelcome(name, avatar, id) {
        console.log('[WELCOME] Function called:', { name, avatar, id });

        // Remove any existing welcome screen
        const existing = document.getElementById('welcome-overlay');
        if (existing) {
            console.log('[WELCOME] Removing existing overlay');
            existing.remove();
        }

        console.log('[WELCOME] Creating new overlay');
        const overlay = document.createElement('div');
        overlay.id = 'welcome-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.95);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 100000;
            transition: opacity 0.8s ease-out;
            color: white;
            font-family: 'Outfit', sans-serif;
            backdrop-filter: blur(10px);
        `;

        const avatarUrl = avatar && id
            ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png`
            : null;

        overlay.innerHTML = `
            <div style="text-align: center; transform: scale(0.8); opacity: 0; animation: popIn 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;">
                ${avatarUrl ? `
                <div style="position: relative; display: inline-block; margin-bottom: 2rem;">
                    <img src="${avatarUrl}" style="width: 120px; height: 120px; border-radius: 50%; border: 4px solid #4f46e5; box-shadow: 0 0 30px rgba(79, 70, 229, 0.5);">
                    <div style="position: absolute; bottom: 5px; right: 5px; width: 24px; height: 24px; background: #22c55e; border: 4px solid #000; border-radius: 50%;"></div>
                </div>` : `
                <div style="font-size: 5rem; margin-bottom: 1rem;">👋</div>
                `}
                <h1 style="font-size: 2.5rem; margin: 0; font-weight: 300; letter-spacing: 2px;">Welcome,</h1>
                <h2 style="font-size: 4rem; margin: 0.5rem 0; font-weight: 800; background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-shadow: 0 10px 30px rgba(79, 70, 229, 0.3);">${name}</h2>
                <div style="margin-top: 2rem; color: #94a3b8; font-size: 1.1rem; letter-spacing: 1px; text-transform: uppercase;">Ready to roll</div>
            </div>
            <style>
                @keyframes popIn {
                    0% { transform: scale(0.8); opacity: 0; filter: blur(10px); }
                    100% { transform: scale(1); opacity: 1; filter: blur(0); }
                }
            </style>
        `;

        console.log('[WELCOME] Appending overlay to body');
        document.body.appendChild(overlay);
        console.log('[WELCOME] Overlay appended, setting timeout for fade out');

        // Fade out after delay
        setTimeout(() => {
            console.log('[WELCOME] Fading out');
            overlay.style.opacity = '0';
            overlay.style.pointerEvents = 'none';
            setTimeout(() => {
                console.log('[WELCOME] Removing overlay');
                overlay.remove();
            }, 800);
        }, 3000);
    }

    // ... skip to joinRoom ... 

    joinRoom(roomCode, asSpectator = false, fromHistory = false) {
        this.debugLog(`Joining ${roomCode} (${asSpectator ? 'Spectating' : 'Playing'})...`);

        let finalName = this.playerName;
        localStorage.setItem('farkle-username', finalName);
        sessionStorage.setItem('farkle-room-code', roomCode);

        if (!fromHistory) {
            history.pushState({ view: 'game', roomCode: roomCode }, "", `?room=${roomCode}`);
        }

        this.socket.emit('join_game', {
            roomCode: roomCode,
            spectator: asSpectator,
            reconnectToken: this.reconnectToken,
            name: finalName,
            dbId: this.discordId || null
        });
    }

    async updateDiscordPresence(details, state) {
        if (!this.discordSdk) return;
        try {
            await this.discordSdk.commands.setActivity({
                activity: {
                    details: details,
                    state: state,
                    assets: {
                        large_image: "farkle_icon",
                        large_text: "Farkle"
                    }
                }
            });
        } catch (e) {
        }
    }

    initSettings() {
        // Theme Buttons
        if (this.ui.settingsBtn) {
            this.ui.settingsBtn.addEventListener('click', () => {
                this.ui.settingsModal.classList.remove('hidden');
            });
        }
        if (this.ui.settingsModal) {
            this.ui.settingsModal.querySelector('.close-modal').addEventListener('click', () => {
                this.ui.settingsModal.classList.add('hidden');
            });
        }

        // Stats Buttons (New)
        this.initStatsUI();

        // Color Themes
        const themeBtns = document.querySelectorAll('.theme-btn');
        themeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const theme = btn.dataset.theme;
                let color = '#0f3d24'; // default green
                if (theme === 'blue') color = '#1e3a8a';
                if (theme === 'red') color = '#7f1d1d';
                if (theme === 'purple') color = '#581c87';

                document.body.style.setProperty('--bg-panel', this.styleHexToRgba(color, 0.75));
                document.body.style.setProperty('--bg-panel-solid', color);
            });
        });

        // Dice Themes
        const diceSelect = document.getElementById('dice-theme-select');
        if (diceSelect) {
            const savedTheme = localStorage.getItem('farkle-dice-theme') || 'classic';
            diceSelect.value = savedTheme;
            document.body.setAttribute('data-dice-theme', savedTheme);
            if (this.dice3D) this.dice3D.materialCache.clear();

            diceSelect.addEventListener('change', (e) => {
                const val = e.target.value;
                document.body.setAttribute('data-dice-theme', val);
                localStorage.setItem('farkle-dice-theme', val);
                if (this.dice3D) {
                    this.dice3D.materialCache.clear();
                    this.dice3D.updateDiceMaterials();
                }
            });
        }
    }

    initStatsUI() {
        // Find or create buttons in main menu
        const modeSelection = document.getElementById('mode-selection');
        if (!modeSelection) return;

        // Container for stats buttons
        let statsRow = document.getElementById('stats-row');
        if (!statsRow) {
            statsRow = document.createElement('div');
            statsRow.id = 'stats-row';
            statsRow.style.display = 'flex';
            statsRow.style.gap = '10px';
            statsRow.style.justifyContent = 'center';
            statsRow.style.marginTop = '2rem';
            modeSelection.appendChild(statsRow);
        }
        statsRow.innerHTML = ''; // Clear to prevent dupes

        const lbBtn = document.createElement('button');
        lbBtn.className = 'btn secondary small';
        lbBtn.innerHTML = '🏆 Leaderboard';
        lbBtn.onclick = () => this.showLeaderboard();

        const myStatsBtn = document.createElement('button');
        myStatsBtn.className = 'btn secondary small';
        myStatsBtn.innerHTML = '📊 My Stats';
        myStatsBtn.onclick = () => this.showMyStats();

        statsRow.appendChild(lbBtn);
        statsRow.appendChild(myStatsBtn);
    }

    async showLeaderboard() {
        // Reuse or create modal
        const modal = this.getStatsModal();
        const content = modal.querySelector('.modal-content-body');
        content.innerHTML = '<p>Loading...</p>';
        modal.classList.remove('hidden');

        try {
            const res = await fetch('/api/leaderboard');
            const data = await res.json();

            let html = '<table style="width:100%; text-align:left;"><tr><th>Rank</th><th>Player</th><th>Wins</th><th>Score</th></tr>';
            data.forEach((row, i) => {
                html += `<tr>
                    <td>#${i + 1}</td>
                    <td style="display:flex; align-items:center; gap:5px;">
                        ${row.avatar ? `<img src="https://cdn.discordapp.com/avatars/${row.id}/${row.avatar}.png" style="width:20px;height:20px;border-radius:50%">` : ''} 
                        ${row.display_name}
                    </td>
                    <td>${row.wins}</td>
                    <td>${Number(row.total_score).toLocaleString()}</td>
                </tr>`;
            });
            html += '</table>';
            content.innerHTML = html;
        } catch (e) {
            content.innerHTML = '<p>Error loading leaderboard</p>';
        }
    }

    async showMyStats() {
        const modal = this.getStatsModal();
        const content = modal.querySelector('.modal-content-body');
        content.innerHTML = '<p>Loading...</p>';
        modal.classList.remove('hidden');

        if (!this.discordId) {
            // Fallback: try to see if we are in "mock" mode or just not authed
            if (this.discordSdk && this.discordSdk.mock) {
                // Mock ID
                this.discordId = "mock_user_123";
            } else {
                content.innerHTML = "<p>Please play via Discord Activity to view stats.</p>";
                return;
            }
        }

        try {
            const res = await fetch(`/api/stats/${this.discordId}`);
            if (!res.ok) throw new Error("Stats not found");
            const data = await res.json();
            const stats = data.stats || {};

            content.innerHTML = `
                <div style="text-align: center; margin-bottom: 20px;">
                    ${data.avatar ? `<img src="https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png" style="width:64px;height:64px;border-radius:50%; margin-bottom:10px;">` : ''}
                    <h3>${data.display_name}</h3>
                    <p style="opacity:0.7">@${data.username}</p>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; text-align: center;">
                    <div style="background: rgba(255,255,255,0.1); padding: 10px; border-radius: 8px;">
                        <div style="font-size: 0.8em; opacity: 0.7;">Games Played</div>
                        <div style="font-size: 1.2em; font-weight: bold;">${stats.games_played || 0}</div>
                    </div>
                    <div style="background: rgba(255,255,255,0.1); padding: 10px; border-radius: 8px;">
                        <div style="font-size: 0.8em; opacity: 0.7;">Wins</div>
                        <div style="font-size: 1.2em; font-weight: bold; color: gold;">${stats.wins || 0}</div>
                    </div>
                    <div style="background: rgba(255,255,255,0.1); padding: 10px; border-radius: 8px;">
                        <div style="font-size: 0.8em; opacity: 0.7;">Total Score</div>
                        <div style="font-size: 1.2em; font-weight: bold;">${Number(stats.total_score || 0).toLocaleString()}</div>
                    </div>
                     <div style="background: rgba(255,255,255,0.1); padding: 10px; border-radius: 8px;">
                        <div style="font-size: 0.8em; opacity: 0.7;">Farkles</div>
                        <div style="font-size: 1.2em; font-weight: bold; color: #ff6b6b;">${stats.farkles_count || 0}</div>
                    </div>
                    <div style="grid-column: 1 / -1; background: rgba(255,255,255,0.1); padding: 10px; border-radius: 8px;">
                        <div style="font-size: 0.8em; opacity: 0.7;">Highest Round Score</div>
                        <div style="font-size: 1.2em; font-weight: bold;">${Number(stats.highest_round_score || 0).toLocaleString()}</div>
                    </div>
                </div>
            `;
        } catch (e) {
            console.error(e);
            content.innerHTML = `<p>No stats found yet. Play a game to track stats!</p><p style="font-size:0.75rem; color:#666; margin-top:10px;">Debug ID: ${this.discordId || "Not Authenticated"}</p>`;
        }
    }

    getStatsModal() {
        let modal = document.getElementById('stats-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'stats-modal';
            modal.className = 'modal hidden';
            // Force high z-index and pointer interaction
            modal.style.zIndex = "99999";
            modal.style.pointerEvents = "auto";

            modal.innerHTML = `
                <div class="modal-content" style="pointer-events: auto;">
                    <h2>Statistics</h2>
                    <div class="modal-content-body" style="max-height: 400px; overflow-y: auto; margin-bottom: 20px;"></div>
                    <button class="btn close-modal" id="stats-close-btn">Close</button>
                </div>
            `;
            document.body.appendChild(modal);
        }

        // Re-attach listener every time to be safe, removing old one if needed (cloning node is a cheap way to strip listeners, but simpler just to overwrite onclick)
        const closeBtn = modal.querySelector('.close-modal');
        if (closeBtn) {
            closeBtn.onclick = () => {
                modal.classList.add('hidden');
            };
        }

        return modal;
    }

    initHistory() {
        window.onpopstate = (event) => {
            const state = event.state;
            if (!state) {
                // Back to mode selection
                if (this.roomCode) {
                    this.leaveGame(true);
                } else {
                    document.getElementById('room-list-container').style.display = 'none';
                    document.getElementById('mode-selection').style.display = 'block';
                    this.ui.setupModal.classList.remove('hidden');
                }
            } else if (state.view === 'room-list') {
                if (this.roomCode) {
                    this.leaveGame(true);
                }
                this.isSpeedMode = state.mode === 'speed';
                document.getElementById('mode-selection').style.display = 'none';
                document.getElementById('room-list-container').style.display = 'grid';
                this.ui.setupModal.classList.remove('hidden');
                this.socket.emit('get_room_list');
            } else if (state.view === 'game') {
                // Rejoin? If we have roomCode in state
                if (state.roomCode && state.roomCode !== this.roomCode) {
                    this.joinRoom(state.roomCode, false, true);
                }
            }
        };
    }

    styleHexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    initSocket() {
        if (this.socket) return;
        if (typeof io === 'undefined') {
            this.debugLog("CRITICAL: Socket.io missing!");
            return;
        }
        this.debugLog("Connecting to Socket...");
        this.socket = io({
            reconnectionAttempts: 10,
            auth: { name: this.playerName }
        });
        this.initSocketEvents();
    }

    initListeners() {
        this.ui.rollBtn.addEventListener('click', () => {
            if (this.canInteract()) {
                const selectedIds = Array.from(document.querySelectorAll('.die.selected'))
                    .map(el => el.dataset.id)
                    .filter(id => id);
                this.socket.emit('roll', { roomCode: this.roomCode, confirmedSelections: selectedIds, useHighStakes: false });
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
                dieEl.classList.toggle('selected');
                this.socket.emit('toggle_die', { roomCode: this.roomCode, dieId: id });
                // Trigger UI update immediately for responsiveness
                this.renderControls();
            }
        });

        this.ui.rulesBtn.addEventListener('click', () => this.ui.rulesModal.classList.remove('hidden'));
        this.ui.rulesModal.querySelector('.close-modal').addEventListener('click', () => this.ui.rulesModal.classList.add('hidden'));

        this.ui.restartBtn.addEventListener('click', () => {
            this.socket.emit('restart', { roomCode: this.roomCode });
            this.ui.gameOverModal.classList.add('hidden');
        });

        if (this.ui.leaveBtn) {
            this.ui.leaveBtn.onclick = (e) => {
                e.preventDefault();
                this.leaveGame();
            };
        }

        // Chat Listeners
        if (this.ui.chatToggleBtn) {
            this.ui.chatToggleBtn.addEventListener('click', () => {
                this.ui.chatPanel.classList.toggle('hidden');
                if (!this.ui.chatPanel.classList.contains('hidden')) {
                    this.ui.chatInput.focus();
                }
            });
        }
        if (this.ui.chatCloseBtn) {
            this.ui.chatCloseBtn.addEventListener('click', () => {
                this.ui.chatPanel.classList.add('hidden');
            });
        }
        if (this.ui.chatSendBtn) {
            this.ui.chatSendBtn.addEventListener('click', () => this.sendChat());
        }
        if (this.ui.chatInput) {
            this.ui.chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.sendChat();
            });
        }

        // --- Hotkeys ---
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.repeat) return;
            if (!this.canInteract()) return;

            // R or Space = Roll
            if (e.code === 'KeyR' || e.code === 'Space') {
                e.preventDefault();
                if (this.ui.rollBtn && !this.ui.rollBtn.disabled && this.ui.rollBtn.offsetParent) {
                    this.ui.rollBtn.click();
                }
            }

            // B or Enter = Bank
            if (e.code === 'KeyB' || e.code === 'Enter') {
                e.preventDefault();
                if (this.ui.bankBtn && !this.ui.bankBtn.disabled && this.ui.bankBtn.offsetParent) {
                    this.ui.bankBtn.click();
                }
            }

            // 1-6 = Select Dice
            if (e.key >= '1' && e.key <= '6') {
                const idx = parseInt(e.key) - 1;
                if (this.ui.diceContainer && this.ui.diceContainer.children[idx]) {
                    const dieEl = this.ui.diceContainer.children[idx];
                    if (dieEl.classList.contains('die')) {
                        const id = dieEl.dataset.id;
                        dieEl.classList.toggle('selected');
                        this.socket.emit('toggle_die', { roomCode: this.roomCode, dieId: id });
                        this.renderControls(); // Recalculate score display immediately
                    }
                }
            }
        });
    }

    initSocketEvents() {
        this.socket.on('connect', () => {
            this.debugLog(`Connected!`);
            this.showFeedback("Connected!", "success");

            const modeSelection = document.getElementById('mode-selection');
            const roomList = document.getElementById('room-list-container');
            const loadMsg = document.getElementById('connection-debug');
            if (loadMsg) loadMsg.style.display = 'none';

            if (!this.roomCode) {
                modeSelection.style.display = 'block';
            }

            if (this.roomCode) {
                this.socket.emit('join_game', { roomCode: this.roomCode, reconnectToken: this.reconnectToken, name: this.playerName });
            }
        });

        this.socket.on('connect_error', (err) => {
            this.debugLog(`Connection Error: ${err.message}`);
            this.showFeedback("Connection Error!", "error");
        });

        this.socket.on('room_list', (rooms) => {
            this.renderRoomList(rooms);
        });

        this.socket.on('disconnect', (reason) => {
            this.debugLog(`Disconnected: ${reason}`);
            this.showFeedback("Connection Lost! Reconnecting...", "error");
        });

        this.socket.on('joined', ({ playerId, state, isSpectator }) => {
            this.playerId = playerId;
            this.roomCode = state.roomCode;
            this.isSpectator = isSpectator || false;

            this.updateGameState(state);
            this.ui.setupModal.classList.add('hidden');

            if (this.isSpectator) this.showFeedback("Joined as Spectator", "info");
            else this.showFeedback("Joined Room!", "success");

            this.renderControls();

            // Update UI
            if (this.ui.roomDisplay) this.ui.roomDisplay.textContent = `Table: ${this.roomCode}`;
            if (this.ui.gameInfoBar) this.ui.gameInfoBar.style.display = 'flex';
            if (this.ui.leaveText) this.ui.leaveText.style.display = 'inline';
            if (this.ui.leaveBtn) this.ui.leaveBtn.style.width = 'auto';
            if (this.ui.leaveBtn) this.ui.leaveBtn.style.padding = '0 12px';
        });

        this.socket.on('game_state_update', (state) => {
            if (this.isRolling) {
                this.pendingState = state;
            } else {
                this.updateGameState(state);
            }
            if (state && this.ui.spectatorDisplay) {
                this.ui.spectatorDisplay.textContent = `Spectators: ${state.spectatorCount || 0}`;
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

            this.dice3D.roll(diceValues).then(async () => {
                if (this.ui.diceContainer) this.ui.diceContainer.classList.remove('rolling');

                if (data.farkle) {
                    this.showFeedback("FARKLE!", "error");
                    // Buffer delay: maintain isRolling=true to catch incoming state updates in pendingState
                    const delay = this.isSpeedMode ? 800 : 2000;
                    await new Promise(r => setTimeout(r, delay));
                }

                this.isRolling = false;

                const finalState = this.pendingState || data.state;
                this.pendingState = null;

                this.updateGameState(finalState);
                if (data.hotDice) {
                    this.showFeedback("HOT DICE!", "hot-dice");
                }
            });
        });

        this.socket.on('error', (msg) => {
            this.showFeedback(msg, "error");
        });

        this.socket.on('chat_message', (data) => {
            // data: { sender: "Name", message: "text", isSystem: boolean }
            this.addChatMessage(data);
        });
    }

    renderRoomList(allRooms) {
        if (!Array.isArray(allRooms)) return;
        const container = document.getElementById('room-list-container');
        if (!container) return;

        // Filter rooms based on current mode
        const targetCategory = this.isSpeedMode ? 'speed' : 'casual';
        const rooms = allRooms.filter(r => r.category === targetCategory);

        // Re-create container structure to prevent duplicates but keep back button logic
        container.innerHTML = '';

        const backRow = document.createElement('div');
        backRow.style.gridColumn = "1/-1";
        backRow.style.marginBottom = "10px";
        const backBtn = document.createElement('button');
        backBtn.className = 'btn secondary small';
        backBtn.innerHTML = '<span>←</span> <span>Back to Modes</span>';
        backBtn.style.padding = '0 20px';
        backBtn.style.gap = '8px';
        backBtn.onclick = () => {
            history.back();
        };
        backRow.appendChild(backBtn);

        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'btn primary small';
        refreshBtn.innerHTML = '<span>↻</span> <span>Refresh</span>';
        refreshBtn.style.marginLeft = '10px';
        refreshBtn.style.padding = '0 20px';
        refreshBtn.style.gap = '8px';
        refreshBtn.onclick = () => {
            this.socket.emit('get_room_list');
        };
        backRow.appendChild(refreshBtn);
        container.appendChild(backRow);

        if (rooms.length === 0) {
            const msg = document.createElement('p');
            msg.style.cssText = 'color:var(--text-muted); padding: 1rem; text-align: center; font-size: 0.8rem;';
            msg.textContent = 'No active tables for this mode.';
            container.appendChild(msg);
            return;
        }

        const label = document.createElement('p');
        label.style.cssText = 'color:var(--text-muted); font-size: 0.8rem; grid-column: 1/-1; margin-bottom: 0.5rem;';
        label.textContent = 'Or select active table:';
        container.appendChild(label);

        rooms.forEach(room => {
            const card = document.createElement('div');
            card.className = `room-card ${room.count >= room.max ? 'full' : ''}`;

            const header = document.createElement('div');
            header.style.display = 'flex';
            header.style.justifyContent = 'space-between';
            const title = document.createElement('h3');
            title.textContent = room.name;
            const mode = document.createElement('span');
            mode.style.fontSize = '0.7rem';
            mode.style.opacity = '0.8';
            mode.textContent = room.rulesSummary || 'Standard';

            header.appendChild(title);
            header.appendChild(mode);

            const status = document.createElement('div');
            status.className = 'room-status';

            const specText = room.spectators > 0 ? ` (+${room.spectators} 👁️)` : '';
            status.textContent = `${room.count} / ${room.max} Players${specText}`;

            if (room.status === 'playing') status.textContent += ' (Playing)';

            card.appendChild(header);
            card.appendChild(status);

            const actions = document.createElement('div');
            actions.style.marginTop = '10px';
            actions.style.display = 'flex';
            actions.style.gap = '10px';

            const joinBtn = document.createElement('button');
            joinBtn.className = 'btn primary small';
            joinBtn.textContent = 'Join';
            joinBtn.onclick = (e) => { e.stopPropagation(); this.joinRoom(room.name, false); };

            if (room.count >= room.max) {
                joinBtn.disabled = true;
                joinBtn.textContent = 'Full';
                joinBtn.style.opacity = "0.5";
            } else if (room.status === 'playing') {
                // can usually join late? logic says yes if not full
            }

            const watchBtn = document.createElement('button');
            watchBtn.className = 'btn secondary small';
            watchBtn.textContent = 'Watch';
            watchBtn.onclick = (e) => { e.stopPropagation(); this.joinRoom(room.name, true); };

            actions.appendChild(joinBtn);
            actions.appendChild(watchBtn);
            card.appendChild(actions);

            container.appendChild(card);
        });
    }



    joinGame() {
        this.debugLog(`Joining Game...`);
        this.socket.emit('join_game');
    }

    leaveGame(fromPopState = false) {
        // if (!fromPopState) {
        //    if (!confirm("Are you sure you want to leave the table?")) return;
        // }

        this.debugLog("Leaving Game...");

        // 1. Notify Server
        if (this.socket) {
            this.socket.emit('leave_game');
        }

        // 2. Clear Local State
        this.roomCode = null;
        this.gameState = null;
        this.playerId = null;
        this.isSpectator = false;
        sessionStorage.removeItem('farkle-room-code');

        // 3. Reset UI to Lobby
        this.ui.setupModal.classList.remove('hidden');
        document.getElementById('mode-selection').style.display = 'block';
        document.getElementById('room-list-container').style.display = 'none';

        if (!fromPopState) {
            history.pushState(null, "", window.location.pathname);
        }

        // Clear Game Board UI
        if (this.ui.playerZonesContainer) this.ui.playerZonesContainer.innerHTML = '';
        if (this.ui.diceContainer) this.ui.diceContainer.innerHTML = '';
        this.ui.actionText.textContent = "Roll to start your turn";
        this.ui.currentScoreDisplay.textContent = "Roll Score: 0";

        // Reset Discord Presence
        this.updateDiscordPresence("In Lobby", "Selecting Table");

        if (this.ui.gameInfoBar) this.ui.gameInfoBar.style.display = 'none';
        if (this.ui.leaveText) this.ui.leaveText.style.display = 'none';

        // Hide leave button or reset style
        // Actually, logic elsewhere likely controls visibility, but let's ensure it handles correctly
        // (UI update loop will hide it if game is null)
    }

    canInteract() {
        if (this.isSpectator) return false;
        if (!this.gameState || this.gameState.gameStatus !== 'playing') return false;
        if (!this.socket || !this.socket.id) return false;
        const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
        return currentPlayer && currentPlayer.id === this.socket.id;
    }

    renderPlayers() {
        if (!this.gameState || !this.gameState.players) return;
        const container = this.ui.playerZonesContainer;
        if (!container) return;

        const players = this.gameState.players;
        while (container.children.length > players.length) {
            container.removeChild(container.lastChild);
        }

        players.forEach((player, index) => {
            let card = container.children[index];
            const isCurrent = this.gameState.currentPlayerIndex === index && this.gameState.gameStatus === 'playing';

            if (!card) {
                card = document.createElement('div');
                card.className = 'player-card';
                card.style.minWidth = "150px";
                if (index === this.gameState.currentPlayerIndex) card.classList.add('active'); // Preload active

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

            const nameEl = card.querySelector('.player-name');
            const scoreEl = card.querySelector('.total-score');
            if (nameEl && nameEl.textContent !== player.name) nameEl.textContent = player.name;
            if (scoreEl && scoreEl.textContent != player.score) scoreEl.textContent = player.score;

            const isActive = card.classList.contains('active');
            if (isCurrent && !isActive) card.classList.add('active');
            if (!isCurrent && isActive) card.classList.remove('active');

            const targetOpacity = player.connected ? "1" : "0.5";
            if (card.style.opacity !== targetOpacity) card.style.opacity = targetOpacity;
        });
    }

    renderDice(dice) {
        if (!this.ui.diceContainer) return;
        const container = this.ui.diceContainer;
        while (container.children.length > dice.length) {
            container.removeChild(container.lastChild);
        }

        dice.forEach((d, index) => {
            let die = container.children[index];
            if (!die) {
                die = document.createElement('div');
                die.className = 'die';
                container.appendChild(die);
            }
            if (d.selected && !die.classList.contains('selected')) die.classList.add('selected');
            if (!d.selected && die.classList.contains('selected')) die.classList.remove('selected');
            if (die.dataset.id !== d.id) die.dataset.id = d.id;

            if (die.dataset.value != d.value) {
                die.dataset.value = d.value;
                die.innerHTML = '';
                for (let i = 0; i < d.value; i++) {
                    const pip = document.createElement('div');
                    pip.className = 'pip';
                    die.appendChild(pip);
                }
                die.style.animation = 'none';
                die.offsetHeight;
                die.style.animation = null;
            }
        });
    }

    updateGameState(state) {
        this.gameState = state;
        this.rules = state.rules || {};
        this.renderPlayers();
        this.renderControls();
        this.renderDice(state.currentDice);
        this.checkGameOver(state);

        if (this.gameState.gameStatus === 'playing') {
            const myPlayer = this.gameState.players.find(p => p.id === this.socket.id);
            if (myPlayer) {
                const scoreText = `Score: ${myPlayer.score}`;
                const roundText = `Round: ${state.roundAccumulatedScore > 0 ? '+' + state.roundAccumulatedScore : 'Rolling'}`;
                this.updateDiscordPresence(scoreText, roundText);
            } else if (this.isSpectator) {
                this.updateDiscordPresence("Spectating", `Round: ${state.roundAccumulatedScore > 0 ? '+' + state.roundAccumulatedScore : 'Rolling'}`);
            }
        }
    }

    renderControls() {
        if (!this.gameState) return;

        // If Spectator, hide all controls and show spectator message
        if (this.isSpectator) {
            this.ui.rollBtn.style.display = 'none';
            this.ui.bankBtn.style.display = 'none';
            const hsBtn = document.getElementById('hs-roll-btn');
            if (hsBtn) hsBtn.style.display = 'none';
            const startBtn = document.getElementById('lobby-start-btn');
            if (startBtn) startBtn.style.display = 'none';

            const currentPlayerName = this.gameState.players[this.gameState.currentPlayerIndex]?.name || "Someone";
            this.ui.actionText.textContent = `Spectating. Current Turn: ${currentPlayerName}`;
            this.ui.currentScoreDisplay.textContent = `Round Score: ${this.gameState.roundAccumulatedScore}`;
            return;
        }

        if (this.gameState.gameStatus === 'waiting') {
            this.ui.currentScoreDisplay.textContent = "Waiting for players...";
            this.ui.rollBtn.style.display = 'none';
            this.ui.bankBtn.style.display = 'none';
            // Remove High Stakes btn if present
            const hsBtn = document.getElementById('hs-roll-btn');
            if (hsBtn) hsBtn.remove();

            let startBtn = document.getElementById('lobby-start-btn');
            if (!startBtn) {
                startBtn = document.createElement('button');
                startBtn.id = 'lobby-start-btn';
                startBtn.className = 'btn primary pulse';
                startBtn.textContent = 'Start Game';
                startBtn.onclick = () => this.socket.emit('start_game', { roomCode: this.roomCode });
                if (this.ui.rollBtn.parentElement) this.ui.rollBtn.parentElement.appendChild(startBtn);
            }
            if (this.gameState.players.length >= 2) {
                startBtn.style.display = 'block';
                startBtn.disabled = false;
                startBtn.classList.add('pulse');
                this.ui.actionText.textContent = "Lobby Ready! Start Game?";
            } else {
                startBtn.style.display = 'block';
                startBtn.disabled = true;
                this.ui.actionText.textContent = `Need ${2 - this.gameState.players.length} more`;
            }
            return;
        }

        // --- Debug Panel ---
        let debugPanel = document.getElementById('debug-panel');
        if (!debugPanel && this.ui.bankBtn.parentElement && this.ui.bankBtn.parentElement.parentElement) {
            debugPanel = document.createElement('div');
            debugPanel.id = 'debug-panel';
            debugPanel.className = 'tools-panel';

            const forceBtn = document.createElement('button');
            forceBtn.className = 'btn micro';
            forceBtn.textContent = 'Force Next';
            forceBtn.onclick = () => this.socket.emit('force_next_turn', { roomCode: this.roomCode });

            const restartBtn = document.createElement('button');
            restartBtn.className = 'btn micro';
            restartBtn.textContent = 'Reset';
            restartBtn.onclick = () => {
                if (confirm("Restart game?")) this.socket.emit('debug_restart_preserve', { roomCode: this.roomCode });
            };

            debugPanel.appendChild(forceBtn);
            debugPanel.appendChild(restartBtn);
            this.ui.bankBtn.parentElement.parentElement.appendChild(debugPanel);
            // Host Checks
            if (this.gameState.hostId === this.socket.id) {
                debugPanel.style.display = 'block';
            } else {
                debugPanel.style.display = 'none';
            }
        }

        const startBtn = document.getElementById('lobby-start-btn');
        if (startBtn) startBtn.style.display = 'none';

        this.ui.rollBtn.style.display = 'inline-block';
        this.ui.bankBtn.style.display = 'inline-block';

        const isMyTurn = this.canInteract();
        const selectedDice = this.gameState.currentDice.filter(d => d.selected);
        const selectedScore = calculateScore(selectedDice.map(d => d.value), this.rules);
        const totalRound = this.gameState.roundAccumulatedScore + selectedScore;

        this.ui.currentScoreDisplay.textContent = `Selection: ${selectedScore} (Round: ${totalRound})`;

        // High Stakes Button Logic
        let hsBtn = document.getElementById('hs-roll-btn');
        if (!hsBtn) {
            hsBtn = document.createElement('button');
            hsBtn.id = 'hs-roll-btn';
            hsBtn.className = 'btn secondary wiggle-hover'; // Distinct style
            hsBtn.style.position = 'absolute';
            hsBtn.style.top = '-50px'; // Position it above or nearby
            hsBtn.style.left = '50%';
            hsBtn.style.transform = 'translateX(-50%)';
            hsBtn.style.whiteSpace = 'nowrap';
            // We'll append it to the button group
            if (this.ui.rollBtn.parentElement) {
                this.ui.rollBtn.parentElement.style.position = 'relative'; // ensure container is relative
                this.ui.rollBtn.parentElement.appendChild(hsBtn);
            }
        }

        if (!isMyTurn) {
            this.ui.rollBtn.disabled = true;
            this.ui.bankBtn.disabled = true;
            hsBtn.style.display = 'none';
            const currentPlayerName = this.gameState.players[this.gameState.currentPlayerIndex]?.name || "Someone";
            this.ui.actionText.textContent = `Waiting for ${currentPlayerName}...`;
            this.ui.rollBtn.textContent = 'Roll';
        } else {
            this.ui.actionText.textContent = "Your turn";

            const hasSelected = selectedDice.length > 0;
            const startOfTurn = (this.gameState.currentDice.length === 0);

            if (startOfTurn) {
                // Main Roll Logic (Start of Turn)
                this.ui.bankBtn.disabled = true;

                // Check if High Stakes is valid
                if (this.gameState.canHighStakes) {
                    hsBtn.style.display = 'block';
                    hsBtn.textContent = `Roll Leftovers? (+1000pts)`;
                    hsBtn.onclick = () => {
                        this.socket.emit('roll', { roomCode: this.roomCode, confirmedSelections: [], useHighStakes: true });
                        hsBtn.style.display = 'none';
                    };

                    this.ui.rollBtn.textContent = "Roll Fresh (6)";
                    this.ui.rollBtn.disabled = false;
                } else {
                    hsBtn.style.display = 'none';
                    this.ui.rollBtn.textContent = "Roll Dice";
                    this.ui.rollBtn.disabled = false;
                }

            } else {
                // Mid-turn
                hsBtn.style.display = 'none';

                const isValid = isScoringSelection(selectedDice.map(d => d.value), this.rules);
                if (isValid) {
                    this.ui.rollBtn.disabled = false;
                    this.ui.rollBtn.textContent = "Roll Remaining";
                    this.ui.bankBtn.disabled = false;
                } else {
                    this.ui.rollBtn.disabled = true;
                    this.ui.bankBtn.disabled = true;
                    if (this.gameState.currentDice.length === 6 && this.gameState.roundAccumulatedScore > 0 && !selectedDice.length) {
                        this.ui.actionText.textContent = "HOT DICE! Select to continue!";
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

            // Populate score board
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
        this.ui.feedback.classList.remove('hidden', 'error', 'success', 'hot-dice');
        if (type === 'error') this.ui.feedback.classList.add('error');
        else if (type === 'success') this.ui.feedback.classList.add('success');
        else if (type === 'hot-dice') this.ui.feedback.classList.add('hot-dice');
        setTimeout(() => {
            this.ui.feedback.classList.add('hidden');
        }, 2000);
    }

    debugLog(msg) {
        console.log(`[FarkleClient] ${msg}`);
        const el = document.getElementById('connection-debug');
        if (el) el.textContent = msg;
    }

    // --- Chat Methods ---
    sendChat() {
        if (!this.ui.chatInput) return;
        const text = this.ui.chatInput.value.trim();
        if (!text) return;
        if (text.length > 200) return;

        if (this.socket) {
            this.socket.emit('send_chat', { roomCode: this.roomCode, message: text });
        }
        this.ui.chatInput.value = '';
    }

    addChatMessage(data) {
        if (!this.ui.chatMessages) return;
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-msg';

        if (data.isSystem) {
            msgDiv.classList.add('system');
            msgDiv.textContent = data.message;
        } else {
            if (data.sender === this.playerName) {
                msgDiv.classList.add('mine');
            } else {
                msgDiv.classList.add('others');
                const author = document.createElement('span');
                author.className = 'msg-author';
                author.textContent = data.sender;
                msgDiv.appendChild(author);
            }
            const textSpan = document.createElement('span');
            textSpan.textContent = data.message;
            msgDiv.appendChild(textSpan);
        }
        this.ui.chatMessages.appendChild(msgDiv);
        this.ui.chatMessages.scrollTop = this.ui.chatMessages.scrollHeight;
    }
}

class Dice3DManager {
    constructor(container) {
        if (!container) return;
        this.container = container;
        this.diceObjects = [];
        this.isRunning = false;
        this.isSpeed = false; // Default speed
        this.palette = ["#EAA14D", "#E05A47", "#4D9BEA", "#5FB376", "#D869A8", "#F2C94C", "#9B51E0", "#FFFFFF"];
        this.faceNormals = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
        this.faceValues = [1, 6, 2, 5, 3, 4];

        // --- Cache System ---
        this.sharedGeometry = new RoundedBoxGeometry(2.2, 2.2, 2.2, 4, 0.4);
        this.materialCache = new Map(); // Stores material arrays per color

        this.init();
    }
    setSpeed(isSpeed) {
        this.isSpeed = isSpeed;
    }
    init() {
        const width = this.container.clientWidth || 600;
        const height = this.container.clientHeight || 400;
        const aspect = width / height;
        const FRUSTUM = 26;
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-FRUSTUM * aspect / 2, FRUSTUM * aspect / 2, FRUSTUM / 2, -FRUSTUM / 2, 1, 1000);
        this.camera.position.set(40, 40, 40);
        this.camera.lookAt(0, 0, 0);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);
        this.world = new CANNON.World();
        this.world.gravity.set(0, -200, 0);
        this.world.allowSleep = true;

        // Floor
        const floorMat = new CANNON.Material();
        const floorBody = new CANNON.Body({ mass: 0, material: floorMat });
        floorBody.addShape(new CANNON.Plane());
        floorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
        this.world.addBody(floorBody);

        // Walls
        const wallMat = new CANNON.Material();
        const createWall = (x, z, rot) => {
            const body = new CANNON.Body({ mass: 0, material: wallMat });
            body.addShape(new CANNON.Plane());
            body.position.set(x, 0, z);
            body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rot);
            this.world.addBody(body);
        };
        createWall(12, 0, -Math.PI / 2); createWall(-12, 0, Math.PI / 2);
        createWall(0, -12, 0); createWall(0, 12, Math.PI);

        this.diceMat = new CANNON.Material();
        this.world.addContactMaterial(new CANNON.ContactMaterial(floorMat, this.diceMat, { friction: 0.2, restitution: 0.4 }));
        this.world.addContactMaterial(new CANNON.ContactMaterial(wallMat, this.diceMat, { friction: 0.1, restitution: 0.6 }));

        this.scene.add(new THREE.AmbientLight(0xffffff, 1.2));
        const dir = new THREE.DirectionalLight(0xffffff, 0.5);
        dir.position.set(10, 20, 10);
        this.scene.add(dir);

        this.animate();
        window.addEventListener('resize', () => {
            const w = this.container.clientWidth; const h = this.container.clientHeight; const asp = w / h;
            const FRUSTUM = 26;
            this.camera.left = -FRUSTUM * asp / 2; this.camera.right = FRUSTUM * asp / 2;
            this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h);
        });
    }
    createDiceTexture(number, color = "#ffffff") {
        const size = 256; // Keep resolution high
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = color; ctx.fillRect(0, 0, size, size);
        const isWhite = (color.toLowerCase() === "#ffffff" || color.toLowerCase() === "white");
        ctx.fillStyle = isWhite ? "#E03E3E" : "#ffffff";
        if (number !== 1 && number !== 4 && isWhite) ctx.fillStyle = "#331e18";
        const dot = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
        const c = size / 2, q1 = size / 4, q3 = size * 3 / 4, d = 25, bd = 35;
        if (number === 1) dot(c, c, bd);
        else if (number === 2) { dot(q1, q1, d); dot(q3, q3, d); }
        else if (number === 3) { dot(q1, q1, d); dot(c, c, d); dot(q3, q3, d); }
        else if (number === 4) { dot(q1, q1, d); dot(q3, q1, d); dot(q1, q3, d); dot(q3, q3, d); }
        else if (number === 5) { dot(q1, q1, d); dot(q3, q1, d); dot(c, c, d); dot(q1, q3, d); dot(q3, q3, d); }
        else if (number === 6) { dot(q1, q1, d); dot(q3, q1, d); dot(q1, c, d); dot(q3, c, d); dot(q1, q3, d); dot(q3, q3, d); }
        return new THREE.CanvasTexture(canvas);
    }

    getMaterialsForColor(color) {
        if (this.materialCache.has(color)) {
            return this.materialCache.get(color);
        }

        const materials = [];
        for (let j = 1; j <= 6; j++) {
            materials.push(new THREE.MeshStandardMaterial({
                map: this.createDiceTexture(j, color)
            }));
        }
        // Map faces to cube sides: [Right, Left, Top, Bottom, Front, Back]
        // Standard UV mapping for box usually maps specific faces.
        // Based on previous code: materials[0], materials[5], etc.
        // indices: 1, 6, 2, 5, 3, 4
        // materials array is 0-indexed (so materials[0] is face 1)
        const matArray = [materials[0], materials[5], materials[1], materials[4], materials[2], materials[3]];

        this.materialCache.set(color, matArray);
        return matArray;
    }

    roll(values) {
        return new Promise(resolve => {
            this.targetValues = values;
            this.resolveRoll = resolve;
            this.clearDice();
            this.spawnDice(values);
            this.isRunning = true;
            this.rollStartTime = Date.now();

            // Adjust duration based on speed
            const duration = this.isSpeed ? 400 : 1200;
            setTimeout(() => { if (this.isRunning) this.stopRoll(); }, duration);
        });
    }
    clearDice() {
        this.diceObjects.forEach(obj => {
            this.scene.remove(obj.mesh);
            this.world.removeBody(obj.body);
            // Do NOT dispose geometry/materials here as they are cached
        });
        this.diceObjects = [];
    }
    spawnDice(values) {
        const theme = document.body.getAttribute('data-dice-theme') || 'classic';
        const geom = this.sharedGeometry;

        values.forEach((val, i) => {
            let diceColor = "#ffffff";
            if (theme === 'classic') diceColor = this.palette[i % this.palette.length];
            else if (theme === 'gold') diceColor = "#ffd700";

            else if (theme === 'dark') diceColor = "#111111";
            else if (theme === 'neon') diceColor = "#00f2ff";

            const matArray = this.getMaterialsForColor(diceColor);

            const mesh = new THREE.Mesh(geom, matArray);
            this.scene.add(mesh);
            const body = new CANNON.Body({ mass: 5, shape: new CANNON.Box(new CANNON.Vec3(1.1, 1.1, 1.1)), material: this.diceMat, position: new CANNON.Vec3((Math.random() - 0.5) * 5, 15 + i * 2, (Math.random() - 0.5) * 5) });

            // Speed mode = faster initial velocity? No, just stop sooner.
            // But maybe slight boost looks better.
            const velMult = this.isSpeed ? 1.5 : 1.0;

            body.velocity.set((Math.random() - 0.5) * 20 * velMult, -60 * velMult, (Math.random() - 0.5) * 20 * velMult);
            body.angularVelocity.set((Math.random() - 0.5) * 40 * velMult, (Math.random() - 0.5) * 40 * velMult, (Math.random() - 0.5) * 40 * velMult);
            this.world.addBody(body);
            this.diceObjects.push({ mesh, body, targetVal: val });
        });
    }
    checkStopped() {
        if (!this.isRunning) return;

        let allStopped = true;
        // In speed mode, we care less about physics stop, we force stop anyway.
        // But if they naturally stop, great.
        this.diceObjects.forEach(obj => { if (obj.body.velocity.lengthSquared() > 0.2) allStopped = false; });

        const minTime = this.isSpeed ? 200 : 500;

        if (allStopped && Date.now() - this.rollStartTime > minTime) this.stopRoll();
    }
    stopRoll() {
        if (!this.isRunning) return;
        this.isRunning = false;
        this.diceObjects.forEach(obj => { this.alignDie(obj); obj.body.sleep(); });

        const delay = this.isSpeed ? 100 : 300;
        if (this.resolveRoll) { const res = this.resolveRoll; this.resolveRoll = null; setTimeout(res, delay); }
    }
    alignDie(obj) {
        const bodyQ = obj.body.quaternion;
        let bestIndex = 0, maxUp = -1;
        for (let i = 0; i < this.faceNormals.length; i++) {
            const normal = this.faceNormals[i].clone().applyQuaternion(bodyQ);
            if (normal.y > maxUp) { maxUp = normal.y; bestIndex = i; }
        }
        let targetIndex = this.faceValues.indexOf(obj.targetVal);
        if (targetIndex !== bestIndex) {
            const correction = new THREE.Quaternion().setFromUnitVectors(this.faceNormals[targetIndex], this.faceNormals[bestIndex]);
            obj.mesh.quaternion.copy(bodyQ).multiply(correction);
        } else { obj.mesh.quaternion.copy(bodyQ); }
    }
    animate() {
        requestAnimationFrame(() => this.animate());
        if (this.isRunning) {
            // Speed up physics in speed mode
            const timeStep = this.isSpeed ? 1 / 30 : 1 / 60;
            // actually faster simulation requires larger timestep? 
            // No, just normal step.
            this.world.step(1 / 60);
            this.diceObjects.forEach(obj => { obj.mesh.position.copy(obj.body.position); obj.mesh.quaternion.copy(obj.body.quaternion); });
            this.checkStopped();
        }
        this.renderer.render(this.scene, this.camera);
    }
    updateDiceMaterials() {
        // Re-apply materials to all existing dice based on current theme
        const theme = document.body.getAttribute('data-dice-theme') || 'classic';

        this.diceObjects.forEach((obj, i) => {
            let diceColor = "#ffffff";
            if (theme === 'classic') diceColor = this.palette[i % this.palette.length];
            else if (theme === 'gold') diceColor = "#ffd700";
            else if (theme === 'dark') diceColor = "#111111";
            else if (theme === 'neon') diceColor = "#00f2ff";

            const matArray = this.getMaterialsForColor(diceColor);

            // Dispose old material? (Three.js memory management)
            // Ideally yes, but here we just swap references. cache handles reuse.
            obj.mesh.material = matArray;
        });
    }
}
window.farkle = new FarkleClient();
