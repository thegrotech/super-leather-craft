class LeatherShopAccounting {
    constructor() {
        this.token = null;
        this.businessInfo = null;
        this.currentPage = 'dashboard';
        this.inactivityTimer = null;
        this.INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes
        this.init();
    }

    // ADD THIS NEW METHOD FOR SECURITY
    escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return unsafe;
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    init() {
        this.setCurrentDate();
        this.attachEventListeners();
        this.checkAuth();
        this.setupInactivityTimer();
        this.displayCurrentTime(); // Initialize current time display
    }

    setCurrentDate() {
    // Get current date in Pakistan Timezone
    const now = new Date();
    const pakDate = new Intl.DateTimeFormat('en-CA', { // en-CA gives YYYY-MM-DD
        timeZone: 'Asia/Karachi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(now);

    const options = { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    };
    
    document.getElementById('currentDate').textContent = 
        now.toLocaleDateString('en-US', options);
    
    // Set default dates to the actual Pakistan "Today"
    document.getElementById('saleDate').value = pakDate;
    document.getElementById('expenseDate').value = pakDate;
    document.getElementById('summaryDate').value = pakDate;
    document.getElementById('filterStartDate').value = pakDate;
    document.getElementById('filterEndDate').value = pakDate;
}

    // NEW: Display current Pakistan time
    displayCurrentTime() {
        const updateTime = () => {
            const now = new Date();
            const pakistanTime = now.toLocaleString('en-PK', {
                timeZone: 'Asia/Karachi',
                hour12: true,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            const timeElement = document.getElementById('currentTime');
            if (timeElement) {
                timeElement.textContent = `Pakistan Time: ${pakistanTime}`;
            }
        };
        
        updateTime();
        setInterval(updateTime, 1000);
    }

    attachEventListeners() {
        // Login form
        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        // Logout button
        document.getElementById('logoutBtn').addEventListener('click', () => {
            this.handleLogout();
        });

        // Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const page = e.currentTarget.getAttribute('data-page');
                this.showPage(page);
            });
        });

        // Transaction forms
        document.getElementById('salesForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSaleSubmit();
        });

        document.getElementById('expenseForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleExpenseSubmit();
        });

        // Ledger filters
        document.getElementById('applyFilters').addEventListener('click', () => {
            this.loadLedger();
        });

        document.getElementById('resetFilters').addEventListener('click', () => {
            this.resetFilters();
        });

        // Print buttons
        document.querySelector('.print-ledger-btn')?.addEventListener('click', () => {
            this.printLedger();
        });

        document.querySelector('.print-summary-btn')?.addEventListener('click', () => {
            this.printDailySummary();
        });

        // Daily summary
        document.getElementById('summaryForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleDailySummarySubmit();
        });

        document.getElementById('summaryDate').addEventListener('change', (e) => {
            this.loadDailySummaryPreview(e.target.value);
        });

        document.getElementById('physicalCash').addEventListener('input', (e) => {
            this.calculateDifference();
        });

        // Dashboard quick actions
        document.querySelectorAll('.action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetPage = e.currentTarget.getAttribute('data-target');
                if (targetPage) {
                    this.showPage(targetPage);
                }
            });
        });

        // Global activity listeners for inactivity timer
        ['mousemove', 'keypress', 'click', 'scroll'].forEach(event => {
            document.addEventListener(event, () => {
                this.resetInactivityTimer();
            });
        });
        // Password visibility toggle
        document.querySelectorAll('.toggle-password').forEach(icon => {
            icon.addEventListener('click', () => {
                const input = icon.previousElementSibling; // password input
                if (input.type === 'password') {
                    input.type = 'text';
                    icon.classList.remove('fa-eye');
                    icon.classList.add('fa-eye-slash');
                } else {
                    input.type = 'password';
                    icon.classList.remove('fa-eye-slash');
                    icon.classList.add('fa-eye');
                }
            });
        });
    }

    // Authentication Methods
    async handleLogin() {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        try {
            const response = await this.apiCall('/api/login', 'POST', {
                username,
                password
            });

            if (response.success) {
                this.token = response.token;
                this.businessInfo = response.business;
                
                // Save token to localStorage for persistence
                localStorage.setItem('authToken', this.token);
                localStorage.setItem('businessInfo', JSON.stringify(this.businessInfo));
                
                this.showApp();
                this.showNotification(`Login successful at ${this.formatTime(new Date())}!`, 'success');
                this.resetInactivityTimer();
            } else {
                this.showNotification('Invalid credentials!', 'error');
            }
        } catch (error) {
            this.showNotification('Login failed!', 'error');
        }
    }

    handleLogout() {
        this.token = null;
        this.businessInfo = null;
        localStorage.removeItem('authToken');
        localStorage.removeItem('businessInfo');
        this.showLogin();
        this.clearInactivityTimer();
        this.showNotification(`Logged out at ${this.formatTime(new Date())}!`, 'success');
    }

    checkAuth() {
        const token = localStorage.getItem('authToken');
        const businessInfo = localStorage.getItem('businessInfo');
        
        if (token) {
            this.token = token;
            this.businessInfo = businessInfo ? JSON.parse(businessInfo) : null;
            this.showApp();
            this.resetInactivityTimer();
        }
    }

    // Inactivity Timer Methods
    setupInactivityTimer() {
        this.resetInactivityTimer();
    }

    resetInactivityTimer() {
        this.clearInactivityTimer();
        this.inactivityTimer = setTimeout(() => {
            this.handleAutoLogout();
        }, this.INACTIVITY_TIMEOUT);
    }

    clearInactivityTimer() {
        if (this.inactivityTimer) {
            clearTimeout(this.inactivityTimer);
            this.inactivityTimer = null;
        }
    }

    handleAutoLogout() {
        if (this.token) {
            this.showNotification(`Session expired due to inactivity at ${this.formatTime(new Date())}. Please login again.`, 'warning');
            this.handleLogout();
        }
    }

    // Page Management
    showLogin() {
        document.getElementById('loginScreen').classList.add('active');
        document.getElementById('appScreen').classList.remove('active');
    }

    showApp() {
        document.getElementById('loginScreen').classList.remove('active');
        document.getElementById('appScreen').classList.add('active');
        document.getElementById('businessName').textContent = this.businessInfo?.name || 'Leather Shop';
        this.loadDashboard();
    }

    showPage(page) {
        // Update navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-page="${page}"]`).classList.add('active');

        // Hide all pages
        document.querySelectorAll('.page').forEach(p => {
            p.classList.remove('active');
        });

        // Show selected page
        document.getElementById(`${page}Page`).classList.add('active');
        this.currentPage = page;

        // Load page-specific data
        switch(page) {
            case 'dashboard':
                this.loadDashboard();
                break;
            case 'ledger':
                this.loadLedger();
                break;
            case 'summary':
                this.loadDailySummaries();
                break;
        }

        this.resetInactivityTimer();
    }

    // API Methods
    async apiCall(endpoint, method = 'GET', data = null) {
        const API_BASE_URL = 'https://super-leather-craft-backend.onrender.com';
        
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
            }
        };

        if (this.token) {
            options.headers.Authorization = `Bearer ${this.token}`;
        }

        if (data) {
            options.body = JSON.stringify(data);
        }

        try {
            const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
            if (response.status === 401) {
                this.handleLogout();
                throw new Error('Unauthorized');
            }
            return await response.json();
        } catch (error) {
            if (error.message === 'Unauthorized') {
                this.showNotification('Session expired. Please login again.', 'error');
            }
            throw error;
        }
    }

    // Transaction Methods - UPDATED WITH TIMESTAMP SUPPORT
    async handleSaleSubmit() {
        const formData = {
            date: document.getElementById('saleDate').value,
            account_name: 'Cash Sales',
            description: document.getElementById('saleDescription').value,
            amount: parseFloat(document.getElementById('saleAmount').value),
            type: 'credit'
        };

        // Check if editing existing transaction
        const editingId = document.getElementById('salesForm').dataset.editingId;
        
        try {
            if (editingId) {
                // Update existing transaction
                const result = await this.apiCall(`/api/transactions/${editingId}`, 'PUT', formData);
                // This will now correctly show the Karachi time from the server response this.showNotification(`Sale updated successfully at ${this.formatTime(result.updated_at)}!`, 'success');
                delete document.getElementById('salesForm').dataset.editingId;
            } else {
                // Create new transaction
                const result = await this.apiCall('/api/transactions', 'POST', formData);
                const timeInfo = result.transaction_time ? ` at ${result.transaction_time}` : '';
                this.showNotification(`Sale recorded successfully! TID: ${result.tid}${timeInfo}`, 'success');
            }
            
            this.resetForm('salesForm');
            this.loadDashboard();
        } catch (error) {
            this.showNotification('Failed to record sale!', 'error');
        }
    }

    async handleExpenseSubmit() {
        const formData = {
            date: document.getElementById('expenseDate').value,
            account_name: document.getElementById('expenseAccount').value,
            description: document.getElementById('expenseDescription').value,
            amount: parseFloat(document.getElementById('expenseAmount').value),
            type: 'debit'
        };

        // Check if editing existing transaction
        const editingId = document.getElementById('expenseForm').dataset.editingId;
        
        try {
            if (editingId) {
                // Update existing transaction
                const result = await this.apiCall(`/api/transactions/${editingId}`, 'PUT', formData);
                this.showNotification(`Expense updated successfully at ${this.formatTime(new Date(result.updated_at))}!`, 'success');
                delete document.getElementById('expenseForm').dataset.editingId;
            } else {
                // Create new transaction
                const result = await this.apiCall('/api/transactions', 'POST', formData);
                const timeInfo = result.transaction_time ? ` at ${result.transaction_time}` : '';
                this.showNotification(`Expense recorded successfully! TID: ${result.tid}${timeInfo}`, 'success');
            }
            
            this.resetForm('expenseForm');
            this.loadDashboard();
        } catch (error) {
            this.showNotification('Failed to record expense!', 'error');
        }
    }

    // Dashboard Methods
    async loadDashboard() {
        try {
            const [dashboardData, recentTransactions] = await Promise.all([
                this.apiCall('/api/dashboard'),
                this.apiCall('/api/transactions?limit=5')
            ]);

            this.updateDashboardStats(dashboardData);
            this.updateRecentTransactions(recentTransactions);
        } catch (error) {
            console.error('Failed to load dashboard:', error);
        }
    }

    updateDashboardStats(data) {
        // Handle both old and new field names for compatibility
        const todaySales = data.today_sales || 0;
        const todayExpenses = data.today_expenses || 0;
        const netBalance = data.net_balance || 0;
    
        document.getElementById('todaySales').textContent = 
            this.formatCurrency(todaySales);
        document.getElementById('todayExpenses').textContent = 
            this.formatCurrency(todayExpenses);
        document.getElementById('netBalance').textContent = 
            this.formatCurrency(netBalance);
    }

    updateRecentTransactions(transactions) {
        const container = document.getElementById('recentTransactions');
        
        if (transactions.length === 0) {
            container.innerHTML = '<div class="transaction-item"><em>No transactions yet</em></div>';
            return;
        }

        container.innerHTML = transactions.slice(0, 5).map(transaction => `
            <div class="transaction-item">
                <div class="transaction-info">
                    <div class="transaction-tid">TID: ${transaction.display_id}</div>
                    <div class="transaction-date">
                        ${this.formatDate(transaction.date)}
                        ${transaction.timestamp_info ? `<br><small class="timestamp">${transaction.timestamp_info}</small>` : ''}
                    </div>
                    <div class="transaction-desc">${this.escapeHtml(transaction.description || 'No description')}</div>
                    <div class="transaction-account">${transaction.account_name}</div>
                </div>
                <div class="transaction-amount ${transaction.type}">
                    ${transaction.type === 'credit' ? '+' : '-'} ${this.formatCurrency(transaction.amount)}
                </div>
            </div>
        `).join('');
    }

    // Ledger Methods - UPDATED WITH TIMESTAMP DISPLAY
    async loadLedger() {
        const filters = this.getLedgerFilters();
        
        try {
            const transactions = await this.apiCall(`/api/transactions?${filters}`);
            this.displayLedger(transactions);
            this.calculateLedgerSummary(transactions);
        } catch (error) {
            console.error('Failed to load ledger:', error);
        }
    }

    getLedgerFilters() {
        const params = new URLSearchParams();
        
        const startDate = document.getElementById('filterStartDate').value;
        const endDate = document.getElementById('filterEndDate').value;
        const type = document.getElementById('filterType').value;

        if (startDate) params.append('start_date', startDate);
        if (endDate) params.append('end_date', endDate);
        if (type) params.append('type', type);

        return params.toString();
    }

    displayLedger(transactions) {
        const tbody = document.getElementById('ledgerTableBody');
        
        if (transactions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem;"><em>No transactions found</em></td></tr>';
            return;
        }
    
        tbody.innerHTML = transactions.map(transaction => `
            <tr>
                <td>${transaction.display_id}</td>
                <td>
                    <div>${this.formatDate(transaction.date)}</div>
                    <small class="timestamp">Created: ${transaction.created_at_display || this.formatDateTime(transaction.created_at)}</small>
                    ${transaction.updated_at_display && transaction.updated_at_display !== transaction.created_at_display ? 
                        `<small class="timestamp updated">Updated: ${transaction.updated_at_display}</small>` : ''}
                    ${transaction.transaction_time_str ? `<small class="timestamp time">Time: ${transaction.transaction_time_str}</small>` : ''}
                </td>
                <td>
                    <span class="transaction-type ${transaction.type}">
                        ${transaction.type === 'credit' ? 'SALE' : 'EXPENSE'}
                    </span>
                </td>
                <td>${transaction.account_name}</td>
                <td>${this.escapeHtml(transaction.description || '-')}</td>
                <td class="${transaction.type}">
                    ${transaction.type === 'credit' ? '+' : '-'} ${this.formatCurrency(transaction.amount)}
                </td>
                <td>
                    <div class="action-buttons-small">
                        <button class="btn-edit" onclick="app.editTransaction(${transaction.id})" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-delete" onclick="app.deleteTransaction(${transaction.id})" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                        <button class="btn-info" onclick="app.viewTransactionAudit(${transaction.id})" title="View History">
                            <i class="fas fa-history"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    calculateLedgerSummary(transactions) {
        const summary = transactions.reduce((acc, transaction) => {
            // FIXED: Ensure amount is parsed as a number
            const amount = parseFloat(transaction.amount) || 0;
            if (transaction.type === 'credit') {
                acc.sales += amount;
            } else {
                acc.expenses += amount;
            }
            return acc;
        }, { sales: 0, expenses: 0 });
    
        // FIXED: Ensure we're working with valid numbers
        const totalSales = Number(summary.sales) || 0;
        const totalExpenses = Number(summary.expenses) || 0;
        const netAmount = totalSales - totalExpenses;
    
        document.getElementById('totalSalesAmount').textContent = 
            this.formatCurrency(totalSales);
        document.getElementById('totalExpensesAmount').textContent = 
            this.formatCurrency(totalExpenses);
        document.getElementById('netAmount').textContent = 
            this.formatCurrency(netAmount);
    }

    resetFilters() {
        document.getElementById('filterStartDate').value = '';
        document.getElementById('filterEndDate').value = '';
        document.getElementById('filterType').value = '';
        this.loadLedger();
    }

    // NEW: View transaction audit history
    async viewTransactionAudit(transactionId) {
        try {
            const auditHistory = await this.apiCall(`/api/transactions/${transactionId}/audit`);
            this.showAuditModal(transactionId, auditHistory);
        } catch (error) {
            this.showNotification('Failed to load transaction history!', 'error');
        }
    }

    showAuditModal(transactionId, auditHistory) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay active';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Transaction History - TID: ${transactionId}</h3>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
                </div>
                <div class="modal-body">
                    ${auditHistory.length === 0 ? 
                        '<p>No audit history found for this transaction.</p>' :
                        `<div class="audit-history">
                            ${auditHistory.map(record => `
                                <div class="audit-record">
                                    <div class="audit-header">
                                        <span class="audit-action ${record.action.toLowerCase()}">${record.action}</span>
                                        <span class="audit-time">${this.formatDateTime(record.changed_at)}</span>
                                    </div>
                                    <div class="audit-details">
                                        <div class="audit-user">By: ${record.changed_by}</div>
                                        ${record.old_values ? `
                                            <div class="audit-changes">
                                                <strong>Changes:</strong>
                                                ${Object.entries(record.old_values).map(([key, oldValue]) => {
                                                    const newValue = record.new_values[key];
                                                    return oldValue !== newValue ? 
                                                        `<div class="change-item">${key}: "${oldValue}" → "${newValue}"</div>` : '';
                                                }).join('')}
                                            </div>
                                        ` : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>`
                    }
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // Print Functionality - UPDATED WITH TIMESTAMPS
    async printLedger() {
        try {
            const filters = this.getLedgerFilters();
            const transactions = await this.apiCall(`/api/transactions?${filters}`);
            
            const printWindow = window.open('', '_blank');
            if (!printWindow) {
                this.showNotification('Please allow popups for printing', 'error');
                return;
            }

            const businessName = this.businessInfo?.name || 'Leather Shop';
            const currentDate = new Date().toLocaleDateString();
            const currentTime = this.formatTime(new Date());
            
            const summary = transactions.reduce((acc, transaction) => {
                // FIXED: Ensure amount is parsed as a number
                const amount = parseFloat(transaction.amount) || 0;
                if (transaction.type === 'credit') {
                    acc.sales += amount;
                } else {
                    acc.expenses += amount;
                }
                return acc;
            }, { sales: 0, expenses: 0 });

            const printContent = this.generateLedgerPrintContent(businessName, currentDate, currentTime, transactions, summary);
            
            printWindow.document.write(printContent);
            printWindow.document.close();
            
            printWindow.onload = () => {
                printWindow.focus();
            };
            
        } catch (error) {
            this.showNotification('Failed to generate print report!', 'error');
        }
    }

    generateLedgerPrintContent(businessName, currentDate, currentTime, transactions, summary) {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Ledger Report - ${businessName}</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 10px; }
                    .business-name { font-size: 24px; font-weight: bold; margin-bottom: 5px; }
                    .report-title { font-size: 18px; color: #666; }
                    .report-time { font-size: 14px; color: #888; margin-bottom: 10px; }
                    .summary { background: #f5f5f5; padding: 15px; margin: 20px 0; border-radius: 5px; }
                    .summary-item { display: flex; justify-content: space-between; margin: 5px 0; }
                    .summary-total { font-weight: bold; border-top: 1px solid #ccc; padding-top: 5px; }
                    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background-color: #f2f2f2; font-weight: bold; }
                    .credit { color: green; }
                    .debit { color: red; }
                    .timestamp { font-size: 11px; color: #666; display: block; }
                    .footer { margin-top: 30px; text-align: center; color: #666; font-size: 12px; }
                    @media print {
                        body { margin: 0; }
                        .no-print { display: none; }
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="business-name">${businessName}</div>
                    <div class="report-title">Transaction Ledger Report</div>
                    <div class="report-time">Generated on: ${currentDate} at ${currentTime}</div>
                </div>
                
                <div class="summary">
                    <div class="summary-item">
                        <span>Total Sales:</span>
                        <span>${this.formatCurrency(summary.sales)}</span>
                    </div>
                    <div class="summary-item">
                        <span>Total Expenses:</span>
                        <span>${this.formatCurrency(summary.expenses)}</span>
                    </div>
                    <div class="summary-item summary-total">
                        <span>Net Amount:</span>
                        <span>${this.formatCurrency(summary.sales - summary.expenses)}</span>
                    </div>
                </div>
                
                <table>
                    <thead>
                        <tr>
                            <th>TID</th>
                            <th>Date & Time</th>
                            <th>Type</th>
                            <th>Account</th>
                            <th>Description</th>
                            <th>Amount (PKR)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${transactions.map(transaction => `
                            <tr>
                                <td>${transaction.display_id}</td>
                                <td>
                                    ${this.formatDate(transaction.date)}
                                    ${transaction.timestamp_info ? `<span class="timestamp">${transaction.timestamp_info}</span>` : ''}
                                </td>
                                <td>${transaction.type === 'credit' ? 'SALE' : 'EXPENSE'}</td>
                                <td>${transaction.account_name}</td>
                                <td>${this.escapeHtml(transaction.description || '-')}</td>
                                <td class="${transaction.type}">
                                    ${transaction.type === 'credit' ? '+' : '-'} ${this.formatCurrency(transaction.amount)}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                
                <div class="footer">
                    <p>This is a computer-generated report from Leather Shop Accounting System</p>
                </div>
                
                <div class="no-print" style="margin-top: 20px; text-align: center;">
                    <button onclick="window.print()" style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;">
                        Print Report
                    </button>
                    <button onclick="window.close()" style="padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 5px; cursor: pointer; margin-left: 10px;">
                        Close Window
                    </button>
                </div>
            </body>
            </html>
        `;
    }

    // Daily Summary Methods
    async loadDailySummaryPreview(date) {
        try {
            const transactions = await this.apiCall(`/api/transactions?start_date=${date}&end_date=${date}`);
            
            const summary = transactions.reduce((acc, transaction) => {
                // FIXED: Ensure amount is parsed as a number
                const amount = parseFloat(transaction.amount) || 0;
                if (transaction.type === 'credit') {
                    acc.sales += amount;
                } else {
                    acc.expenses += amount;
                }
                return acc;
            }, { sales: 0, expenses: 0 });

            document.getElementById('previewSales').textContent = 
                this.formatCurrency(summary.sales);
            document.getElementById('previewExpenses').textContent = 
                this.formatCurrency(summary.expenses);
            
            const expected = summary.sales - summary.expenses;
            document.getElementById('previewExpected').textContent = 
                this.formatCurrency(expected);
            
            this.calculateDifference();
        } catch (error) {
            console.error('Failed to load summary preview:', error);
        }
    }

    calculateDifference() {
        const expected = parseFloat(document.getElementById('previewExpected').textContent.replace(/[^0-9.-]+/g,"")) || 0;
        const physical = parseFloat(document.getElementById('physicalCash').value) || 0;
        const difference = physical - expected;
        
        const diffElement = document.getElementById('previewDifference');
        diffElement.textContent = this.formatCurrency(difference);
        
        if (difference === 0) {
            diffElement.style.color = 'var(--success)';
        } else {
            diffElement.style.color = 'var(--error)';
        }
    }

    async handleDailySummarySubmit() {
        const formData = {
            date: document.getElementById('summaryDate').value,
            physical_cash: parseFloat(document.getElementById('physicalCash').value),
            notes: document.getElementById('summaryNotes').value
        };

        try {
            const result = await this.apiCall('/api/daily-summary', 'POST', formData);
            this.showNotification(`Daily summary saved successfully at ${this.formatTime(new Date())}!`, 'success');
            this.resetForm('summaryForm');
            this.loadDailySummaries();
        } catch (error) {
            this.showNotification('Failed to save daily summary!', 'error');
        }
    }

    async loadDailySummaries() {
        try {
            const summaries = await this.apiCall('/api/daily-summaries');
            this.displayDailySummaries(summaries);
        } catch (error) {
            console.error('Failed to load daily summaries:', error);
        }
    }

    displayDailySummaries(summaries) {
        const container = document.getElementById('previousSummaries');
        
        if (summaries.length === 0) {
            container.innerHTML = '<div class="summary-card"><em>No daily summaries yet</em></div>';
            return;
        }

        container.innerHTML = summaries.map(summary => `
            <div class="summary-card">
                <div class="date">${this.formatDate(summary.date)}</div>
                <div class="timestamp-info">
                    <small>Created: ${summary.created_at_display || this.formatDate(summary.created_at)}</small>
                    ${summary.updated_at_display && summary.updated_at_display !== summary.created_at_display ? 
                        `<small>Updated: ${summary.updated_at_display}</small>` : ''}
                </div>
                <div class="amounts">
                    <div class="amount-item">
                        <span>Sales:</span>
                        <span>${this.formatCurrency(summary.total_sales)}</span>
                    </div>
                    <div class="amount-item">
                        <span>Expenses:</span>
                        <span>${this.formatCurrency(summary.total_expenses)}</span>
                    </div>
                    <div class="amount-item">
                        <span>Expected:</span>
                        <span>${this.formatCurrency(summary.expected_cash)}</span>
                    </div>
                    <div class="amount-item">
                        <span>Physical:</span>
                        <span>${this.formatCurrency(summary.physical_cash)}</span>
                    </div>
                </div>
                <div class="difference ${summary.difference === 0 ? 'matched' : 'mismatch'}">
                    Difference: ${this.formatCurrency(summary.difference)}
                </div>
                ${summary.notes ? `<div class="notes">${summary.notes}</div>` : ''}
                <div class="summary-actions">
                    <button class="btn-outline" onclick="app.printDailySummaryByDate('${summary.date}')">
                        <i class="fas fa-print"></i> Print
                    </button>
                </div>
            </div>
        `).join('');
    }

    // CRUD Operations for Transactions
    async editTransaction(transactionId) {
        try {
            const transaction = await this.apiCall(`/api/transactions/${transactionId}`);
            
            if (!transaction) {
                this.showNotification('Transaction not found!', 'error');
                return;
            }

            this.showEditForm(transaction);
        } catch (error) {
            this.showNotification('Failed to load transaction!', 'error');
        }
    }

    showEditForm(transaction) {
        if (transaction.type === 'credit') {
            document.getElementById('saleDate').value = transaction.date;
            document.getElementById('saleAmount').value = transaction.amount;
            document.getElementById('saleDescription').value = transaction.description || '';
            
            document.getElementById('salesForm').dataset.editingId = transaction.id;
            
            this.showPage('sales');
            this.showNotification(`Editing Sale TID: ${transaction.display_id} (Created: ${this.formatDateTime(transaction.created_at)})`, 'success');
        } else {
            document.getElementById('expenseDate').value = transaction.date;
            document.getElementById('expenseAccount').value = transaction.account_name;
            document.getElementById('expenseAmount').value = transaction.amount;
            document.getElementById('expenseDescription').value = transaction.description || '';
            
            document.getElementById('expenseForm').dataset.editingId = transaction.id;
            
            this.showPage('expenses');
            this.showNotification(`Editing Expense TID: ${transaction.display_id} (Created: ${this.formatDateTime(transaction.created_at)})`, 'success');
        }
    }

    async deleteTransaction(transactionId) {
        if (!confirm('Are you sure you want to delete this transaction? This action cannot be undone.')) {
            return;
        }

        try {
            const result = await this.apiCall(`/api/transactions/${transactionId}`, 'DELETE');
            this.showNotification(`Transaction deleted successfully at ${this.formatTime(new Date(result.deleted_at))}!`, 'success');
            this.loadLedger();
            this.loadDashboard();
        } catch (error) {
            this.showNotification('Failed to delete transaction!', 'error');
        }
    }

    // Utility Methods - ENHANCED WITH TIME FORMATTING
    resetForm(formId) {
        document.getElementById(formId).reset();
        const today = new Date().toISOString().split('T')[0];
        document.getElementById(formId).querySelector('input[type="date"]').value = today;
        delete document.getElementById(formId).dataset.editingId;
    }

    formatCurrency(amount) {
        return new Intl.NumberFormat('en-PK', {
            style: 'currency',
            currency: 'PKR',
            minimumFractionDigits: 2
        }).format(amount);
    }

    // Utility Methods - UPDATED FOR TIMEZONE SYNC
formatDate(dateString) {
    if (!dateString) return '';
    // Use 'en-PK' and explicit timezone to prevent the 5-hour shift
    return new Date(dateString).toLocaleDateString('en-PK', {
        timeZone: 'Asia/Karachi'
    });
}

formatTime(date) {
    if (!date) return '';
    return new Date(date).toLocaleTimeString('en-PK', {
        timeZone: 'Asia/Karachi',
        hour12: true,
        hour: '2-digit',
        minute: '2-digit'
    });
}

formatDateTime(dateTimeString) {
    if (!dateTimeString) return '';
    const date = new Date(dateTimeString);
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
    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification');
        const messageEl = document.getElementById('notificationMessage');
        
        messageEl.textContent = message;
        notification.className = `notification ${type} show`;
        
        setTimeout(() => {
            notification.classList.remove('show');
        }, 4000); // Increased timeout for better readability
    }

    // Additional print method for specific dates
    printDailySummaryByDate(date) {
        const printWindow = window.open('', '_blank');
        this.apiCall(`/api/daily-summaries?start_date=${date}&end_date=${date}`).then(summaries => {
            const summary = summaries[0];
            if (!summary) {
                this.showNotification('No summary found for this date!', 'error');
                return;
            }

            const businessName = this.businessInfo?.name || 'Leather Shop';
            const printContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Daily Summary - ${businessName}</title>
                    <style>
                        body { font-family: Arial, sans-serif; margin: 20px; }
                        .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 10px; }
                        .business-name { font-size: 24px; font-weight: bold; }
                        .date { font-size: 16px; margin: 10px 0; }
                        .timestamp { font-size: 14px; color: #666; margin: 5px 0; }
                        .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; }
                        .summary-card { border: 1px solid #ddd; padding: 15px; border-radius: 5px; }
                        .amount { font-size: 18px; font-weight: bold; margin: 10px 0; }
                        .footer { margin-top: 30px; text-align: center; color: #666; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <div class="business-name">${businessName}</div>
                        <div class="date">Daily Cash Summary - ${this.formatDate(date)}</div>
                        <div class="timestamp">Generated on ${new Date().toLocaleDateString()} at ${this.formatTime(new Date())}</div>
                    </div>
                    
                    <div class="summary-grid">
                        <div class="summary-card">
                            <h3>Sales</h3>
                            <div class="amount" style="color: green;">${this.formatCurrency(summary.total_sales)}</div>
                        </div>
                        <div class="summary-card">
                            <h3>Expenses</h3>
                            <div class="amount" style="color: red;">${this.formatCurrency(summary.total_expenses)}</div>
                        </div>
                    </div>
                    
                    <div class="summary-card">
                        <h3>Cash Reconciliation</h3>
                        <div>Expected Cash: <strong>${this.formatCurrency(summary.expected_cash)}</strong></div>
                        <div>Physical Cash: <strong>${this.formatCurrency(summary.physical_cash)}</strong></div>
                        <div>Difference: <strong style="color: ${summary.difference === 0 ? 'green' : 'red'}">${this.formatCurrency(summary.difference)}</strong></div>
                    </div>
                    
                    ${summary.notes ? `
                    <div class="summary-card">
                        <h3>Notes</h3>
                        <div>${this.escapeHtml(summary.notes)}</div>
                    </div>
                    ` : ''}
                    
                    <div class="footer">
                        <p>Generated by Leather Shop Accounting System</p>
                    </div>
                </body>
                </html>
            `;

            printWindow.document.write(printContent);
            printWindow.document.close();
        });
    }
}

// Make showPage available globally for HTML onclick handlers
window.showPage = function (page) {
    // Hide all pages
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));

    // Show selected page
    document.getElementById(page + "Page").classList.add("active");

    // Update navbar active button also (optional)
    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.page === page);
    });
};

// Initialize the application
const app = new LeatherShopAccounting();


