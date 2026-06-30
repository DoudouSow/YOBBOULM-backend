const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL et SUPABASE_KEY sont requis dans les variables d'environnement");
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
