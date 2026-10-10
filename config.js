// Public Supabase settings. The anon key is safe to expose in the browser:
// the database only allows the narrow RPC functions defined in supabase/migrations,
// and the name list / submissions tables are not readable by the public.
window.APP_CONFIG = {
  supabaseUrl: 'https://jgdssbylqcethfellobb.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpnZHNzYnlscWNldGhmZWxsb2JiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NTIxODMsImV4cCI6MjEwNzIyODE4M30.aaLQGABMAIgNTXJ0s5qZGu2sPklcg8lW_y69Mu7EYKk',
  bucket: 'agreement-submissions',
};
