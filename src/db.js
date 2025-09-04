// src/db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// points to /data/responses.db at repo root
const dbPath = path.join(__dirname, '..', 'data', 'responses.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // tables
    db.run(`
        CREATE TABLE IF NOT EXISTS responses (
                                                 user_id   TEXT PRIMARY KEY,
                                                 topics    TEXT,
                                                 timestamp TEXT
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS users (
                                             user_id    TEXT PRIMARY KEY,
                                             name       TEXT,
                                             country    TEXT,
                                             consent    INTEGER DEFAULT 0,
                                             status     TEXT    DEFAULT 'new',
                                             match_pref TEXT,                 -- preferred match: '1:1' | 'group'
                                             created_at TEXT,
                                             updated_at TEXT
        )
    `);

    // migration: add match_pref if table already existed without it
    db.run(`ALTER TABLE users ADD COLUMN match_pref TEXT`, [], (err) => {
        if (err && !/duplicate column name/i.test(err.message)) {
            console.warn('ALTER TABLE users ADD COLUMN match_pref failed:', err.message);
        }
    });
});

// -------- responses --------
function saveResponse(userId, topics) {
    return new Promise((resolve, reject) => {
        const ts = new Date().toISOString();
        const csv = Array.isArray(topics) ? topics.join(',') : String(topics || '');
        db.run(
            `INSERT INTO responses (user_id, topics, timestamp)
             VALUES (?, ?, ?)
                 ON CONFLICT(user_id)
       DO UPDATE SET topics=excluded.topics, timestamp=excluded.timestamp`,
            [userId, csv, ts],
            function (err) {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

function getAllResponses() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM responses`, [], (err, rows) => {
            if (err) return reject(err);
            const mapped = (rows || []).map(r => {
                const list = String(r.topics || '')
                    .split(',')
                    .map(t => t.trim())
                    .filter(Boolean);
                return {
                    userId: r.user_id,
                    topics: list,
                    timestamp: r.timestamp
                };
            });
            resolve(mapped);
        });
    });
}

function clearResponses() {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM responses`, [], function (err) {
            if (err) reject(err);
            else resolve();
        });
    });
}

// -------- users --------
function saveUser(userId, name, consent, status) {
    return new Promise((resolve, reject) => {
        const ts = new Date().toISOString();
        db.run(
            `INSERT INTO users (user_id, name, consent, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(user_id)
       DO UPDATE SET
                name=excluded.name,
                               consent=excluded.consent,
                               status=excluded.status,
                               updated_at=excluded.updated_at`,
            [userId, name, consent ? 1 : 0, status, ts, ts],
            function (err) {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

function getUser(userId) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM users WHERE user_id = ?`, [userId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function setUserStatus(userId, status) {
    return new Promise((resolve, reject) => {
        const ts = new Date().toISOString();
        db.run(
            `UPDATE users SET status = ?, updated_at = ? WHERE user_id = ?`,
            [status, ts, userId],
            function (err) {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

function updateUserCountry(userId, country) {
    return new Promise((resolve, reject) => {
        const ts = new Date().toISOString();
        db.run(
            `UPDATE users SET country = ?, updated_at = ? WHERE user_id = ?`,
            [country, ts, userId],
            function (err) {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

/**
 * Save user's match preference.
 * @param {string} userId
 * @param {'1:1'|'group'} pref
 */
function updateUserMatchPreference(userId, pref) {
    const normalized =
        pref === '1:1' ? '1:1' :
            pref === 'group' ? 'group' :
                'group'; // default fallback

    return new Promise((resolve, reject) => {
        const ts = new Date().toISOString();
        db.run(
            `UPDATE users SET match_pref = ?, updated_at = ? WHERE user_id = ?`,
            [normalized, ts, userId],
            function (err) {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

function getAllUsers() {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT user_id, name, consent, status, country, match_pref, created_at, updated_at FROM users`,
            [],
            (err, rows) => (err ? reject(err) : resolve(rows))
        );
    });
}

module.exports = {
    // responses
    saveResponse,
    getAllResponses,
    clearResponses,
    // users
    saveUser,
    getUser,
    setUserStatus,
    updateUserCountry,
    updateUserMatchPreference,
    getAllUsers
};
