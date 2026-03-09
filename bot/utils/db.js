const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../database.db');
const db = new sqlite3.Database(dbPath);

// Initialize database tables
db.serialize(() => {
    // Config table
    db.run(`CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);

    // Mediators table
    db.run(`CREATE TABLE IF NOT EXISTS mediators (
        userId TEXT PRIMARY KEY,
        pix TEXT,
        online INTEGER DEFAULT 0,
        name TEXT
    )`);

    // Queues table
    db.run(`CREATE TABLE IF NOT EXISTS queues (
        id TEXT PRIMARY KEY,
        mode TEXT,
        type TEXT,
        value TEXT,
        channelId TEXT,
        players TEXT DEFAULT '[]',
        messageId TEXT
    )`);

    // Active matches table
    db.run(`CREATE TABLE IF NOT EXISTS active_matches (
        id TEXT PRIMARY KEY,
        data TEXT
    )`);

    // Stats table
    db.run(`CREATE TABLE IF NOT EXISTS stats (
        userId TEXT PRIMARY KEY,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        winStreak INTEGER DEFAULT 0,
        maxWinStreak INTEGER DEFAULT 0,
        totalMatches INTEGER DEFAULT 0
    )`);

    // Migrate data from JSON if exists
    migrateFromJSON();
});

function migrateFromJSON() {
    const fs = require('fs');
    const jsonPath = path.join(__dirname, '../database.json');

    if (fs.existsSync(jsonPath)) {
        try {
            const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

            // Migrate config
            if (jsonData.config) {
                Object.entries(jsonData.config).forEach(([key, value]) => {
                    db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
                });
            }

            // Migrate mediators
            if (jsonData.mediators) {
                Object.entries(jsonData.mediators).forEach(([userId, data]) => {
                    db.run('INSERT OR REPLACE INTO mediators (userId, pix, online, name) VALUES (?, ?, ?, ?)',
                        [userId, data.pix || '', data.online ? 1 : 0, data.name || '']);
                });
            }

            // Migrate queues
            if (jsonData.queues) {
                jsonData.queues.forEach(queue => {
                    db.run('INSERT OR REPLACE INTO queues (id, mode, type, value, channelId, players, messageId) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [queue.id, queue.mode, queue.type, queue.value, queue.channelId, JSON.stringify(queue.players || []), queue.messageId || '']);
                });
            }

            // Migrate stats
            if (jsonData.stats) {
                Object.entries(jsonData.stats).forEach(([userId, data]) => {
                    db.run('INSERT OR REPLACE INTO stats (userId, wins, losses, winStreak, maxWinStreak, totalMatches) VALUES (?, ?, ?, ?, ?, ?)',
                        [userId, data.wins || 0, data.losses || 0, data.winStreak || 0, data.maxWinStreak || 0, data.totalMatches || 0]);
                });
            }

            // Backup and remove old JSON file
            fs.renameSync(jsonPath, jsonPath + '.backup');
            console.log('✅ Dados migrados do JSON para SQLite com sucesso!');

        } catch (error) {
            console.error('❌ Erro ao migrar dados:', error);
        }
    }
}

module.exports = {
    get: (key) => {
        return new Promise((resolve, reject) => {
            if (!key) {
                // Return all data
                const result = {};

                // Get config
                db.all('SELECT * FROM config', (err, rows) => {
                    if (err) return reject(err);
                    result.config = {};
                    rows.forEach(row => {
                        result.config[row.key] = JSON.parse(row.value);
                    });

                    // Get mediators
                    db.all('SELECT * FROM mediators', (err, rows) => {
                        if (err) return reject(err);
                        result.mediators = {};
                        rows.forEach(row => {
                            result.mediators[row.userId] = {
                                pix: row.pix,
                                online: row.online === 1,
                                name: row.name
                            };
                        });

                        // Get queues
                        db.all('SELECT * FROM queues', (err, rows) => {
                            if (err) return reject(err);
                            result.queues = rows.map(row => ({
                                id: row.id,
                                mode: row.mode,
                                type: row.type,
                                value: row.value,
                                channelId: row.channelId,
                                players: JSON.parse(row.players),
                                messageId: row.messageId
                            }));

                            // Get stats
                            db.all('SELECT * FROM stats', (err, rows) => {
                                if (err) return reject(err);
                                result.stats = {};
                                rows.forEach(row => {
                                    result.stats[row.userId] = {
                                        wins: row.wins,
                                        losses: row.losses,
                                        winStreak: row.winStreak,
                                        maxWinStreak: row.maxWinStreak,
                                        totalMatches: row.totalMatches
                                    };
                                });

                                resolve(result);
                            });
                        });
                    });
                });
            } else {
                // Return specific key
                if (key === 'config') {
                    db.all('SELECT * FROM config', (err, rows) => {
                        if (err) return reject(err);
                        const result = {};
                        rows.forEach(row => {
                            result[row.key] = JSON.parse(row.value);
                        });
                        resolve(result);
                    });
                } else if (key === 'mediators') {
                    db.all('SELECT * FROM mediators', (err, rows) => {
                        if (err) return reject(err);
                        const result = {};
                        rows.forEach(row => {
                            result[row.userId] = {
                                pix: row.pix,
                                online: row.online === 1,
                                name: row.name
                            };
                        });
                        resolve(result);
                    });
                } else if (key === 'queues') {
                    db.all('SELECT * FROM queues', (err, rows) => {
                        if (err) return reject(err);
                        resolve(rows.map(row => ({
                            id: row.id,
                            mode: row.mode,
                            type: row.type,
                            value: row.value,
                            channelId: row.channelId,
                            players: JSON.parse(row.players),
                            messageId: row.messageId
                        })));
                    });
                } else if (key === 'stats') {
                    db.all('SELECT * FROM stats', (err, rows) => {
                        if (err) return reject(err);
                        const result = {};
                        rows.forEach(row => {
                            result[row.userId] = {
                                wins: row.wins,
                                losses: row.losses,
                                winStreak: row.winStreak,
                                maxWinStreak: row.maxWinStreak,
                                totalMatches: row.totalMatches
                            };
                        });
                        resolve(result);
                    });
                } else {
                    resolve(null);
                }
            }
        });
    },

    set: (key, value) => {
        return new Promise((resolve, reject) => {
            if (key === 'config') {
                // Clear existing config
                db.run('DELETE FROM config', (err) => {
                    if (err) return reject(err);

                    // Insert new config
                    const stmt = db.prepare('INSERT INTO config (key, value) VALUES (?, ?)');
                    Object.entries(value).forEach(([k, v]) => {
                        stmt.run(k, JSON.stringify(v));
                    });
                    stmt.finalize(resolve);
                });
            } else if (key === 'mediators') {
                // Clear existing mediators
                db.run('DELETE FROM mediators', (err) => {
                    if (err) return reject(err);

                    // Insert new mediators
                    const stmt = db.prepare('INSERT INTO mediators (userId, pix, online, name) VALUES (?, ?, ?, ?)');
                    Object.entries(value).forEach(([userId, data]) => {
                        stmt.run(userId, data.pix || '', data.online ? 1 : 0, data.name || '');
                    });
                    stmt.finalize(resolve);
                });
            } else if (key === 'queues') {
                // Clear existing queues
                db.run('DELETE FROM queues', (err) => {
                    if (err) return reject(err);

                    // Insert new queues
                    const stmt = db.prepare('INSERT INTO queues (id, mode, type, value, channelId, players, messageId) VALUES (?, ?, ?, ?, ?, ?, ?)');
                    value.forEach(queue => {
                        stmt.run(queue.id, queue.mode, queue.type, queue.value, queue.channelId, JSON.stringify(queue.players || []), queue.messageId || '');
                    });
                    stmt.finalize(resolve);
                });
            } else if (key === 'stats') {
                // Clear existing stats
                db.run('DELETE FROM stats', (err) => {
                    if (err) return reject(err);

                    // Insert new stats
                    const stmt = db.prepare('INSERT INTO stats (userId, wins, losses, winStreak, maxWinStreak, totalMatches) VALUES (?, ?, ?, ?, ?, ?)');
                    Object.entries(value).forEach(([userId, data]) => {
                        stmt.run(userId, data.wins || 0, data.losses || 0, data.winStreak || 0, data.maxWinStreak || 0, data.totalMatches || 0);
                    });
                    stmt.finalize(resolve);
                });
            } else {
                reject(new Error(`Unknown key: ${key}`));
            }
        });
    },

    update: (callback) => {
        return new Promise(async (resolve, reject) => {
            try {
                const currentData = await module.exports.get();
                const newData = callback(currentData);

                // Update each table
                if (newData.config) await module.exports.set('config', newData.config);
                if (newData.mediators) await module.exports.set('mediators', newData.mediators);
                if (newData.queues) await module.exports.set('queues', newData.queues);
                if (newData.stats) await module.exports.set('stats', newData.stats);

                resolve();
            } catch (error) {
                reject(error);
            }
        });
    },

    // Close database connection
    close: () => {
        db.close();
    }
};
