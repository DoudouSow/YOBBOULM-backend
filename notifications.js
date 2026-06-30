const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { verifierToken, autoriserRoles } = require('../middleware/auth');
const { envoyerNotification } = require('../services/notificationService');

// GET /api/notifications — Notifications de l'utilisateur connecté
router.get('/', verifierToken, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('utilisateur_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json({ success: true, data, message: 'Notifications récupérées' });
  } catch (error) {
    next(error);
  }
});

// PUT /api/notifications/enregistrer-token — Enregistrer le token FCM de l'appareil
router.put('/enregistrer-token', verifierToken, async (req, res, next) => {
  try {
    const { fcm_token } = req.body;
    if (!fcm_token) {
      return res.status(400).json({ success: false, message: 'fcm_token requis', data: null });
    }

    const { error } = await supabase
      .from('utilisateurs')
      .update({ fcm_token })
      .eq('id', req.user.id);

    if (error) throw error;
    res.json({ success: true, data: null, message: 'Token FCM enregistré' });
  } catch (error) {
    next(error);
  }
});

// PUT /api/notifications/:id/lire — Marquer une notification comme lue
router.put('/:id/lire', verifierToken, async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ lue: true })
      .eq('id', req.params.id)
      .eq('utilisateur_id', req.user.id);

    if (error) throw error;
    res.json({ success: true, data: null, message: 'Notification marquée comme lue' });
  } catch (error) {
    next(error);
  }
});

// POST /api/notifications/envoyer — Envoi manuel (admin)
router.post('/envoyer', verifierToken, autoriserRoles('admin'), async (req, res, next) => {
  try {
    const { utilisateur_ids, titre, corps, donnees } = req.body;
    if (!utilisateur_ids || !titre || !corps) {
      return res.status(400).json({ success: false, message: 'utilisateur_ids, titre et corps sont requis', data: null });
    }

    await envoyerNotification(utilisateur_ids, { titre, corps, donnees });
    res.json({ success: true, data: null, message: 'Notification envoyée' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
