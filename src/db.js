// src/db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// points to /data/responses.db at repo root
const dbPath = path.join(__dirname, '..', 'data', 'responses.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // -------- tables --------
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

    // rooms used for matches (to later archive)
    db.run(`
        CREATE TABLE IF NOT EXISTS match_rooms (
                                                   channel_id TEXT PRIMARY KEY,
                                                   created_at TEXT,
                                                   archived   INTEGER DEFAULT 0
        )
    `);

    // weekly check-ins
    db.run(`
        CREATE TABLE IF NOT EXISTS checkins (
                                                user_id          TEXT,
                                                week             TEXT,             -- e.g., 2025-09-02 (or your chosen key)
                                                connected        INTEGER,          -- 0/1
                                                will_participate INTEGER,          -- 0/1
                                                created_at       TEXT,
                                                updated_at       TEXT,
                                                PRIMARY KEY (user_id, week)
            )
    `);

    // unmatched participants per ISO-week bucket (e.g., Monday date "YYYY-MM-DD")
    db.run(`
    CREATE TABLE IF NOT EXISTS unmatched_participants (
      user_id     TEXT,
      week_bucket TEXT,
      created_at  TEXT,
      PRIMARY KEY (user_id, week_bucket)
    )
  `);

    db.run(`
  CREATE TABLE IF NOT EXISTS match_participants (
    channel_id TEXT,
    user_id    TEXT,
    PRIMARY KEY (channel_id, user_id)
  )
`);
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
            function (err) { if (err) reject(err); else resolve(); }
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
                return { userId: r.user_id, topics: list, timestamp: r.timestamp };
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

function clearUsers() {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM users`, [], function (err) {
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
            function (err) { if (err) reject(err); else resolve(); }
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

// -------- deletes / opt-out --------
/** Delete all responses for a user */
function deleteResponsesByUser(userId) {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM responses WHERE user_id = ?`, [userId], function (err) {
            if (err) reject(err);
            else resolve();
        });
    });
}

/** Delete user row from users */
function deleteUser(userId) {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM users WHERE user_id = ?`, [userId], function (err) {
            if (err) reject(err);
            else resolve();
        });
    });
}

/** Soft opt-out: marks as opted_out and removes consent (keeps user row) */
function softOptOutUser(userId) {
    return new Promise((resolve, reject) => {
        const ts = new Date().toISOString();
        db.run(
            `UPDATE users
             SET status = 'opted_out',
                 consent = 0,
                 updated_at = ?
             WHERE user_id = ?`,
            [ts, userId],
            function (err) {
                if (err) reject(err);
                else resolve();
            }
        );
    });
}

/** Atomic delete of user (responses + user row) */
function deleteUserCascade(userId) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            db.run(`DELETE FROM responses WHERE user_id = ?`, [userId], function (err) {
                if (err) {
                    db.run('ROLLBACK');
                    return reject(err);
                }
                db.run(`DELETE FROM users WHERE user_id = ?`, [userId], function (err2) {
                    if (err2) {
                        db.run('ROLLBACK');
                        return reject(err2);
                    }
                    db.run('COMMIT', (err3) => {
                        if (err3) return reject(err3);
                        resolve();
                    });
                });
            });
        });
    });
}

// -------- match rooms --------
function upsertMatchRoom(channelId) {
    return new Promise((resolve, reject) => {
        const ts = new Date().toISOString();
        db.run(
            `INSERT INTO match_rooms (channel_id, created_at, archived)
             VALUES (?, ?, 0)
                 ON CONFLICT(channel_id)
       DO UPDATE SET archived = 0`,
            [channelId, ts],
            function (err) { if (err) reject(err); else resolve(); }
        );
    });
}

function markRoomArchived(channelId) {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE match_rooms SET archived = 1 WHERE channel_id = ?`,
            [channelId],
            function (err) { if (err) reject(err); else resolve(); }
        );
    });
}

function getActiveRooms() {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT channel_id FROM match_rooms WHERE archived = 0`,
            [],
            (err, rows) => (err ? reject(err) : resolve((rows || []).map(r => r.channel_id)))
        );
    });
}

// -------- weekly check-ins --------
function upsertCheckinConnected(userId, week, connected) {
    return new Promise((resolve, reject) => {
        const ts = new Date().toISOString();
        db.run(
            `INSERT INTO checkins (user_id, week, connected, will_participate, created_at, updated_at)
             VALUES (?, ?, ?, NULL, ?, ?)
                 ON CONFLICT(user_id, week)
       DO UPDATE SET connected = excluded.connected, updated_at = excluded.updated_at`,
            [userId, week, connected ? 1 : 0, ts, ts],
            function (err) { if (err) reject(err); else resolve(); }
        );
    });
}

function upsertCheckinParticipate(userId, week, willParticipate) {
    return new Promise((resolve, reject) => {
        const ts = new Date().toISOString();
        db.run(
            `INSERT INTO checkins (user_id, week, connected, will_participate, created_at, updated_at)
             VALUES (?, ?, NULL, ?, ?, ?)
                 ON CONFLICT(user_id, week)
       DO UPDATE SET will_participate = excluded.will_participate, updated_at = excluded.updated_at`,
            [userId, week, willParticipate ? 1 : 0, ts, ts],
            function (err) { if (err) reject(err); else resolve(); }
        );
    });
}

function getOptedInUsersForWeek(week) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT user_id FROM checkins WHERE week = ? AND will_participate = 1`,
            [week],
            (err, rows) => (err ? reject(err) : resolve((rows || []).map(r => r.user_id)))
        );
    });
}

// -------- unmatched per week (ISO week bucket) --------
function addUnmatchedUsersForWeek(weekBucket, userIds) {
    if (!Array.isArray(userIds) || userIds.length === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const ts = new Date().toISOString();
        db.serialize(() => {
            const stmt = db.prepare(
                `INSERT OR IGNORE INTO unmatched_participants (user_id, week_bucket, created_at)
         VALUES (?, ?, ?)`
            );
            for (const uid of userIds) {
                if (uid) stmt.run([uid, weekBucket, ts]);
            }
            stmt.finalize(err => err ? reject(err) : resolve());
        });
    });
}

function getUnmatchedUsersForWeek(weekBucket) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT user_id FROM unmatched_participants WHERE week_bucket = ?`,
            [weekBucket],
            (err, rows) => (err ? reject(err) : resolve((rows || []).map(r => r.user_id)))
        );
    });
}

// Guarda participantes de um canal (INSERT OR IGNORE)
function addMatchParticipants(channelId, userIds) {
    if (!channelId || !Array.isArray(userIds) || userIds.length === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            const stmt = db.prepare(
                `INSERT OR IGNORE INTO match_participants (channel_id, user_id) VALUES (?, ?)`
            );
            for (const uid of userIds) {
                if (uid) stmt.run([channelId, uid]);
            }
            stmt.finalize(err => err ? reject(err) : resolve());
        });
    });
}

// Devolve os participantes para 1+ canais
function getParticipantsForChannels(channelIds) {
    if (!Array.isArray(channelIds) || channelIds.length === 0) return Promise.resolve([]);
    const placeholders = channelIds.map(() => '?').join(',');
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT DISTINCT user_id FROM match_participants WHERE channel_id IN (${placeholders})`,
            channelIds,
            (err, rows) => (err ? reject(err) : resolve((rows || []).map(r => r.user_id)))
        );
    });
}

module.exports = {
    // responses
    saveResponse,
    getAllResponses,
    clearResponses,
    clearUsers,
    // users
    saveUser,
    getUser,
    setUserStatus,
    updateUserCountry,
    updateUserMatchPreference,
    getAllUsers,
    deleteResponsesByUser,
    deleteUser,
    softOptOutUser,
    deleteUserCascade,
    // rooms
    upsertMatchRoom,
    markRoomArchived,
    getActiveRooms,
    // check-ins
    upsertCheckinConnected,
    upsertCheckinParticipate,
    getOptedInUsersForWeek,
    // unmatched
    addUnmatchedUsersForWeek,
    getUnmatchedUsersForWeek,
    // match participants
    addMatchParticipants,
    getParticipantsForChannels
};
