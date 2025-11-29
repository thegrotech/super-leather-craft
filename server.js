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

// ==================== MIDDLEWARE ====================

// Security headers
app.use(helmet());

// CORS configuration - more permissive for production
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
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

// ==================== UTILITY FUNCTIONS ====================

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
      timestamp: new Date().toISOString()
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
      docs: 'API endpoints are available under /api/*'
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
      business: businessConfig.business
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

// Add transaction (sale or expense)
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

    // Get next TID
    const tid = await new Promise((resolve, reject) => {
      db.getNextTID((err, tid) => {
        if (err) reject(err);
        else resolve(tid);
      });
    });

    // Insert transaction with RETURNING clause for PostgreSQL
    const insertQuery = `
      INSERT INTO transactions (tid, date, account_name, description, amount, type, reference) 
      VALUES ($1, $2, $3, $4, $5, $6, $7) 
      RETURNING id
    `;
    const reference = `REF-${Date.now()}`;
    
    const result = await db.pool.query(insertQuery, [tid, date, account_name, description, amount, type, reference]);
    const transactionId = result.rows[0].id;

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
      message: 'Transaction recorded successfully'
    });

  } catch (error) {
    console.error('❌ Transaction creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all transactions with filtering
app.get('/api/transactions', authenticate, async (req, res) => {
  try {
    const { start_date, end_date, account_name, type, limit } = req.query;
    
    let query = `SELECT *, COALESCE(tid, id) as display_id FROM transactions WHERE 1=1`;
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

// Get dashboard summary
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

    // Current balances
    const balanceQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'revenue' THEN balance ELSE 0 END), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN balance ELSE 0 END), 0) as total_expenses
      FROM accounts
    `;

    const [todayResult, balanceResult] = await Promise.all([
      db.pool.query(todayQuery, [today]),
      db.pool.query(balanceQuery)
    ]);

    const todayData = todayResult.rows[0];
    const balanceData = balanceResult.rows[0];
    
    const netBalance = balanceData.total_revenue - balanceData.total_expenses;
    
    res.json({
      today_sales: parseFloat(todayData.today_sales),
      today_expenses: parseFloat(todayData.today_expenses),
      net_balance: parseFloat(netBalance),
      total_revenue: parseFloat(balanceData.total_revenue),
      total_expenses: parseFloat(balanceData.total_expenses)
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

    const upsertQuery = `
      INSERT INTO daily_summaries 
      (date, total_sales, total_expenses, expected_cash, physical_cash, difference, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (date) 
      DO UPDATE SET 
        total_sales = EXCLUDED.total_sales,
        total_expenses = EXCLUDED.total_expenses,
        expected_cash = EXCLUDED.expected_cash,
        physical_cash = EXCLUDED.physical_cash,
        difference = EXCLUDED.difference,
        notes = EXCLUDED.notes
      RETURNING id
    `;

    const upsertResult = await db.pool.query(upsertQuery, [
      date, total_sales, total_expenses, expected_cash, physical_cash, difference, notes
    ]);

    res.json({ success: true, id: upsertResult.rows[0].id });

  } catch (error) {
    console.error('❌ Daily summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get daily summaries
app.get('/api/daily-summaries', authenticate, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    let query = `SELECT * FROM daily_summaries WHERE 1=1`;
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

// Update transaction
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

    // Get old transaction first
    const oldResult = await db.pool.query('SELECT * FROM transactions WHERE id = $1', [transactionId]);
    if (oldResult.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const oldTransaction = oldResult.rows[0];

    // Update transaction
    const updateQuery = `
      UPDATE transactions 
      SET date = $1, account_name = $2, description = $3, amount = $4, type = $5
      WHERE id = $6
    `;
    
    await db.pool.query(updateQuery, [date, account_name, description, amount, type, transactionId]);

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
      message: 'Transaction updated successfully'
    });

  } catch (error) {
    console.error('❌ Update transaction error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete transaction
app.delete('/api/transactions/:id', authenticate, async (req, res) => {
  try {
    const transactionId = req.params.id;
    
    // Get transaction first
    const result = await db.pool.query('SELECT * FROM transactions WHERE id = $1', [transactionId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const transaction = result.rows[0];

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
      message: 'Transaction deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete transaction error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single transaction
app.get('/api/transactions/:id', authenticate, async (req, res) => {
  try {
    const transactionId = req.params.id;
    
    const result = await db.pool.query(
      'SELECT *, COALESCE(tid, id) as display_id FROM transactions WHERE id = $1', 
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

// ==================== ERROR HANDLING ====================

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('🚨 Global Error Handler:', error);
  res.status(500).json({ error: 'Internal Server Error' });
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
});
