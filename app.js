const express = require('express');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const http = require('http');
const { Server } = require('socket.io');

const perangkatRoutes = require('./routes/perangkat');
const dataRoutes = require('./routes/data');
const penjadwalanRoutes = require('./routes/penjadwalan');
const dashboardController = require('./controllers/dashboardController');
const limitRoutes = require('./routes/limit');
const laporanRoutes = require('./routes/laporan');
const statisticRoute = require('./routes/statistic');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }, // Adjust CORS for production
});

// ✅ Set ke global agar bisa diakses di mqttClient.js
global.io = io;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout'); // Menentukan layout default

// Global response locals
app.use((req, res, next) => {
  res.locals.title = 'Smart Energy';
  res.locals.message = null;
  next();
});

// Routes
app.use('/perangkat', perangkatRoutes);
app.use('/data', dataRoutes);
app.use('/penjadwalan', penjadwalanRoutes);
app.use('/limit', limitRoutes);
app.use('/laporan', laporanRoutes);
app.use('/statistic', statisticRoute);
app.get('/', dashboardController.index);

// Socket.IO Connection
io.on('connection', (socket) => {
  console.log('🟢 Socket terhubung:', socket.id);
  socket.on('disconnect', () => {
    console.log('🔌 Socket terputus:', socket.id);
  });
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err);

  const statusCode = err.status || 500;
  res.status(statusCode);

  res.render('error', {
    title: 'Terjadi Kesalahan',
    message: err.message || 'Terjadi kesalahan server',
    error: req.app.get('env') === 'development' ? err : {}
  });
});

// ✅ Jalankan MQTT client setelah global.io tersedia
require('./mqttClient');

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
