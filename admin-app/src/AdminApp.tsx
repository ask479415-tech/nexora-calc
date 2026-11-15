import { useCallback, useEffect, useState } from 'react';
import { createClient, Session } from '@supabase/supabase-js';
import { ShieldCheck, LogOut, RefreshCw, Search, Users, Check, X, Ban, Trash2 } from 'lucide-react';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabase = url && anon ? createClient(url,anon,{auth:{persistSession:true,autoRefreshToken:true}}) : null;
type UserRow = {id:string;name:string;email:string;mobile_number:string;address:string;company_name:string;status:string;created_at:string};
type Result = {total:number;users:UserRow[]};

export default function AdminApp(){
 const [session,setSession]=useState<Session|null>(null);
 const [email,setEmail]=useState(''); const [password,setPassword]=useState('');
 const [data,setData]=useState<Result>({total:0,users:[]});
 const [query,setQuery]=useState(''); const [filter,setFilter]=useState('all');
 const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 const load=useCallback(async()=>{
  if(!supabase)return;
  setBusy(true);setError('');
  const {data:result,error}=await supabase.rpc('nexora_admin_list_users');
  if(error)setError(error.message);else setData(result as Result);
  setBusy(false);
 },[]);
 useEffect(()=>{
  if(!supabase)return;
  supabase.auth.getSession().then(({data})=>setSession(data.session));
  const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>setSession(next));
  return()=>subscription.unsubscribe();
 },[]);
 useEffect(()=>{if(session)void load();},[session,load]);
 async function login(e:React.FormEvent){e.preventDefault();if(!supabase)return;setBusy(true);setError('');const {error}=await supabase.auth.signInWithPassword({email,password});if(error)setError(error.message);setBusy(false);}
 async function changeStatus(user:UserRow,status:string){
  if(!supabase)return;
  const action=status==='deleted'?'remove':'set';
  if(!window.confirm(action==='remove'?'Remove this user and revoke app access?':`Change ${user.name} status to ${status}?`))return;
  setBusy(true);setError('');
  const result=action==='remove'
   ? await supabase.rpc('nexora_admin_remove_user',{p_user_id:user.id})
   : await supabase.rpc('nexora_admin_set_status',{p_user_id:user.id,p_status:status});
  if(result.error)setError(result.error.message);else await load();
  setBusy(false);
 }
 if(!supabase)return <main className="center"><section className="panel"><h1>Nexora Admin</h1><p>Supabase configuration is missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the admin app environment.</p></section></main>;
 if(!session)return <main className="center"><form className="panel login" onSubmit={login}><div className="brand"><ShieldCheck size={28}/> NEXORA ADMIN</div><h1>Administrator Login</h1><p>Sign in with an authorised Supabase admin account.</p><label>Email<input required type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<input required type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<div className="error">{error}</div>}<button disabled={busy}>{busy?'Signing in…':'Sign In Securely'}</button></form></main>;
 const users=data.users.filter(u=>(filter==='all'||u.status===filter)&&[u.name,u.email,u.mobile_number,u.company_name].join(' ').toLowerCase().includes(query.toLowerCase()));
 return <main className="shell"><header><div className="brand"><ShieldCheck/> NEXORA <span>ADMIN</span></div><div className="header-right"><span>{session.user.email}</span><button className="ghost" onClick={()=>supabase.auth.signOut()}><LogOut size={16}/> Sign out</button></div></header>
 <section className="welcome"><div><small>CONTROL CENTER</small><h1>User Management</h1><p>Review registrations and control Nexora Calc access.</p></div><button className="refresh" onClick={()=>void load()} disabled={busy}><RefreshCw size={16}/> Refresh</button></section>
 <section className="stats"><article><Users/><small>Total registered users</small><strong>{data.total}</strong></article><article><small>Pending approval</small><strong>{data.users.filter(u=>u.status==='pending').length}</strong></article><article><small>Approved users</small><strong>{data.users.filter(u=>u.status==='approved').length}</strong></article><article><small>Disabled / rejected</small><strong>{data.users.filter(u=>['deactivated','rejected'].includes(u.status)).length}</strong></article></section>
 <section className="list-panel"><div className="list-head"><div><h2>Registrations</h2><p>{users.length} records shown</p></div><div className="tools"><div className="search"><Search size={16}/><input placeholder="Search name, email, phone…" value={query} onChange={e=>setQuery(e.target.value)}/></div><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All statuses</option>{['pending','approved','rejected','deactivated'].map(s=><option key={s}>{s}</option>)}</select></div></div>
 {error&&<div className="error">{error}</div>}
 {busy&&!data.users.length?<p className="empty">Loading registrations…</p>:users.length===0?<p className="empty">No matching registrations.</p>:<div className="table-wrap"><table><thead><tr><th>User</th><th>Contact</th><th>Company & address</th><th>Status</th><th>Registered</th><th>Actions</th></tr></thead><tbody>{users.map(user=><tr key={user.id}><td><b>{user.name}</b></td><td>{user.email}<br/>{user.mobile_number}</td><td>{user.company_name}<br/><small>{user.address}</small></td><td><span className={'status '+user.status}>{user.status}</span></td><td>{new Date(user.created_at).toLocaleDateString()}</td><td><div className="actions">{user.status!=='approved'&&<button title="Approve" className="approve" onClick={()=>void changeStatus(user,'approved')}><Check size={15}/></button>}{user.status!=='rejected'&&<button title="Reject" className="reject" onClick={()=>void changeStatus(user,'rejected')}><X size={15}/></button>}{user.status!=='deactivated'&&<button title="Deactivate" className="disable" onClick={()=>void changeStatus(user,'deactivated')}><Ban size={15}/></button>}{user.status!=='approved'&&<button title="Reactivate / approve" className="approve" onClick={()=>void changeStatus(user,'approved')}><RefreshCw size={15}/></button>}<button title="Remove" className="remove" onClick={()=>void changeStatus(user,'deleted')}><Trash2 size={15}/></button></div></td></tr>)}</tbody></table></div>}</section>
 <footer>NEXORA DIGITAL · ADMINISTRATION PORTAL</footer></main>;
}
