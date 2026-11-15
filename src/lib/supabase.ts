import { createClient } from '@supabase/supabase-js';

// These are Supabase publishable client credentials. Never put a service_role/secret key here.
export const supabase = createClient(
  'https://ptuiinqqsopflhpcygdh.supabase.co',
  'sb_publishable_tLbn0-lvyQOtvwPYf0CaUQ_ReirBQtI'
);
