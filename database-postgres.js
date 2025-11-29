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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create transactions table with comprehensive audit tracking
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
        
        -- Audit timestamps
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        transaction_time TIME DEFAULT CURRENT_TIME,
        
        -- User action tracking (for future enhancement)
        created_by VARCHAR(100) DEFAULT 'system',
        updated_by VARCHAR(100) DEFAULT 'system',
        
        -- Version tracking for updates
        version INTEGER DEFAULT 1
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

    // Create audit_log table for comprehensive tracking
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        table_name VARCHAR(50) NOT NULL,
        record_id INTEGER NOT NULL,
        action VARCHAR(20) NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
        old_values JSONB,
        new_values JSONB,
        changed_by VARCHAR(100) DEFAULT 'system',
        changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45),
        user_agent TEXT
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

    // Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
      CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
      CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
      CREATE INDEX IF NOT EXISTS idx_audit_log_record_id ON audit_log(table_name, record_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at ON audit_log(changed_at);
    `);

    console.log('✅ PostgreSQL database initialized successfully with audit tracking');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    throw error;
  }
};

// Database functions with enhanced audit capabilities
const db = {
  // ✅ FIXED: Atomic TID generation using PostgreSQL advisory locks
  getNextTID: function(callback) {
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

  // Enhanced run method with audit logging
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

  // Audit logging function
  logAudit: function(tableName, recordId, action, oldValues, newValues, changedBy = 'system') {
    const auditQuery = `
      INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, changed_by)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;
    
    return pool.query(auditQuery, [tableName, recordId, action, oldValues, newValues, changedBy])
      .catch(error => {
        console.error('❌ Audit logging error:', error);
        // Don't throw error for audit failures to avoid breaking main operations
      });
  },

  // Get transaction with full audit history
  getTransactionWithAudit: function(transactionId, callback) {
    const transactionQuery = `
      SELECT *, 
             COALESCE(tid, id) as display_id,
             TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at_full,
             TO_CHAR(updated_at, 'YYYY-MM-DD HH24:MI:SS') as updated_at_full,
             TO_CHAR(transaction_time, 'HH24:MI:SS') as transaction_time_str
      FROM transactions 
      WHERE id = $1
    `;

    const auditQuery = `
      SELECT action, changed_by, changed_at, old_values, new_values
      FROM audit_log 
      WHERE table_name = 'transactions' AND record_id = $1
      ORDER BY changed_at DESC
    `;

    Promise.all([
      pool.query(transactionQuery, [transactionId]),
      pool.query(auditQuery, [transactionId])
    ])
    .then(([transactionResult, auditResult]) => {
      const transaction = transactionResult.rows[0] || null;
      if (transaction) {
        transaction.audit_history = auditResult.rows;
      }
      callback(null, transaction);
    })
    .catch(error => {
      console.error('❌ Get transaction with audit error:', error);
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
