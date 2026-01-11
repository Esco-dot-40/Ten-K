import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === 'production';
const connectionString = process.env.DATABASE_URL;

// Fallback for local development if no DB URL is present?
// For now, we assume user provides it or we log error.
if (!connectionString) {
    console.warn("WARNING: DATABASE_URL is not set. Database features will fail.");
}

const pool = new Pool({
    connectionString,
    ssl: isProduction ? { rejectUnauthorized: false } : false
});

// Init Tables
const initDB = async () => {
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
        console.log("Database initialized successfully.");
    } catch (err) {
        console.error("Failed to initialize database:", err);
    }
};

if (connectionString) {
    initDB();
}

export const db = {
    // Basic Query wrapper
    query: (text, params) => pool.query(text, params),

    upsertUser: async (userData) => {
        const displayName = userData.global_name || userData.username;
        const now = new Date();

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

        try {
            const res = await pool.query(query, [userData.id, userData.username, displayName, userData.avatar, now]);

            // Ensure stats row exists
            await pool.query(`INSERT INTO user_stats (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userData.id]);

            const stats = await pool.query(`SELECT * FROM user_stats WHERE user_id = $1`, [userData.id]);
            return { ...res.rows[0], stats: stats.rows[0] };
        } catch (e) {
            console.error("upsertUser Error", e);
            throw e;
        }
    },

    getUser: async (id) => {
        try {
            const userRes = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
            if (userRes.rows.length === 0) return null;

            const statsRes = await pool.query(`SELECT * FROM user_stats WHERE user_id = $1`, [id]);
            return { ...userRes.rows[0], stats: statsRes.rows[0] };
        } catch (e) {
            console.error("getUser Error", e);
            return null;
        }
    },

    recordGameEnd: async (userId, isWin, score, maxRoundScore, farkles) => {
        try {
            // Ensure stats row exists (just in case)
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
        } catch (e) {
            console.error("recordGameEnd Error", e);
        }
    },

    getLeaderboard: async () => {
        try {
            const res = await pool.query(`
                SELECT u.username, u.display_name, u.avatar, s.wins, s.total_score, s.highest_round_score
                FROM user_stats s
                JOIN users u ON s.user_id = u.id
                ORDER BY s.wins DESC, s.total_score DESC
                LIMIT 20
            `);
            return res.rows;
        } catch (e) {
            console.error("getLeaderboard Error", e);
            return [];
        }
    }
};

// Aliases
export const database = db;
