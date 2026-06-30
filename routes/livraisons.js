const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { verifierToken, autoriserRoles } = require('../middleware/auth');
const { optimiserItineraire } = require('../services/optimisationService');
const { calculerTarif, genererDevis } = require('../services/tarifService');
const { genererQRCode, genererRecu, genererRecuJSON } = require('../services/qrService');
const { envoyerNotification } = require('../services/notificationService');
const { v4: uuidv4 } = require('uuid');

// GET /api/livraisons/regrouper — Regrouper les colis par route nationale (admin)
router.get('/regrouper', verifierToken, autoriserRoles('admin'), async (req, res, next) => {
  try {
    const { data: colis, error } = await supabase
      .from('colis')
      .select('*')
      .eq('statut', 'en_attente');

    if (error) throw error;

    const groupes = { RN1: [], RN2: [], RN3: [] };
    colis.forEach(c => {
      if (groupes[c.route_nationale]) groupes[c.route_nationale].push(c);
    });

    const { data: transporteurs, error: errT } = await supabase
      .from('utilisateurs')
      .select('id, nom, prenom, telephone, route_nationale')
      .eq('role', 'transporteur')
      .eq('statut_validation', true);

    if (errT) throw errT;

    const affectations = Object.entries(groupes)
      .filter(([, colisGroupe]) => colisGroupe.length > 0)
      .map(([rn, colisGroupe]) => ({
        route_nationale: rn,
        nombre_colis: colisGroupe.length,
        transporteurs_disponibles: transporteurs.filter(t => t.route_nationale === rn),
        colis: colisGroupe
      }));

    res.json({ success: true, data: affectations, message: 'Regroupement effectué' });
  } catch (error) {
    next(error);
  }
});

// POST /api/livraisons/devis — Estimer le tarif avant commande
router.post('/devis', async (req, res, next) => {
  try {
    const { distance_km, poids_kg, route_nationale, type_livraison } = req.body;

    if (!distance_km || !poids_kg || !route_nationale || !type_livraison) {
      return res.status(400).json({
        success: false,
        message: 'distance_km, poids_kg, route_nationale et type_livraison sont requis',
        data: null
      });
    }

    const devis = genererDevis({ distance_km, poids_kg, route_nationale, type_livraison });
    res.json({ success: true, data: devis, message: 'Devis généré' });
  } catch (error) {
    next(error);
  }
});

// POST /api/livraisons/creer — Créer une livraison
router.post('/creer', verifierToken, autoriserRoles('expediteur', 'admin'), async (req, res, next) => {
  try {
    const {
      destinataire_id,
      description,
      poids_kg,
      volume_m3,
      adresse_collecte,
      adresse_livraison,
      lat_collecte,
      lng_collecte,
      lat_livraison,
      lng_livraison,
      route_nationale,
      type_livraison,
      distance_km
    } = req.body;

    if (!destinataire_id || !description || !poids_kg || !route_nationale || !type_livraison) {
      return res.status(400).json({ success: false, message: 'Champs manquants', data: null });
    }

    const tarif = calculerTarif({ distance_km: distance_km || 0, poids_kg, route_nationale, type_livraison });
    const colisId = uuidv4();
    const qrCode = await genererQRCode(colisId);

    const { data, error } = await supabase
      .from('colis')
      .insert({
        id: colisId,
        expediteur_id: req.user.id,
        destinataire_id,
        description,
        poids_kg,
        volume_m3: volume_m3 || null,
        adresse_collecte,
        adresse_livraison,
        lat_collecte: lat_collecte || null,
        lng_collecte: lng_collecte || null,
        lat_livraison: lat_livraison || null,
        lng_livraison: lng_livraison || null,
        route_nationale,
        type_livraison,
        tarif,
        statut: 'en_attente',
        statut_paiement: 'en_attente',
        qr_code: qrCode,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, data, message: 'Livraison créée avec succès' });
  } catch (error) {
    next(error);
  }
});

// POST /api/livraisons/optimiser/:routeNationale — Optimiser l'itinéraire
router.post('/optimiser/:routeNationale', verifierToken, autoriserRoles('admin', 'transporteur'), async (req, res, next) => {
  try {
    const { routeNationale } = req.params;

    const { data: colis, error } = await supabase
      .from('colis')
      .select('*')
      .eq('route_nationale', routeNationale)
      .in('statut', ['en_attente', 'pris_en_charge']);

    if (error) throw error;
    if (!colis || colis.length === 0) {
      return res.json({ success: true, data: [], message: 'Aucun colis à optimiser sur cette route' });
    }

    const resultat = optimiserItineraire(colis);
    res.json({ success: true, data: resultat, message: 'Itinéraire optimisé' });
  } catch (error) {
    next(error);
  }
});

// PUT /api/livraisons/statut/:colisId — Mettre à jour le statut
router.put('/statut/:colisId', verifierToken, autoriserRoles('transporteur', 'admin'), async (req, res, next) => {
  try {
    const { colisId } = req.params;
    const { statut } = req.body;
    const statutsValides = ['en_attente', 'pris_en_charge', 'en_transit', 'livre', 'echec'];

    if (!statutsValides.includes(statut)) {
      return res.status(400).json({ success: false, message: 'Statut invalide', data: null });
    }

    const { data, error } = await supabase
      .from('colis')
      .update({ statut, updated_at: new Date().toISOString() })
      .eq('id', colisId)
      .select()
      .single();

    if (error) throw error;

    // Diffuser le changement de statut en temps réel
    const io = req.app.get('io');
    io.to(`colis:${colisId}`).emit('statut_mis_a_jour', { colisId, statut });

    // Notifier l'expéditeur et le destinataire
    await envoyerNotification([data.expediteur_id, data.destinataire_id], {
      titre: 'Mise à jour de votre colis',
      corps: `Votre colis est maintenant : ${statut.replace(/_/g, ' ')}`,
      donnees: { type: 'statut_colis', colis_id: colisId, statut }
    });

    res.json({ success: true, data, message: 'Statut mis à jour' });
  } catch (error) {
    next(error);
  }
});

// PUT /api/livraisons/valider-transporteur/:transporteurId — Valider un transporteur (admin)
router.put('/valider-transporteur/:transporteurId', verifierToken, autoriserRoles('admin'), async (req, res, next) => {
  try {
    const { transporteurId } = req.params;

    const { data, error } = await supabase
      .from('utilisateurs')
      .update({ statut_validation: true })
      .eq('id', transporteurId)
      .eq('role', 'transporteur')
      .select('id, nom, prenom, email, telephone, route_nationale, statut_validation')
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: 'Transporteur introuvable', data: null });
    }

    await envoyerNotification([transporteurId], {
      titre: 'Compte validé',
      corps: 'Votre compte transporteur a été validé. Vous pouvez maintenant accepter des livraisons.',
      donnees: { type: 'transporteur_valide' }
    });

    res.json({ success: true, data, message: 'Transporteur validé avec succès' });
  } catch (error) {
    next(error);
  }
});

// GET /api/livraisons/:colisId/recu-pdf — Reçu PDF
router.get('/:colisId/recu-pdf', verifierToken, async (req, res, next) => {
  try {
    const { colisId } = req.params;

    const [{ data: colis, error: ec }, { data: transaction }] = await Promise.all([
      supabase.from('colis').select('*').eq('id', colisId).single(),
      supabase.from('transactions').select('*').eq('commande_id', colisId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
    ]);

    if (ec || !colis) {
      return res.status(404).json({ success: false, message: 'Colis introuvable', data: null });
    }

    const [{ data: expediteur }, { data: destinataire }] = await Promise.all([
      supabase.from('utilisateurs').select('nom, prenom, telephone, email').eq('id', colis.expediteur_id).single(),
      supabase.from('utilisateurs').select('nom, prenom, telephone').eq('id', colis.destinataire_id).single()
    ]);

    const pdfBuffer = await genererRecu({ expediteur, destinataire, colis, transaction });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=recu-${colisId}.pdf`);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

// GET /api/livraisons/:colisId/recu-json
router.get('/:colisId/recu-json', verifierToken, async (req, res, next) => {
  try {
    const { colisId } = req.params;

    const [{ data: colis, error: ec }, { data: transaction }] = await Promise.all([
      supabase.from('colis').select('*').eq('id', colisId).single(),
      supabase.from('transactions').select('*').eq('commande_id', colisId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
    ]);

    if (ec || !colis) {
      return res.status(404).json({ success: false, message: 'Colis introuvable', data: null });
    }

    const [{ data: expediteur }, { data: destinataire }] = await Promise.all([
      supabase.from('utilisateurs').select('nom, prenom, telephone, email').eq('id', colis.expediteur_id).single(),
      supabase.from('utilisateurs').select('nom, prenom, telephone').eq('id', colis.destinataire_id).single()
    ]);

    const recu = genererRecuJSON({ expediteur, destinataire, colis, transaction });
    res.json({ success: true, data: recu, message: 'Reçu généré' });
  } catch (error) {
    next(error);
  }
});

// GET /api/livraisons/:colisId — Détails d'un colis
router.get('/:colisId', verifierToken, async (req, res, next) => {
  try {
    const { colisId } = req.params;

    const { data, error } = await supabase
      .from('colis')
      .select('*')
      .eq('id', colisId)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: 'Colis introuvable', data: null });
    }

    const peutAcceder =
      req.user.role === 'admin' ||
      data.expediteur_id === req.user.id ||
      data.destinataire_id === req.user.id ||
      data.transporteur_id === req.user.id;

    if (!peutAcceder) {
      return res.status(403).json({ success: false, message: 'Accès refusé', data: null });
    }

    res.json({ success: true, data, message: 'Colis récupéré' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
