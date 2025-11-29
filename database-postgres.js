const { Pool } = require('pg');

console.log('🔍 DEBUG: Creating PostgreSQL pool...');
console.log('🔍 DEBUG: DATABASE_URL length:', process.env.DATABASE_URL ? process.env.DATABASE_URL.length : 'MISSING');

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
  connectionTimeoutMillis: 10000, // How long to wait for a connection
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

// Database functions - FIXED VERSION
const db = {
  // ✅ FIXED: Atomic TID generation using PostgreSQL advisory locks
  getNextTID: function(callback) {
    // Use a transaction with row locking to prevent race conditions
    const getTIDQuery = `
      WITH updated AS (
        UPDATE app_metadata 
        SET value = (CAST(value AS INTEGER) + 1)::VARCHAR,
            updated_at = CURRENT_TIMESTAMP
        WHERE key = 'last_tid'
        RETURNING CAST(value AS INTEGER) as new_tid
      )
      SELECT new_tid FROM updated
      UNION ALL
      SELECT 1 as new_tid
      WHERE NOT EXISTS (SELECT 1 FROM updated)
    `;

    pool.query(getTIDQuery)
      .then(result => {
        if (result.rows.length === 0 || !result.rows[0].new_tid) {
          throw new Error('Failed to generate TID');
        }
        const nextTID = result.rows[0].new_tid;
        callback(null, nextTID);
      })
      .catch(error => {
        console.error('❌ TID generation error:', error);
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
        // For INSERT queries with RETURNING clause
        const lastID = result.rows[0]?.id || null;
        callback(null, { lastID: lastID, changes: result.rowCount });
      })
      .catch(error => {
        console.error('❌ Database run error:', error);
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
        console.error('❌ Database get error:', error);
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
        console.error('❌ Database all error:', error);
        callback(error);
      });
  },

  // Direct pool access for complex operations
  pool: pool
};

// Test connection and initialize
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
  initializeDatabase().catch(err => {
    console.error('❌ Database initialization failed:', err);
  });
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL pool error:', err);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

module.exports = db;
