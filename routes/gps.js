const express = require('express');
const router = express.Router();
const { verifierToken } = require('../middleware/auth');
const { enregistrerPosition, getDernierePosition, parserSMS } = require('../services/gpsService');
const supabase = require('../config/supabase');

// POST /api/gps — Réception de trame IoT via HTTP
router.post('/', async (req, res, next) => {
  try {
    const { colis_id, latitude, longitude, timestamp } = req.body;

    if (!colis_id || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'colis_id, latitude et longitude sont requis',
        data: null
      });
    }

    const resultat = await enregistrerPosition({ colis_id, latitude, longitude, timestamp, source: 'http' });
    res.json({ success: true, data: resultat, message: 'Position enregistrée' });
  } catch (error) {
    next(error);
  }
});

// POST /api/gps/sms — Réception de position par SMS (repli sans data)
// Format SMS attendu : "YOBB:<colis_id>;<lat>;<lng>;<timestamp_unix>"
router.post('/sms', async (req, res, next) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ success: false, message: 'Champ message requis', data: null });
    }

    const position = parserSMS(message);
    const resultat = await enregistrerPosition(position);
    res.json({ success: true, data: resultat, message: 'Position SMS enregistrée' });
  } catch (error) {
    if (error.message === 'Format SMS invalide') {
      return res.status(400).json({ success: false, message: error.message, data: null });
    }
    next(error);
  }
});

// GET /api/gps/:colisId/derniere — Dernière position connue
router.get('/:colisId/derniere', verifierToken, async (req, res, next) => {
  try {
    const { colisId } = req.params;

    // Cache mémoire en priorité
    let position = getDernierePosition(colisId);

    if (!position) {
      const { data, error } = await supabase
        .from('positions_gps')
        .select('*')
        .eq('colis_id', colisId)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      position = data;
    }

    if (!position) {
      return res.status(404).json({ success: false, message: 'Aucune position connue pour ce colis', data: null });
    }

    res.json({ success: true, data: position, message: 'Dernière position récupérée' });
  } catch (error) {
    next(error);
  }
});

// GET /api/gps/:colisId/historique — Historique complet du trajet
router.get('/:colisId/historique', verifierToken, async (req, res, next) => {
  try {
    const { colisId } = req.params;
    const { debut, fin, limite = 500 } = req.query;

    let query = supabase
      .from('positions_gps')
      .select('*')
      .eq('colis_id', colisId)
      .order('timestamp', { ascending: true })
      .limit(parseInt(limite));

    if (debut) query = query.gte('timestamp', debut);
    if (fin) query = query.lte('timestamp', fin);

    const { data, error } = await query;
    if (error) throw error;

    res.json({ success: true, data, message: `${data.length} positions récupérées` });
  } catch (error) {
    next(error);
  }
});

// GET /api/gps/:colisId/zones-sans-signal — Tronçons sans couverture détectés
router.get('/:colisId/zones-sans-signal', verifierToken, async (req, res, next) => {
  try {
    const { colisId } = req.params;

    const { data, error } = await supabase
      .from('zones_sans_signal')
      .select('*')
      .eq('colis_id', colisId)
      .order('debut', { ascending: true });

    if (error) throw error;
    res.json({ success: true, data, message: 'Zones sans signal récupérées' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
