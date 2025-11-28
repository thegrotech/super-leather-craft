const { Pool } = require('pg');

console.log('🔍 DEBUG: Creating PostgreSQL pool...');
console.log('🔍 DEBUG: DATABASE_URL length:', process.env.DATABASE_URL ? process.env.DATABASE_URL.length : 'MISSING');

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test connection immediately
console.log('🔍 DEBUG: Testing PostgreSQL connection...');
pool.connect()
  .then((client) => {
    console.log('✅ PostgreSQL connection test successful');
    client.release();
  })
  .catch((error) => {
    console.error('❌ PostgreSQL connection failed:', error.message);
    console.error('🔍 Connection details:', {
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      urlLength: process.env.DATABASE_URL ? process.env.DATABASE_URL.length : 0,
      nodeEnv: process.env.NODE_ENV
    });
  });

// Initialize database tables
const initializeDatabase = async () => {
  try {
    console.log('🔄 Initializing PostgreSQL database...');
    
    // Create accounts table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        type VARCHAR(50) NOT NULL,
        balance DECIMAL(15,2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create transactions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        tid INTEGER UNIQUE,
        date DATE NOT NULL,
        account_name VARCHAR(255) NOT NULL,
        description TEXT,
        amount DECIMAL(15,2) NOT NULL,
        type VARCHAR(10) NOT NULL CHECK (type IN ('credit', 'debit')),
        reference VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create daily_summaries table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_summaries (
        id SERIAL PRIMARY KEY,
        date DATE UNIQUE NOT NULL,
        total_sales DECIMAL(15,2) DEFAULT 0.00,
        total_expenses DECIMAL(15,2) DEFAULT 0.00,
        expected_cash DECIMAL(15,2) DEFAULT 0.00,
        physical_cash DECIMAL(15,2) DEFAULT 0.00,
        difference DECIMAL(15,2) DEFAULT 0.00,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create app_metadata table (for TID counter)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_metadata (
        key VARCHAR(50) PRIMARY KEY,
        value VARCHAR(255),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert default accounts
    const defaultAccounts = [
      { name: 'Cash Sales', type: 'revenue' },
      { name: 'Operating Expenses', type: 'expense' },
      { name: 'Vendor Payments', type: 'expense' }
    ];

    for (const account of defaultAccounts) {
      await pool.query(
        'INSERT INTO accounts (name, type) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
        [account.name, account.type]
      );
    }

    // Initialize TID counter if not exists
    await pool.query(
      `INSERT INTO app_metadata (key, value) VALUES ('last_tid', '0') ON CONFLICT (key) DO NOTHING`
    );

    console.log('✅ PostgreSQL database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    throw error;
  }
};

// Database functions - matching your SQLite interface
const db = {
  // Get next TID (same as your SQLite version but for PostgreSQL)
  getNextTID: function(callback) {
    pool.query(`SELECT value FROM app_metadata WHERE key = 'last_tid'`)
      .then(result => {
        const nextTID = parseInt(result.rows[0]?.value || 0) + 1;
        
        // Update the last_tid
        return pool.query(`UPDATE app_metadata SET value = $1 WHERE key = 'last_tid'`, [nextTID])
          .then(() => {
            callback(null, nextTID);
          });
      })
      .catch(error => {
        callback(error);
      });
  },

  // Run query (for INSERT, UPDATE, DELETE)
  run: function(query, params, callback) {
    // Convert SQLite ? to PostgreSQL $1, $2, etc.
    let postgresQuery = query;
    let paramIndex = 1;
    postgresQuery = query.replace(/\?/g, () => `$${paramIndex++}`);
    
    pool.query(postgresQuery, params)
      .then(result => {
        // For INSERT queries, return lastID
        const lastID = result.rows[0]?.id || null;
        callback(null, { lastID: lastID, changes: result.rowCount });
      })
      .catch(error => {
        callback(error);
      });
  },

  // Get single row
  get: function(query, params, callback) {
    let postgresQuery = query;
    let paramIndex = 1;
    postgresQuery = query.replace(/\?/g, () => `$${paramIndex++}`);
    
    pool.query(postgresQuery, params)
      .then(result => {
        callback(null, result.rows[0] || null);
      })
      .catch(error => {
        callback(error);
      });
  },

  // Get all rows
  all: function(query, params, callback) {
    let postgresQuery = query;
    let paramIndex = 1;
    postgresQuery = query.replace(/\?/g, () => `$${paramIndex++}`);
    
    pool.query(postgresQuery, params || [])
      .then(result => {
        callback(null, result.rows);
      })
      .catch(error => {
        callback(error);
      });
  },

  // Direct pool access for complex operations
  pool: pool
};

// Test connection and initialize
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
  initializeDatabase();
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL pool error:', err);
});

module.exports = db;

