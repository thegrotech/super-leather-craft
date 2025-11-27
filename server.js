const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');
const businessConfig = require('./business.json');
const helmet = require('helmet');
require('dotenv').config();

// JWT authentication packages (now installed)
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Environment variables for authentication
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = '24h'; // Token expires in 24 hours

// We'll hash the password on server start
let ADMIN_PASSWORD_HASH = '';

// Hash the admin password when server starts
console.log('🔐 Hashing admin password...');
bcrypt.hash(ADMIN_PASSWORD, 10, (err, hash) => {
    if (err) {
        console.error('❌ Failed to hash password:', err);
        process.exit(1);
    }
    ADMIN_PASSWORD_HASH = hash;
    console.log('✅ Admin password hashed successfully');
});


const app = express();
const PORT = process.env.PORT || 5000;

// Security Middleware
app.use(helmet()); // ← ADD THIS - Adds security headers

// CORS configuration - only allow your frontend
app.use(cors({
    origin: 'http://localhost:5000', // Your frontend URL
    credentials: true
}));

// Other middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Simple base64 encoding function (since btoa is not available in Node.js)
const btoa = (str) => Buffer.from(str).toString('base64');
const atob = (str) => Buffer.from(str, 'base64').toString();

// JWT Authentication middleware
const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized - No token provided' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    try {
        // Verify JWT token
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // Attach user info to request
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

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Routes

// Login
// Login with JWT and password hashing
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    // Check username first
    if (username !== ADMIN_USERNAME) {
        console.log('❌ Login failed - username mismatch');
        return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Check if password hash is ready
    if (!ADMIN_PASSWORD_HASH) {
        console.log('❌ Password hash not ready yet');
        return res.status(500).json({ success: false, error: 'Server not ready' });
    }

    // Check password using bcrypt (secure comparison)
    bcrypt.compare(password, ADMIN_PASSWORD_HASH, (err, isMatch) => {
        if (err) {
            console.error('❌ Password comparison error:', err);
            return res.status(500).json({ success: false, error: 'Server error' });
        }

        if (isMatch) {
            // Create JWT token
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
        } else {
            console.log('❌ Login failed - incorrect password');
            res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
    });
});

// Get business info
app.get('/api/business', authenticate, (req, res) => {
    res.json(businessConfig.business);
});

// Add transaction (sale or expense) - UPDATED WITH TID
app.post('/api/transactions', authenticate, (req, res) => {
    const { date, account_name, description, amount, type } = req.body;
    
    if (!date || !account_name || !amount || !type) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get next TID first
    db.getNextTID((err, tid) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to generate transaction ID' });
        }

        const query = `INSERT INTO transactions (tid, date, account_name, description, amount, type, reference) 
                       VALUES (?, ?, ?, ?, ?, ?, ?)`;
        
        db.run(query, [tid, date, account_name, description, amount, type, `REF-${Date.now()}`], 
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            
            // Update account balance
            const balanceChange = type === 'credit' ? amount : -amount;
            db.run(`UPDATE accounts SET balance = balance + ? WHERE name = ?`, 
                   [balanceChange, account_name]);
            
            res.json({ 
                success: true, 
                id: this.lastID,
                tid: tid, // Return TID to frontend
                message: 'Transaction recorded successfully'
            });
        });
    });
});

// Get all transactions with filtering - UPDATED TO INCLUDE TID
app.get('/api/transactions', authenticate, (req, res) => {
    const { start_date, end_date, account_name, type, limit } = req.query;
    
    let query = `SELECT *, COALESCE(tid, id) as display_id FROM transactions WHERE 1=1`;
    const params = [];

    if (start_date) {
        query += ` AND date >= ?`;
        params.push(start_date);
    }
    if (end_date) {
        query += ` AND date <= ?`;
        params.push(end_date);
    }
    if (account_name) {
        query += ` AND account_name = ?`;
        params.push(account_name);
    }
    if (type) {
        query += ` AND type = ?`;
        params.push(type);
    }

    query += ` ORDER BY date DESC, created_at DESC`;

    if (limit) {
        query += ` LIMIT ?`;
        params.push(parseInt(limit));
    }

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// Get accounts
app.get('/api/accounts', authenticate, (req, res) => {
    db.all(`SELECT * FROM accounts ORDER BY type, name`, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// Get dashboard summary
app.get('/api/dashboard', authenticate, (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    
    // Today's sales and expenses
    const todayQuery = `
        SELECT 
            SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END) as today_sales,
            SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END) as today_expenses
        FROM transactions 
        WHERE date = ?
    `;

    // Current balances
    const balanceQuery = `
        SELECT 
            SUM(CASE WHEN type = 'revenue' THEN balance ELSE 0 END) as total_revenue,
            SUM(CASE WHEN type = 'expense' THEN balance ELSE 0 END) as total_expenses
        FROM accounts
    `;

    db.get(todayQuery, [today], (err, todayData) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        db.get(balanceQuery, (err, balanceData) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            
            const netBalance = (balanceData.total_revenue || 0) - (balanceData.total_expenses || 0);
            
            res.json({
                today_sales: todayData.today_sales || 0,
                today_expenses: todayData.today_expenses || 0,
                net_balance: netBalance,
                total_revenue: balanceData.total_revenue || 0,
                total_expenses: balanceData.total_expenses || 0
            });
        });
    });
});

// Save daily cash summary
app.post('/api/daily-summary', authenticate, (req, res) => {
    const { date, physical_cash, notes } = req.body;
    
    if (!date || physical_cash === undefined) {
        return res.status(400).json({ error: 'Date and physical cash are required' });
    }

    // Calculate expected cash (sales - expenses)
    const summaryQuery = `
        SELECT 
            SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END) as total_sales,
            SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END) as total_expenses
        FROM transactions 
        WHERE date = ?
    `;

    db.get(summaryQuery, [date], (err, data) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        const total_sales = data.total_sales || 0;
        const total_expenses = data.total_expenses || 0;
        const expected_cash = total_sales - total_expenses;
        const difference = physical_cash - expected_cash;

        const upsertQuery = `
            INSERT OR REPLACE INTO daily_summaries 
            (date, total_sales, total_expenses, expected_cash, physical_cash, difference, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        db.run(upsertQuery, [date, total_sales, total_expenses, expected_cash, physical_cash, difference, notes], 
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, id: this.lastID });
        });
    });
});

// Get daily summaries
app.get('/api/daily-summaries', authenticate, (req, res) => {
    const { start_date, end_date } = req.query;
    
    let query = `SELECT * FROM daily_summaries WHERE 1=1`;
    const params = [];

    if (start_date) {
        query += ` AND date >= ?`;
        params.push(start_date);
    }
    if (end_date) {
        query += ` AND date <= ?`;
        params.push(end_date);
    }

    query += ` ORDER BY date DESC`;

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// Update transaction - UPDATED TO PRESERVE TID
app.put('/api/transactions/:id', authenticate, (req, res) => {
    const transactionId = req.params.id;
    const { date, account_name, description, amount, type } = req.body;
    
    if (!date || !account_name || !amount || !type) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get old transaction first to calculate balance difference
    db.get(`SELECT * FROM transactions WHERE id = ?`, [transactionId], (err, oldTransaction) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        if (!oldTransaction) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        // Update transaction - preserve the original TID
        const updateQuery = `
            UPDATE transactions 
            SET date = ?, account_name = ?, description = ?, amount = ?, type = ?
            WHERE id = ?
        `;
        
        db.run(updateQuery, [date, account_name, description, amount, type, transactionId], 
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            
            // Revert old balance change
            const oldBalanceChange = oldTransaction.type === 'credit' ? -oldTransaction.amount : oldTransaction.amount;
            db.run(`UPDATE accounts SET balance = balance + ? WHERE name = ?`, 
                   [oldBalanceChange, oldTransaction.account_name]);
            
            // Apply new balance change
            const newBalanceChange = type === 'credit' ? amount : -amount;
            db.run(`UPDATE accounts SET balance = balance + ? WHERE name = ?`, 
                   [newBalanceChange, account_name]);
            
            res.json({ 
                success: true, 
                message: 'Transaction updated successfully'
            });
        });
    });
});

// Delete transaction
app.delete('/api/transactions/:id', authenticate, (req, res) => {
    const transactionId = req.params.id;
    
    // Get transaction first to update account balance
    db.get(`SELECT * FROM transactions WHERE id = ?`, [transactionId], (err, transaction) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        if (!transaction) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        // Delete transaction
        db.run(`DELETE FROM transactions WHERE id = ?`, [transactionId], function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            
            // Update account balance
            const balanceChange = transaction.type === 'credit' ? -transaction.amount : transaction.amount;
            db.run(`UPDATE accounts SET balance = balance + ? WHERE name = ?`, 
                   [balanceChange, transaction.account_name]);
            
            res.json({ 
                success: true, 
                message: 'Transaction deleted successfully'
            });
        });
    });
});

// Get single transaction
app.get('/api/transactions/:id', authenticate, (req, res) => {
    const transactionId = req.params.id;
    
    db.get(`SELECT *, COALESCE(tid, id) as display_id FROM transactions WHERE id = ?`, [transactionId], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        if (!row) {
            return res.status(404).json({ error: 'Transaction not found' });
        }
        
        res.json(row);
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Frontend: http://localhost:${PORT}`);
    console.log(`🔑 Login username: ${ADMIN_USERNAME}`);
    console.log(`🔒 JWT Authentication enabled`);
    console.log(`⏰ Token expiration: ${JWT_EXPIRES_IN}`);
    console.log(`🛡️  Security headers enabled with Helmet`);
});