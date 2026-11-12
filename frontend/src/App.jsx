import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText, serverNow, NET_MSG, ApiError } from './api.js';

const ID_RE = /^[0-9]{17}$/;
const STORAGE_KEY = 'studentId';
const REFRESH_MS = 4000;

const STATUS_BN = {
  HELD: 'আবেদন চলমান',
  CONFIRMED: 'ভর্তি নিশ্চিত',
  EXPIRED: 'সময় শেষ',
  CANCELLED: 'বাতিল'
};

// parents may type Bengali digits: turn them into 0-9 so the id is always the same
export const toAsciiDigits = (s) => String(s).replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d)).replace(/\s+/g, '');

export const fmtCountdown = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};

// a HELD application whose time is over counts as EXPIRED right away (no reload needed)
export const effectiveStatus = (h, now) =>
  h.status === 'HELD' && Date.parse(h.expiresAt) <= now ? 'EXPIRED' : h.status;

// the student's running (not expired) or confirmed application in one class (the API allows only one per class)
export const activeInClass = (holds, classId, now) =>
  (holds || []).find((h) => h.classId === classId && ['HELD', 'CONFIRMED'].includes(effectiveStatus(h, now))) || null;

const seatsOk = (v) => /^[0-9]+$/.test(String(v).trim()) && Number(v) >= 1 && Number(v) <= 100000;

function useNow() {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 500);
    return () => clearInterval(t);
  }, []);
  return now;
}

function useHash() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const f = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return hash.replace(/^#/, '') || '/';
}
const go = (p) => { window.location.hash = p; };

function Banner({ msg, kind = 'error', onClose }) {
  if (!msg) return null;
  return (
    <div className={`banner ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span>{msg}</span>
      <button className="link" onClick={onClose} aria-label="বন্ধ করুন">✕</button>
    </div>
  );
}

// one application: status, time left, "ভর্তি ফি দিন" and "বাতিল"
export function HoldCard({ h, now, busy, onPay, onCancel, onOpen }) {
  const st = effectiveStatus(h, now);
  const left = Date.parse(h.expiresAt) - now;
  return (
    <div className={`hold ${st.toLowerCase()}`}>
      <div className="hold-main">
        <b className="hold-title">{h.className || h.classId}</b>
        <div className="muted small">আবেদন নম্বর: {h.holdId}</div>
        <div><span className={`badge ${st.toLowerCase()}`}>{STATUS_BN[st] || st}</span></div>
        {st === 'HELD' && <div className="timer">⏱ মেয়াদ শেষ হতে বাকি: <b data-testid="countdown">{fmtCountdown(left)}</b></div>}
        {st === 'EXPIRED' && <div className="muted small">সময় শেষ, আসনটি ছেড়ে দেওয়া হয়েছে।</div>}
      </div>
      <div className="row nowrap">
        {onOpen && <button className="ghost" onClick={() => onOpen(h)}>বিস্তারিত</button>}
        {(st === 'HELD' || st === 'EXPIRED') && <button disabled={st !== 'HELD' || busy} onClick={() => onPay(h)}>ভর্তি ফি দিন</button>}
        {st === 'HELD' && <button className="secondary" disabled={busy} onClick={() => onCancel(h)}>বাতিল</button>}
      </div>
    </div>
  );
}

function Header({ route }) {
  const part = route.startsWith('/admin') ? 'admin' : /^\/(my|application)(\/|$)/.test(route) ? 'my' : 'classes';
  const link = (key, href, text) => <a href={href} className={part === key ? 'on' : ''} aria-current={part === key ? 'page' : undefined}>{text}</a>;
  return (
    <header className="topbar">
      <div className="topbar-in">
        <a className="brand" href="#/">
          <span className="logo" aria-hidden="true">🎓</span>
          <span><b>স্কুল ভর্তি</b><small>School Admission System</small></span>
        </a>
        <nav aria-label="প্রধান মেনু">
          {link('classes', '#/', 'ক্লাস তালিকা')}
          {link('my', '#/my', 'আমার আবেদন')}
          {link('admin', '#/admin', 'ক্লাস তৈরি (স্কুল অ্যাডমিন)')}
        </nav>
      </div>
    </header>
  );
}

// the box at the top of every page where the student's birth registration number is typed (no login)
function StudentBar({ studentId, onSave, editToken }) {
  const inputRef = useRef(null);
  const [text, setText] = useState(studentId);
  const [editing, setEditing] = useState(!studentId);
  const [err, setErr] = useState('');
  useEffect(() => { setText(studentId); setEditing(!studentId); setErr(''); }, [studentId]);
  useEffect(() => {
    if (editToken > 0) { setEditing(true); setTimeout(() => inputRef.current && inputRef.current.focus(), 0); }
  }, [editToken]);
  const save = (e) => {
    e.preventDefault();
    const v = toAsciiDigits(text);
    if (!ID_RE.test(v)) { setErr('জন্ম নিবন্ধন নম্বর ঠিক ১৭টি সংখ্যার হতে হবে।'); return; }
    setErr(''); onSave(v);
  };
  return (
    <div className="studentbar">
      <div className="studentbar-in">
        {editing ? (
          <form className="sb-form" onSubmit={save}>
            <label htmlFor="sid">শিক্ষার্থীর জন্ম নিবন্ধন নম্বর (১৭ সংখ্যা)</label>
            <div className="row nowrap">
              <input id="sid" ref={inputRef} inputMode="numeric" maxLength={17} value={text} placeholder="যেমন 20120101234567890"
                     onChange={(e) => setText(toAsciiDigits(e.target.value))} />
              <button type="submit">সংরক্ষণ করুন</button>
              {studentId && <button type="button" className="ghost" onClick={() => { setEditing(false); setText(studentId); setErr(''); }}>বাদ দিন</button>}
            </div>
            {err && <p className="field-error" role="alert">{err}</p>}
          </form>
        ) : (
          <div className="sb-show">
            <span>শিক্ষার্থীর জন্ম নিবন্ধন নং <b>{studentId}</b></span>
            <button type="button" className="ghost" onClick={() => setEditing(true)}>নম্বর পরিবর্তন</button>
          </div>
        )}
      </div>
    </div>
  );
}

// screen: Class তালিকা
function ClassesPage({ classes, holds, now, busyId, onApply }) {
  if (classes === null) return <p className="muted">লোড হচ্ছে…</p>;
  return (
    <>
      <div className="pagehead"><h1>ক্লাস তালিকা</h1><p className="muted">"আবেদন করুন" চাপলে নির্দিষ্ট সময়ের জন্য আসনটি শিক্ষার্থীর নামে ধরা থাকবে; এর মধ্যে ভর্তি ফি দিয়ে ভর্তি নিশ্চিত করুন।</p></div>
      {classes.length === 0 ? (
        <div className="card center"><h2>এখনও কোনো ক্লাস তৈরি হয়নি</h2><p className="muted">"ক্লাস তৈরি" পাতা থেকে স্কুল অ্যাডমিন ক্লাস যোগ করতে পারবেন।</p></div>
      ) : (
        <div className="card tablewrap">
          <table>
            <thead><tr><th>ক্লাস</th><th>মোট আসন</th><th>ধরা আছে (hold)</th><th>নিশ্চিত</th><th>খালি আসন</th><th></th></tr></thead>
            <tbody>
              {classes.map((c) => {
                const mine = activeInClass(holds, c.id, now);
                const full = c.availableSeats <= 0;
                return (
                  <tr key={c.id}>
                    <td><b>{c.name}</b></td>
                    <td>{c.totalSeats}</td><td>{c.heldSeats}</td><td>{c.confirmedSeats}</td><td><b>{c.availableSeats}</b></td>
                    <td>
                      {mine
                        ? <a className="btn ghost" href={'#/application/' + mine.holdId}>আবেদন দেখুন</a>
                        : <button disabled={full || busyId === 'class:' + c.id} onClick={() => onApply(c)}>
                            {full ? 'আসন নেই' : busyId === 'class:' + c.id ? 'অপেক্ষা করুন…' : 'আবেদন করুন'}
                          </button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// screen: আবেদন (status, time left, pay, cancel)
function StatusPage({ hold, now, busy, onPay, onCancel }) {
  if (!hold) return <div className="card center"><h2>আবেদনটি পাওয়া যায়নি</h2><p className="muted">আবেদন নম্বরটি ঠিক নেই অথবা এটি অন্য শিক্ষার্থীর।</p><a className="btn" href="#/my">আমার আবেদন দেখুন</a></div>;
  const st = effectiveStatus(hold, now);
  const left = Date.parse(hold.expiresAt) - now;
  return (
    <>
      <div className="pagehead"><h1>আবেদনের অবস্থা</h1></div>
      <section className="card status">
        <h2>{hold.className}</h2>
        <p className="muted small">আবেদন নম্বর: {hold.holdId}</p>
        <p><span className={`badge ${st.toLowerCase()}`}>{STATUS_BN[st] || st}</span></p>
        {st === 'HELD' && (
          <div className="clock"><span>মেয়াদ শেষ হতে বাকি সময়</span><b data-testid="countdown">{fmtCountdown(left)}</b>
            <small>এই সময়ের মধ্যে ভর্তি ফি না দিলে আসনটি অন্যদের জন্য খুলে যাবে।</small></div>
        )}
        {st === 'EXPIRED' && <div className="notice">সময় শেষ, আসনটি ছেড়ে দেওয়া হয়েছে। ক্লাস তালিকা থেকে নতুন করে আবেদন করতে পারেন।</div>}
        {st === 'CANCELLED' && <div className="notice">এই আবেদনটি বাতিল করা হয়েছে।</div>}
        {st === 'CONFIRMED' && <div className="notice ok">ভর্তি ফি জমা হয়েছে, ভর্তি নিশ্চিত।</div>}
        <div className="row">
          {(st === 'HELD' || st === 'EXPIRED') && <button className="big" disabled={st !== 'HELD' || busy} onClick={() => onPay(hold)}>ভর্তি ফি দিন</button>}
          {st === 'HELD' && <button className="secondary big" disabled={busy} onClick={() => onCancel(hold)}>বাতিল</button>}
          <a className="btn ghost" href="#/">ক্লাস তালিকা</a>
        </div>
      </section>
    </>
  );
}

// screen: আমার আবেদন
function MyPage({ holds, now, busyId, onPay, onCancel }) {
  return (
    <>
      <div className="pagehead"><h1>আমার আবেদন</h1><p className="muted">এই শিক্ষার্থীর সব আবেদন ও প্রতিটির অবস্থা।</p></div>
      {holds.length === 0 && <div className="card center"><h2>এখনও কোনো আবেদন নেই</h2><a className="btn big" href="#/">ক্লাস তালিকা দেখুন</a></div>}
      {holds.map((h) => (
        <HoldCard key={h.holdId} h={h} now={now} busy={busyId === h.holdId}
                  onOpen={(x) => go('/application/' + x.holdId)} onPay={onPay} onCancel={onCancel} />
      ))}
    </>
  );
}

// screen: Class তৈরি (school admin): the class name and number of seats
function AdminPage({ onChanged, onError, onInfo }) {
  const [name, setName] = useState('');
  const [seats, setSeats] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const create = async (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setErr('ক্লাসের নাম লিখুন।');
    if (n.length > 200) return setErr('ক্লাসের নাম সর্বোচ্চ ২০০ অক্ষরের হতে পারবে।');
    const s = toAsciiDigits(seats);
    if (!seatsOk(s)) return setErr('আসন সংখ্যা ১ থেকে ১,০০,০০০ এর মধ্যে একটি পূর্ণ সংখ্যা হতে হবে।');
    setErr(''); setBusy(true);
    try {
      await api('/classes', { method: 'POST', body: { name: n, totalSeats: Number(s) } });
      onInfo(`"${n}" ক্লাস তৈরি হয়েছে (${Number(s)}টি আসন)।`);
      setName(''); setSeats('');
    } catch (ex) { setErr(errorText(ex)); onError(''); }
    finally { setBusy(false); onChanged(); }
  };

  return (
    <>
      <div className="pagehead"><h1>ক্লাস তৈরি (স্কুল অ্যাডমিন)</h1><p className="muted">প্রতিটি শিফট আলাদা ক্লাস। যেমন "Class 6 Morning Shift" আর "Class 6 Day Shift" দুটো আলাদা ক্লাস, প্রতিটির নিজস্ব আসন সংখ্যা।</p></div>
      <form className="card status" onSubmit={create}>
        <label htmlFor="cname">ক্লাসের নাম</label>
        <input id="cname" value={name} maxLength={200} placeholder="যেমন Class 6 Morning Shift" onChange={(e) => setName(e.target.value)} />
        <label htmlFor="cseats">মোট আসন সংখ্যা</label>
        <input id="cseats" inputMode="numeric" value={seats} placeholder="যেমন 120" onChange={(e) => setSeats(e.target.value)} />
        {err && <p className="field-error" role="alert">{err}</p>}
        <div className="row"><button type="submit" className="big" disabled={busy}>{busy ? 'অপেক্ষা করুন…' : 'ক্লাস তৈরি করুন'}</button></div>
      </form>
    </>
  );
}

export default function App() {
  const route = useHash();
  const [studentId, setStudentId] = useState(() => localStorage.getItem(STORAGE_KEY) || '');
  const [classes, setClasses] = useState(null);
  const [holds, setHolds] = useState([]);
  const [holdsLoaded, setHoldsLoaded] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busyId, setBusyId] = useState('');
  const [editToken, setEditToken] = useState(0);
  const now = useNow();
  const loggedIn = ID_RE.test(studentId);

  const loadClasses = useCallback(async () => {
    try { setClasses(await api('/classes')); setError((e) => (e === NET_MSG ? '' : e)); }
    catch (ex) { setError(errorText(ex)); }
  }, []);

  const loadHolds = useCallback(async () => {
    if (!ID_RE.test(studentId)) { setHolds([]); setHoldsLoaded(true); return; }
    try { setHolds(await api('/me/holds', { studentId })); setHoldsLoaded(true); }
    catch (ex) { setError(errorText(ex)); }
  }, [studentId]);

  const refreshAll = useCallback(() => Promise.all([loadClasses(), loadHolds()]), [loadClasses, loadHolds]);
  // seat numbers and applications refresh by themselves every few seconds (no page reload)
  useEffect(() => { refreshAll(); const t = setInterval(refreshAll, REFRESH_MS); return () => clearInterval(t); }, [refreshAll]);

  const anyJustExpired = holds.some((h) => h.status === 'HELD' && Date.parse(h.expiresAt) <= now);
  useEffect(() => { if (anyJustExpired) refreshAll(); }, [anyJustExpired]); // eslint-disable-line

  const saveStudent = (v) => {
    localStorage.setItem(STORAGE_KEY, v);
    if (v !== studentId) { setHolds([]); setHoldsLoaded(false); }
    setStudentId(v); setError(''); setInfo('');
  };

  const askForId = () => {
    setError(errorText(new ApiError(400, 'MISSING_STUDENT_ID', '')));
    window.scrollTo && window.scrollTo({ top: 0, behavior: 'smooth' });
    setEditToken((t) => t + 1);
  };

  const apply = async (c) => {
    if (!loggedIn) return askForId();
    setError(''); setInfo(''); setBusyId('class:' + c.id);
    try {
      const h = await api(`/classes/${c.id}/holds`, { method: 'POST', studentId });
      await refreshAll();
      go('/application/' + h.holdId);
    } catch (ex) { setError(errorText(ex)); refreshAll(); }
    finally { setBusyId(''); }
  };

  // "ভর্তি ফি দিন": payment is assumed successful, so this simply confirms the admission
  const pay = async (h) => {
    setError(''); setInfo(''); setBusyId(h.holdId);
    try { await api(`/holds/${h.holdId}/confirm`, { method: 'POST', studentId }); setInfo('ভর্তি ফি জমা হয়েছে, ভর্তি নিশ্চিত হয়েছে।'); }
    catch (ex) { setError(errorText(ex)); }
    finally { setBusyId(''); refreshAll(); }
  };

  const cancel = async (h) => {
    if (!window.confirm('আবেদনটি বাতিল করতে চান? আসনটি ছেড়ে দেওয়া হবে।')) return;
    setError(''); setInfo(''); setBusyId(h.holdId);
    try { await api(`/holds/${h.holdId}`, { method: 'DELETE', studentId }); setInfo('আবেদন বাতিল হয়েছে, আসনটি ছেড়ে দেওয়া হয়েছে।'); }
    catch (ex) { setError(errorText(ex)); }
    finally { setBusyId(''); refreshAll(); }
  };

  const seg = route.split('/').filter(Boolean);
  const needId = <div className="card center"><h2>প্রথমে শিক্ষার্থীর পরিচয় দিন</h2><p className="muted">উপরের ঘরে ১৭ সংখ্যার জন্ম নিবন্ধন নম্বর লিখে "সংরক্ষণ করুন" চাপুন।</p></div>;
  const loadingCard = <p className="muted">লোড হচ্ছে…</p>;

  let page;
  if (seg[0] === 'admin') {
    page = <AdminPage onChanged={loadClasses} onError={setError} onInfo={setInfo} />;
  } else if (['application', 'my'].includes(seg[0]) && !loggedIn) {
    page = needId;
  } else if (seg[0] === 'application') {
    page = holdsLoaded
      ? <StatusPage hold={holds.find((h) => h.holdId === seg[1])} now={now} busy={busyId === seg[1]} onPay={pay} onCancel={cancel} />
      : loadingCard;
  } else if (seg[0] === 'my') {
    page = holdsLoaded ? <MyPage holds={holds} now={now} busyId={busyId} onPay={pay} onCancel={cancel} /> : loadingCard;
  } else {
    page = <ClassesPage classes={classes} holds={holds} now={now} busyId={busyId} onApply={apply} />;
  }

  return (
    <div className="app">
      <Header route={route} />
      <StudentBar studentId={loggedIn ? studentId : ''} onSave={saveStudent} editToken={editToken} />
      <main className="wrap">
        <Banner msg={error} onClose={() => setError('')} />
        <Banner msg={info} kind="info" onClose={() => setInfo('')} />
        {page}
      </main>
    </div>
  );
}
