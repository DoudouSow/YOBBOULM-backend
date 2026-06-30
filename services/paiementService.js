const axios = require('axios');
const supabase = require('../config/supabase');

// ── Interface commune ────────────────────────────────────────────────────────
class ProviderPaiement {
  async initierPaiement(_commande) { throw new Error('initierPaiement non implémenté'); }
  async traiterCallback(_payload) { throw new Error('traiterCallback non implémenté'); }
  async verifierStatut(_transactionId) { throw new Error('verifierStatut non implémenté'); }
}

// ── Orange Money ─────────────────────────────────────────────────────────────
class OrangeMoneyProvider extends ProviderPaiement {
  constructor() {
    super();
    this.apiKey = process.env.ORANGE_MONEY_API_KEY;
    this.baseUrl = 'https://api.orange.com/orange-money-webpay/sn/v1';
  }

  async initierPaiement({ commandeId, montant, telephone }) {
    const { data } = await axios.post(`${this.baseUrl}/webpayment`, {
      merchant_key: this.apiKey,
      currency: 'OUV',
      order_id: commandeId,
      amount: montant,
      return_url: `${process.env.APP_URL}/api/paiements/callback/orange-money`,
      cancel_url: `${process.env.APP_URL}/api/paiements/annuler`,
      notif_url: `${process.env.APP_URL}/api/paiements/webhook/orange-money`,
      lang: 'fr',
      reference: commandeId,
      msisdn: telephone
    });
    return { provider: 'orange_money', ...data };
  }

  async traiterCallback(payload) {
    return {
      transactionId: payload.txnid,
      statut: payload.status === 'SUCCESS' ? 'paye' : 'echec',
      payload
    };
  }

  async verifierStatut(transactionId) {
    const { data } = await axios.get(`${this.baseUrl}/transactions/${transactionId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` }
    });
    return data;
  }
}

// ── Wave ─────────────────────────────────────────────────────────────────────
class WaveProvider extends ProviderPaiement {
  constructor() {
    super();
    this.apiKey = process.env.WAVE_API_KEY;
    this.baseUrl = 'https://api.wave.com/v1';
  }

  async initierPaiement({ commandeId, montant }) {
    const { data } = await axios.post(`${this.baseUrl}/checkout/sessions`, {
      amount: String(montant),
      currency: 'XOF',
      error_url: `${process.env.APP_URL}/api/paiements/annuler`,
      success_url: `${process.env.APP_URL}/api/paiements/callback/wave`,
      client_reference: commandeId
    }, { headers: { Authorization: `Bearer ${this.apiKey}` } });
    return { provider: 'wave', ...data };
  }

  async traiterCallback(payload) {
    return {
      transactionId: payload.id,
      statut: payload.checkout_status === 'complete' ? 'paye' : 'echec',
      payload
    };
  }

  async verifierStatut(transactionId) {
    const { data } = await axios.get(`${this.baseUrl}/checkout/sessions/${transactionId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` }
    });
    return data;
  }
}

// ── Carte Bancaire ────────────────────────────────────────────────────────────
class CarteBancaireProvider extends ProviderPaiement {
  constructor() {
    super();
    this.apiKey = process.env.PAYMENT_CARD_API_KEY;
    this.baseUrl = 'https://api.payment-gateway.sn/v1'; // À adapter selon le prestataire choisi
  }

  async initierPaiement({ commandeId, montant, email }) {
    const { data } = await axios.post(`${this.baseUrl}/payment-intents`, {
      amount: montant,
      currency: 'xof',
      metadata: { commande_id: commandeId },
      receipt_email: email,
      payment_method_types: ['card']
    }, { headers: { Authorization: `Bearer ${this.apiKey}` } });
    return { provider: 'carte_bancaire', ...data };
  }

  async traiterCallback(payload) {
    return {
      transactionId: payload.id,
      statut: payload.status === 'succeeded' ? 'paye' : 'echec',
      payload
    };
  }

  async verifierStatut(transactionId) {
    const { data } = await axios.get(`${this.baseUrl}/payment-intents/${transactionId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` }
    });
    return data;
  }
}

// ── Registre des providers ────────────────────────────────────────────────────
const providers = {
  orange_money: new OrangeMoneyProvider(),
  wave: new WaveProvider(),
  carte_bancaire: new CarteBancaireProvider()
};

function getProvider(type) {
  const provider = providers[type];
  if (!provider) throw new Error(`Prestataire de paiement inconnu : ${type}. Valeurs : ${Object.keys(providers).join(', ')}`);
  return provider;
}

async function enregistrerTransaction({ commandeId, montant, provider, statut, transactionId, payload }) {
  const { error } = await supabase.from('transactions').insert({
    commande_id: commandeId,
    montant,
    provider,
    statut,
    transaction_id: transactionId,
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    created_at: new Date().toISOString()
  });
  if (error) throw error;
}

async function mettreAJourStatutCommande(commandeId, statutPaiement) {
  const { error } = await supabase
    .from('colis')
    .update({ statut_paiement: statutPaiement, updated_at: new Date().toISOString() })
    .eq('id', commandeId);
  if (error) throw error;
}

module.exports = { getProvider, enregistrerTransaction, mettreAJourStatutCommande };
