const admin = require('firebase-admin');
const supabase = require('../config/supabase');

let initialise = false;

function initFirebase() {
  if (initialise) return;
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FCM_PROJECT_ID,
      clientEmail: process.env.FCM_CLIENT_EMAIL,
      privateKey: (process.env.FCM_PRIVATE_KEY || '').replace(/\\n/g, '\n')
    })
  });
  initialise = true;
}

async function envoyerNotification(utilisateurIds, { titre, corps, donnees = {} }) {
  try {
    initFirebase();

    const ids = Array.isArray(utilisateurIds) ? utilisateurIds : [utilisateurIds];

    const { data: utilisateurs } = await supabase
      .from('utilisateurs')
      .select('id, fcm_token')
      .in('id', ids)
      .not('fcm_token', 'is', null);

    const tokens = (utilisateurs || []).map(u => u.fcm_token).filter(Boolean);

    if (tokens.length > 0) {
      const message = {
        tokens,
        notification: { title: titre, body: corps },
        data: Object.fromEntries(
          Object.entries(donnees).map(([k, v]) => [k, String(v)])
        )
      };
      await admin.messaging().sendEachForMulticast(message);
    }

    // Persister les notifications dans Supabase
    if (ids.length > 0) {
      await supabase.from('notifications').insert(
        ids.map(uid => ({
          utilisateur_id: uid,
          titre,
          corps,
          donnees: JSON.stringify(donnees),
          lue: false,
          created_at: new Date().toISOString()
        }))
      );
    }
  } catch (error) {
    // Ne pas bloquer le flux principal si la notification échoue
    console.error('[FCM] Erreur envoi notification :', error.message);
  }
}

module.exports = { envoyerNotification };
