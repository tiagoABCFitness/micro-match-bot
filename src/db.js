// src/db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// aponta para a pasta data no root
const dbPath = path.join(__dirname, '..', 'data', 'responses.db');

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS responses (
      user_id TEXT PRIMARY KEY,
      topics TEXT,
      timestamp TEXT
    )
  `);

    db.run(`
        CREATE TABLE IF NOT EXISTS users (
         user_id TEXT PRIMARY KEY,
         name TEXT,
         consent INTEGER DEFAULT 0,
         status TEXT DEFAULT 'new',
         reated_at TEXT,
         updated_at TEXT
        )
    `);

});

function saveResponse(userId, topics) {
  return new Promise((resolve, reject) => {
    const ts = new Date().toISOString();
    db.run(
      `INSERT INTO responses (user_id, topics, timestamp)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id)
       DO UPDATE SET topics=excluded.topics, timestamp=excluded.timestamp`,
      [userId, topics.join(','), ts],
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
      if (err) reject(err);
      else {
        const mapped = rows.map(r => ({
          userId: r.user_id,
          topics: r.topics.split(',').map(t => t.trim()),
          timestamp: r.timestamp
        }));
        resolve(mapped);
      }
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

module.exports = { saveResponse, getAllResponses, clearResponses, saveUser, getUser };
