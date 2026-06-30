const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

const verifierToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token manquant ou format invalide', data: null });
    }

    const token = authHeader.split(' ')[1];

    // Vérifier si le token est révoqué
    const { data: revoque } = await supabase
      .from('tokens_revoques')
      .select('token')
      .eq('token', token)
      .maybeSingle();

    if (revoque) {
      return res.status(401).json({ success: false, message: 'Token révoqué', data: null });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    req.token = token;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Token invalide ou expiré', data: null });
  }
};

const autoriserRoles = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Non authentifié', data: null });
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Accès refusé — rôle insuffisant', data: null });
  }
  next();
};

module.exports = { verifierToken, autoriserRoles };
