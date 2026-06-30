// Formule de Haversine : distance en km entre deux coordonnées GPS
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceTotale(points) {
  let dist = 0;
  for (let i = 0; i < points.length - 1; i++) {
    dist += haversine(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng);
  }
  return dist;
}

// Heuristique du plus proche voisin à partir d'un point de départ
function plusProcheVoisin(points, depart) {
  const visite = new Set();
  const itineraire = [depart];
  visite.add(depart.id);
  let courant = depart;

  while (itineraire.length < points.length) {
    let plusProche = null;
    let distMin = Infinity;
    for (const pt of points) {
      if (!visite.has(pt.id)) {
        const d = haversine(courant.lat, courant.lng, pt.lat, pt.lng);
        if (d < distMin) { distMin = d; plusProche = pt; }
      }
    }
    if (!plusProche) break;
    visite.add(plusProche.id);
    itineraire.push(plusProche);
    courant = plusProche;
  }
  return itineraire;
}

// Amélioration 2-opt : inverser des segments jusqu'à convergence
function amelioration2Opt(route) {
  let meilleure = [...route];
  let ameliore = true;

  while (ameliore) {
    ameliore = false;
    for (let i = 1; i < meilleure.length - 1; i++) {
      for (let j = i + 1; j < meilleure.length; j++) {
        const nvlle = [
          ...meilleure.slice(0, i),
          ...meilleure.slice(i, j + 1).reverse(),
          ...meilleure.slice(j + 1)
        ];
        if (distanceTotale(nvlle) < distanceTotale(meilleure)) {
          meilleure = nvlle;
          ameliore = true;
        }
      }
    }
  }
  return meilleure;
}

// Extraire les points de collecte et de livraison de chaque colis
function extrairePoints(colis) {
  const points = [];
  for (const c of colis) {
    if (c.lat_collecte && c.lng_collecte) {
      points.push({ id: `c_${c.id}`, type: 'collecte', lat: c.lat_collecte, lng: c.lng_collecte, adresse: c.adresse_collecte, colis_id: c.id });
    }
    if (c.lat_livraison && c.lng_livraison) {
      points.push({ id: `l_${c.id}`, type: 'livraison', lat: c.lat_livraison, lng: c.lng_livraison, adresse: c.adresse_livraison, colis_id: c.id });
    }
  }
  return points;
}

function optimiserItineraire(colis) {
  if (!colis || colis.length === 0) return { points: [], distance_totale_km: 0, nombre_arrets: 0 };

  const points = extrairePoints(colis);
  if (points.length === 0) return { points: [], distance_totale_km: 0, nombre_arrets: 0 };

  const initial = plusProcheVoisin(points, points[0]);
  const optimise = amelioration2Opt(initial);

  return {
    points: optimise,
    distance_totale_km: parseFloat(distanceTotale(optimise).toFixed(2)),
    nombre_arrets: optimise.length
  };
}

module.exports = { optimiserItineraire, haversine, distanceTotale };
