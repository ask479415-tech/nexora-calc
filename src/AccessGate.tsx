import { createContext, FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { Preferences } from '@capacitor/preferences';
import { isSupabaseConfigured, supabase } from './lib/supabase';

type Registration = {
  name: string;
  email: string;
  mobile_number: string;
  address: string;
  company_name: string;
};
export const UserProfileContext = createContext<Registration | null>(null);

type GateState = 'loading' | 'register' | 'pending' | 'approved' | 'rejected' | 'deactivated' | 'deleted' | 'offline' | 'setup';

const TOKEN_KEY = 'nexora-calc-access-token-v1';
const DEVICE_KEY = 'nexora-calc-device-id-v1';

function newDeviceId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

const page: React.CSSProperties = {
  minHeight: '100dvh', display: 'grid', placeItems: 'center',
  padding: 20, background: 'linear-gradient(145deg,#0d2748,#174d83 58%,#eaf2fa)',
  fontFamily: 'Inter,Arial,sans-serif', color: '#173451',
};
const panel: React.CSSProperties = {
  width: 'min(100%,440px)', background: '#fff', borderRadius: 22, padding: 24,
  boxShadow: '0 20px 60px #061a3340',
};
const field: React.CSSProperties = {
  display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 6,
  border: '1px solid #dce5ef', borderRadius: 10, padding: '12px 13px',
  color: '#173451', background: '#fbfdff', font: '14px Inter,Arial,sans-serif',
};
const action: React.CSSProperties = {
  width: '100%', border: 0, borderRadius: 11, padding: 14, marginTop: 16,
  color: '#fff', background: '#174d83', font: '700 14px Inter,Arial,sans-serif',
};

export default function AccessGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>('loading');
  const [form, setForm] = useState<Registration>({
    name: '', email: '', mobile_number: '', address: '', company_name: '',
  });
  const [profile, setProfile] = useState<Registration | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const checkAccess = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) { setState('setup'); return; }
    const { value: token } = await Preferences.get({ key: TOKEN_KEY });
    if (!token) { setState('register'); return; }
    if (!navigator.onLine) { setState('offline'); return; }
    try {
      const { data, error } = await supabase.rpc('nexora_check_access', { p_access_token: token });
      if (error || !data?.status) {
        setState('offline');
        setMessage(error?.message || 'Could not verify your approval. Please check your internet connection.');
        return;
      }
      setProfile(data.profile || null);
      setState(data.status as GateState);
      setMessage('');
    } catch (error) {
      setState('offline');
      setMessage(error instanceof Error ? error.message : 'Could not verify approval. Please try again.');
    }
  }, []);

  useEffect(() => {
    let active = true;
    const initial = async () => {
      if (!isSupabaseConfigured || !supabase) { if (active) setState('setup'); return; }
      const { value: token } = await Preferences.get({ key: TOKEN_KEY });
      if (!active) return;
      if (!token) { setState('register'); return; }
      if (!navigator.onLine) { setState('offline'); return; }
      try {
        const { data, error } = await supabase.rpc('nexora_check_access', { p_access_token: token });
        if (!active) return;
        if (error || !data?.status) {
          setState('offline');
          setMessage(error?.message || 'Could not verify your approval. Please connect to the internet.');
        } else {
          setProfile(data.profile || null);
          setState(data.status as GateState);
        }
      } catch (error) {
        if (!active) return;
        setState('offline');
        setMessage(error instanceof Error ? error.message : 'Could not verify approval. Please try again.');
      }
    };
    void initial();
    const interval = window.setInterval(() => { if (active) void checkAccess(); }, 30000);
    const onVisible = () => { if (document.visibilityState === 'visible' && active) void checkAccess(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    window.addEventListener('offline', onVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      window.removeEventListener('offline', onVisible);
    };
  }, [checkAccess]);

  async function submitRegistration(event: FormEvent) {
    event.preventDefault();
    if (!supabase || busy) return;
    setBusy(true); setMessage('');
    try {
      const { value: savedDeviceId } = await Preferences.get({ key: DEVICE_KEY });
      const deviceId = savedDeviceId || newDeviceId();
      if (!savedDeviceId) await Preferences.set({ key: DEVICE_KEY, value: deviceId });
      const { data, error } = await supabase.rpc('nexora_register_user', {
        p_name: form.name.trim(),
        p_email: form.email.trim(),
        p_mobile_number: form.mobile_number.trim(),
        p_address: form.address.trim(),
        p_company_name: form.company_name.trim(),
        p_device_id: deviceId,
      });
      if (error) throw error;
      if (!data?.access_token) throw new Error('Registration could not be completed. Please try again.');
      await Preferences.set({ key: TOKEN_KEY, value: String(data.access_token) });
      setProfile(form);
      setState('pending');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Registration failed. Please try again.');
    } finally { setBusy(false); }
  }

  if (state === 'loading') return <div style={page}><div style={{color:'#fff'}}>Checking registration approval…</div></div>;
  if (state === 'approved') return <UserProfileContext.Provider value={profile}>{children}</UserProfileContext.Provider>;

  const update = (key: keyof Registration, value: string) => setForm(old => ({ ...old, [key]: value }));
  const statusTitle: Record<string,string> = {
    pending: 'Approval Pending', rejected: 'Registration Rejected',
    deactivated: 'Access Deactivated', deleted: 'Access Removed',
    offline: 'Internet Connection Required',
  };
  if (state === 'register') return <div style={page}><section style={panel}>
    <div style={{textAlign:'center',marginBottom:20}}>
      <div style={{fontSize:12,fontWeight:800,letterSpacing:2,color:'#4381b5'}}>NEXORA DIGITAL</div>
      <h1 style={{fontSize:23,margin:'8px 0 4px'}}>User Registration</h1>
      <p style={{fontSize:12,color:'#71849a',margin:0}}>Register once. Your account will open after admin approval.</p>
    </div>
    <form onSubmit={submitRegistration}>
      {([
        ['name','Name','text','Enter your full name'],
        ['email','Email','email','Enter your email address'],
        ['mobile_number','Mobile Number','tel','Enter your mobile number'],
        ['address','Address','text','Enter your full address'],
        ['company_name','Company Name','text','Enter your company name'],
      ] as const).map(([key,label,type,placeholder]) => <label key={key} style={{display:'block',fontSize:12,fontWeight:700,color:'#52677d',marginTop:12}}>
        {label}<input required type={type} value={form[key]} placeholder={placeholder}
          onChange={event=>update(key,event.target.value)} style={field} />
      </label>)}
      {message && <p role="alert" style={{color:'#b42318',fontSize:12,lineHeight:1.5}}>{message}</p>}
      <button disabled={busy} style={{...action,opacity: busy ? 0.65 : 1}}>{busy?'Submitting…':'Submit Registration'}</button>
    </form>
    <p style={{textAlign:'center',fontSize:10,color:'#8b9aab',lineHeight:1.5,marginBottom:0}}>No password or login is required. Access is enabled only after admin approval.</p>
  </section></div>;

  return <div style={page}><section style={{...panel,textAlign:'center'}}>
    <div style={{fontSize:12,fontWeight:800,letterSpacing:2,color:'#4381b5'}}>NEXORA DIGITAL</div>
    <div style={{fontSize:38,marginTop:16}}>{state==='pending'?'⌛':'🔒'}</div>
    <h1 style={{fontSize:23,margin:'8px 0'}}>{statusTitle[state] || 'Access Unavailable'}</h1>
    <p style={{fontSize:13,color:'#71849a',lineHeight:1.7}}>
      {state==='pending'?'Your registration has been submitted. The calculator will unlock automatically after the administrator approves your account.':
       state==='rejected'?'Your registration was not approved. Please contact the administrator.':
       state==='deactivated' || state==='deleted'?'The administrator has disabled your access. The calculator, OCR and billing are locked.':
       'Connect to the internet so we can securely verify your approval. The calculator remains locked until verification succeeds.'}
    </p>
    {profile && <div style={{textAlign:'left',background:'#f4f7fb',borderRadius:12,padding:13,fontSize:12,lineHeight:1.9}}>
      <strong>{profile.name}</strong><br/>{profile.company_name}<br/>{profile.email}<br/>{profile.mobile_number}
    </div>}
    {message && <p role="alert" style={{fontSize:11,color:'#b42318'}}>{message}</p>}
    <button style={action} onClick={()=>void checkAccess()} disabled={busy}>Check Approval Status</button>
  </section></div>;
}
