const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

class Database {
    constructor() {
        this.dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/bot.db');
        this.db = null;
    }

    async initialize() {
        // Ensure data directory exists
        const dataDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    logger.error('Database connection failed:', err);
                    reject(err);
                } else {
                    logger.info('Connected to SQLite database');
                    this.createTables().then(resolve).catch(reject);
                }
            });
        });
    }

    async createTables() {
        const tables = [
            `CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone_number TEXT UNIQUE NOT NULL,
                name TEXT,
                auth_status TEXT DEFAULT 'pending',
                google_tokens TEXT,
                preferences TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            `CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                phone_number TEXT NOT NULL,
                status TEXT DEFAULT 'active',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME NOT NULL,
                last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`,
            
            `CREATE TABLE IF NOT EXISTS message_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                phone_number TEXT NOT NULL,
                message_type TEXT NOT NULL,
                message_content TEXT,
                response_content TEXT,
                processing_time_ms INTEGER,
                success BOOLEAN DEFAULT 1,
                error_message TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES sessions (id)
            )`,
            
            `CREATE TABLE IF NOT EXISTS calendar_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                google_event_id TEXT,
                title TEXT NOT NULL,
                description TEXT,
                start_time DATETIME NOT NULL,
                end_time DATETIME NOT NULL,
                location TEXT,
                attendees TEXT,
                reminder_minutes INTEGER DEFAULT 15,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )`,
            
            `CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number)`,
            `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
            `CREATE INDEX IF NOT EXISTS idx_sessions_phone ON sessions(phone_number)`,
            `CREATE INDEX IF NOT EXISTS idx_events_user ON calendar_events(user_id)`,
            `CREATE INDEX IF NOT EXISTS idx_events_time ON calendar_events(start_time)`
        ];

        for (const tableQuery of tables) {
            await this.run(tableQuery);
        }
        
        logger.info('Database tables created/verified');
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    logger.error('Database run error:', err);
                    reject(err);
                } else {
                    resolve({ id: this.lastID, changes: this.changes });
                }
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    logger.error('Database get error:', err);
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    logger.error('Database all error:', err);
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async createUser(phoneNumber, name = null) {
        const sql = 'INSERT INTO users (phone_number, name) VALUES (?, ?)';
        return await this.run(sql, [phoneNumber, name]);
    }

    async getUserByPhone(phoneNumber) {
        const sql = 'SELECT * FROM users WHERE phone_number = ?';
        return await this.get(sql, [phoneNumber]);
    }

    async updateUserAuthStatus(userId, status, tokens = null) {
        const sql = 'UPDATE users SET auth_status = ?, google_tokens = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
        return await this.run(sql, [status, tokens ? JSON.stringify(tokens) : null, userId]);
    }

    async createSession(sessionId, userId, phoneNumber, expiresAt) {
        try {
            // Convert Date to ISO string for SQLite
            const expiresAtISO = expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt;
            const sql = 'INSERT INTO sessions (id, user_id, phone_number, expires_at) VALUES (?, ?, ?, ?)';
            logger.info(`Creating session with params: ID=${sessionId}, UserID=${userId}, Phone=${phoneNumber}, Expires=${expiresAtISO}`);
            const result = await this.run(sql, [sessionId, userId, phoneNumber, expiresAtISO]);
            logger.info(`Session creation result:`, result);
            return result;
        } catch (error) {
            logger.error('Session creation failed:', error);
            throw error;
        }
    }

    async getActiveSession(phoneNumber) {
        try {
            const sql = `SELECT * FROM sessions 
                         WHERE phone_number = ? AND status = 'active' AND expires_at > datetime('now')
                         ORDER BY created_at DESC LIMIT 1`;
            logger.info(`Getting active session for ${phoneNumber} with SQL: ${sql}`);
            const result = await this.get(sql, [phoneNumber]);
            logger.info(`Active session query result:`, result);
            return result;
        } catch (error) {
            logger.error('getActiveSession failed:', error);
            throw error;
        }
    }

    async updateSessionActivity(sessionId) {
        const sql = 'UPDATE sessions SET last_activity = CURRENT_TIMESTAMP WHERE id = ?';
        return await this.run(sql, [sessionId]);
    }

    async logMessage(sessionId, phoneNumber, messageType, messageContent, responseContent = null, processingTime = null, success = true, error = null) {
        const sql = `INSERT INTO message_logs 
                     (session_id, phone_number, message_type, message_content, response_content, processing_time_ms, success, error_message)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        return await this.run(sql, [sessionId, phoneNumber, messageType, messageContent, responseContent, processingTime, success, error]);
    }

    async close() {
        return new Promise((resolve) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) {
                        logger.error('Error closing database:', err);
                    } else {
                        logger.info('Database connection closed');
                    }
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = Database;
