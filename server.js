require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const authRoutes = require('./routes/auth');
const livraisonRoutes = require('./routes/livraisons');
const gpsRoutes = require('./routes/gps');
const paiementRoutes = require('./routes/paiements');
const notificationRoutes = require('./routes/notifications');
const { initGpsService } = require('./services/gpsService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rendre l'instance io accessible depuis les routes
app.set('io', io);

// Initialiser le service GPS avec Socket.io
initGpsService(io);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/livraisons', livraisonRoutes);
app.use('/api/gps', gpsRoutes);
app.use('/api/paiements', paiementRoutes);
app.use('/api/notifications', notificationRoutes);

// Santé
app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'YOBBOULMA SN API opérationnelle', timestamp: new Date().toISOString() });
});

// Socket.io — gestion des abonnements au suivi de colis
io.on('connection', (socket) => {
  console.log(`[Socket] Client connecté : ${socket.id}`);

  socket.on('suivre_colis', (colisId) => {
    socket.join(`colis:${colisId}`);
  });

  socket.on('arreter_suivi', (colisId) => {
    socket.leave(`colis:${colisId}`);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client déconnecté : ${socket.id}`);
  });
});

// Gestion d'erreurs centralisée
app.use((err, _req, res, _next) => {
  console.error('[Erreur]', err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Erreur interne du serveur',
    data: null
  });
});

// 404
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route introuvable', data: null });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur YOBBOULMA SN démarré sur le port ${PORT}`);
});

module.exports = { app, io };
