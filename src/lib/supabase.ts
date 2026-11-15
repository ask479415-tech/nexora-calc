import { createClient } from '@supabase/supabase-js';
import { Preferences } from '@capacitor/preferences';

// Capacitor Preferences keeps the Supabase session available after the Android app closes.
const capacitorAuthStorage = {
  getItem: async (key: string) => {
    const { value } = await Preferences.get({ key });
    return value;
  },
  setItem: async (key: string, value: string) => {
    await Preferences.set({ key, value });
  },
  removeItem: async (key: string) => {
    await Preferences.remove({ key });
  },
};

// These are Supabase publishable client credentials. Never put a service_role/secret key here.
export const supabase = createClient(
  'https://ptuiinqqsopflhpcygdh.supabase.co',
  'sb_publishable_tLbn0-lvyQOtvwPYf0CaUQ_ReirBQtI',
  {
    auth: {
      storage: capacitorAuthStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);
