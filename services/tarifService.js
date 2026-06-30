// Barèmes de tarification par route nationale (montants en FCFA)
const BAREMES = {
  RN1: { prix_de_base: 2000, cout_km: 50,  cout_kg: 100, supplement_express: 500 },
  RN2: { prix_de_base: 2500, cout_km: 60,  cout_kg: 120, supplement_express: 600 },
  RN3: { prix_de_base: 3000, cout_km: 70,  cout_kg: 130, supplement_express: 700 }
};

function calculerTarif({ distance_km, poids_kg, route_nationale, type_livraison }) {
  const bareme = BAREMES[route_nationale];
  if (!bareme) throw new Error(`Route nationale invalide : ${route_nationale}`);

  const { prix_de_base, cout_km, cout_kg, supplement_express } = bareme;
  let tarif = prix_de_base + cout_km * distance_km + cout_kg * poids_kg;
  if (type_livraison === 'express') tarif += supplement_express;

  return Math.round(tarif);
}

function genererDevis({ distance_km, poids_kg, route_nationale, type_livraison }) {
  const bareme = BAREMES[route_nationale];
  if (!bareme) throw new Error(`Route nationale invalide : ${route_nationale}`);

  const tarif = calculerTarif({ distance_km, poids_kg, route_nationale, type_livraison });

  return {
    route_nationale,
    type_livraison,
    distance_km,
    poids_kg,
    tarif_fcfa: tarif,
    details: {
      prix_de_base: bareme.prix_de_base,
      cout_transport: Math.round(bareme.cout_km * distance_km),
      cout_poids: Math.round(bareme.cout_kg * poids_kg),
      supplement_express: type_livraison === 'express' ? bareme.supplement_express : 0
    },
    devise: 'FCFA'
  };
}

module.exports = { calculerTarif, genererDevis };
