const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { existsSync, mkdirSync } = require('fs');

const DB_PATH = path.join(__dirname, '../database/accounts.db');

// Create database directory if it doesn't exist
const dbDir = path.join(__dirname, '../database');
if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
}

// Create database connection
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        initializeDatabase();
    }
});

// Initialize database tables
function initializeDatabase() {
    const queries = [
        `CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name VARCHAR(255) NOT NULL UNIQUE,
            type VARCHAR(50) NOT NULL,
            balance DECIMAL(15,2) DEFAULT 0.00,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tid INTEGER UNIQUE, -- Transaction ID (TID) for user-facing reference
            date DATE NOT NULL,
            account_name VARCHAR(255) NOT NULL,
            description TEXT,
            amount DECIMAL(15,2) NOT NULL,
            type VARCHAR(10) NOT NULL,
            reference VARCHAR(100),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS daily_summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date DATE UNIQUE NOT NULL,
            total_sales DECIMAL(15,2) DEFAULT 0.00,
            total_expenses DECIMAL(15,2) DEFAULT 0.00,
            expected_cash DECIMAL(15,2) DEFAULT 0.00,
            physical_cash DECIMAL(15,2) DEFAULT 0.00,
            difference DECIMAL(15,2) DEFAULT 0.00,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS app_metadata (
            key VARCHAR(50) PRIMARY KEY,
            value VARCHAR(255),
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
    ];

    db.serialize(() => {
        // Create tables
        queries.forEach(query => {
            db.run(query, (err) => {
                if (err) console.error('Error creating table:', err.message);
            });
        });

        // Insert default accounts
        const defaultAccounts = [
            { name: 'Cash Sales', type: 'revenue' },
            { name: 'Operating Expenses', type: 'expense' },
            { name: 'Vendor Payments', type: 'expense' }
        ];

        const insertAccount = db.prepare(`INSERT OR IGNORE INTO accounts (name, type) VALUES (?, ?)`);
        defaultAccounts.forEach(account => {
            insertAccount.run([account.name, account.type]);
        });
        insertAccount.finalize();

        // Initialize TID counter if not exists
        db.run(`INSERT OR IGNORE INTO app_metadata (key, value) VALUES ('last_tid', '0')`, (err) => {
            if (err) console.error('Error initializing TID counter:', err.message);
        });
    });
}

// Function to get next TID
db.getNextTID = function(callback) {
    this.get(`SELECT value FROM app_metadata WHERE key = 'last_tid'`, (err, row) => {
        if (err) return callback(err);
        
        const nextTID = parseInt(row.value) + 1;
        
        // Update the last_tid
        this.run(`UPDATE app_metadata SET value = ? WHERE key = 'last_tid'`, [nextTID], (err) => {
            if (err) return callback(err);
            callback(null, nextTID);
        });
    });
};

module.exports = db;