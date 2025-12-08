const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./database/db');
const authRoutes = require('./routes/auth');
const deliveryRoutes = require('./routes/delivery');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production' || process.env.DATABASE_URL;

// Trust proxy para Railway
if (isProduction) {
    app.set('trust proxy', 1);
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Session
app.use(session({
    secret: process.env.SESSION_SECRET || 'ghosts-farm-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: isProduction, // HTTPS em produção
        httpOnly: true,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 horas
    }
}));

// Auth middleware
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/admin', adminRoutes);

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Initialize database and start server
db.initialize().then(() => {
    app.listen(PORT, () => {
        console.log(`🎮 Ghosts Farm Control rodando em http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('Erro ao inicializar banco de dados:', err);
});
