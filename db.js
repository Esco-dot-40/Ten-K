import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, 'users.json');

// Simple JSON DB to avoid PG dependency requirement for now
// Mimics a basic upsert
export const db = {
    upsertUser: async (userData) => {
        let users = {};
        try {
            if (fs.existsSync(DB_FILE)) {
                users = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            }
        } catch (e) { console.error("DB Load Error", e); }

        users[userData.id] = {
            uid: userData.id,
            display_name: userData.global_name || userData.username,
            username: userData.username,
            avatar: userData.avatar,
            created_at: users[userData.id]?.created_at || new Date().toISOString(),
            last_login: new Date().toISOString()
        };

        try {
            fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
        } catch (e) { console.error("DB Save Error", e); }

        return users[userData.id];
    },

    getUser: (id) => {
        try {
            if (fs.existsSync(DB_FILE)) {
                const users = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
                return users[id];
            }
        } catch (e) { return null; }
        return null;
    }
};
