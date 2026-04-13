const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const DATA_FILE = path.join(__dirname, 'data', 'registrations.json');

// ============================================
// CORS - IMPORTANT: Add your Vercel URL here later!
// ============================================
app.use(cors({
    origin: [
        'http://localhost:5000',
        'http://localhost:3000',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
        'http://127.0.0.1:5000',
        // ADD YOUR VERCEL URL HERE AFTER DEPLOYING FRONTEND
        // Example: 'https://pulse-exe.vercel.app',
        // This allows ALL vercel.app subdomains:
        /\.vercel\.app$/
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json({ limit: '10kb' }));

// ============================================
// DATA HELPERS
// ============================================
async function initDataFile() {
    try {
        await fs.access(path.join(__dirname, 'data'));
    } catch {
        await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
    }
    try {
        await fs.access(DATA_FILE);
    } catch {
        await fs.writeFile(DATA_FILE, JSON.stringify({
            registrations: [],
            lastUpdated: new Date().toISOString()
        }, null, 2));
    }
}

async function readData() {
    try {
        const raw = await fs.readFile(DATA_FILE, 'utf8');
        return JSON.parse(raw);
    } catch {
        return { registrations: [], lastUpdated: new Date().toISOString() };
    }
}

async function writeData(data) {
    data.lastUpdated = new Date().toISOString();
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

function generateRegId(eventName) {
    const code = eventName.substring(0, 3).toUpperCase().replace(/\s/g, '');
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `PX-${code}-${ts}-${rand}`;
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-IN', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

// ============================================
// ROUTES
// ============================================

// Root - API info
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: '⚡ Pulse.exe API is running!',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        endpoints: {
            health: 'GET /api/health',
            register: 'POST /api/register',
            list: 'GET /api/register/list',
            stats: 'GET /api/register/stats',
            verify: 'GET /api/register/verify/:id',
            check: 'GET /api/register/check/:email/:event'
        }
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
});

// Register
app.post('/api/register', async (req, res) => {
    try {
        const { fullName, rollNumber, email, department, eventName } = req.body;

        // Validation
        if (!fullName || !rollNumber || !email || !department || !eventName) {
            return res.status(400).json({
                success: false,
                message: 'All fields are required'
            });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email'
            });
        }

        const data = await readData();

        // Check duplicates
        const exists = data.registrations.find(r =>
            (r.email.toLowerCase() === email.toLowerCase() ||
             r.rollNumber.toUpperCase() === rollNumber.toUpperCase()) &&
            r.eventName === eventName &&
            r.status !== 'cancelled'
        );

        if (exists) {
            return res.status(409).json({
                success: false,
                message: 'You have already registered for this event!',
                data: { registrationId: exists.registrationId }
            });
        }

        // Create registration
        const newReg = {
            id: data.registrations.length + 1,
            registrationId: generateRegId(eventName),
            fullName: fullName.trim(),
            rollNumber: rollNumber.toUpperCase().trim(),
            email: email.toLowerCase().trim(),
            department,
            eventName,
            registeredAt: new Date().toISOString(),
            status: 'confirmed'
        };

        data.registrations.push(newReg);
        await writeData(data);

        console.log(`✅ New registration: ${newReg.fullName} → ${newReg.eventName}`);

        res.status(201).json({
            success: true,
            message: 'Registration successful! Welcome to Pulse.exe!',
            data: {
                registrationId: newReg.registrationId,
                fullName: newReg.fullName,
                email: newReg.email,
                eventName: newReg.eventName,
                department: newReg.department,
                registeredAt: formatDate(newReg.registeredAt)
            }
        });

    } catch (error) {
        console.error('Registration Error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// List registrations
app.get('/api/register/list', async (req, res) => {
    try {
        const { event, department, status, search } = req.query;
        const data = await readData();
        let regs = [...data.registrations];

        if (event) regs = regs.filter(r => r.eventName === event);
        if (department) regs = regs.filter(r => r.department === department);
        if (status) regs = regs.filter(r => r.status === status);
        if (search) {
            const s = search.toLowerCase();
            regs = regs.filter(r =>
                r.fullName.toLowerCase().includes(s) ||
                r.email.toLowerCase().includes(s) ||
                r.rollNumber.toLowerCase().includes(s) ||
                r.registrationId.toLowerCase().includes(s)
            );
        }

        regs.sort((a, b) => new Date(b.registeredAt) - new Date(a.registeredAt));

        res.json({ success: true, data: regs, total: regs.length });
    } catch (error) {
        console.error('List Error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Stats
app.get('/api/register/stats', async (req, res) => {
    try {
        const data = await readData();
        const regs = data.registrations.filter(r => r.status !== 'cancelled');

        const byEvent = {};
        const byDepartment = {};
        regs.forEach(r => {
            byEvent[r.eventName] = (byEvent[r.eventName] || 0) + 1;
            byDepartment[r.department] = (byDepartment[r.department] || 0) + 1;
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayCount = regs.filter(r => new Date(r.registeredAt) >= today).length;

        res.json({
            success: true,
            data: { total: regs.length, today: todayCount, byEvent, byDepartment }
        });
    } catch (error) {
        console.error('Stats Error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Verify
app.get('/api/register/verify/:id', async (req, res) => {
    try {
        const data = await readData();
        const reg = data.registrations.find(r => r.registrationId === req.params.id);
        if (!reg) {
            return res.status(404).json({ success: false, message: 'Not found' });
        }
        res.json({
            success: true,
            data: {
                registrationId: reg.registrationId,
                fullName: reg.fullName,
                email: reg.email,
                eventName: reg.eventName,
                department: reg.department,
                status: reg.status,
                registeredAt: formatDate(reg.registeredAt)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Check if registered
app.get('/api/register/check/:email/:eventName', async (req, res) => {
    try {
        const data = await readData();
        const reg = data.registrations.find(r =>
            r.email.toLowerCase() === req.params.email.toLowerCase() &&
            r.eventName === req.params.eventName &&
            r.status !== 'cancelled'
        );
        res.json({
            success: true,
            isRegistered: !!reg,
            registrationId: reg?.registrationId || null
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Cancel registration
app.delete('/api/register/:registrationId', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, message: 'Email required' });
        }

        const data = await readData();
        const reg = data.registrations.find(r =>
            r.registrationId === req.params.registrationId
        );

        if (!reg) return res.status(404).json({ success: false, message: 'Not found' });
        if (reg.email !== email.toLowerCase()) {
            return res.status(403).json({ success: false, message: 'Email mismatch' });
        }

        reg.status = 'cancelled';
        await writeData(data);
        res.json({ success: true, message: 'Registration cancelled' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ============================================
// START
// ============================================
initDataFile().then(() => {
    app.listen(PORT, () => {
        console.log(`⚡ Pulse.exe API running on port ${PORT}`);
    });
});