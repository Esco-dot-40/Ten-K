import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === 'production';
const connectionString = process.env.DATABASE_URL;

let pool = null;
let sqliteDb = null;
try {
    const Database = (await import('better-sqlite3')).default;
    sqliteDb = new Database('farkle.db');
    sqliteDb.pragma('journal_mode = WAL');
    console.log("SQLite loaded successfully.");
} catch (e) {
    console.warn("SQLite could not be loaded (likely missing build tools). Falling back to memory or Postgres only.");
}
let dbType = 'none'; // 'postgres', 'sqlite', 'none'

const init = async () => {
    // 1. Try Postgres if URL exists
    if (connectionString) {
        try {
            console.log("Attempting to connect to PostgreSQL...");
            const testPool = new Pool({
                connectionString,
                ssl: isProduction ? { rejectUnauthorized: false } : false,
                connectionTimeoutMillis: 5000 // 5s timeout
            });
            // Simple query to test connection
            await testPool.query('SELECT 1');
            console.log("Connected to PostgreSQL successfully.");
            pool = testPool;
            dbType = 'postgres';
        } catch (e) {
            console.warn("PostgreSQL connection failed (likely internal URL or network issue).");
            console.warn("Error:", e.message);
        }
    } else {
        console.log("No DATABASE_URL provided.");
    }

    // 2. Fallback to SQLite if Postgres failed or not provided
    if (dbType !== 'postgres' && sqliteDb) {
        dbType = 'sqlite';
        console.log("Using SQLite fallback.");
    } else if (dbType !== 'postgres' && !sqliteDb) {
        console.error("CRITICAL: No database available (Postgres failed and SQLite not loaded).");
    }

    // 3. Initialize Tables
    await initDB();
};


// Init Tables
const initDB = async () => {
    if (dbType === 'postgres') {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id VARCHAR(255) PRIMARY KEY,
                    username VARCHAR(255),
                    display_name VARCHAR(255),
                    avatar VARCHAR(255),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_login TIMESTAMP
                );
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS user_stats (
                    user_id VARCHAR(255) PRIMARY KEY,
                    games_played INTEGER DEFAULT 0,
                    wins INTEGER DEFAULT 0,
                    total_score INTEGER DEFAULT 0,
                    highest_round_score INTEGER DEFAULT 0,
                    farkles_count INTEGER DEFAULT 0,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );
            `);
            // console.log("Postgres Tables Initialized");
        } catch (err) {
            console.error("Failed to initialize Postgres tables:", err);
        }
    } else if (dbType === 'sqlite') {
        try {
            sqliteDb.prepare(`
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT,
                    display_name TEXT,
                    avatar TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_login DATETIME
                )
            `).run();

            sqliteDb.prepare(`
                CREATE TABLE IF NOT EXISTS user_stats (
                    user_id TEXT PRIMARY KEY,
                    games_played INTEGER DEFAULT 0,
                    wins INTEGER DEFAULT 0,
                    total_score INTEGER DEFAULT 0,
                    highest_round_score INTEGER DEFAULT 0,
                    farkles_count INTEGER DEFAULT 0,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `).run();
            // console.log("SQLite Tables Initialized");
        } catch (err) {
            console.error("Failed to initialize SQLite tables:", err);
        }
    }
};

// Start Initialization
init();

export const db = {
    // Basic Query wrapper
    query: async (text, params = []) => {
        if (dbType === 'postgres') {
            return pool.query(text, params);
        } else if (dbType === 'sqlite') {
            // Convert $1, $2 to ? for SQLite
            // This is a naive conversion, relies on simple queries
            const sql = text.replace(/\$\d+/g, '?');
            const stmt = sqliteDb.prepare(sql);

            // Guess if it's a SELECT or modifying query based on first word
            const isSelect = /^\s*SELECT/i.test(sql) || /RETURNING/i.test(sql);

            try {
                if (isSelect) {
                    const rows = stmt.all(params);
                    return { rows, rowCount: rows.length };
                } else {
                    const info = stmt.run(params);
                    return { rows: [], rowCount: info.changes };
                }
            } catch (e) {
                console.error("SQLite Query Error:", e);
                throw e;
            }
        }
        return { rows: [], rowCount: 0 };
    },

    upsertUser: async (userData) => {
        const displayName = userData.global_name || userData.username;
        const now = new Date(); // Postgres uses object, SQLite needs string usually, but better-sqlite3 handles Date objects if acceptable or we convert.
        // better-sqlite3 binds Date as string if likely, or we can use ISO string.
        const nowISO = now.toISOString();

        try {
            if (dbType === 'postgres') {
                const query = `
                    INSERT INTO users (id, username, display_name, avatar, last_login)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (id) DO UPDATE SET
                        username = EXCLUDED.username,
                        display_name = EXCLUDED.display_name,
                        avatar = EXCLUDED.avatar,
                        last_login = EXCLUDED.last_login
                    RETURNING *
                `;
                const res = await pool.query(query, [userData.id, userData.username, displayName, userData.avatar, now]);

                // Ensure stats row exists
                await pool.query(`INSERT INTO user_stats (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userData.id]);

                const stats = await pool.query(`SELECT * FROM user_stats WHERE user_id = $1`, [userData.id]);
                return { ...res.rows[0], stats: stats.rows[0] };

            } else if (dbType === 'sqlite') {
                const query = `
                    INSERT INTO users (id, username, display_name, avatar, last_login)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        username = excluded.username,
                        display_name = excluded.display_name,
                        avatar = excluded.avatar,
                        last_login = excluded.last_login
                    RETURNING *
                `;
                const stmt = sqliteDb.prepare(query);
                const userRow = stmt.get(userData.id, userData.username, displayName, userData.avatar, nowISO);

                // Ensure stats
                sqliteDb.prepare(`INSERT OR IGNORE INTO user_stats (user_id) VALUES (?)`).run(userData.id);

                const statsRow = sqliteDb.prepare(`SELECT * FROM user_stats WHERE user_id = ?`).get(userData.id);
                return { ...userRow, stats: statsRow };
            }
        } catch (e) {
            console.error("upsertUser Error", e);
            throw e;
        }
    },

    getUser: async (id) => {
        try {
            if (dbType === 'postgres') {
                const userRes = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
                if (userRes.rows.length === 0) return null;
                const statsRes = await pool.query(`SELECT * FROM user_stats WHERE user_id = $1`, [id]);
                return { ...userRes.rows[0], stats: statsRes.rows[0] };
            } else if (dbType === 'sqlite') {
                const userRow = sqliteDb.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
                if (!userRow) return null;
                const statsRow = sqliteDb.prepare(`SELECT * FROM user_stats WHERE user_id = ?`).get(id);
                return { ...userRow, stats: statsRow };
            }
        } catch (e) {
            console.error("getUser Error", e);
            return null;
        }
    },

    recordGameEnd: async (userId, isWin, score, maxRoundScore, farkles) => {
        try {
            if (dbType === 'postgres') {
                await pool.query(`INSERT INTO user_stats (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
                await pool.query(`
                    UPDATE user_stats SET 
                        games_played = games_played + 1,
                        wins = wins + $1,
                        total_score = total_score + $2,
                        highest_round_score = GREATEST(highest_round_score, $3),
                        farkles_count = farkles_count + $4
                    WHERE user_id = $5
                `, [isWin ? 1 : 0, score, maxRoundScore, farkles, userId]);
            } else if (dbType === 'sqlite') {
                sqliteDb.prepare(`INSERT OR IGNORE INTO user_stats (user_id) VALUES (?)`).run(userId);
                sqliteDb.prepare(`
                    UPDATE user_stats SET 
                        games_played = games_played + 1,
                        wins = wins + ?,
                        total_score = total_score + ?,
                        highest_round_score = MAX(highest_round_score, ?),
                        farkles_count = farkles_count + ?
                    WHERE user_id = ?
                `).run(isWin ? 1 : 0, score, maxRoundScore, farkles, userId);
            }
        } catch (e) {
            console.error("recordGameEnd Error", e);
        }
    },

    getLeaderboard: async () => {
        try {
            let rows = [];
            if (dbType === 'postgres') {
                const res = await pool.query(`
                    SELECT 
                        u.username, 
                        u.display_name, 
                        u.avatar, 
                        s.wins, 
                        s.games_played,
                        s.total_score, 
                        s.highest_round_score as highest_score
                    FROM user_stats s
                    JOIN users u ON s.user_id = u.id
                    WHERE s.games_played > 0
                    ORDER BY s.wins DESC, s.total_score DESC
                    LIMIT 50
                `);
                rows = res.rows;
            } else if (dbType === 'sqlite') {
                rows = sqliteDb.prepare(`
                    SELECT 
                        u.username, 
                        u.display_name, 
                        u.avatar, 
                        s.wins, 
                        s.games_played,
                        s.total_score, 
                        s.highest_round_score as highest_score
                    FROM user_stats s
                    JOIN users u ON s.user_id = u.id
                    WHERE s.games_played > 0
                    ORDER BY s.wins DESC, s.total_score DESC
                    LIMIT 50
                `).all();
            }

            return rows.map(row => ({
                name: row.display_name || row.username,
                wins: row.wins,
                gamesPlayed: row.games_played,
                highestScore: row.highest_score,
                totalScore: row.total_score
            }));
        } catch (e) {
            console.error("getLeaderboard Error", e);
            return [];
        }
    }
};

export const database = db;
