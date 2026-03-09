const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { DatabaseSync } = require('node:sqlite');

const provider = (process.env.DB_PROVIDER || 'sqlite').toLowerCase();
const sqlitePath = process.env.SQLITE_PATH || path.join(__dirname, '../database.db');
const mysqlRequiredEnvVars = [
    'MYSQL_HOST',
    'MYSQL_PORT',
    'MYSQL_USER',
    'MYSQL_PASSWORD',
    'MYSQL_DATABASE'
];

let pool;
let sqliteDb;
let initPromise;

function getMissingMysqlEnvVars() {
    return mysqlRequiredEnvVars.filter((key) => !process.env[key]);
}

function getJsonCandidates() {
    return [
        path.join(__dirname, '../database.json'),
        path.join(__dirname, '../database.json.backup')
    ];
}

function getExistingJsonPath() {
    return getJsonCandidates().find((candidate) => fs.existsSync(candidate));
}

function backupOriginalJsonIfNeeded(jsonPath) {
    if (jsonPath && jsonPath.endsWith('database.json')) {
        fs.renameSync(jsonPath, `${jsonPath}.backup`);
    }
}

async function initMysql() {
    const missing = getMissingMysqlEnvVars();
    if (missing.length > 0) {
        throw new Error(`Missing MySQL environment variables: ${missing.join(', ')}`);
    }

    const port = Number(process.env.MYSQL_PORT);
    if (!Number.isInteger(port) || port <= 0) {
        throw new Error('MYSQL_PORT must be a valid positive integer.');
    }

    const baseConfig = {
        host: process.env.MYSQL_HOST,
        port,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        waitForConnections: true,
        connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
        queueLimit: 0
    };

    const setupConnection = await mysql.createConnection(baseConfig);
    await setupConnection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.MYSQL_DATABASE}\``);
    await setupConnection.end();

    pool = mysql.createPool({
        ...baseConfig,
        database: process.env.MYSQL_DATABASE
    });

    await pool.query(`
        CREATE TABLE IF NOT EXISTS config (
            \`key\` VARCHAR(255) PRIMARY KEY,
            \`value\` LONGTEXT NOT NULL
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS mediators (
            userId VARCHAR(32) PRIMARY KEY,
            pix TEXT,
            online TINYINT(1) DEFAULT 0,
            name VARCHAR(255)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS queues (
            id VARCHAR(255) PRIMARY KEY,
            mode VARCHAR(100),
            type VARCHAR(100),
            value VARCHAR(255),
            channelId VARCHAR(32),
            players LONGTEXT,
            messageId VARCHAR(32)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS active_matches (
            id VARCHAR(255) PRIMARY KEY,
            data LONGTEXT NOT NULL
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS stats (
            userId VARCHAR(32) PRIMARY KEY,
            wins INT DEFAULT 0,
            losses INT DEFAULT 0,
            winStreak INT DEFAULT 0,
            maxWinStreak INT DEFAULT 0,
            totalMatches INT DEFAULT 0
        )
    `);
}

function initSqlite() {
    sqliteDb = new DatabaseSync(sqlitePath);
    sqliteDb.exec(`
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS mediators (
            userId TEXT PRIMARY KEY,
            pix TEXT,
            online INTEGER DEFAULT 0,
            name TEXT
        );

        CREATE TABLE IF NOT EXISTS queues (
            id TEXT PRIMARY KEY,
            mode TEXT,
            type TEXT,
            value TEXT,
            channelId TEXT,
            players TEXT,
            messageId TEXT
        );

        CREATE TABLE IF NOT EXISTS active_matches (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS stats (
            userId TEXT PRIMARY KEY,
            wins INTEGER DEFAULT 0,
            losses INTEGER DEFAULT 0,
            winStreak INTEGER DEFAULT 0,
            maxWinStreak INTEGER DEFAULT 0,
            totalMatches INTEGER DEFAULT 0
        );
    `);
}

async function mysqlTableHasRows(tableName) {
    const [rows] = await pool.query(`SELECT 1 AS hasRows FROM \`${tableName}\` LIMIT 1`);
    return rows.length > 0;
}

function sqliteTableHasRows(tableName) {
    const row = sqliteDb.prepare(`SELECT 1 AS hasRows FROM ${tableName} LIMIT 1`).get();
    return Boolean(row);
}

async function hasAnyData() {
    if (provider === 'mysql') {
        const checks = await Promise.all([
            mysqlTableHasRows('config'),
            mysqlTableHasRows('mediators'),
            mysqlTableHasRows('queues'),
            mysqlTableHasRows('active_matches'),
            mysqlTableHasRows('stats')
        ]);
        return checks.some(Boolean);
    }

    return [
        sqliteTableHasRows('config'),
        sqliteTableHasRows('mediators'),
        sqliteTableHasRows('queues'),
        sqliteTableHasRows('active_matches'),
        sqliteTableHasRows('stats')
    ].some(Boolean);
}

async function ensureInitialized() {
    if (!initPromise) {
        initPromise = (async () => {
            if (provider === 'mysql') {
                await initMysql();
            } else if (provider === 'sqlite') {
                initSqlite();
            } else {
                throw new Error(`Unsupported DB_PROVIDER: ${provider}`);
            }

            await migrateFromJsonIfNeeded();
        })();
    }

    return initPromise;
}

async function migrateFromJsonIfNeeded() {
    if (await hasAnyData()) {
        return;
    }

    const jsonPath = getExistingJsonPath();
    if (!jsonPath) {
        return;
    }

    try {
        const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

        const mergedConfig = { ...(jsonData.config || {}) };
        if (jsonData.embedSettings) {
            mergedConfig.embedSettings = jsonData.embedSettings;
        }

        if (Object.keys(mergedConfig).length > 0) await writeConfig(mergedConfig);
        if (jsonData.mediators) await writeMediators(jsonData.mediators);
        if (jsonData.queues) await writeQueues(jsonData.queues);
        if (jsonData.activeMatches) await writeActiveMatches(jsonData.activeMatches);
        if (jsonData.stats) await writeStats(jsonData.stats);

        backupOriginalJsonIfNeeded(jsonPath);
        console.log(`Dados migrados para ${provider} com sucesso.`);
    } catch (error) {
        console.error(`Erro ao migrar dados para ${provider}:`, error);
    }
}

async function getConfig() {
    if (provider === 'mysql') {
        const [rows] = await pool.query('SELECT `key`, `value` FROM config');
        return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)]));
    }

    const rows = sqliteDb.prepare('SELECT key, value FROM config').all();
    return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)]));
}

async function getMediators() {
    const rows = provider === 'mysql'
        ? (await pool.query('SELECT userId, pix, online, name FROM mediators'))[0]
        : sqliteDb.prepare('SELECT userId, pix, online, name FROM mediators').all();

    return Object.fromEntries(rows.map((row) => [
        row.userId,
        {
            pix: row.pix || '',
            online: row.online === 1,
            name: row.name || ''
        }
    ]));
}

async function getQueues() {
    const rows = provider === 'mysql'
        ? (await pool.query('SELECT id, mode, type, value, channelId, players, messageId FROM queues'))[0]
        : sqliteDb.prepare('SELECT id, mode, type, value, channelId, players, messageId FROM queues').all();

    return rows.map((row) => ({
        id: row.id,
        mode: row.mode,
        type: row.type,
        value: row.value,
        channelId: row.channelId,
        players: JSON.parse(row.players || '[]'),
        messageId: row.messageId || ''
    }));
}

async function getActiveMatches() {
    const rows = provider === 'mysql'
        ? (await pool.query('SELECT id, data FROM active_matches'))[0]
        : sqliteDb.prepare('SELECT id, data FROM active_matches').all();

    return rows.map((row) => ({
        id: row.id,
        ...JSON.parse(row.data)
    }));
}

async function getStats() {
    const rows = provider === 'mysql'
        ? (await pool.query('SELECT userId, wins, losses, winStreak, maxWinStreak, totalMatches FROM stats'))[0]
        : sqliteDb.prepare('SELECT userId, wins, losses, winStreak, maxWinStreak, totalMatches FROM stats').all();

    return Object.fromEntries(rows.map((row) => [
        row.userId,
        {
            wins: row.wins,
            losses: row.losses,
            winStreak: row.winStreak,
            maxWinStreak: row.maxWinStreak,
            totalMatches: row.totalMatches
        }
    ]));
}

async function writeConfig(config) {
    if (provider === 'mysql') {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query('DELETE FROM config');
            for (const [key, value] of Object.entries(config || {})) {
                await connection.query('INSERT INTO config (`key`, `value`) VALUES (?, ?)', [key, JSON.stringify(value)]);
            }
            await connection.commit();
            return;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    const insert = sqliteDb.prepare('INSERT INTO config (key, value) VALUES (?, ?)');
    sqliteDb.exec('DELETE FROM config');
    for (const [key, value] of Object.entries(config || {})) {
        insert.run(key, JSON.stringify(value));
    }
}

async function writeMediators(mediators) {
    if (provider === 'mysql') {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query('DELETE FROM mediators');
            for (const [userId, data] of Object.entries(mediators || {})) {
                await connection.query(
                    'INSERT INTO mediators (userId, pix, online, name) VALUES (?, ?, ?, ?)',
                    [userId, data.pix || '', data.online ? 1 : 0, data.name || '']
                );
            }
            await connection.commit();
            return;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    const insert = sqliteDb.prepare('INSERT INTO mediators (userId, pix, online, name) VALUES (?, ?, ?, ?)');
    sqliteDb.exec('DELETE FROM mediators');
    for (const [userId, data] of Object.entries(mediators || {})) {
        insert.run(userId, data.pix || '', data.online ? 1 : 0, data.name || '');
    }
}

async function writeQueues(queues) {
    if (provider === 'mysql') {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query('DELETE FROM queues');
            for (const queue of queues || []) {
                await connection.query(
                    'INSERT INTO queues (id, mode, type, value, channelId, players, messageId) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [queue.id, queue.mode, queue.type, queue.value, queue.channelId, JSON.stringify(queue.players || []), queue.messageId || '']
                );
            }
            await connection.commit();
            return;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    const insert = sqliteDb.prepare('INSERT INTO queues (id, mode, type, value, channelId, players, messageId) VALUES (?, ?, ?, ?, ?, ?, ?)');
    sqliteDb.exec('DELETE FROM queues');
    for (const queue of queues || []) {
        insert.run(queue.id, queue.mode, queue.type, queue.value, queue.channelId, JSON.stringify(queue.players || []), queue.messageId || '');
    }
}

async function writeActiveMatches(matches) {
    if (provider === 'mysql') {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query('DELETE FROM active_matches');
            for (const match of matches || []) {
                const { id, ...data } = match;
                await connection.query('INSERT INTO active_matches (id, data) VALUES (?, ?)', [id, JSON.stringify(data)]);
            }
            await connection.commit();
            return;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    const insert = sqliteDb.prepare('INSERT INTO active_matches (id, data) VALUES (?, ?)');
    sqliteDb.exec('DELETE FROM active_matches');
    for (const match of matches || []) {
        const { id, ...data } = match;
        insert.run(id, JSON.stringify(data));
    }
}

async function writeStats(stats) {
    if (provider === 'mysql') {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query('DELETE FROM stats');
            for (const [userId, data] of Object.entries(stats || {})) {
                await connection.query(
                    'INSERT INTO stats (userId, wins, losses, winStreak, maxWinStreak, totalMatches) VALUES (?, ?, ?, ?, ?, ?)',
                    [userId, data.wins || 0, data.losses || 0, data.winStreak || 0, data.maxWinStreak || 0, data.totalMatches || 0]
                );
            }
            await connection.commit();
            return;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    const insert = sqliteDb.prepare('INSERT INTO stats (userId, wins, losses, winStreak, maxWinStreak, totalMatches) VALUES (?, ?, ?, ?, ?, ?)');
    sqliteDb.exec('DELETE FROM stats');
    for (const [userId, data] of Object.entries(stats || {})) {
        insert.run(userId, data.wins || 0, data.losses || 0, data.winStreak || 0, data.maxWinStreak || 0, data.totalMatches || 0);
    }
}

module.exports = {
    get: async (key) => {
        await ensureInitialized();
        const config = await getConfig();

        if (!key) {
            return {
                config,
                embedSettings: config.embedSettings || {},
                mediators: await getMediators(),
                queues: await getQueues(),
                activeMatches: await getActiveMatches(),
                stats: await getStats()
            };
        }

        if (key === 'config') return config;
        if (key === 'embedSettings') return config.embedSettings || {};
        if (key === 'mediators') return getMediators();
        if (key === 'queues') return getQueues();
        if (key === 'activeMatches') return getActiveMatches();
        if (key === 'stats') return getStats();
        return null;
    },

    set: async (key, value) => {
        await ensureInitialized();
        if (key === 'embedSettings') {
            const config = await getConfig();
            config.embedSettings = value || {};
            return writeConfig(config);
        }

        if (key === 'config') return writeConfig(value);
        if (key === 'mediators') return writeMediators(value);
        if (key === 'queues') return writeQueues(value);
        if (key === 'activeMatches') return writeActiveMatches(value);
        if (key === 'stats') return writeStats(value);
        throw new Error(`Unknown key: ${key}`);
    },

    update: async (callback) => {
        await ensureInitialized();
        const currentData = await module.exports.get();
        const newData = await callback(currentData);

        if (newData.config) await module.exports.set('config', newData.config);
        if (newData.embedSettings) await module.exports.set('embedSettings', newData.embedSettings);
        if (newData.mediators) await module.exports.set('mediators', newData.mediators);
        if (newData.queues) await module.exports.set('queues', newData.queues);
        if (newData.activeMatches) await module.exports.set('activeMatches', newData.activeMatches);
        if (newData.stats) await module.exports.set('stats', newData.stats);
    },

    close: async () => {
        if (pool) {
            await pool.end();
            pool = null;
        }

        if (sqliteDb) {
            sqliteDb.close();
            sqliteDb = null;
        }

        initPromise = null;
    }
};
