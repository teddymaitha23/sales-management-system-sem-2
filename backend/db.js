const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase credentials in .env');
} else {
  console.log('Connecting to Supabase at:', supabaseUrl);
}

// Public client (RLS-enforced, used per-request with user tokens)
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Admin client (bypasses RLS, used for user management)
let supabaseAdmin = null;
if (supabaseServiceKey) {
  supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  console.log('Admin client initialized (service role key found).');
} else {
  console.warn('WARNING: SUPABASE_SERVICE_ROLE_KEY not set. Auto-confirm signup will not work.');
  console.warn('  → Go to Supabase Dashboard → Settings → API → Copy "service_role" key');
  console.warn('  → Add SUPABASE_SERVICE_ROLE_KEY=<key> to your .env file');
}

module.exports = supabase;
module.exports.admin = supabaseAdmin;
