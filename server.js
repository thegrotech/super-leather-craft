const express = require('express');
const cors = require('cors');
const path = require('path');
const businessConfig = require('./business.json');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Load environment variables first
require('dotenv').config();

// Debug database configuration
console.log('🔍 DEBUG: Testing PostgreSQL connection...');
console.log('🔍 DEBUG: DATABASE_URL length:', process.env.DATABASE_URL ? process.env.DATABASE_URL.length : 'MISSING');
console.log('🔍 DEBUG: DATABASE_URL contains pooler:', process.env.DATABASE_URL ? process.env.DATABASE_URL.includes('pooler') : false);

// Validate critical environment variables
if (!process.env.DATABASE_URL) {
  console.error('❌ CRITICAL ERROR: DATABASE_URL environment variable is missing!');
  process.exit(1);
}

if (!process.env.JWT_SECRET) {
  console.error('❌ CRITICAL ERROR: JWT_SECRET environment variable is missing!');
  process.exit(1);
}

if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
  console.error('❌ CRITICAL ERROR: ADMIN_USERNAME or ADMIN_PASSWORD environment variable is missing!');
  process.exit(1);
}

// Initialize PostgreSQL database
console.log('✅ DATABASE_URL found, loading PostgreSQL...');
const db = require('./database-postgres');

// Environment variables
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = '24h';

// Hashed admin password (will be set after hashing)
let ADMIN_PASSWORD_HASH = '';

const app = express();
const PORT = process.env.PORT || 10000;

// ==================== UTILITY FUNCTIONS ====================

// 1. For created_at and updated_at (TIMESTAMP columns)
// We return a real Date object so the 'pg' library handles formatting
function getPakistanTimestamp() {
  return new Date(); 
}

// 2. For transaction_time (TIME column)
// We use 'en-GB' because it gives us HH:MM:SS (24-hour) which Postgres TIME type loves
function getPakistanTime() {
  return new Date().toLocaleTimeString("en-GB", { 
    timeZone: "Asia/Karachi",
    hour12: false 
  });
}

// 3. For display on your website (KEEP THIS AS IS)
// This is what takes the DB value and makes it look good for you
function formatTimestampForDisplay(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleString('en-PK', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

// ==================== MIDDLEWARE ====================

// Security headers
app.use(helmet());

// CORS configuration - more permissive for production
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:10000',
      'http://localhost:5000',
      'http://localhost:3000',
      'https://super-leather-craft.vercel.app',
      'https://super-leather-craft-backend.onrender.com'
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('🔍 CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Handle preflight requests
app.options('*', cors());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve frontend in development only
if (process.env.NODE_ENV !== 'production') {
  app.use(express.static(path.join(__dirname, '../frontend')));
}

// JWT Authentication middleware
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    } else {
      return res.status(401).json({ error: 'Authentication failed' });
    }
  }
};

// Hash admin password on server start
console.log('🔐 Hashing admin password...');
bcrypt.hash(ADMIN_PASSWORD, 12)
  .then(hash => {
    ADMIN_PASSWORD_HASH = hash;
    console.log('✅ Admin password hashed successfully');
  })
  .catch(err => {
    console.error('❌ Failed to hash admin password:', err);
    process.exit(1);
  });

// ==================== ROUTES ====================

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    // Test database connection
    await db.pool.query('SELECT 1 as test');
    res.json({ 
      status: 'healthy', 
      database: 'connected',
      timestamp: new Date().toISOString(),
      pakistan_time: getPakistanTimestamp()
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'unhealthy', 
      database: 'disconnected',
      error: error.message 
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  if (process.env.NODE_ENV !== 'production') {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
  } else {
    res.json({ 
      message: 'Super Leather Craft Backend API', 
      status: 'running',
      environment: process.env.NODE_ENV,
      frontend: 'https://super-leather-craft.vercel.app',
      docs: 'API endpoints are available under /api/*',
      server_time: getPakistanTimestamp()
    });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Input validation
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required' });
    }

    // Check if password hash is ready
    if (!ADMIN_PASSWORD_HASH) {
      return res.status(503).json({ success: false, error: 'Server is initializing, please try again shortly' });
    }

    // Check credentials
    if (username !== ADMIN_USERNAME) {
      console.log('❌ Login failed - invalid username');
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Compare passwords
    const isMatch = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!isMatch) {
      console.log('❌ Login failed - invalid password');
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        username: ADMIN_USERNAME,
        type: 'admin'
      }, 
      JWT_SECRET, 
      { expiresIn: JWT_EXPIRES_IN }
    );

    console.log('✅ Login successful - JWT token issued');
    res.json({
      success: true,
      token,
      business: businessConfig.business,
      login_time: getPakistanTimestamp()
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get business info
app.get('/api/business', authenticate, (req, res) => {
  res.json(businessConfig.business);
});

// Add transaction (sale or expense) with enhanced timestamp tracking
app.post('/api/transactions', authenticate, async (req, res) => {
  try {
    const { date, account_name, description, amount, type } = req.body;
    
    // Validation
    if (!date || !account_name || !amount || !type) {
      return res.status(400).json({ error: 'Missing required fields: date, account_name, amount, type' });
    }

    if (!['credit', 'debit'].includes(type)) {
      return res.status(400).json({ error: 'Type must be either "credit" or "debit"' });
    }

    // Get Pakistan timestamp
    const pakistanTimestamp = getPakistanTimestamp();
    
    // Get next TID
    const tid = await new Promise((resolve, reject) => {
      db.getNextTID((err, tid) => {
        if (err) reject(err);
        else resolve(tid);
      });
    });

    // Insert transaction with comprehensive timestamp tracking
    const insertQuery = `
      INSERT INTO transactions (
        tid, date, account_name, description, amount, type, reference,
        created_at, updated_at, transaction_time, created_by
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
      RETURNING id, created_at, transaction_time
    `;
    const reference = `REF-${Date.now()}`;
    const pakistanTime = getPakistanTime();
    
    const result = await db.pool.query(insertQuery, [
      tid, date, account_name, description, amount, type, reference,
      pakistanTimestamp, pakistanTimestamp, pakistanTime, req.user.username
    ]);
    
    const transactionId = result.rows[0].id;
    const createdAt = result.rows[0].created_at;
    const transactionTime = result.rows[0].transaction_time;

    // Log audit trail
    await db.logAudit(
      'transactions',
      transactionId,
      'INSERT',
      null,
      { date, account_name, description, amount, type, tid, reference },
      req.user.username
    );

    // Update account balance
    const balanceChange = type === 'credit' ? amount : -amount;
    await db.pool.query(
      'UPDATE accounts SET balance = balance + $1 WHERE name = $2',
      [balanceChange, account_name]
    );

    res.json({ 
      success: true, 
      id: transactionId,
      tid: tid,
      created_at: createdAt,
      transaction_time: transactionTime,
      formatted_timestamp: formatTimestampForDisplay(createdAt),
      message: 'Transaction recorded successfully'
    });

  } catch (error) {
    console.error('❌ Transaction creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all transactions with enhanced timestamp data
app.get('/api/transactions', authenticate, async (req, res) => {
  try {
    const { start_date, end_date, account_name, type, limit } = req.query;
    
    let query = `
  SELECT *, COALESCE(tid, id) as display_id 
  FROM transactions WHERE 1=1
`;
    const params = [];
    let paramCount = 0;

    if (start_date) {
      paramCount++;
      query += ` AND date >= $${paramCount}`;
      params.push(start_date);
    }
    if (end_date) {
      paramCount++;
      query += ` AND date <= $${paramCount}`;
      params.push(end_date);
    }
    if (account_name) {
      paramCount++;
      query += ` AND account_name = $${paramCount}`;
      params.push(account_name);
    }
    if (type) {
      paramCount++;
      query += ` AND type = $${paramCount}`;
      params.push(type);
    }

    query += ` ORDER BY date DESC, created_at DESC`;

    if (limit) {
      paramCount++;
      query += ` LIMIT $${paramCount}`;
      params.push(parseInt(limit));
    }

    const result = await db.pool.query(query, params);
    res.json(result.rows);

  } catch (error) {
    console.error('❌ Get transactions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get accounts
app.get('/api/accounts', authenticate, async (req, res) => {
  try {
    const result = await db.pool.query('SELECT * FROM accounts ORDER BY type, name');
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Get accounts error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get dashboard summary - FIXED CALCULATION
app.get('/api/dashboard', authenticate, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Today's sales and expenses
    const todayQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) as today_sales,
        COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END), 0) as today_expenses
      FROM transactions 
      WHERE date = $1
    `;

    // FIXED: Calculate total sales and expenses from ALL transactions
    const totalQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) as total_sales,
        COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END), 0) as total_expenses
      FROM transactions
    `;

    const [todayResult, totalResult] = await Promise.all([
      db.pool.query(todayQuery, [today]),
      db.pool.query(totalQuery)
    ]);

    const todayData = todayResult.rows[0];
    const totalData = totalResult.rows[0];
    
    // FIXED: Net balance = Total Sales - Total Expenses
    const netBalance = totalData.total_sales - totalData.total_expenses;
    
    res.json({
      today_sales: parseFloat(todayData.today_sales),
      today_expenses: parseFloat(todayData.today_expenses),
      net_balance: parseFloat(netBalance),
      total_sales: parseFloat(totalData.total_sales), // Renamed for clarity
      total_expenses: parseFloat(totalData.total_expenses), // Renamed for clarity
      server_time: getPakistanTimestamp()
    });

  } catch (error) {
    console.error('❌ Dashboard error:', error);
    res.status(500).json({ error: error.message });
  }
});
// Save daily cash summary
app.post('/api/daily-summary', authenticate, async (req, res) => {
  try {
    const { date, physical_cash, notes } = req.body;
    
    if (!date || physical_cash === undefined) {
      return res.status(400).json({ error: 'Date and physical cash are required' });
    }

    // Calculate expected cash (sales - expenses)
    const summaryQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) as total_sales,
        COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END), 0) as total_expenses
      FROM transactions 
      WHERE date = $1
    `;

    const result = await db.pool.query(summaryQuery, [date]);
    const data = result.rows[0];

    const total_sales = parseFloat(data.total_sales);
    const total_expenses = parseFloat(data.total_expenses);
    const expected_cash = total_sales - total_expenses;
    const difference = physical_cash - expected_cash;

    const pakistanTimestamp = getPakistanTimestamp();

    const upsertQuery = `
      INSERT INTO daily_summaries 
      (date, total_sales, total_expenses, expected_cash, physical_cash, difference, notes, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (date) 
      DO UPDATE SET 
        total_sales = EXCLUDED.total_sales,
        total_expenses = EXCLUDED.total_expenses,
        expected_cash = EXCLUDED.expected_cash,
        physical_cash = EXCLUDED.physical_cash,
        difference = EXCLUDED.difference,
        notes = EXCLUDED.notes,
        updated_at = EXCLUDED.updated_at
      RETURNING id, created_at, updated_at
    `;

    const upsertResult = await db.pool.query(upsertQuery, [
      date, total_sales, total_expenses, expected_cash, physical_cash, difference, notes, pakistanTimestamp
    ]);

    res.json({ 
      success: true, 
      id: upsertResult.rows[0].id,
      created_at: upsertResult.rows[0].created_at,
      updated_at: upsertResult.rows[0].updated_at,
      message: 'Daily summary saved successfully'
    });

  } catch (error) {
    console.error('❌ Daily summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get daily summaries
app.get('/api/daily-summaries', authenticate, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    let query = `
      SELECT *, 
             TO_CHAR(created_at, 'DD Mon YYYY, HH24:MI') as created_at_display,
             TO_CHAR(updated_at, 'DD Mon YYYY, HH24:MI') as updated_at_display
      FROM daily_summaries WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    if (start_date) {
      paramCount++;
      query += ` AND date >= $${paramCount}`;
      params.push(start_date);
    }
    if (end_date) {
      paramCount++;
      query += ` AND date <= $${paramCount}`;
      params.push(end_date);
    }

    query += ` ORDER BY date DESC`;

    const result = await db.pool.query(query, params);
    res.json(result.rows);

  } catch (error) {
    console.error('❌ Get daily summaries error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update transaction with comprehensive audit tracking
app.put('/api/transactions/:id', authenticate, async (req, res) => {
  try {
    const transactionId = req.params.id;
    const { date, account_name, description, amount, type } = req.body;
    
    if (!date || !account_name || !amount || !type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!['credit', 'debit'].includes(type)) {
      return res.status(400).json({ error: 'Type must be either "credit" or "debit"' });
    }

    // Get Pakistan timestamp for update
    const pakistanTimestamp = getPakistanTimestamp();

    // Get old transaction first
    const oldResult = await db.pool.query('SELECT * FROM transactions WHERE id = $1', [transactionId]);
    if (oldResult.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const oldTransaction = oldResult.rows[0];

    // Update transaction with timestamp and version increment
    const updateQuery = `
      UPDATE transactions 
      SET date = $1, account_name = $2, description = $3, amount = $4, type = $5, 
          updated_at = $6, version = version + 1, updated_by = $7
      WHERE id = $8
      RETURNING updated_at, version
    `;
    
    const updateResult = await db.pool.query(updateQuery, [
      date, account_name, description, amount, type, 
      pakistanTimestamp, req.user.username, transactionId
    ]);

    // Log audit trail
    await db.logAudit(
      'transactions',
      transactionId,
      'UPDATE',
      {
        date: oldTransaction.date,
        account_name: oldTransaction.account_name,
        description: oldTransaction.description,
        amount: oldTransaction.amount,
        type: oldTransaction.type
      },
      {
        date,
        account_name,
        description,
        amount,
        type
      },
      req.user.username
    );

    // Revert old balance change
    const oldBalanceChange = oldTransaction.type === 'credit' ? -oldTransaction.amount : oldTransaction.amount;
    await db.pool.query(
      'UPDATE accounts SET balance = balance + $1 WHERE name = $2',
      [oldBalanceChange, oldTransaction.account_name]
    );

    // Apply new balance change
    const newBalanceChange = type === 'credit' ? amount : -amount;
    await db.pool.query(
      'UPDATE accounts SET balance = balance + $1 WHERE name = $2',
      [newBalanceChange, account_name]
    );

    res.json({ 
      success: true, 
      message: 'Transaction updated successfully',
      updated_at: updateResult.rows[0].updated_at,
      version: updateResult.rows[0].version,
      formatted_timestamp: formatTimestampForDisplay(updateResult.rows[0].updated_at)
    });

  } catch (error) {
    console.error('❌ Update transaction error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete transaction with audit logging
app.delete('/api/transactions/:id', authenticate, async (req, res) => {
  try {
    const transactionId = req.params.id;
    
    // Get transaction first
    const result = await db.pool.query('SELECT * FROM transactions WHERE id = $1', [transactionId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const transaction = result.rows[0];

    // Log audit trail before deletion
    await db.logAudit(
      'transactions',
      transactionId,
      'DELETE',
      {
        date: transaction.date,
        account_name: transaction.account_name,
        description: transaction.description,
        amount: transaction.amount,
        type: transaction.type,
        tid: transaction.tid
      },
      null,
      req.user.username
    );

    // Delete transaction
    await db.pool.query('DELETE FROM transactions WHERE id = $1', [transactionId]);

    // Update account balance
    const balanceChange = transaction.type === 'credit' ? -transaction.amount : transaction.amount;
    await db.pool.query(
      'UPDATE accounts SET balance = balance + $1 WHERE name = $2',
      [balanceChange, transaction.account_name]
    );

    res.json({ 
      success: true, 
      message: 'Transaction deleted successfully',
      deleted_at: getPakistanTimestamp()
    });

  } catch (error) {
    console.error('❌ Delete transaction error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single transaction with full audit history
app.get('/api/transactions/:id', authenticate, async (req, res) => {
  try {
    const transactionId = req.params.id;
    
    const result = await db.pool.query(
  `SELECT *, COALESCE(tid, id) as display_id 
   FROM transactions WHERE id = $1`, 
  [transactionId]
);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    res.json(result.rows[0]);

  } catch (error) {
    console.error('❌ Get transaction error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get transaction audit history
app.get('/api/transactions/:id/audit', authenticate, async (req, res) => {
  try {
    const transactionId = req.params.id;
    
    const auditResult = await db.pool.query(
      `SELECT action, changed_by, changed_at, old_values, new_values,
              TO_CHAR(changed_at, 'DD Mon YYYY, HH24:MI:SS') as changed_at_display
       FROM audit_log 
       WHERE table_name = 'transactions' AND record_id = $1
       ORDER BY changed_at DESC`,
      [transactionId]
    );
    
    res.json(auditResult.rows);

  } catch (error) {
    console.error('❌ Get transaction audit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== ERROR HANDLING ====================

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('🚨 Global Error Handler:', error);
  res.status(500).json({ 
    error: 'Internal Server Error',
    timestamp: getPakistanTimestamp()
  });
});

// ==================== SERVER STARTUP ====================

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Frontend: http://localhost:${PORT}`);
  console.log(`🔑 Login username: ${ADMIN_USERNAME}`);
  console.log(`🔒 JWT Authentication enabled`);
  console.log(`⏰ Token expiration: ${JWT_EXPIRES_IN}`);
  console.log(`🛡️ Security headers enabled with Helmet`);
  console.log(`🌐 CORS configured for production`);
  console.log(`⏰ Server time: ${getPakistanTimestamp()}`);
});






