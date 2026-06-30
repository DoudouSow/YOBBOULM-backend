const supabase = require('../config/supabase');

let io = null;
// Cache mémoire : colisId -> { latitude, longitude, timestamp, signal_perdu }
const dernieresPositions = new Map();

// Seuil : 3x l'intervalle GPS sans nouvelles = perte de signal
const SEUIL_SECONDES = parseInt(process.env.GPS_INTERVAL || '10') * 3;

function initGpsService(socketIo) {
  io = socketIo;
}

async function enregistrerPosition({ colis_id, latitude, longitude, timestamp, source = 'http' }) {
  const ts = new Date(timestamp || Date.now());
  const dernierePos = dernieresPositions.get(colis_id);

  let zoneSansSignal = null;

  if (dernierePos) {
    const ecartSecondes = (ts - new Date(dernierePos.timestamp)) / 1000;

    if (ecartSecondes > SEUIL_SECONDES) {
      // Tronçon sans signal détecté entre les deux positions
      zoneSansSignal = {
        colis_id,
        debut: dernierePos.timestamp,
        fin: ts.toISOString(),
        duree_secondes: Math.round(ecartSecondes),
        lat_debut: dernierePos.latitude,
        lng_debut: dernierePos.longitude,
        lat_fin: latitude,
        lng_fin: longitude
      };

      await supabase.from('zones_sans_signal').insert(zoneSansSignal);

      // Événement Socket.io : reprise de signal
      if (io) {
        io.to(`colis:${colis_id}`).emit('reprise_signal', {
          colis_id,
          position: { latitude, longitude, timestamp: ts.toISOString() },
          zone_sans_signal: zoneSansSignal
        });
      }
    }
  }

  // Persister la position
  const { data, error } = await supabase
    .from('positions_gps')
    .insert({ colis_id, latitude, longitude, timestamp: ts.toISOString(), source })
    .select()
    .single();

  if (error) throw error;

  // Mise à jour du cache
  dernieresPositions.set(colis_id, { latitude, longitude, timestamp: ts.toISOString(), signal_perdu: false });

  // Événement Socket.io : nouvelle position
  if (io) {
    io.to(`colis:${colis_id}`).emit('position_mise_a_jour', {
      colis_id,
      latitude,
      longitude,
      timestamp: ts.toISOString(),
      source
    });
  }

  return { position: data, zone_sans_signal: zoneSansSignal };
}

function getDernierePosition(colisId) {
  return dernieresPositions.get(colisId) || null;
}

// Parseur pour les trames SMS : "YOBB:<colis_id>;<lat>;<lng>;<timestamp_unix>"
function parserSMS(message) {
  const match = message.match(/YOBB:([^;]+);(-?\d+\.?\d*);(-?\d+\.?\d*);(\d+)/);
  if (!match) throw new Error('Format SMS invalide');
  return {
    colis_id: match[1],
    latitude: parseFloat(match[2]),
    longitude: parseFloat(match[3]),
    timestamp: new Date(parseInt(match[4]) * 1000).toISOString(),
    source: 'sms'
  };
}

// Détecteur de perte de signal — exécuté chaque GPS_INTERVAL secondes
function verifierPerteSignal() {
  const maintenant = Date.now();
  dernieresPositions.forEach((pos, colisId) => {
    const ecartSecondes = (maintenant - new Date(pos.timestamp).getTime()) / 1000;
    if (ecartSecondes > SEUIL_SECONDES && !pos.signal_perdu) {
      pos.signal_perdu = true;
      if (io) {
        io.to(`colis:${colisId}`).emit('perte_signal', {
          colis_id: colisId,
          derniere_position_connue: {
            latitude: pos.latitude,
            longitude: pos.longitude,
            timestamp: pos.timestamp
          },
          timestamp_detection: new Date().toISOString()
        });
      }
    }
  });
}

setInterval(verifierPerteSignal, parseInt(process.env.GPS_INTERVAL || '10') * 1000);

module.exports = { initGpsService, enregistrerPosition, getDernierePosition, parserSMS };
