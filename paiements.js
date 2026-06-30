const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { verifierToken } = require('../middleware/auth');
const { getProvider, enregistrerTransaction, mettreAJourStatutCommande } = require('../services/paiementService');
const { envoyerNotification } = require('../services/notificationService');

// POST /api/paiements/initier — Déclencher un paiement
router.post('/initier', verifierToken, async (req, res, next) => {
  try {
    const { commande_id, type_paiement, telephone, email } = req.body;

    if (!commande_id || !type_paiement) {
      return res.status(400).json({ success: false, message: 'commande_id et type_paiement sont requis', data: null });
    }

    const { data: commande, error } = await supabase
      .from('colis')
      .select('id, tarif, expediteur_id')
      .eq('id', commande_id)
      .single();

    if (error || !commande) {
      return res.status(404).json({ success: false, message: 'Commande introuvable', data: null });
    }

    const provider = getProvider(type_paiement);
    const resultat = await provider.initierPaiement({
      commandeId: commande_id,
      montant: commande.tarif,
      telephone,
      email
    });

    await enregistrerTransaction({
      commandeId: commande_id,
      montant: commande.tarif,
      provider: type_paiement,
      statut: 'en_attente',
      transactionId: resultat.id || resultat.txnid || `${type_paiement}_${Date.now()}`,
      payload: resultat
    });

    res.json({ success: true, data: resultat, message: 'Paiement initié' });
  } catch (error) {
    next(error);
  }
});

// POST /api/paiements/webhook/:provider — Callback du prestataire (orange-money, wave, carte-bancaire)
router.post('/webhook/:provider', async (req, res, next) => {
  try {
    const providerNom = req.params.provider.replace(/-/g, '_');
    const provider = getProvider(providerNom);
    const { transactionId, statut, payload } = await provider.traiterCallback(req.body);

    const { data: transaction } = await supabase
      .from('transactions')
      .select('commande_id, montant')
      .eq('transaction_id', transactionId)
      .maybeSingle();

    if (transaction) {
      await Promise.all([
        mettreAJourStatutCommande(transaction.commande_id, statut),
        enregistrerTransaction({
          commandeId: transaction.commande_id,
          montant: transaction.montant,
          provider: providerNom,
          statut,
          transactionId,
          payload
        })
      ]);

      if (statut === 'paye') {
        const { data: colis } = await supabase
          .from('colis')
          .select('expediteur_id, destinataire_id')
          .eq('id', transaction.commande_id)
          .single();

        if (colis) {
          await envoyerNotification([colis.expediteur_id, colis.destinataire_id], {
            titre: 'Paiement confirmé ✓',
            corps: `Le paiement de votre commande a été confirmé.`,
            donnees: { type: 'paiement_confirme', commande_id: transaction.commande_id }
          });
        }
      }
    }

    // Répondre 200 immédiatement au prestataire
    res.json({ success: true, data: null, message: 'Webhook traité' });
  } catch (error) {
    next(error);
  }
});

// GET /api/paiements/statut/:transactionId — Consulter le statut d'une transaction
router.get('/statut/:transactionId', verifierToken, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('transaction_id', req.params.transactionId)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: 'Transaction introuvable', data: null });
    }

    res.json({ success: true, data, message: 'Statut récupéré' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
