const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');

// Génère un QR code en Data URL encodant l'identifiant de suivi
async function genererQRCode(colisId) {
  return QRCode.toDataURL(`YOBB:${colisId}`, {
    errorCorrectionLevel: 'H',
    margin: 1,
    width: 300
  });
}

// Génère un reçu PDF en mémoire et retourne un Buffer
function genererRecu({ expediteur, destinataire, colis, transaction }) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const buffers = [];
  doc.on('data', chunk => buffers.push(chunk));

  const dateFormatee = new Date(colis.created_at).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric'
  });

  // En-tête
  doc.fontSize(22).font('Helvetica-Bold').fillColor('#1a1a2e').text('YOBBOULMA SN', { align: 'center' });
  doc.fontSize(11).font('Helvetica').fillColor('#555').text('Reçu officiel de livraison', { align: 'center' });
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ccc').stroke();
  doc.moveDown();

  // Identifiants
  doc.fillColor('#000').fontSize(11).font('Helvetica-Bold').text(`N° de suivi : `, { continued: true });
  doc.font('Helvetica').text(colis.id);
  doc.font('Helvetica-Bold').text(`Date : `, { continued: true });
  doc.font('Helvetica').text(dateFormatee);
  doc.moveDown();

  // Bloc expéditeur / destinataire côte à côte
  const yBloc = doc.y;
  doc.font('Helvetica-Bold').text('Expéditeur', 50, yBloc);
  doc.font('Helvetica')
    .text(`${expediteur.nom} ${expediteur.prenom}`, 50)
    .text(`Tél : ${expediteur.telephone}`)
    .text(`Email : ${expediteur.email}`);

  doc.font('Helvetica-Bold').text('Destinataire', 300, yBloc);
  doc.font('Helvetica')
    .text(`${destinataire.nom} ${destinataire.prenom}`, 300)
    .text(`Tél : ${destinataire.telephone}`, 300);

  doc.moveDown(2);

  // Détails du colis
  doc.font('Helvetica-Bold').fontSize(12).text('Détails du colis');
  doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).strokeColor('#eee').stroke();
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(11)
    .text(`Description : ${colis.description}`)
    .text(`Poids : ${colis.poids_kg} kg${colis.volume_m3 ? ` — Volume : ${colis.volume_m3} m³` : ''}`)
    .text(`Type de livraison : ${colis.type_livraison}`)
    .text(`Route nationale : ${colis.route_nationale}`)
    .text(`Adresse de collecte : ${colis.adresse_collecte || '—'}`)
    .text(`Adresse de livraison : ${colis.adresse_livraison || '—'}`);
  doc.moveDown();

  // Paiement
  doc.font('Helvetica-Bold').fontSize(12).text('Paiement');
  doc.moveTo(50, doc.y + 2).lineTo(545, doc.y + 2).strokeColor('#eee').stroke();
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(11)
    .text(`Montant : ${colis.tarif ? colis.tarif.toLocaleString('fr-FR') : '—'} FCFA`)
    .text(`Mode de paiement : ${transaction?.provider || '—'}`)
    .text(`Statut : ${transaction?.statut || 'en_attente'}`)
    .text(`Réf. transaction : ${transaction?.transaction_id || '—'}`);
  doc.moveDown(2);

  // Pied de page
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ccc').stroke();
  doc.moveDown(0.5);
  doc.fontSize(9).fillColor('#888').text('YOBBOULMA SN — Livraison rapide et sécurisée au Sénégal', { align: 'center' });

  doc.end();

  return new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(buffers))));
}

// Reçu allégé en JSON (pour impression légère ou API)
function genererRecuJSON({ expediteur, destinataire, colis, transaction }) {
  return {
    reference: colis.id,
    date: colis.created_at,
    expediteur: {
      nom: `${expediteur.nom} ${expediteur.prenom}`,
      telephone: expediteur.telephone,
      email: expediteur.email
    },
    destinataire: {
      nom: `${destinataire.nom} ${destinataire.prenom}`,
      telephone: destinataire.telephone
    },
    colis: {
      description: colis.description,
      poids_kg: colis.poids_kg,
      volume_m3: colis.volume_m3,
      type_livraison: colis.type_livraison,
      route_nationale: colis.route_nationale,
      adresse_collecte: colis.adresse_collecte,
      adresse_livraison: colis.adresse_livraison
    },
    paiement: {
      montant_fcfa: colis.tarif,
      provider: transaction?.provider || null,
      statut: transaction?.statut || 'en_attente',
      transaction_id: transaction?.transaction_id || null
    }
  };
}

module.exports = { genererQRCode, genererRecu, genererRecuJSON };
