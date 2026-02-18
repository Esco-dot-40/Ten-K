import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as CANNON from "cannon-es";
import gsap from "gsap";
import { calculateScore, isScoringSelection } from "./rules.js";




// Discord SDK integration refactored to use dynamic import

// Global reference
const DISCORD_CLIENT_ID = "1455588853254717510"; // Corrected ID from user


class FarkleClient {
    constructor() {
        // Default to random player name until Discord loads
        try {
            const loadingContainer = document.getElementById('connection-debug');
            if (loadingContainer) {
                loadingContainer.textContent = "Script Running...";
            }
        } catch (e) {
            // Silently fail
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
                leaveText: document.getElementById('leave-text'),
                chatNotifications: document.getElementById('chat-notifications'),
                volumeSlider: document.getElementById('volume-slider'),
                muteBtn: document.getElementById('mute-btn'),
                volumeIcon: document.getElementById('volume-icon'),
                statsContent: document.getElementById('stats-content'),
                statsModal: document.getElementById('stats-modal'), // Fix: missing reference
                statsBtn: document.getElementById('stats-btn'),
                headerLoginBtn: document.getElementById('header-login-btn'),
                zoomSlider: document.getElementById('zoom-slider'),
                zoomValue: document.getElementById('zoom-value')
            };

            // Hook up start button
            if (this.ui.startGameBtn) {
                this.ui.startGameBtn.addEventListener('click', () => {
                    if (this.roomCode) {
                        this.socket.emit('start_game', { roomCode: this.roomCode });
                        this.sounds.play('click');
                    }
                });
            }

            this.announcer = new VirtualHost(this);
            this.dice3D = new Dice3DManager(this.ui.threeCanvasContainer, this);
            this.sounds = new SoundManager();

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
            try { this.createBackgroundEffects(); } catch (e) { console.error("Background Effects Failed", e); }
            try { this.initHistory(); } catch (e) { console.error("History Init Failed", e); }
            try { this.initStatsUI(); } catch (e) { console.error("Stats UI Init Failed", e); }

            // Minimalist init
            // this.createDebugPanel();
            // this.addDebugMessage('✅ Core Modules Ready');

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
            // If we are here, we are a "Guest" by default or failed auth
            if (this.ui.headerLoginBtn) this.ui.headerLoginBtn.style.display = 'block';

            // Default to Mode Selection immediately
            const modeSelection = document.getElementById('mode-selection');
            if (modeSelection) modeSelection.style.display = 'block';
            const loadMsg = document.getElementById('connection-debug');
            if (loadMsg) loadMsg.style.display = 'none';

            this.debugLog("Loading Discord SDK...");
            let DiscordSDK;
            try {
                // Use local path as CDN might be blocked by Discord CSP
                const module = await import("/libs/@discord/embedded-app-sdk/output/index.mjs");
                DiscordSDK = module.DiscordSDK;
                this.addDebugMessage('✅ Discord SDK Connected');
            } catch (importErr) {
                this.addDebugMessage(`❌ Connection failed: ${importErr.message}`);
                // Try fallback to unpkg if local fails, but local is preferred
                try {
                    const fallback = await import("https://unpkg.com/@discord/embedded-app-sdk/output/index.mjs");
                    DiscordSDK = fallback.DiscordSDK;
                    this.addDebugMessage('⚠️ Loaded via unpkg fallback');
                } catch (e2) {
                    this.addDebugMessage(`❌ All SDK loads failed: ${e2.message}`);
                    return;
                }
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

                    // Show Welcome
                    this.showWelcome(this.playerName, user.avatar, user.id);

                    // Helper to track analytics for restored session
                    this.identifyAnalytics(user);

                    // Progress to mode selection
                    const modeSelection = document.getElementById('mode-selection');
                    if (modeSelection) modeSelection.style.display = 'block';
                    return;
                } catch (e) {
                    localStorage.removeItem('farkle_auth_token');
                    localStorage.removeItem('farkle_user_data');
                }
            } else {
            }

            // 2. Proceed with Discord SDK Auth if no session


            // Add a timeout to SDK ready
            const readyTimeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('SDK ready timeout (5s)')), 5000)
            );

            try {
                await Promise.race([this.discordSdk.ready(), readyTimeout]);
            } catch (readyErr) {
                this.addDebugMessage(`❌ SDK Ready failed`);
                throw readyErr;
            }


            // Authorize with Discord Client
            // Removing prompt: none and redirect_uri to let Discord use its defaults
            // and avoid RPC bridge rejection issues.
            const { code } = await this.discordSdk.commands.authorize({
                client_id: DISCORD_CLIENT_ID,
                response_type: "code",
                state: "",
                scope: [
                    "identify",
                    "guilds"
                ],
            });

            // Exchange code for token via backend
            const response = await fetch("/api/token", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    code
                }),
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || `HTTP ${response.status}`);
            }

            const { access_token, user } = await response.json();
            this.addDebugMessage(`✅ Token received for ${user.username}`);

            // Authenticate with Discord SDK (for channel interactions if needed later)
            const auth = await this.discordSdk.commands.authenticate({
                access_token,
            });

            if (auth == null) {
                throw new Error("Authenticate command failed via SDK");
            }
            this.addDebugMessage(`✅ Identity Verified: ${user.username}`);

            try {
                localStorage.setItem('farkle_auth_token', access_token);
                localStorage.setItem('farkle_user_data', JSON.stringify(user));
            } catch (lsErr) {
                console.warn("Storage failed", lsErr);
            }

            this.playerName = user.global_name || user.username;
            this.discordId = user.id;

            // console.log('[WELCOME] Calling showWelcome with:', this.playerName, user.avatar, user.id);
            this.showWelcome(this.playerName, user.avatar, user.id);
            this.identifyAnalytics(user);

        } catch (err) {
            console.error("Discord Auth Failed/Cancelled", err);
            // Fallback to mode selection even on failure
            const modeSelection = document.getElementById('mode-selection');
            if (modeSelection) modeSelection.style.display = 'block';
            const loadMsg = document.getElementById('connection-debug');
            if (loadMsg) loadMsg.style.display = 'none';
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
        this.addDebugMessage(`👋 showWelcome called: ${name}`);
        // console.log('[WELCOME] Function called:', { name, avatar, id });

        // Remove any existing welcome screen
        const existing = document.getElementById('welcome-overlay');
        if (existing) {
            // console.log('[WELCOME] Removing existing overlay');
            existing.remove();
        }

        // console.log('[WELCOME] Creating new overlay');
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
            backdrop-filter: blur(4px);
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

        // console.log('[WELCOME] Appending overlay to body');
        document.body.appendChild(overlay);
        // console.log('[WELCOME] Overlay appended, setting timeout for fade out');

        // Fade out after delay
        setTimeout(() => {
            // console.log('[WELCOME] Fading out');
            overlay.style.opacity = '0';
            overlay.style.pointerEvents = 'none';
            setTimeout(() => {
                // console.log('[WELCOME] Removing overlay');
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

        this.sounds.play('click');
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
                        large_text: "Ten-K"
                    }
                }
            });
        } catch (e) {
        }
    }

    toggleMute() {
        const newState = !this.sounds.enabled;
        this.sounds.setEnabled(newState);

        const isMuted = !newState;
        const muteBtns = [this.ui.muteBtn, document.getElementById('quick-mute-btn')];
        muteBtns.forEach(btn => {
            if (btn) btn.classList.toggle('muted', isMuted);
        });

        this.updateVolumeIcon(isMuted ? 0 : this.sounds.masterVolume);
        if (!isMuted) this.sounds.play('click');
        localStorage.setItem('farkle_muted', isMuted);
    }

    initSettings() {
        if (this.ui.settingsBtn) {
            this.ui.settingsBtn.addEventListener('click', () => {
                this.ui.settingsModal.classList.remove('hidden');
                this.sounds.play('menu_open');
            });
        }
        if (this.ui.settingsModal) {
            this.ui.settingsModal.querySelector('.close-modal').addEventListener('click', () => {
                this.ui.settingsModal.classList.add('hidden');
                this.sounds.play('click');
            });
        }

        // Settings UI initialization complete

        // Felt Color (Table)
        const feltBtnGroup = document.querySelectorAll('.theme-options .theme-btn[data-theme]');
        feltBtnGroup.forEach(btn => {
            btn.addEventListener('click', () => {
                const theme = btn.dataset.theme;
                let color = '#1a3a2a';
                if (theme === 'blue') color = '#1a2a4a';
                if (theme === 'red') color = '#4a1a1a';
                if (theme === 'purple') color = '#2a1a4a';
                document.body.style.background = color;
                feltBtnGroup.forEach(b => b.classList.toggle('active', b === btn));
                this.sounds.play('select');
            });
        });

        // Background Atmosphere
        const bgBtnGroup = document.querySelectorAll('.theme-options .theme-btn[data-bg]');
        const auroraContainer = document.querySelector('.aurora-container');
        bgBtnGroup.forEach(btn => {
            btn.addEventListener('click', () => {
                const bgType = btn.dataset.bg;
                if (auroraContainer) {
                    if (bgType === 'aurora-cyan') {
                        document.documentElement.style.setProperty('--primary-glow', 'rgba(77, 234, 255, 0.3)');
                        document.documentElement.style.setProperty('--accent-glow', 'rgba(180, 77, 234, 0.3)');
                    } else if (bgType === 'aurora-purple') {
                        document.documentElement.style.setProperty('--primary-glow', 'rgba(180, 77, 234, 0.3)');
                        document.documentElement.style.setProperty('--accent-glow', 'rgba(77, 77, 255, 0.3)');
                    } else if (bgType === 'cosmic-red') {
                        document.documentElement.style.setProperty('--primary-glow', 'rgba(224, 90, 71, 0.3)');
                        document.documentElement.style.setProperty('--accent-glow', 'rgba(234, 77, 180, 0.3)');
                    }
                }
                bgBtnGroup.forEach(b => b.classList.toggle('active', b === btn));
                localStorage.setItem('farkle-bg-theme', bgType);
                this.sounds.play('select');
            });
        });

        // Dice Theme
        const diceSelect = this.ui.diceThemeSelect;
        if (diceSelect) {
            const savedTheme = localStorage.getItem('farkle-dice-theme') || 'classic';
            diceSelect.value = savedTheme;
            document.body.setAttribute('data-dice-theme', savedTheme);

            diceSelect.addEventListener('change', (e) => {
                const val = e.target.value;
                document.body.setAttribute('data-dice-theme', val);
                localStorage.setItem('farkle-dice-theme', val);
                if (this.dice3D) this.dice3D.materialCache.clear();
                this.sounds.play('click');
            });
        }

        if (this.ui.volumeSlider) {
            this.ui.volumeSlider.addEventListener('input', (e) => {
                const vol = parseFloat(e.target.value);
                this.sounds.setVolume(vol);
                localStorage.setItem('farkle_volume', vol);
                this.updateVolumeIcon(vol);
                // If it was muted by volume 0, and we slide up, but master toggle is OFF, 
                // we should probably NOT unmute the master toggle unless the user explicitly clicks mute.
                // But if they slide volume up from 0, it's expected to hear something IF enabled.
            });
        }

        if (this.ui.muteBtn) {
            this.ui.muteBtn.addEventListener('click', () => this.toggleMute());
        }

        const quickMute = document.getElementById('quick-mute-btn');
        if (quickMute) {
            quickMute.addEventListener('click', () => this.toggleMute());
        }

        if (this.ui.zoomSlider) {
            this.ui.zoomSlider.addEventListener('input', (e) => {
                this.setZoom(parseFloat(e.target.value));
            });
        }

        // Restore Settings
        const savedVol = localStorage.getItem('farkle_volume');
        if (savedVol !== null && this.ui.volumeSlider) {
            const vol = parseFloat(savedVol);
            this.ui.volumeSlider.value = vol;
            this.sounds.masterVolume = vol;
            this.updateVolumeIcon(vol);
        }

        const savedBg = localStorage.getItem('farkle-bg-theme');
        if (savedBg) {
            const targetBtn = Array.from(bgBtnGroup).find(b => b.dataset.bg === savedBg);
            if (targetBtn) targetBtn.click();
        }

        const savedMuted = localStorage.getItem('farkle_muted') === 'true';
        if (savedMuted) {
            this.sounds.enabled = true; // Temporary set to true so toggleMute flips it to false
            this.toggleMute();
        }

        const savedZoom = localStorage.getItem('farkle_ui_zoom');
        if (savedZoom !== null) {
            this.setZoom(parseFloat(savedZoom));
        }
    }

    updateVolumeIcon(vol) {
        const isMuted = vol <= 0 || !this.sounds.enabled;
        const iconHtml = isMuted ?
            `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9l5 5m0-5l-5 5"></path><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon></svg>` :
            `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;

        if (this.ui.volumeIcon) this.ui.volumeIcon.innerHTML = iconHtml;
        const quickMuteIcon = document.querySelector('#quick-mute-btn svg');
        if (quickMuteIcon) quickMuteIcon.parentElement.innerHTML = iconHtml;
    }

    setZoom(val) {
        if (!this.ui.app) return;
        this.ui.app.style.transform = `scale(${val})`;
        if (this.ui.zoomValue) {
            this.ui.zoomValue.textContent = `${Math.round(val * 100)}%`;
        }
        if (this.ui.zoomSlider) {
            this.ui.zoomSlider.value = val;
        }
        localStorage.setItem('farkle_ui_zoom', val);
    }

    initStatsUI() {
        const modeSelection = document.getElementById('mode-selection');
        if (!modeSelection) return;

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
        statsRow.innerHTML = '';

        const lbBtn = document.createElement('button');
        lbBtn.className = 'btn secondary small';
        lbBtn.innerHTML = '🏆 Leaderboard';
        lbBtn.onclick = () => this.showStats();

        const myStatsBtn = document.createElement('button');
        myStatsBtn.className = 'btn secondary small';
        myStatsBtn.innerHTML = '📊 My Stats';
        myStatsBtn.onclick = () => this.showMyStats();

        statsRow.appendChild(lbBtn);
        statsRow.appendChild(myStatsBtn);
    }

    // Unified stats logic below in showStats

    async showMyStats() {
        if (!this.ui.statsModal || !this.ui.statsContent) return;
        this.ui.statsModal.classList.remove('hidden');
        this.ui.statsContent.innerHTML = '<p style="text-align:center">Loading your stats...</p>';

        const userId = this.discordId || (this.discordSdk && this.discordSdk.mock ? "mock_user_123" : null);

        if (!userId) {
            this.ui.statsContent.innerHTML = "<p style='text-align:center; color:var(--text-muted)'>Please play via Discord Activity or log in to view stats.</p>";
            return;
        }

        try {
            const res = await fetch(`/api/stats/${userId}`);
            if (!res.ok) throw new Error("Stats not found");
            const data = await res.json();
            const stats = data.stats || {};

            const html = `
                <div style="text-align: center; margin-bottom: 20px;">
                    ${data.avatar ? `<img src="https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png" style="width:64px;height:64px;border-radius:50%; margin-bottom:10px; border: 2px solid var(--primary);">` : ''}
                    <h3 style="margin:0">${data.display_name}</h3>
                    <p style="opacity:0.7; font-size: 0.8rem;">@${data.username}</p>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; text-align: center;">
                    <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="font-size: 0.7rem; opacity: 0.6; text-transform: uppercase;">Games</div>
                        <div style="font-size: 1.2rem; font-weight: bold; color: var(--primary)">${stats.games_played || 0}</div>
                    </div>
                    <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="font-size: 0.7rem; opacity: 0.6; text-transform: uppercase;">Wins</div>
                        <div style="font-size: 1.2rem; font-weight: bold; color: var(--success)">${stats.wins || 0}</div>
                    </div>
                    <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="font-size: 0.7rem; opacity: 0.6; text-transform: uppercase;">Total Score</div>
                        <div style="font-size: 1.1rem; font-weight: bold;">${Number(stats.total_score || 0).toLocaleString()}</div>
                    </div>
                     <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="font-size: 0.7rem; opacity: 0.6; text-transform: uppercase;">Farkles</div>
                        <div style="font-size: 1.2rem; font-weight: bold; color: var(--danger)">${stats.farkles_count || 0}</div>
                    </div>
                    <div style="grid-column: 1 / -1; background: rgba(255,255,255,0.05); padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="font-size: 0.7rem; opacity: 0.6; text-transform: uppercase;">Personal Best</div>
                        <div style="font-size: 1.3rem; font-weight: bold; color: var(--accent)">${Number(stats.highest_round_score || 0).toLocaleString()}</div>
                    </div>
                </div>
            `;
            this.ui.statsContent.innerHTML = html;
        } catch (e) {
            this.ui.statsContent.innerHTML = `<p style="text-align:center; color:var(--text-muted)">No stats found yet. Play a game to track stats!</p>`;
        }
    }

    // Modal references handled in constructor/ui object

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
            reconnectionAttempts: 25,
            transports: ['websocket'],
            auth: { name: this.playerName },
            timeout: 10000
        });
        this.initSocketEvents();
    }

    // --- Web Auth Helpers ---
    loginWithDiscordWeb() {
        const width = 500, height = 750;
        const left = (window.innerWidth / 2) - (width / 2);
        const top = (window.innerHeight / 2) - (height / 2);

        const url = '/api/access/auth/discord';
        window.open(url, 'discord_login', `width=${width},height=${height},top=${top},left=${left}`);

        const onMessage = (event) => {
            if (event.data?.type === 'DISCORD_AUTH_SUCCESS') {
                window.removeEventListener('message', onMessage);
                const { token, user } = event.data;

                localStorage.setItem('farkle_auth_token', token);
                localStorage.setItem('farkle_user_data', JSON.stringify(user));

                this.playerName = user.global_name || user.username;
                this.discordId = user.id;

                this.playerName = user.global_name || user.username;
                this.discordId = user.id;

                if (this.ui.headerLoginBtn) this.ui.headerLoginBtn.style.display = 'none';
                this.showWelcome(this.playerName, user.avatar, user.id);
                this.identifyAnalytics(user);
            }
        };

        window.addEventListener('message', onMessage);
    }

    initListeners() {
        // ...Existing listeners...
        if (this.ui.headerLoginBtn) {
            this.ui.headerLoginBtn.onclick = () => this.loginWithDiscordWeb();
        }
        this.ui.rollBtn.addEventListener('click', () => {
            if (this.canInteract()) {
                const selectedIds = Array.from(document.querySelectorAll('.die.selected'))
                    .map(el => el.dataset.id)
                    .filter(id => id);
                this.socket.emit('roll', { roomCode: this.roomCode, confirmedSelections: selectedIds, useHighStakes: false });
                this.sounds.play('click');
            }
        });

        this.ui.bankBtn.addEventListener('click', () => {
            if (this.canInteract()) {
                const selectedIds = Array.from(document.querySelectorAll('.die.selected'))
                    .map(el => el.dataset.id)
                    .filter(id => id);
                this.socket.emit('bank', { roomCode: this.roomCode, confirmedSelections: selectedIds });
                this.sounds.play('bank');
            }
        });

        this.ui.diceContainer.addEventListener('click', (e) => {
            const dieEl = e.target.closest('.die');
            if (dieEl && this.canInteract()) {
                const id = dieEl.dataset.id;
                dieEl.classList.toggle('selected');
                this.socket.emit('toggle_die', { roomCode: this.roomCode, dieId: id });
                this.sounds.play('select');
                // Trigger UI update immediately for responsiveness
                this.renderControls();
            }
        });

        this.ui.rulesBtn.addEventListener('click', () => this.ui.rulesModal.classList.remove('hidden'));
        this.ui.rulesModal.querySelector('.close-modal').addEventListener('click', () => this.ui.rulesModal.classList.add('hidden'));

        if (this.ui.statsBtn) {
            this.ui.statsBtn.addEventListener('click', () => this.showStats());
        }
        if (this.ui.statsModal) {
            this.ui.statsModal.querySelector('.close-modal').addEventListener('click', () => {
                this.ui.statsModal.classList.add('hidden');
            });
        }

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

        // Add hover sounds to all buttons
        document.querySelectorAll('.btn, .icon-btn, .die, .room-card, .theme-btn').forEach(el => {
            el.addEventListener('mouseenter', () => this.sounds.play('hover'));
        });

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
            this.addDebugMessage('📡 Uplink Established');
            this.showFeedback("Connected!", "success");

            const modeSelection = document.getElementById('mode-selection');
            const roomList = document.getElementById('room-list-container');
            const loadMsg = document.getElementById('connection-debug');
            if (loadMsg) loadMsg.style.display = 'none';

            if (!this.roomCode) {
                modeSelection.style.display = 'block';
            }

            if (this.roomCode) {
                this.socket.emit('join_game', {
                    roomCode: this.roomCode,
                    reconnectToken: this.reconnectToken,
                    name: this.playerName,
                    dbId: this.discordId || null
                });
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
            if (reason === 'io server disconnect') {
                this.socket.connect();
            }
        });

        this.socket.on('joined', ({ playerId, state, isSpectator }) => {
            this.playerId = playerId;
            this.roomCode = state.roomCode;
            this.isSpectator = isSpectator || false;

            // HIDE MODAL IMMEDIATELY
            if (this.ui.setupModal) this.ui.setupModal.classList.add('hidden');

            try {
                this.updateGameState(state);
            } catch (e) {
                console.error("State Update Failed on Join", e);
            }

            if (this.isSpectator) this.showFeedback("Joined as Spectator", "info");
            else this.showFeedback("Joined Room!", "success");

            this.renderControls();

            // Update UI
            if (this.ui.roomDisplay) this.ui.roomDisplay.textContent = `Table: ${this.roomCode}`;
            this.addDebugMessage(`🎮 Session Active: ${this.roomCode}`);
            if (this.ui.gameInfoBar) this.ui.gameInfoBar.style.display = 'flex';
            if (this.ui.leaveText) this.ui.leaveText.style.display = 'inline';
            if (this.ui.leaveBtn) this.ui.leaveBtn.style.width = 'auto';
            if (this.ui.leaveBtn) this.ui.leaveBtn.style.padding = '0 12px';

            // Fluent Board Entrance
            gsap.from(".player-zones", { y: -20, opacity: 0, delay: 0.2, duration: 1, ease: "power3.out" });
            gsap.from(".dice-arena", { scale: 0.95, opacity: 0, delay: 0.4, duration: 1.2, ease: "expo.out" });
            gsap.from(".controls", { y: 50, opacity: 0, delay: 0.6, duration: 1, ease: "power2.out" });

            if (this.announcer) {
                setTimeout(() => this.announcer.show(`Welcome to Table ${this.roomCode}. High stakes today!`), 1000);
            }
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

            // Fluent Startup Animation
            gsap.from(".player-zones", { y: -30, opacity: 0, duration: 1.2, ease: "power4.out" });
            gsap.from(".dice-arena", { y: 20, opacity: 0, duration: 1.8, ease: "power2.out" });

            if (this.announcer) {
                this.announcer.show("Cards up, dice out! The game has officially started.");
            }
        });

        this.socket.on('roll_result', (data) => {
            const diceValues = data.dice.map(d => d.value);
            this.isRolling = true;
            if (this.ui.diceContainer) this.ui.diceContainer.classList.add('rolling');

            // Quip on start
            if (this.announcer) this.announcer.say('start');

            // Camera Zoom In
            if (this.dice3D) {
                gsap.to(this.dice3D.camera, {
                    zoom: 1.5,
                    duration: 0.8,
                    ease: "power2.out",
                    onUpdate: () => this.dice3D.camera.updateProjectionMatrix()
                });
            }

            this.dice3D.roll(diceValues).then(async () => {
                if (this.ui.diceContainer) this.ui.diceContainer.classList.remove('rolling');

                if (data.farkle) {
                    this.showFeedback("FARKLE!", "error");
                    this.sounds.play('farkle');
                    this.shakeScreen(5, 0.4); // Add immersion shake
                    if (this.announcer) this.announcer.say('farkle');
                    // Buffer delay
                    const delay = this.isSpeedMode ? 800 : 2000;
                    await new Promise(r => setTimeout(r, delay));
                }

                // Camera Zoom Out
                if (this.dice3D) {
                    gsap.to(this.dice3D.camera, {
                        zoom: 1.0,
                        duration: 1.2,
                        ease: "elastic.out(1, 0.5)",
                        onUpdate: () => this.dice3D.camera.updateProjectionMatrix()
                    });
                }

                this.isRolling = false;

                const finalState = this.pendingState || data.state;
                this.pendingState = null;

                this.updateGameState(finalState);
                if (data.hotDice) {
                    this.showFeedback("HOT DICE!", "hot-dice");
                    this.sounds.play('hot_dice');
                    if (this.announcer) this.announcer.say('hot_dice');
                } else if (!data.farkle) {
                    // Possible commentary on bank? No, that's handled in bank response
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

        this.socket.on('turn_reminder', () => {
            this.showFeedback("It's your turn! (AFK Reminder)", "info");
            this.sounds.play('hover'); // Gentle sound
            if (this.discordSdk) {
                // Flash or notify via SDK? 
                // Discord Activity SDK doesn't have a direct "flash window" but we can try setting activity.
            }
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



    joinRoom(roomCode, asSpectator = false) {
        this.roomCode = roomCode;
        this.isSpectator = asSpectator;
        sessionStorage.setItem('farkle-room-code', roomCode);

        this.debugLog(`Joining ${roomCode}...`);
        this.socket.emit('join_game', {
            roomCode: roomCode,
            asSpectator: asSpectator,
            reconnectToken: this.reconnectToken,
            name: this.playerName,
            dbId: this.discordId || null
        });
    }

    joinGame() {
        this.debugLog(`Joining Game...`);
        this.socket.emit('join_game', {
            reconnectToken: this.reconnectToken,
            name: this.playerName,
            dbId: this.discordId || null
        });
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

    updateGameState(state) {
        if (!state) return;
        this.gameState = state;
        this.rules = state.rules;

        this.renderPlayers();
        this.renderDice(state.currentDice || []);
        this.renderControls();
        this.checkGameOver(state);

        // Presence Update
        const currentPlayer = state.players[state.currentPlayerIndex];
        if (currentPlayer) {
            const status = this.canInteract() ? "YOUR TURN" : (state.gameStatus === 'playing' ? `Waiting for ${currentPlayer.name}` : "Waiting to Start");
            this.updateDiscordPresence(`Table: ${this.roomCode}`, status);
        }
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

        container.style.opacity = 1; // Force visibility
        container.classList.add('seated-layout');

        // Render 10 Seats
        const MAX_SEATS = 10;
        const players = this.gameState.players;
        const canSwitch = this.gameState.gameStatus === 'waiting' && !this.isSpectator;

        // Sync children count
        while (container.children.length < MAX_SEATS) {
            const seatEl = document.createElement('div');
            seatEl.className = 'player-seat';
            container.appendChild(seatEl);
        }

        for (let i = 0; i < MAX_SEATS; i++) {
            const seatEl = container.children[i];
            const player = players.find(p => p.seat === i);

            seatEl.innerHTML = '';
            seatEl.className = 'player-seat';

            if (player) {
                seatEl.classList.add('occupied');
                const card = document.createElement('div');
                card.className = 'player-card';

                const isCurrent = this.gameState.currentPlayerIndex !== -1 &&
                    players[this.gameState.currentPlayerIndex] &&
                    players[this.gameState.currentPlayerIndex].id === player.id;

                if (isCurrent) card.classList.add('active');

                // Content
                const info = document.createElement('div');
                info.className = 'player-name';
                info.textContent = player.name + (player.id === this.socket.id ? ' (You)' : '');

                const score = document.createElement('div');
                score.className = 'player-score';
                score.textContent = player.score.toLocaleString();

                card.appendChild(info);
                card.appendChild(score);

                // Host Badge
                if (this.gameState.hostId === player.id) {
                    const hostBadge = document.createElement('span');
                    hostBadge.className = 'host-badge';
                    hostBadge.textContent = 'HOST';
                    card.appendChild(hostBadge);
                }

                seatEl.appendChild(card);
            } else {
                seatEl.classList.add('empty');
                if (canSwitch) {
                    const sitBtn = document.createElement('button');
                    sitBtn.className = 'sit-btn';
                    sitBtn.textContent = 'SIT HERE';
                    sitBtn.onclick = () => {
                        this.socket.emit('switch_seat', { seatIndex: i });
                        this.sounds.play('click');
                    };
                    seatEl.appendChild(sitBtn);
                } else {
                    const ghost = document.createElement('div');
                    ghost.className = 'seat-ghost';
                    seatEl.appendChild(ghost);
                }
            }
        }
    }

    renderDice(dice = []) {
        if (!this.ui.diceContainer) return;
        const container = this.ui.diceContainer;
        if (!Array.isArray(dice)) dice = [];

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

        // Ensure dice arena is visible
        const arena = document.querySelector('.dice-arena');
        if (arena) arena.style.opacity = 1;
    }

    updateGameState(state) {
        const oldState = this.gameState;
        this.gameState = state;
        this.rules = state.rules || {};
        this.renderPlayers();
        this.renderControls();
        this.renderDice(state.currentDice);
        this.checkGameOver(state);

        // Turn change commentary
        if (oldState && oldState.currentPlayerIndex !== state.currentPlayerIndex) {
            const currentPlayer = state.players[state.currentPlayerIndex];
            if (currentPlayer && currentPlayer.id === this.socket.id) {
                if (this.announcer) this.announcer.say('turn_start');
            }
        }

        // Bank commentary
        if (oldState && state.gameStatus === 'playing') {
            const oldCurrent = oldState.players[oldState.currentPlayerIndex];
            const newPrev = state.players[oldState.currentPlayerIndex]; // The one who just finished
            if (oldCurrent && newPrev && newPrev.score > oldCurrent.score) {
                if (this.announcer) this.announcer.say('bank');
            }
        }

        // --- STABILITY: Ensure items are actually revealed ---
        const reveal = () => {
            gsap.set([".player-zones", ".dice-arena", ".controls"], { opacity: 1, visibility: 'visible', scale: 1, y: 0 });
        };
        if (!this.revealDone) {
            setTimeout(reveal, 2000); // Fail-safe reveal
            this.revealDone = true;
        }

        if (this.gameState.gameStatus === 'playing') {
            const myId = this.socket?.id || this.playerId;
            const myPlayer = this.gameState.players.find(p => p.id === myId || p.reconnectToken === this.reconnectToken);
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
            if (this.ui.startGameBtn) this.ui.startGameBtn.style.display = 'none';

            const currentPlayerName = this.gameState.players[this.gameState.currentPlayerIndex]?.name || "Someone";
            this.ui.actionText.textContent = `Spectating. Current Turn: ${currentPlayerName}`;
            this.ui.currentScoreDisplay.textContent = `Round Score: ${this.gameState.roundAccumulatedScore}`;
            return;
        }

        if (this.gameState.gameStatus === 'waiting') {
            this.ui.currentScoreDisplay.textContent = "Waiting for players...";
            this.ui.rollBtn.style.display = 'none';
            this.ui.bankBtn.style.display = 'none';

            const startBtn = this.ui.startGameBtn;
            if (startBtn) {
                startBtn.style.display = 'inline-flex';
                startBtn.textContent = 'START GAME';

                const connectedPlayers = this.gameState.players.filter(p => p.connected);
                if (connectedPlayers.length >= 2) {
                    startBtn.disabled = false;
                    startBtn.classList.add('pulse');
                    this.ui.actionText.textContent = "Lobby Ready! Start Game?";
                    this.ui.currentScoreDisplay.textContent = "";

                } else {
                    startBtn.disabled = true;
                    startBtn.classList.remove('pulse');
                    this.ui.actionText.textContent = `Need ${2 - connectedPlayers.length} more`;
                    this.ui.currentScoreDisplay.textContent = "Waiting for players...";
                }
            }
            return;
        }

        // --- Game Actions Panel (formerly Debug) ---
        let debugPanel = document.getElementById('game-controls-panel');
        if (!debugPanel && this.ui.bankBtn.parentElement && this.ui.bankBtn.parentElement.parentElement) {
            debugPanel = document.createElement('div');
            debugPanel.id = 'game-controls-panel';
            debugPanel.className = 'tools-panel';

            const forceBtn = document.createElement('button');
            forceBtn.id = 'force-next-action-btn';
            forceBtn.className = 'btn micro';
            forceBtn.textContent = 'Force Next';

            const restartBtn = document.createElement('button');
            restartBtn.id = 'force-reset-action-btn';
            restartBtn.className = 'btn micro';
            restartBtn.textContent = 'Reset';

            debugPanel.appendChild(forceBtn);
            debugPanel.appendChild(restartBtn);
            this.ui.bankBtn.parentElement.parentElement.appendChild(debugPanel);
        }

        if (debugPanel) {
            debugPanel.style.display = 'block'; // Always show now
            const forceBtn = document.getElementById('force-next-action-btn');
            const restartBtn = document.getElementById('force-reset-action-btn');

            // Add null checks before manipulating buttons
            if (!forceBtn || !restartBtn) {
                console.warn('Voting buttons not found in DOM');
                return;
            }

            const activeVote = this.gameState.activeVote;

            // Handle Force Next Button
            if (activeVote && activeVote.type === 'next') {
                const voted = activeVote.voters.includes(this.socket.id);
                forceBtn.textContent = voted ? `Next (${activeVote.count}/${activeVote.needed})` : `Vote Next (${activeVote.count}/${activeVote.needed})`;
                forceBtn.classList.toggle('active', voted);
                forceBtn.onclick = () => {
                    if (!voted) this.socket.emit('cast_vote', { roomCode: this.roomCode });
                };
            } else {
                forceBtn.textContent = 'Force Next';
                forceBtn.classList.remove('active');
                forceBtn.onclick = () => {
                    this.socket.emit('start_vote', { roomCode: this.roomCode, type: 'next' });
                };
            }

            // Handle Reset Button
            if (activeVote && activeVote.type === 'reset') {
                const voted = activeVote.voters.includes(this.socket.id);
                restartBtn.textContent = voted ? `Reset (${activeVote.count}/${activeVote.needed})` : `Vote Reset (${activeVote.count}/${activeVote.needed})`;
                restartBtn.classList.toggle('active', voted);
                restartBtn.onclick = () => {
                    if (!voted) this.socket.emit('cast_vote', { roomCode: this.roomCode });
                };
            } else {
                restartBtn.textContent = 'Reset';
                restartBtn.classList.remove('active');
                restartBtn.onclick = () => {
                    if (confirm("Start vote to reset game?")) {
                        this.socket.emit('start_vote', { roomCode: this.roomCode, type: 'reset' });
                    }
                };
            }
        }

        if (this.ui.startGameBtn) this.ui.startGameBtn.style.display = 'none';

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
            if (winner === 'tie') {
                title = "It's a Tie!";
            } else if (winner) {
                title = `${winner.name} Wins!`;
                if (this.announcer) this.announcer.say('win');
            }
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

        // iOS Style Notification
        if (!data.isSystem && data.sender !== this.playerName) {
            const isPanelHidden = !this.ui.chatPanel || this.ui.chatPanel.classList.contains('hidden');
            if (isPanelHidden) {
                this.showChatNotification(data);
            }
        }
    }

    showChatNotification(data) {
        if (!this.ui.chatNotifications) return;

        const notif = document.createElement('div');
        notif.className = 'chat-notification';

        const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        notif.innerHTML = `
            <div class="notification-header">
                <span class="notification-author">${data.sender}</span>
                <span class="notification-time">${now}</span>
            </div>
            <div class="notification-body">${data.message}</div>
        `;

        notif.onclick = () => {
            if (this.ui.chatPanel) {
                this.ui.chatPanel.classList.remove('hidden');
                this.ui.chatInput.focus();
            }
            notif.classList.add('outgoing');
            setTimeout(() => notif.remove(), 400);
        };

        this.ui.chatNotifications.appendChild(notif);
        this.sounds.play('msg');

        // Auto remove
        setTimeout(() => {
            if (notif.parentElement) {
                notif.classList.add('outgoing');
                setTimeout(() => notif.remove(), 400);
            }
        }, 5000);
    }

    async showStats() {
        if (!this.ui.statsModal || !this.ui.statsContent) return;

        this.ui.statsModal.classList.remove('hidden');
        this.ui.statsContent.innerHTML = '<p style="text-align: center; color: var(--text-muted);">Loading statistics...</p>';

        try {
            const response = await fetch('/api/stats/leaderboard');
            if (!response.ok) throw new Error('Failed to fetch stats');

            const stats = await response.json();

            if (!stats || stats.length === 0) {
                this.ui.statsContent.innerHTML = '<p style="text-align: center; color: var(--text-muted);">No stats available yet. Play some games!</p>';
                return;
            }

            let html = '<table style="width: 100%; border-collapse: collapse;">';
            html += '<thead><tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">';
            html += '<th style="padding: 0.75rem; text-align: left; color: var(--primary);">Player</th>';
            html += '<th style="padding: 0.75rem; text-align: center; color: var(--primary);">Wins</th>';
            html += '<th style="padding: 0.75rem; text-align: center; color: var(--primary);">Games</th>';
            html += '<th style="padding: 0.75rem; text-align: center; color: var(--primary);">Win %</th>';
            html += '<th style="padding: 0.75rem; text-align: right; color: var(--primary);">High Score</th>';
            html += '</tr></thead><tbody>';

            stats.forEach((player, idx) => {
                const winRate = player.gamesPlayed > 0 ? Math.round((player.wins / player.gamesPlayed) * 100) : 0;
                html += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">`;
                html += `<td style="padding: 0.75rem; font-weight: 600;">${idx + 1}. ${player.name || 'Anonymous'}</td>`;
                html += `<td style="padding: 0.75rem; text-align: center; color: var(--success);">${player.wins}</td>`;
                html += `<td style="padding: 0.75rem; text-align: center;">${player.gamesPlayed}</td>`;
                html += `<td style="padding: 0.75rem; text-align: center;">${winRate}%</td>`;
                html += `<td style="padding: 0.75rem; text-align: right; color: var(--accent);">${player.highestScore?.toLocaleString() || 0}</td>`;
                html += `</tr>`;
            });

            html += '</tbody></table>';
            this.ui.statsContent.innerHTML = html;
        } catch (e) {
            console.error('Failed to load stats:', e);
            this.ui.statsContent.innerHTML = '<p style="text-align: center; color: var(--danger);">Failed to load statistics. Try again later.</p>';
        }
    }

    createBackgroundEffects() {
        const container = document.getElementById('bg-dice-container');
        if (!container) return;

        // Create Stars
        for (let i = 0; i < 50; i++) {
            const star = document.createElement('div');
            star.className = 'bg-particle';
            const size = Math.random() * 3 + 1;
            star.style.width = `${size}px`;
            star.style.height = `${size}px`;
            star.style.left = `${Math.random() * 100}%`;
            star.style.top = `${Math.random() * 100}%`;
            star.style.animationDelay = `${Math.random() * 5}s`;
            star.style.animationDuration = `${Math.random() * 3 + 2}s`;
            container.appendChild(star);
        }

        // Create Floating Dice Outlines
        const diceChars = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
        for (let i = 0; i < 15; i++) {
            const die = document.createElement('div');
            die.className = 'bg-die';
            die.textContent = diceChars[Math.floor(Math.random() * diceChars.length)];
            die.style.left = `${Math.random() * 100}%`;
            die.style.fontSize = `${Math.random() * 20 + 20}px`;
            die.style.animationDuration = `${Math.random() * 10 + 10}s`;
            die.style.animationDelay = `${Math.random() * 10}s`;
            die.style.opacity = (Math.random() * 0.1 + 0.05).toString();
            container.appendChild(die);
        }
    }

    createDebugPanel() {
        // Disabled to prevent "Performance Notice" overlay
        this.debugPanel = null;
    }

    addDebugMessage(msg) {
        try {
            if (!this.debugPanel) {
                console.log(`[SYSTEM] ${msg}`);
                return;
            }
            const line = document.createElement('div');
            line.style.cssText = `
                margin-bottom: 2px;
                opacity: 0.9;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                animation: fadeIn 0.3s ease-out;
            `;
            line.textContent = `> ${msg}`;

            // Keep only last 4 messages for minimalism
            while (this.debugPanel.children.length >= 4) {
                this.debugPanel.removeChild(this.debugPanel.firstChild);
            }

            this.debugPanel.appendChild(line);
            console.log(`[SYSTEM] ${msg}`);
        } catch (e) {
            console.error('Failed to add debug message:', e);
        }
    }

    shakeScreen(intensity = 10, duration = 0.5) {
        if (!this.ui.app) return;
        gsap.to(this.ui.app, {
            x: `random(-${intensity}, ${intensity})`,
            y: `random(-${intensity}, ${intensity})`,
            duration: 0.05,
            repeat: Math.floor(duration / 0.05),
            yoyo: true,
            onComplete: () => {
                gsap.set(this.ui.app, { x: 0, y: 0 });
            }
        });
    }
}

class SoundManager {
    constructor() {
        this.ctx = null;
        this.enabled = true;
        this.masterVolume = 0.25;
        this.masterGain = null;
        this.reverbNode = null;

        const unlock = () => {
            if (this.ctx) return;
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = this.masterVolume;
            this.masterGain.connect(this.ctx.destination);

            this.setupReverb();
            if (this.ctx.state === 'suspended') this.ctx.resume();

            window.removeEventListener('click', unlock);
            window.removeEventListener('keydown', unlock);
        };
        window.addEventListener('click', unlock);
        window.addEventListener('keydown', unlock);
    }

    async setupReverb() {
        if (!this.ctx) return;
        this.reverbNode = this.ctx.createConvolver();
        const length = this.ctx.sampleRate * 2.0;
        const buffer = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
        for (let i = 0; i < 2; i++) {
            const data = buffer.getChannelData(i);
            for (let j = 0; j < length; j++) {
                data[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / length, 2.0);
            }
        }
        this.reverbNode.buffer = buffer;
        const reverbGain = this.ctx.createGain();
        reverbGain.gain.value = 0.3;
        this.reverbNode.connect(reverbGain);
        reverbGain.connect(this.masterGain);
    }

    updateGain() {
        if (!this.ctx || !this.masterGain) return;
        const target = this.enabled ? this.masterVolume : 0;
        this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
    }

    setVolume(vol) {
        this.masterVolume = vol;
        this.updateGain();
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        this.updateGain();
    }

    play(name) {
        if (!this.enabled || !this.ctx) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();
        this.updateGain(); // Ensure gain is synced before playing

        const now = this.ctx.currentTime;

        // Helper to get master destination (Dry + Reverb)
        const connect = (node) => {
            const master = this.ctx.createGain();
            master.gain.value = this.masterVolume;
            node.connect(master);
            master.connect(this.ctx.destination);
            if (this.reverbNode) node.connect(this.reverbNode);
            return master;
        };

        switch (name) {
            case 'click':
                this.playTone({ freq: 880, dur: 0.1, type: 'sine', attack: 0.005, decay: 0.05, vol: 0.2 });
                break;
            case 'hover':
                this.playTone({ freq: 440, dur: 0.08, type: 'sine', attack: 0.005, decay: 0.03, vol: 0.05 });
                break;
            case 'select':
                this.playTone({ freq: 550, dur: 0.1, type: 'sine', attack: 0.005, decay: 0.05, vol: 0.15 });
                break;
            case 'roll':
                this.playNoise({ dur: 0.4, vol: 0.1, low: 100, high: 600, sweep: true });
                break;
            case 'bank':
                this.playSweep({ start: 330, end: 660, dur: 0.4, attack: 0.05, decay: 0.3, vol: 0.2 });
                break;
            case 'farkle':
                this.playSweep({ start: 220, end: 110, dur: 0.8, attack: 0.1, decay: 0.7, vol: 0.2 });
                break;
            case 'success':
                this.playArp({ freqs: [440, 554, 659], interval: 0.05, vol: 0.2, dur: 0.3 });
                break;
            case 'hot_dice':
                this.playArp({ freqs: [659, 880, 1108, 1318], interval: 0.04, vol: 0.2, dur: 0.4 });
                break;
            case 'menu_open':
                this.playTone({ freq: 220, dur: 0.2, type: 'sine', attack: 0.05, decay: 0.1, vol: 0.1 });
                break;
            case 'msg':
                this.playArp({ freqs: [880, 1108], interval: 0.06, vol: 0.2, dur: 0.3 });
                break;
        }
    }

    playTone({ freq, dur, type = 'sine', attack = 0.01, decay = 0.1, vol = 1 }) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        gain.gain.setValueAtTime(0, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + attack);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + attack + decay);

        osc.connect(gain);
        this.connectToMaster(gain);

        osc.start();
        osc.stop(this.ctx.currentTime + attack + decay + 0.1);
    }

    playSweep({ start, end, dur, attack = 0.05, decay = 0.2, vol = 1, type = 'sine' }) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(start, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(end, this.ctx.currentTime + dur);

        gain.gain.setValueAtTime(0, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + attack);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + attack + decay);

        osc.connect(gain);
        this.connectToMaster(gain);

        osc.start();
        osc.stop(this.ctx.currentTime + dur + 0.1);
    }

    playNoise({ dur, vol, low = 100, high = 1000, sweep = false }) {
        const bufferSize = this.ctx.sampleRate * dur;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(high, this.ctx.currentTime);
        if (sweep) {
            filter.frequency.exponentialRampToValueAtTime(low, this.ctx.currentTime + dur);
        }

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);

        noise.connect(filter);
        filter.connect(gain);
        this.connectToMaster(gain);

        noise.start();
        noise.stop(this.ctx.currentTime + dur);
    }

    playChord({ freqs, dur, vol = 1, attack = 0.1 }) {
        freqs.forEach(f => {
            this.playTone({ freq: f, dur: dur, type: 'sine', attack: attack, decay: dur - attack, vol: vol / freqs.length });
        });
    }

    playArp({ freqs, interval, vol = 1, dur = 0.2 }) {
        freqs.forEach((f, i) => {
            setTimeout(() => {
                if (!this.ctx) return;
                this.playTone({ freq: f, dur: dur, type: 'sine', attack: 0.05, decay: dur, vol: vol });
            }, i * interval * 1000);
        });
    }

    connectToMaster(node) {
        if (!this.ctx || !this.masterGain) return;
        node.connect(this.masterGain);
        if (this.reverbNode) node.connect(this.reverbNode);
    }

    toggle() {
        this.setEnabled(!this.enabled);
        return this.enabled;
    }
}

class VirtualHost {
    constructor(client) {
        this.client = client;
        this.bubble = document.getElementById('host-bubble');
        this.messageEl = document.getElementById('host-message');
        this.quips = {
            start: ["Place your bets!", "Good luck, you'll need it.", "Rolling for glory!", "Let's see what you've got."],
            hot_dice: ["Hot dice! Keep 'em coming!", "You're on fire!", "Fantastic roll!", "UNBELIEVABLE!"],
            farkle: ["OH NO! A FARKLE!", "Ouch, that's a cold roll.", "And just like that, it's gone.", "Better luck next time..."],
            bank: ["Playing it safe, I see.", "Wise choice.", "Adding to the stash!", "A solid gain."],
            turn_start: ["Your turn! Don't mess it up.", "Show them how it's done.", "Ready to roll?"],
            win: ["WE HAVE A WINNER!", "Legendary performance!", "What a game!", "A new champion!"]
        };
        this.activeTimeout = null;
    }

    say(type) {
        if (!this.quips[type]) return;
        const list = this.quips[type];
        const msg = list[Math.floor(Math.random() * list.length)];
        this.show(msg);
    }

    show(text) {
        if (!this.bubble || !this.messageEl) return;
        if (this.activeTimeout) clearTimeout(this.activeTimeout);
        this.messageEl.textContent = text;
        this.bubble.classList.add('visible');
        this.activeTimeout = setTimeout(() => {
            this.bubble.classList.remove('visible');
        }, 5000);
    }
}

class Dice3DManager {
    constructor(container, client) {
        if (!container) return;
        this.container = container;
        this.client = client;
        this.diceObjects = [];
        this.isRunning = false;
        this.isSpeed = false; // Default speed
        this.palette = ["#EAA14D", "#E05A47", "#4D9BEA", "#5FB376", "#D869A8", "#F2C94C", "#9B51E0", "#FFFFFF"];
        this.faceNormals = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
        this.faceValues = [1, 6, 2, 5, 3, 4];

        // --- Cache System ---
        this.sharedGeometry = new RoundedBoxGeometry(2.2, 2.2, 2.2, 4, 0.4);
        this.materialCache = new Map();

        this.init();
    }

    generateFeltTexture(color) {
        const size = 512;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Fill base color
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, size, size);

        // Add noise/texture
        for (let i = 0; i < 50000; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const alpha = Math.random() * 0.05;
            ctx.fillStyle = `rgba(0,0,0,${alpha})`;
            ctx.fillRect(x, y, 1, 1);
        }

        // Add spotlight center glow
        const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        gradient.addColorStop(0, 'rgba(255,255,255,0.1)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        return tex;
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

        // --- ACTUAL TABLE MODEL ---
        // Floor (The Felt)
        const floorMat = new CANNON.Material();
        const floorBody = new CANNON.Body({ mass: 0, material: floorMat });
        floorBody.addShape(new CANNON.Plane());
        floorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
        this.world.addBody(floorBody);

        // Visual Table Base (The Wood)
        const tableBaseGeom = new THREE.CylinderGeometry(15, 16, 2, 64);
        const tableBaseMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.9,
            metalness: 0.1
        });
        const tableBase = new THREE.Mesh(tableBaseGeom, tableBaseMat);
        tableBase.position.y = -1.1;
        this.scene.add(tableBase);

        // Visual Felt
        const feltGeom = new THREE.CircleGeometry(14.8, 64);
        this.feltMat = new THREE.MeshStandardMaterial({
            color: 0x1a3a2a,
            map: this.generateFeltTexture('#1a3a2a'),
            roughness: 1,
            metalness: 0
        });
        this.feltMesh = new THREE.Mesh(feltGeom, this.feltMat);
        this.feltMesh.rotation.x = -Math.PI / 2;
        this.feltMesh.position.y = 0.01;
        this.scene.add(this.feltMesh);

        // Decorative Rail
        const railGeom = new THREE.TorusGeometry(15, 0.8, 16, 100);
        const railMat = new THREE.MeshStandardMaterial({
            color: 0x444444,
            roughness: 0.3,
            metalness: 0.8
        });
        const rail = new THREE.Mesh(railGeom, railMat);
        rail.rotation.x = Math.PI / 2;
        rail.position.y = 0.5;
        this.scene.add(rail);

        // Walls (Physics)
        const wallMat = new CANNON.Material();
        const createWall = (x, z, rot) => {
            const body = new CANNON.Body({ mass: 0, material: wallMat });
            body.addShape(new CANNON.Plane());
            body.position.set(x, 0, z);
            body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rot);
            this.world.addBody(body);
        };
        createWall(14, 0, -Math.PI / 2); createWall(-14, 0, Math.PI / 2);
        createWall(0, -14, 0); createWall(0, 14, Math.PI);

        this.diceMat = new CANNON.Material();
        this.world.addContactMaterial(new CANNON.ContactMaterial(floorMat, this.diceMat, { friction: 0.2, restitution: 0.4 }));
        this.world.addContactMaterial(new CANNON.ContactMaterial(wallMat, this.diceMat, { friction: 0.1, restitution: 0.6 }));

        // --- ENHANCED LIGHTING ---
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));

        // Spotlights for dramatic table effect
        this.spotLight = new THREE.SpotLight(0xffffff, 1.8);
        this.spotLight.position.set(0, 35, 0);
        this.spotLight.angle = Math.PI / 4.5;
        this.spotLight.penumbra = 0.4;
        this.spotLight.decay = 1.2;
        this.spotLight.distance = 120;
        this.scene.add(this.spotLight);

        const fill = new THREE.DirectionalLight(0x4deaff, 0.4);
        fill.position.set(25, 15, 25);
        this.scene.add(fill);

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
            if (this.client && this.client.sounds) this.client.sounds.play('roll');

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

            // Add collision sound
            body.addEventListener('collide', (e) => {
                const relativeVelocity = e.contact.getImpactVelocityAlongNormal();
                if (relativeVelocity > 2) { // Only play if impact is strong enough
                    if (this.client && this.client.sounds) {
                        this.client.sounds.play('dice_hit');
                    }
                }
            });

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

        // Suble spotlight pulse for immersion
        if (this.spotLight) {
            this.spotLight.intensity = 1.6 + Math.sin(Date.now() * 0.0015) * 0.2;
        }

        // Performance optimization: only render and simulate if running OR we need to render one final frame
        if (this.isRunning) {
            this.world.step(1 / 60);
            this.diceObjects.forEach(obj => {
                obj.mesh.position.copy(obj.body.position);
                obj.mesh.quaternion.copy(obj.body.quaternion);
            });
            this.checkStopped();
            this.renderer.render(this.scene, this.camera);
            this.needsRender = true;
        } else if (this.needsRender) {
            // Render one final frame after stopping to ensure everything is aligned
            this.renderer.render(this.scene, this.camera);
            this.needsRender = false;
        }
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

// Wait for DOM to be fully loaded before initializing
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        try {
            window.farkle = new FarkleClient();
        } catch (e) {
            console.error('Failed to initialize Farkle Client:', e);
            const errorEl = document.getElementById('global-error-display');
            if (errorEl) {
                errorEl.style.display = 'block';
                errorEl.textContent = `Critical error: ${e.message}\n\nPlease refresh the page.`;
            }
        }
    });
} else {
    // DOM already loaded
    try {
        window.farkle = new FarkleClient();
    } catch (e) {
        console.error('Failed to initialize Farkle Client:', e);
        const errorEl = document.getElementById('global-error-display');
        if (errorEl) {
            errorEl.style.display = 'block';
            errorEl.textContent = `Critical error: ${e.message}\n\nPlease refresh the page.`;
        }
    }
}
