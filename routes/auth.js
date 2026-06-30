const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { verifierToken } = require('../middleware/auth');

const ROLES_VALIDES = ['expediteur', 'destinataire', 'transporteur', 'admin'];
const ROUTES_NATIONALES = ['RN1', 'RN2', 'RN3'];
const SALT_ROUNDS = 10;

// POST /api/auth/inscription
router.post('/inscription', async (req, res, next) => {
  try {
    const { nom, prenom, telephone, email, mot_de_passe, role, route_nationale } = req.body;

    if (!nom || !prenom || !telephone || !email || !mot_de_passe || !role) {
      return res.status(400).json({
        success: false,
        message: 'Champs requis : nom, prenom, telephone, email, mot_de_passe, role',
        data: null
      });
    }

    if (!ROLES_VALIDES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Rôle invalide. Valeurs acceptées : ${ROLES_VALIDES.join(', ')}`,
        data: null
      });
    }

    if (role === 'transporteur' && (!route_nationale || !ROUTES_NATIONALES.includes(route_nationale))) {
      return res.status(400).json({
        success: false,
        message: `route_nationale requise pour le rôle transporteur. Valeurs : ${ROUTES_NATIONALES.join(', ')}`,
        data: null
      });
    }

    const { data: existant } = await supabase
      .from('utilisateurs')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existant) {
      return res.status(409).json({ success: false, message: 'Email déjà utilisé', data: null });
    }

    const mot_de_passe_hash = await bcrypt.hash(mot_de_passe, SALT_ROUNDS);

    const nouvelUtilisateur = {
      nom,
      prenom,
      telephone,
      email,
      mot_de_passe: mot_de_passe_hash,
      role,
      ...(role === 'transporteur' && { route_nationale, statut_validation: false })
    };

    const { data, error } = await supabase
      .from('utilisateurs')
      .insert(nouvelUtilisateur)
      .select('id, nom, prenom, email, role, telephone')
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: role === 'transporteur'
        ? 'Compte créé. En attente de validation par un administrateur.'
        : 'Compte créé avec succès.',
      data
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/connexion
router.post('/connexion', async (req, res, next) => {
  try {
    const { email, mot_de_passe } = req.body;

    if (!email || !mot_de_passe) {
      return res.status(400).json({ success: false, message: 'Email et mot de passe requis', data: null });
    }

    const { data: utilisateur, error } = await supabase
      .from('utilisateurs')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !utilisateur) {
      return res.status(401).json({ success: false, message: 'Identifiants incorrects', data: null });
    }

    const valide = await bcrypt.compare(mot_de_passe, utilisateur.mot_de_passe);
    if (!valide) {
      return res.status(401).json({ success: false, message: 'Identifiants incorrects', data: null });
    }

    if (utilisateur.role === 'transporteur' && !utilisateur.statut_validation) {
      return res.status(403).json({
        success: false,
        message: 'Compte en attente de validation par un administrateur.',
        data: null
      });
    }

    const token = jwt.sign(
      { id: utilisateur.id, role: utilisateur.role, email: utilisateur.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Connexion réussie',
      data: {
        token,
        utilisateur: {
          id: utilisateur.id,
          nom: utilisateur.nom,
          prenom: utilisateur.prenom,
          email: utilisateur.email,
          role: utilisateur.role,
          telephone: utilisateur.telephone
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/deconnexion
router.post('/deconnexion', verifierToken, async (req, res, next) => {
  try {
    // Expiration = maintenant + 24h (durée de vie du token)
    const expireAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from('tokens_revoques')
      .insert({ token: req.token, expire_le: expireAt });

    if (error) throw error;

    res.json({ success: true, message: 'Déconnexion réussie', data: null });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
