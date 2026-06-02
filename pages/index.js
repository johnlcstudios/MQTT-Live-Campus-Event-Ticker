import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';

const API = (path, opts = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined' && localStorage.getItem('token')) {
    headers['Authorization'] = `Bearer ${localStorage.getItem('token')}`;
  }
  return fetch(`/api/${path}${opts.query || ''}`, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
    .then(async r => {
      const ct = r.headers.get('content-type');
      if (ct && ct.includes('application/json')) { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Request failed'); return d; }
      if (!r.ok) throw new Error(r.statusText);
      return r;
    });
};

const ONE_SIGNAL_APP_ID = 'f426ca4c-6613-4a39-988b-ddb6dcf34304';

export default function Home() {
  const router = useRouter();
  const [view, setView] = useState('login');
  const [token, setToken_] = useState('');
  const [admin, setAdmin] = useState(null);
  const [events, setEvents] = useState([]);
  const [students, setStudents] = useState([]);
  const [logs, setLogs] = useState([]);
  const [tickerSettings, setTickerSettings] = useState({});
  const [tickerData, setTickerData] = useState(null);
  const [tab, setTab] = useState('events');

  const setToken = (t) => { setToken_(t); if (t) localStorage.setItem('token', t); else localStorage.removeItem('token'); };

  // OneSignal
  useEffect(() => {
    if (typeof window !== 'undefined' && window.OneSignalDeferred) {
      window.OneSignalDeferred.push(async (OneSignal) => {
        await OneSignal.init({ appId: ONE_SIGNAL_APP_ID, serviceWorkerParam: { scope: '/' }, serviceWorkerPath: '/OneSignalSDKWorker.js' });
        OneSignal.addListenerForNotificationReceived(n => { toast(n.body || 'New notification'); });
      });
    }
  }, []);

  const oneSignalSetUser = (sid, cid, name) => {
    if (window.OneSignalDeferred) {
      window.OneSignalDeferred.push(async (OneSignal) => {
        await OneSignal.login(`${cid}:${sid}`);
        await OneSignal.sendTags({ campus_id: cid, student_id: sid, name: name || '' });
      });
    }
  };
  const oneSignalLogout = () => {
    if (window.OneSignalDeferred) window.OneSignalDeferred.push(async (OneSignal) => { await OneSignal.logout(); });
  };

  // URL routing
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('token')) { setView('enroll'); return; }
    if (q.get('ticker')) { setView('ticker'); return; }
    if (localStorage.getItem('token')) { setView('dashboard'); loadAdmin(); }
  }, []);

  useEffect(() => { if (view === 'dashboard' && admin) { loadEvents(); loadStudents(); loadLogs(); loadTickerSettings(); } }, [view, admin]);

  const loadAdmin = async () => {
    try { const d = await API('admin/me'); setAdmin(d); } catch { setToken(null); setView('login'); }
  };
  const loadEvents = async () => { try { const d = await API('events'); setEvents(d.events || []); } catch {} };
  const loadStudents = async () => { try { const d = await API('students'); setStudents(d.students || []); } catch {} };
  const loadLogs = async () => { try { const d = await API('notification_log'); setLogs(d.logs || []); } catch {} };
  const loadTickerSettings = async () => { try { const d = await API('get_ticker_settings'); setTickerSettings(d.settings || {}); } catch {} };

  const toast = (msg, type = 'info') => {
    let c = document.querySelector('.toast-container');
    if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
    const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.remove(); if (!c.children.length) c.remove(); }, 3000);
  };

  return (
    <div id="app">
      {view === 'login' && <LoginView setView={setView} setToken={setToken} setAdmin={setAdmin} toast={toast} />}
      {view === 'setup' && <SetupView setView={setView} toast={toast} />}
      {view === 'dashboard' && <DashboardView token={token} admin={admin} setToken={setToken} setView={setView} tab={tab} setTab={setTab} events={events} setEvents={setEvents} students={students} setStudents={setStudents} logs={logs} setLogs={setLogs} tickerSettings={tickerSettings} setTickerSettings={setTickerSettings} loadEvents={loadEvents} loadStudents={loadStudents} loadLogs={loadLogs} loadTickerSettings={loadTickerSettings} toast={toast} />}
      {view === 'ticker' && <TickerView setView={setView} toast={toast} oneSignalSetUser={oneSignalSetUser} oneSignalLogout={oneSignalLogout} />}
      {view === 'enroll' && <EnrollView setView={setView} toast={toast} oneSignalSetUser={oneSignalSetUser} />}
    </div>
  );
}

// ─── LOGIN ───
function LoginView({ setView, setToken, setAdmin, toast }) {
  const [user, setUser] = useState(''); const [pass, setPass] = useState('');
  const handleLogin = async () => {
    if (!user || !pass) return toast('Fill in all fields', 'error');
    try { const d = await API('admin/login', { method: 'POST', body: { username: user, password: pass } }); setToken(d.token); localStorage.setItem('username', d.username); setAdmin({ username: d.username }); setView('dashboard'); toast('Signed in!'); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="auth-container">
      <h1>📡 Live Campus Event Ticker</h1><p>Admin Dashboard</p>
      <div className="auth-card">
        <div className="form-group"><label>Username</label><input value={user} onChange={e => setUser(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} /></div>
        <div className="form-group"><label>Password</label><input type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} /></div>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleLogin}>Sign In</button>
        <p className="auth-link">No account? <a href="#" onClick={e => { e.preventDefault(); setView('setup'); }}>Set up now</a></p>
        <p className="auth-link"><a href="#" onClick={e => { e.preventDefault(); setView('ticker'); }} style={{ color: 'var(--accent)' }}>I am a student — open Live Ticker</a></p>
      </div>
    </div>
  );
}

// ─── SETUP ───
function SetupView({ setView, toast }) {
  const [user, setUser] = useState(''); const [pass, setPass] = useState('');
  const handleSetup = async () => {
    if (!user || !pass) return toast('Fill in all fields', 'error');
    try { const d = await API('admin/setup', { method: 'POST', body: { username: user, password: pass } }); toast(`Account created! Campus ID: ${d.campus_id}`); setView('login'); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="auth-container">
      <h1>Admin Setup</h1><p>Create your admin account</p>
      <div className="auth-card">
        <div className="form-group"><label>Username</label><input value={user} onChange={e => setUser(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSetup()} /></div>
        <div className="form-group"><label>Password</label><input type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSetup()} /></div>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleSetup}>Create Account</button>
        <p className="auth-link">Already have an account? <a href="#" onClick={e => { e.preventDefault(); setView('login'); }}>Sign in</a></p>
      </div>
    </div>
  );
}

// ─── DASHBOARD ───
function DashboardView({ token, admin, setToken, setView, tab, setTab, events, setEvents, students, setStudents, logs, setLogs, tickerSettings, setTickerSettings, loadEvents, loadStudents, loadLogs, loadTickerSettings, toast }) {
  const tabs = [
    { id: 'events', label: 'Events' }, { id: 'students', label: 'Students' },
    { id: 'notifications', label: 'Notify' }, { id: 'settings', label: 'Ticker' }
  ];
  const logout = () => { setToken(null); setView('login'); };
  return (
    <>
      <div className="dashboard-header">
        <div><h1>Dashboard <small>{admin?.campus_id || ''}</small></h1></div>
        <div className="user-info"><span>{admin?.username || ''}</span><button className="logout-btn" onClick={logout}>Sign Out</button></div>
      </div>
      <div className="tabs">{tabs.map(t => <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>)}</div>
      {tab === 'events' && <EventsTab events={events} loadEvents={loadEvents} toast={toast} />}
      {tab === 'students' && <StudentsTab students={students} loadStudents={loadStudents} toast={toast} />}
      {tab === 'notifications' && <NotificationsTab events={events} logs={logs} loadLogs={loadLogs} toast={toast} />}
      {tab === 'settings' && <SettingsTab tickerSettings={tickerSettings} loadTickerSettings={loadTickerSettings} toast={toast} />}
    </>
  );
}

// ─── EVENTS TAB ───
function EventsTab({ events, loadEvents, toast }) {
  const [modal, setModal] = useState(null);
  const [roster, setRoster] = useState(null);
  const handleDelete = async (id) => { if (!confirm('Delete this event?')) return; await API(`delete_event&id=${id}`); toast('Deleted'); loadEvents(); };
  const handleClone = async (id) => { await API(`clone_event&id=${id}`); toast('Cloned'); loadEvents(); };
  const createEvent = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    await API('create_event', { method: 'POST', body: Object.fromEntries(fd) }); toast('Created!'); loadEvents(); setModal(null);
  };
  const viewRoster = async (ev) => {
    try { const d = await API(`event_students&id=${ev.id}`); setRoster({ event: ev, students: d.students || [] }); } catch (e) { toast(e.message, 'error'); }
  };
  const copyQR = (qr) => {
    const url = `${window.location.origin}/?token=${qr}`;
    navigator.clipboard.writeText(url).then(() => toast('QR URL copied!')).catch(() => toast('Copy failed', 'error'));
  };
  return (
    <div className="card">
      <div className="card-header"><h2>Events</h2><button className="btn btn-accent btn-sm" onClick={() => setModal('create')}>+ New Event</button></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Date</th><th>Capacity</th><th>Reminder</th><th>QR</th><th>Actions</th></tr></thead>
        <tbody>{events.map(ev => <tr key={ev.id}>
          <td className="clickable" onClick={() => viewRoster(ev)}>{ev.name}</td>
          <td>{new Date(ev.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
          <td><span className={`status-badge ${parseInt(ev.registrations) >= parseInt(ev.max_capacity) ? 'ended' : 'upcoming'}`}>{ev.registrations || 0}/{ev.max_capacity}</span></td>
          <td>{ev.reminder_minutes ? `${ev.reminder_minutes}m before` : '—'}</td>
          <td><button className="btn btn-outline btn-sm" onClick={() => copyQR(ev.qr_token)}>Copy</button></td>
          <td style={{ display: 'flex', gap: 4 }}><button className="btn btn-outline btn-sm" onClick={() => handleClone(ev.id)}>Clone</button><button className="btn btn-danger btn-sm" onClick={() => handleDelete(ev.id)}>Del</button></td>
        </tr>)}</tbody>
      </table></div>
      {modal === 'create' && <Modal onClose={() => setModal(null)}>
        <h2>New Event</h2><form onSubmit={createEvent}>
          <div className="form-group"><label>Event Name</label><input name="name" required /></div>
          <div className="form-group"><label>Description</label><textarea name="description" /></div>
          <div className="form-group"><label>Date & Time</label><input name="event_date" type="datetime-local" required /></div>
          <div className="form-group"><label>Max Capacity</label><input name="max_capacity" type="number" defaultValue="100" /></div>
          <div className="form-group"><label>Reminder (minutes before)</label><input name="reminder_minutes" type="number" placeholder="e.g. 15" /></div>
          <div className="modal-actions"><button type="button" className="btn btn-outline" onClick={() => setModal(null)}>Cancel</button><button type="submit" className="btn btn-primary">Create Event</button></div>
        </form>
      </Modal>}
      {roster && <Modal onClose={() => setRoster(null)} style={{ maxWidth: 700 }}>
        <h2>{roster.event.name}</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: 12 }}>{roster.event.description || 'No description'} — {roster.students.length}/{roster.event.max_capacity} registered</p>
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Student ID</th><th>Registered At</th></tr></thead>
          <tbody>{roster.students.length ? roster.students.map(s => <tr key={s.id}><td>{s.name}</td><td>{s.student_id_number}</td><td>{new Date(s.registered_at).toLocaleDateString()}</td></tr>) : <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No registrations</td></tr>}</tbody>
        </table></div>
        <div className="modal-actions"><button className="btn btn-outline" onClick={() => setRoster(null)}>Close</button></div>
      </Modal>}
    </div>
  );
}

// ─── STUDENTS TAB ───
function StudentsTab({ students, loadStudents, toast }) {
  const [search, setSearch] = useState('');
  const [csvModal, setCsvModal] = useState(false);
  const [csvText, setCsvText] = useState('');
  const filtered = students.filter(s => s.name.toLowerCase().includes(search.toLowerCase()) || s.student_id_number.toLowerCase().includes(search.toLowerCase()));
  const delStudent = async (id) => { if (!confirm('Delete student?')) return; await API(`delete_student&id=${id}`); toast('Deleted'); loadStudents(); };
  const importCsv = async () => {
    try { const d = await API('import_students', { method: 'POST', body: { csv: csvText } }); toast(`Imported ${d.imported} students`); setCsvModal(false); loadStudents(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="card">
      <div className="card-header"><h2>Students</h2><div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-outline btn-sm" onClick={() => setCsvModal(true)}>Import CSV</button>
        <a href="/api/export_students_csv" className="btn btn-outline btn-sm" target="_blank">Export CSV</a>
      </div></div>
      <div className="form-group"><input placeholder="Search by name or ID..." value={search} onChange={e => setSearch(e.target.value)} /></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Student ID</th><th>Enrolled At</th><th>Actions</th></tr></thead>
        <tbody>{filtered.map(s => <tr key={s.id}><td>{s.name}</td><td>{s.student_id_number}</td><td>{new Date(s.enrolled_at).toLocaleDateString()}</td><td><button className="btn btn-danger btn-sm" onClick={() => delStudent(s.id)}>Del</button></td></tr>)}</tbody>
      </table></div>
      {csvModal && <Modal onClose={() => setCsvModal(false)}>
        <h2>Import Students (CSV)</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 12 }}>Paste CSV with columns: Name, Student ID</p>
        <div className="form-group"><textarea style={{ minHeight: 200, fontFamily: 'monospace' }} value={csvText} onChange={e => setCsvText(e.target.value)} /></div>
        <div className="modal-actions"><button className="btn btn-outline" onClick={() => setCsvModal(false)}>Cancel</button><button className="btn btn-primary" onClick={importCsv}>Import</button></div>
      </Modal>}
    </div>
  );
}

// ─── NOTIFICATIONS TAB ───
function NotificationsTab({ events, logs, loadLogs, toast }) {
  const [target, setTarget] = useState('masterlist');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [editLog, setEditLog] = useState(null);
  const send = async () => {
    if (!title || !body) return toast('Title and body required', 'error');
    const target_type = target.startsWith('event_') ? 'event' : 'masterlist';
    const target_id = target.startsWith('event_') ? parseInt(target.split('_')[1]) : null;
    await API('send_notification', { method: 'POST', body: { target_type, target_id, title, body, pinned } });
    toast('Sent!'); setTitle(''); setBody(''); setPinned(false); loadLogs();
  };
  const togglePin = async (id) => { await API(`toggle_pin&id=${id}`); toast('Toggled'); loadLogs(); };
  const delNotif = async (id) => { if (!confirm('Delete notification?')) return; await API(`delete_notification&id=${id}`); toast('Deleted'); loadLogs(); };
  const saveEdit = async () => {
    await API('edit_notification', { method: 'PUT', body: editLog }); toast('Updated!'); setEditLog(null); loadLogs();
  };
  return (
    <>
      <div className="card">
        <div className="card-header"><h2>Send Notification</h2></div>
        <div className="form-group"><label>Target</label><select value={target} onChange={e => setTarget(e.target.value)}>
          <option value="masterlist">All Students (Masterlist)</option>
          {events.map(e => <option key={e.id} value={`event_${e.id}`}>Event: {e.name}</option>)}
        </select></div>
        <div className="form-group"><label>Title</label><input value={title} onChange={e => setTitle(e.target.value)} /></div>
        <div className="form-group"><label>Body</label><textarea value={body} onChange={e => setBody(e.target.value)} /></div>
        <label className="checkbox-group"><input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} /> Pin this notification</label>
        <button className="btn btn-primary" onClick={send} style={{ marginTop: 8 }}>Send Notification</button>
      </div>
      <div className="card">
        <div className="card-header"><h2>Sent Notifications</h2><button className="btn btn-outline btn-sm" onClick={loadLogs}>Refresh</button></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Time</th><th>Title</th><th>Body</th><th>Target</th><th>Pin</th><th>Actions</th></tr></thead>
          <tbody>{logs.map(n => <tr key={n.id} style={n.pinned ? { background: 'rgba(245,158,11,.05)' } : {}}>
            <td>{new Date(n.sent_at).toLocaleDateString()}</td>
            <td>{n.title}</td><td style={{ maxWidth: 200, whiteSpace: 'normal', wordBreak: 'break-word' }}>{n.body}</td>
            <td>{n.event_name || n.target_type}</td>
            <td><button className={`btn btn-sm ${n.pinned ? 'btn-accent' : 'btn-outline'}`} onClick={() => togglePin(n.id)}>{n.pinned ? 'Pinned' : 'Pin'}</button></td>
            <td style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-outline btn-sm" onClick={() => setEditLog({ id: n.id, title: n.title, body: n.body, pinned: !!n.pinned })}>Edit</button>
              <button className="btn btn-danger btn-sm" onClick={() => delNotif(n.id)}>Del</button>
            </td>
          </tr>)}</tbody>
        </table></div>
      </div>
      {editLog && <Modal onClose={() => setEditLog(null)}>
        <h2>Edit Notification</h2>
        <div className="form-group"><label>Title</label><input value={editLog.title} onChange={e => setEditLog({ ...editLog, title: e.target.value })} /></div>
        <div className="form-group"><label>Body</label><textarea value={editLog.body} onChange={e => setEditLog({ ...editLog, body: e.target.value })} /></div>
        <label className="checkbox-group"><input type="checkbox" checked={editLog.pinned} onChange={e => setEditLog({ ...editLog, pinned: e.target.checked })} /> Pinned</label>
        <div className="modal-actions"><button className="btn btn-outline" onClick={() => setEditLog(null)}>Cancel</button><button className="btn btn-primary" onClick={saveEdit}>Save</button></div>
      </Modal>}
    </>
  );
}

// ─── SETTINGS TAB ───
function SettingsTab({ tickerSettings, loadTickerSettings, toast }) {
  const [s, setS] = useState(tickerSettings);
  useEffect(() => { setS(tickerSettings); }, [tickerSettings]);
  const update = (k, v) => setS(p => ({ ...p, [k]: v }));
  const save = async () => {
    await API('update_ticker_settings', { method: 'PUT', body: { ...s, banner_enabled: !!s.banner_enabled, show_dates: !!s.show_dates, show_descriptions: !!s.show_descriptions } });
    toast('Saved!'); loadTickerSettings();
  };
  const bg = s.background_style || 'dark';
  const pc = s.primary_color || '#3b82f6';
  const ac = s.accent_color || '#10b981';
  return (
    <div className="card">
      <div className="card-header"><h2>Ticker Customization</h2></div>
      <div className="color-inputs">
        <label>Primary<input type="color" value={pc} onChange={e => update('primary_color', e.target.value)} /></label>
        <label>Accent<input type="color" value={ac} onChange={e => update('accent_color', e.target.value)} /></label>
      </div>
      <div className="form-group"><label>Background</label><select value={bg} onChange={e => update('background_style', e.target.value)}>
        <option value="dark">Dark</option><option value="light">Light</option><option value="gradient">Gradient</option>
      </select></div>
      <div className="form-group"><label>Banner Text</label><input value={s.banner_text || ''} onChange={e => update('banner_text', e.target.value)} placeholder="Welcome!" /></div>
      <label className="checkbox-group"><input type="checkbox" checked={!!s.banner_enabled} onChange={e => update('banner_enabled', e.target.checked)} /> Show banner</label>
      <div className="color-inputs" style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 16 }}>
        <label>Font Size<select value={s.font_size || 'medium'} onChange={e => update('font_size', e.target.value)}>
          <option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option>
        </select></label>
        <label>Card Style<select value={s.card_style || 'card'} onChange={e => update('card_style', e.target.value)}>
          <option value="card">Card</option><option value="compact">Compact</option>
        </select></label>
        <label>Animation<select value={s.animation_style || 'fade'} onChange={e => update('animation_style', e.target.value)}>
          <option value="fade">Fade In</option><option value="slide">Slide Up</option><option value="none">None</option>
        </select></label>
        <label>Radius: {s.border_radius || 12}px<input type="range" min="4" max="24" value={s.border_radius || 12} onChange={e => update('border_radius', Number(e.target.value))} style={{ width: '100%' }} /></label>
      </div>
      <div className="checkbox-group"><input type="checkbox" checked={!!s.show_dates} onChange={e => update('show_dates', e.target.checked)} /><label>Show dates</label></div>
      <div className="checkbox-group"><input type="checkbox" checked={!!s.show_descriptions} onChange={e => update('show_descriptions', e.target.checked)} /><label>Show descriptions</label></div>
      <div className="form-group"><label>Footer Text</label><input value={s.footer_text || ''} onChange={e => update('footer_text', e.target.value)} placeholder="Powered by Campus Ticker" /></div>
      <div className="preview-box" style={{ background: bg === 'gradient' ? `linear-gradient(135deg,${pc}22,${ac}22)` : bg === 'light' ? '#f0f0f0' : '#0f172a', color: bg === 'light' ? '#0f172a' : '#f1f5f9', padding: 20, borderRadius: (s.border_radius || 12) + 'px', marginTop: 16 }}>
        <h3 style={{ color: pc }}>Preview</h3>
        <p style={{ color: ac }}>Sample notification text</p>
        {s.banner_enabled && s.banner_text && <div style={{ background: pc, color: '#fff', padding: 8, borderRadius: (s.border_radius || 12) + 'px', marginTop: 8 }}>{s.banner_text}</div>}
        {s.footer_text && <p style={{ color: ac, fontSize: 10, textAlign: 'center', marginTop: 12, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.6 }}>{s.footer_text}</p>}
      </div>
      <button className="btn btn-primary" onClick={save} style={{ marginTop: 16 }}>Save Settings</button>
    </div>
  );
}

// ─── TICKER ───
function TickerView({ setView, toast, oneSignalSetUser, oneSignalLogout }) {
  const [data, setData] = useState(null);
  const [sid, setSid] = useState('');
  const [cid, setCid] = useState('');
  const [name, setName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const savedSid = typeof window !== 'undefined' ? localStorage.getItem('sessionSid') : null;
  const savedCid = typeof window !== 'undefined' ? localStorage.getItem('sessionCid') : null;
  const s = data?.settings || {};
  const pc = s.primary_color || '#3b82f6';
  const ac = s.accent_color || '#10b981';
  const bg = s.background_style || 'dark';
  const fs = s.font_size || 'medium';
  const cs = s.card_style || 'card';
  const anim = s.animation_style || 'fade';
  const br = s.border_radius || 12;

  const loadData = async (_sid, _cid) => {
    try { const d = await API(`student/ticker-data?studentId=${encodeURIComponent(_sid)}&campusId=${encodeURIComponent(_cid)}`); setData(d); setName(d.name); setNameInput(d.name); localStorage.setItem('sessionSid', _sid); localStorage.setItem('sessionCid', _cid); localStorage.setItem('sessionName', d.name); oneSignalSetUser(_sid, _cid, d.name); } catch (e) { toast(e.message, 'error'); }
  };

  useEffect(() => { if (savedSid && savedCid) loadData(savedSid, savedCid); }, []);

  const handleLogin = () => { if (!sid || !cid) return toast('Fill in both fields', 'error'); loadData(sid.trim(), cid.trim()); };
  const handleLogout = () => { setData(null); setSid(''); setCid(''); setName(''); localStorage.removeItem('sessionSid'); localStorage.removeItem('sessionCid'); localStorage.removeItem('sessionName'); oneSignalLogout(); };
  const handleEnroll = (ev, isRegistered) => async () => {
    if (isRegistered) {
      await API('unregister', { method: 'POST', body: { student_db_id: data.student_db_id, event_id: ev.id } }); toast('Unregistered');
    } else {
      await API('enroll', { method: 'POST', body: { token: ev.qr_token || '', name, studentId: sid } }); toast('Registered!');
    }
    loadData(sid, cid);
  };
  const saveProfile = async () => {
    if (!nameInput.trim()) return toast('Name required', 'error');
    await API('update_profile', { method: 'PUT', body: { student_db_id: data.student_db_id, name: nameInput.trim() } });
    toast('Updated!'); setName(nameInput.trim()); setEditingName(false);
  };

  const fontSize = fs === 'small' ? '0.85rem' : fs === 'large' ? '1.15rem' : '1rem';
  const cardPadding = cs === 'compact' ? '10px' : '16px';

  if (!savedSid && !savedCid && !data) {
    return (
      <div className="auth-container" style={{ marginTop: 60 }}>
        <h1>📡 Live Campus Event Ticker</h1>
        <p className="subtitle">Student Live Feed</p>
        <div className="auth-card">
          <div className="form-group"><label>Student ID</label><input value={sid} onChange={e => setSid(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} /></div>
          <div className="form-group"><label>Campus ID</label><input value={cid} onChange={e => setCid(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} /></div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleLogin}>View Events</button>
          <p className="auth-link">First time? <a href="/?token=" style={{ color: 'var(--accent)' }} onClick={e => { e.preventDefault(); setView('enroll'); }}>Enroll via QR code</a></p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: bg === 'light' ? '#f5f5f0' : bg === 'gradient' ? `linear-gradient(135deg,${pc}11,${ac}11)` : '#05060f', color: bg === 'light' ? '#111' : '#fff', fontSize, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div className="ticker-header" style={{ borderRadius: br + 'px' }}>
        <h1 style={{ color: pc }}>📡 Live Campus Event Ticker</h1>
        <p className="subtitle">Welcome, {name || savedSid}</p>
        <span className="mqtt-status"><span className="mqtt-dot connected"></span> Connected</span>
      </div>
      {s.banner_enabled && s.banner_text && <div className="ticker-banner" style={{ background: pc, borderRadius: br + 'px' }}>{s.banner_text}</div>}
      <div style={{ padding: '0 16px', flex: 1, maxWidth: 800, margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ color: pc }}>📢 Notifications</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => setEditingName(true)}>Edit Name</button>
            <button className="btn btn-danger btn-sm" onClick={handleLogout}>Logout</button>
          </div>
        </div>
        <div className="notif-list">
          {data?.notifications?.length ? data.notifications.map(n => (
            <div key={n.id} className={`notif-card${n.pinned ? ' pinned' : ''}`} style={{ borderRadius: br + 'px', padding: cardPadding }}>
              {n.pinned ? <span className="pin-badge">📌 Pinned</span> : ''}
              <div><strong style={{ color: pc }}>{n.title}</strong><p style={{ fontSize: '0.9rem', margin: '4px 0' }}>{n.body}</p><span className="notif-time">{new Date(n.sent_at).toLocaleDateString()}</span></div>
            </div>
          )) : <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>No notifications yet</p>}
        </div>
        <h2 style={{ color: pc, marginTop: 24 }}>📅 Upcoming Events</h2>
        <div className="event-list">
          {data?.events?.length ? data.events.map(ev => (
            <div key={ev.id} className="event-card" style={{ borderRadius: br + 'px', padding: cardPadding }}>
              <h3 style={{ color: pc }}>{ev.name}</h3>
              {s.show_dates !== false && <div className="meta" style={{ display: s.show_dates !== false ? 'block' : 'none' }}>📅 {new Date(ev.event_date).toLocaleDateString()}</div>}
              {ev.description && s.show_descriptions !== false && <div className="desc" style={{ display: s.show_descriptions !== false ? 'block' : 'none' }}>{ev.description}</div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <span className={`capacity ${parseInt(ev.registrations) >= parseInt(ev.max_capacity) ? 'full' : 'available'}`}>{parseInt(ev.registrations) >= parseInt(ev.max_capacity) ? 'Full' : `${ev.registrations}/${ev.max_capacity} spots`}</span>
                <button className={`btn btn-sm ${ev.registered ? 'btn-danger' : 'btn-accent'}`} onClick={handleEnroll(ev, ev.registered)}>{ev.registered ? 'Unregister' : 'Register'}</button>
              </div>
            </div>
          )) : <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>No upcoming events</p>}
        </div>
      </div>
      {s.footer_text && <div className="ticker-footer" style={{ color: ac }}>{s.footer_text}</div>}
      {editingName && <Modal onClose={() => setEditingName(false)}>
        <h2>Edit Name</h2>
        <div className="form-group"><input value={nameInput} onChange={e => setNameInput(e.target.value)} /></div>
        <div className="modal-actions"><button className="btn btn-outline" onClick={() => setEditingName(false)}>Cancel</button><button className="btn btn-primary" onClick={saveProfile}>Save</button></div>
      </Modal>}
    </div>
  );
}

// ─── ENROLL ───
function EnrollView({ setView, toast, oneSignalSetUser }) {
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [sid, setSid] = useState('');
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('token')) setToken(q.get('token'));
  }, []);
  const enroll = async () => {
    if (!token || !name || !sid) return toast('Fill in all fields', 'error');
    try {
      const d = await API('enroll', { method: 'POST', body: { token, name, studentId: sid } });
      localStorage.setItem('sessionSid', sid); localStorage.setItem('sessionName', name);
      try { const r = await API(`resolve-token&token=${token}`); if (r.campus_id) localStorage.setItem('sessionCid', r.campus_id); oneSignalSetUser(sid, r.campus_id, name); } catch {}
      toast('Enrolled!'); setView('ticker');
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="enroll-container">
      <h1>📋 Enroll</h1><p>Register via QR code</p>
      <div className="enroll-card">
        <div className="form-group"><label>QR Token</label><input className="qr-input" value={token} onChange={e => setToken(e.target.value)} placeholder="Paste QR token" /></div>
        <div className="form-group"><label>Your Name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" onKeyDown={e => e.key === 'Enter' && enroll()} /></div>
        <div className="form-group"><label>Student ID</label><input value={sid} onChange={e => setSid(e.target.value)} placeholder="e.g. 2025-0001" onKeyDown={e => e.key === 'Enter' && enroll()} /></div>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={enroll}>Enroll</button>
      </div>
      <p className="auth-link">Already enrolled? <a href="#" style={{ color: 'var(--accent)' }} onClick={e => { e.preventDefault(); setView('ticker'); }}>Open Live Ticker</a></p>
    </div>
  );
}

// ─── MODAL ───
function Modal({ onClose, children, style }) {
  return (
    <div className="modal-overlay" onClick={e => { if (e.target.className === 'modal-overlay') onClose(); }}>
      <div className="modal" style={style}>{children}</div>
    </div>
  );
}
