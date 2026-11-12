import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorText, serverNow, NET_MSG } from './api.js';

const ID_RE = /^\d{17}$/;
const STORAGE_KEY = 'studentId';
const REFRESH_MS = 4000;
const CLASS_LEVELS = [6, 7, 8, 9, 10];
const SHIFTS = [
  { key: 'Morning', bn: 'প্রভাতি শিফট' },
  { key: 'Day', bn: 'দিবা শিফট' }
];

const STATUS_BN = {
  HELD: 'আবেদন চলমান',
  CONFIRMED: 'ভর্তি নিশ্চিত',
  EXPIRED: 'সময় শেষ',
  CANCELLED: 'বাতিল'
};

export const fmtCountdown = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};

// a HELD application whose time is over counts as EXPIRED right away (no reload needed)
export const effectiveStatus = (h, now) =>
  h.status === 'HELD' && Date.parse(h.expiresAt) <= now ? 'EXPIRED' : h.status;

// one birth registration number = one application: a student with a running (HELD, not expired)
// or confirmed application cannot start another one (UI rule; the API itself only limits per class)
export const activeHold = (holds, now) =>
  (holds || []).find((h) => ['HELD', 'CONFIRMED'].includes(effectiveStatus(h, now))) || null;

export const parseClassName = (name) => {
  const m = /^Class\s+(\d+)\s+(Morning|Day)\s+Shift$/i.exec((name || '').trim());
  return m ? { level: Number(m[1]), shift: m[2][0].toUpperCase() + m[2].slice(1).toLowerCase() } : null;
};
export const classLabel = (name) => {
  const p = parseClassName(name);
  if (!p) return name;
  const sh = SHIFTS.find((s) => s.key === p.shift);
  return `ক্লাস ${p.level} · ${sh.bn}`;
};

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

function Seats({ c }) {
  const total = Math.max(1, c.totalSeats);
  const pc = (n) => `${Math.min(100, (n / total) * 100)}%`;
  return (
    <div className="seatbar" aria-hidden="true">
      <span className="seg conf" style={{ width: pc(c.confirmedSeats) }} />
      <span className="seg held" style={{ width: pc(c.heldSeats) }} />
    </div>
  );
}

export function HoldCard({ h, now, busy, onPay, onCancel, onOpen }) {
  const st = effectiveStatus(h, now);
  const left = Date.parse(h.expiresAt) - now;
  return (
    <div className={`hold ${st.toLowerCase()}`}>
      <div className="hold-main">
        <b className="hold-title">{classLabel(h.className || h.classId)}</b>
        <div className="muted small">আবেদন নম্বর: {h.holdId}</div>
        <div><span className={`badge ${st.toLowerCase()}`}>{STATUS_BN[st] || st}</span></div>
        {st === 'HELD' && <div className="timer">⏱ বাকি সময়: <b data-testid="countdown">{fmtCountdown(left)}</b></div>}
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

function Header({ admin, route }) {
  const myGroup = /^\/(my|application|pay|success)(\/|$)/.test(route);
  return (
    <header className={`topbar ${admin ? 'admin' : ''}`}>
      <div className="topbar-in">
        <a className="brand" href={admin ? '#/admin' : '#/'}>
          <span className="logo" aria-hidden="true">🎓</span>
          <span><b>{admin ? 'প্রশাসক প্যানেল' : 'অনলাইন স্কুল ভর্তি পোর্টাল'}</b><small>{admin ? 'ক্লাস ও আসন ব্যবস্থাপনা' : 'ষষ্ঠ থেকে দশম শ্রেণি'}</small></span>
        </a>
        {!admin && (
          <nav aria-label="প্রধান মেনু">
            <a href="#/" className={!myGroup ? 'on' : ''} aria-current={!myGroup ? 'page' : undefined}>ক্লাসসমূহ</a>
            <a href="#/my" className={myGroup ? 'on' : ''} aria-current={myGroup ? 'page' : undefined}>আমার আবেদন</a>
          </nav>
        )}
        {admin && <nav><a href="#/">← অভিভাবক পোর্টালে যান</a></nav>}
      </div>
    </header>
  );
}

// the box at the top of every guardian page where the student's birth registration number is typed
function StudentBar({ studentId, onSave }) {
  const [text, setText] = useState(studentId);
  const [editing, setEditing] = useState(!studentId);
  const [err, setErr] = useState('');
  useEffect(() => { setText(studentId); setEditing(!studentId); setErr(''); }, [studentId]);
  const save = (e) => {
    e.preventDefault();
    const v = text.trim();
    if (!ID_RE.test(v)) { setErr('জন্ম নিবন্ধন নম্বর ঠিক ১৭টি সংখ্যার হতে হবে (ইংরেজি 0-9 সংখ্যা লিখুন)।'); return; }
    setErr(''); onSave(v);
  };
  return (
    <div className="studentbar">
      <div className="studentbar-in">
        {editing ? (
          <form className="sb-form" onSubmit={save}>
            <label htmlFor="sid">শিক্ষার্থীর জন্ম নিবন্ধন নম্বর (১৭ সংখ্যা)</label>
            <div className="row nowrap">
              <input id="sid" inputMode="numeric" maxLength={17} value={text} placeholder="যেমন 20120101234567890"
                     onChange={(e) => setText(e.target.value)} />
              <button type="submit">সংরক্ষণ করুন</button>
              {studentId && <button type="button" className="ghost" onClick={() => { setEditing(false); setText(studentId); setErr(''); }}>বাদ দিন</button>}
            </div>
            {err && <p className="field-error" role="alert">{err}</p>}
          </form>
        ) : (
          <div className="sb-show">
            <span title="শিক্ষার্থীর জন্ম নিবন্ধন নম্বর">শিক্ষার্থীর জন্ম নিবন্ধন নং <b>{studentId}</b></span>
            <button type="button" className="ghost" onClick={() => setEditing(true)}>নম্বর পরিবর্তন</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ClassesPage({ classes, busyId, onApply, error, lock, current, now }) {
  const [level, setLevel] = useState(6);
  const list = classes || [];
  const byShift = (sh) => list.find((c) => { const p = parseClassName(c.name); return p && p.level === level && p.shift === sh; });
  const others = list.filter((c) => !parseClassName(c.name));
  const levelTotal = (l) => list.filter((c) => parseClassName(c.name)?.level === l).reduce((a, c) => a + c.availableSeats, 0);
  const card = (c, sh) => {
    if (!c) return (
      <div className="classcard empty" key={sh.key}>
        <h3>{sh.bn}</h3>
        <p className="muted">এই শিফটের ক্লাস এখনও চালু হয়নি।</p>
      </div>
    );
    const full = c.availableSeats <= 0;
    return (
      <div className="classcard" key={c.id}>
        <div className="cc-head"><h3>{sh ? sh.bn : c.name}</h3>{full && <span className="badge expired">আসন শেষ</span>}</div>
        <div className="avail"><b>{c.availableSeats}</b><span>টি আসন খালি</span></div>
        <Seats c={c} />
        <ul className="legend">
          <li><i className="dot conf" />নিশ্চিত {c.confirmedSeats}</li>
          <li><i className="dot held" />ধরা আছে {c.heldSeats}</li>
          <li>মোট {c.totalSeats}</li>
        </ul>
        <button className="big" disabled={full || Boolean(lock) || busyId === 'class:' + c.id} onClick={() => onApply(c)}>
          {full ? 'আসন নেই' : busyId === 'class:' + c.id ? 'অপেক্ষা করুন…' : 'আবেদন করুন'}
        </button>
      </div>
    );
  };
  return (
    <>
      <div className="pagehead"><h1>ভর্তির জন্য ক্লাস বেছে নিন</h1><p className="muted">শ্রেণি ও শিফট বেছে "আবেদন করুন" চাপলে নির্দিষ্ট সময়ের জন্য আসনটি আপনার নামে ধরে রাখা হবে; ওই সময়ের মধ্যে ভর্তি ফি দিয়ে নিশ্চিত করুন।</p></div>
      {lock === 'noid' && <div className="notice info">আবেদন করতে আগে উপরের ঘরে জন্ম নিবন্ধন নম্বর সংরক্ষণ করুন।</div>}
      {lock === 'active' && current && (
        <div className="notice info">
          {effectiveStatus(current, now) === 'CONFIRMED' ? 'এই শিক্ষার্থীর ভর্তি নিশ্চিত হয়েছে' : 'এই শিক্ষার্থীর একটি আবেদন চলমান'} ({classLabel(current.className)})। {' '}
          <a href={'#/application/' + current.holdId}>আবেদন দেখুন</a>
        </div>
      )}
      {classes === null && !error && <p className="muted">লোড হচ্ছে…</p>}
      {classes && list.length === 0 && <div className="card center"><h2>এখনও কোনো ক্লাস চালু হয়নি</h2><p className="muted">স্কুল কর্তৃপক্ষ ক্লাস চালু করলে এখানে দেখতে পাবেন। একটু পরে আবার দেখুন।</p></div>}
      {list.length > 0 && (
        <>
          <div className="tabs" role="tablist">
            {CLASS_LEVELS.map((l) => (
              <button key={l} role="tab" aria-selected={l === level} className={l === level ? 'tab on' : 'tab'} onClick={() => setLevel(l)}>
                ক্লাস {l}<small>{levelTotal(l)} আসন খালি</small>
              </button>
            ))}
          </div>
          <div className="grid2">{SHIFTS.map((sh) => card(byShift(sh.key), sh))}</div>
          {others.length > 0 && (<><h2 className="sect">অন্যান্য</h2><div className="grid2">{others.map((c) => card(c, null))}</div></>)}
        </>
      )}
    </>
  );
}

function Stepper({ step }) {
  const items = ['আবেদন', 'ভর্তি ফি', 'নিশ্চিত'];
  return <ol className="stepper">{items.map((t, i) => <li key={t} className={i < step ? 'done' : i === step ? 'cur' : ''}><span>{i + 1}</span>{t}</li>)}</ol>;
}

function StatusPage({ hold, now, busyId, onCancel }) {
  if (!hold) return <div className="card center"><h2>আবেদনটি পাওয়া যায়নি</h2><p className="muted">আবেদন নম্বরটি ঠিক নেই অথবা এটি অন্য শিক্ষার্থীর।</p><a className="btn" href="#/my">আমার আবেদনসমূহে যান</a></div>;
  const st = effectiveStatus(hold, now);
  const left = Date.parse(hold.expiresAt) - now;
  const step = st === 'CONFIRMED' ? 3 : 1;
  return (
    <>
      <div className="pagehead"><h1>আবেদনের অবস্থা</h1></div>
      <section className="card status">
        <Stepper step={step} />
        <h2>{classLabel(hold.className)}</h2>
        <p className="muted small">আবেদন নম্বর: {hold.holdId}</p>
        <p><span className={`badge ${st.toLowerCase()}`}>{STATUS_BN[st] || st}</span></p>
        {st === 'HELD' && (
          <div className="clock"><span>আসন ধরে রাখার বাকি সময়</span><b data-testid="countdown">{fmtCountdown(left)}</b>
            <small>এই সময়ের মধ্যে ভর্তি ফি না দিলে আসনটি অন্য শিক্ষার্থীর জন্য ছেড়ে দেওয়া হবে।</small></div>
        )}
        {st === 'EXPIRED' && <div className="notice">সময় শেষ, আসনটি ছেড়ে দেওয়া হয়েছে। ক্লাস তালিকা থেকে নতুন করে আবেদন করতে পারেন।</div>}
        {st === 'CANCELLED' && <div className="notice">এই আবেদনটি বাতিল করা হয়েছে।</div>}
        {st === 'CONFIRMED' && <div className="notice ok">ভর্তি ফি জমা হয়েছে, আপনার সন্তানের আসন নিশ্চিত।</div>}
        <div className="row">
          {(st === 'HELD' || st === 'EXPIRED') && <button className="big" disabled={st !== 'HELD' || busyId === hold.holdId} onClick={() => go('/pay/' + hold.holdId)}>ভর্তি ফি দিন</button>}
          {st === 'HELD' && <button className="secondary big" disabled={busyId === hold.holdId} onClick={() => onCancel(hold)}>বাতিল</button>}
          <a className="btn ghost" href="#/">ক্লাস তালিকা</a>
        </div>
      </section>
    </>
  );
}

function PayPage({ hold, now, busy, onConfirm }) {
  if (!hold) return <div className="card center"><h2>আবেদনটি পাওয়া যায়নি</h2><a className="btn" href="#/my">আমার আবেদনসমূহে যান</a></div>;
  const st = effectiveStatus(hold, now);
  const left = Date.parse(hold.expiresAt) - now;
  const ok = st === 'HELD';
  return (
    <>
      <div className="pagehead"><h1>ভর্তি ফি প্রদান</h1></div>
      <section className="card status">
        <Stepper step={ok ? 1 : st === 'CONFIRMED' ? 3 : 1} />
        <h2>অর্ডার সারসংক্ষেপ</h2>
        <dl className="summary">
          <div><dt>ক্লাস ও শিফট</dt><dd>{classLabel(hold.className)}</dd></div>
          <div><dt>আবেদন নম্বর</dt><dd>{hold.holdId}</dd></div>
          <div><dt>অবস্থা</dt><dd><span className={`badge ${st.toLowerCase()}`}>{STATUS_BN[st] || st}</span></dd></div>
        </dl>
        {ok && <div className="clock slim"><span>পেমেন্টের বাকি সময়</span><b data-testid="countdown">{fmtCountdown(left)}</b></div>}
        {!ok && <div className="notice warn">{st === 'EXPIRED' ? 'সময় শেষ, তাই আর ফি দেওয়া যাবে না।' : 'এই আবেদনে এখন ফি দেওয়া যাবে না।'}</div>}
        <p className="muted small">এটি একটি ডেমো পেমেন্ট ধাপ; কোনো প্রকৃত অর্থ কাটা হবে না। নিশ্চিত করলে পেমেন্ট সফল ধরা হবে।</p>
        <div className="row">
          <button className="big" disabled={!ok || busy} onClick={() => onConfirm(hold)}>{busy ? 'অপেক্ষা করুন…' : 'ফি জমা নিশ্চিত করুন'}</button>
          <a className="btn ghost" href={'#/application/' + hold.holdId}>← ফিরে যান</a>
        </div>
      </section>
    </>
  );
}

function SuccessPage({ hold, studentId }) {
  if (!hold || hold.status !== 'CONFIRMED') return <div className="card center"><h2>নিশ্চিত ভর্তি পাওয়া যায়নি</h2><a className="btn" href="#/my">আমার আবেদনসমূহে যান</a></div>;
  return (
    <section className="card status success">
      <Stepper step={3} />
      <div className="tick" aria-hidden="true">✓</div>
      <h1>ভর্তি নিশ্চিত হয়েছে!</h1>
      <p className="muted">ভর্তি ফি সফলভাবে জমা হয়েছে।</p>
      <dl className="summary">
        <div><dt>ক্লাস ও শিফট</dt><dd>{classLabel(hold.className)}</dd></div>
        <div><dt>আবেদন নম্বর</dt><dd>{hold.holdId}</dd></div>
        <div><dt>জন্ম নিবন্ধন নম্বর</dt><dd>{studentId}</dd></div>
        <div><dt>অবস্থা</dt><dd><span className="badge confirmed">ভর্তি নিশ্চিত</span></dd></div>
      </dl>
      <div className="row"><a className="btn big" href="#/my">আমার আবেদনসমূহ</a><a className="btn ghost" href="#/">ক্লাস তালিকা</a></div>
    </section>
  );
}

function MyPage({ holds, now, busyId, onCancel }) {
  return (
    <>
      <div className="pagehead"><h1>আমার আবেদনসমূহ</h1><p className="muted">এই শিক্ষার্থীর সব আবেদন এখানে দেখা যাবে।</p></div>
      {holds.length === 0 && <div className="card center"><h2>এখনও কোনো আবেদন নেই</h2><a className="btn big" href="#/">ক্লাস বেছে আবেদন করুন</a></div>}
      {holds.map((h) => (
        <HoldCard key={h.holdId} h={h} now={now} busy={busyId === h.holdId}
                  onOpen={(x) => go('/application/' + x.holdId)} onPay={(x) => go('/pay/' + x.holdId)} onCancel={onCancel} />
      ))}
    </>
  );
}

const seatsOk = (v) => /^\d+$/.test(String(v).trim()) && Number(v) >= 1 && Number(v) <= 100000;
const SEATS_ERR = 'আসন সংখ্যা ১ থেকে ১,০০,০০০ এর মধ্যে একটি পূর্ণ সংখ্যা হতে হবে।';
const mkName = (level, shift) => `Class ${level} ${shift} Shift`;

function AdminPage({ classes, onChanged, onError, onInfo }) {
  const [level, setLevel] = useState(6);
  const [shift, setShift] = useState('Morning');
  const [seats, setSeats] = useState('60');
  const [bulkSeats, setBulkSeats] = useState('60');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(null);
  const existing = useMemo(() => new Set((classes || []).map((c) => c.name)), [classes]);

  const create = async (e) => {
    e.preventDefault();
    if (!seatsOk(seats)) return setErr(SEATS_ERR);
    const name = mkName(level, shift);
    if ((classes || []).some((c) => c.name === name && (!editing || c.id !== editing.id))) return setErr('এই ক্লাস ও শিফট আগে থেকেই তৈরি করা আছে।');
    setErr(''); setBusy(true);
    try {
      if (editing) {
        await api('/classes/' + editing.id, { method: 'PUT', body: { name, totalSeats: Number(seats) } });
        onInfo(`"${classLabel(name)}" হালনাগাদ হয়েছে।`); setEditing(null); setSeats('60');
      } else {
        await api('/classes', { method: 'POST', body: { name, totalSeats: Number(seats) } });
        onInfo(`"${classLabel(name)}" তৈরি হয়েছে।`);
      }
      onChanged();
    }
    catch (ex) { onError(errorText(ex)); onChanged(); } finally { setBusy(false); }
  };

  const startEdit = (c) => {
    const p = parseClassName(c.name);
    if (!p) return;
    setEditing(c); setLevel(p.level); setShift(p.shift); setSeats(String(c.totalSeats)); setErr('');
    window.scrollTo && window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const stopEdit = () => { setEditing(null); setSeats('60'); setErr(''); };

  const remove = async (c) => {
    if (!window.confirm(`"${classLabel(c.name)}" ক্লাসটি মুছে ফেলবেন?\nনতুন আবেদন বন্ধ হবে ও চলমান আবেদন বাতিল হবে। যাদের ভর্তি নিশ্চিত হয়েছে তাদের তথ্য থাকবে।`)) return;
    setBusy(true);
    try { await api('/classes/' + c.id, { method: 'DELETE' }); if (editing && editing.id === c.id) stopEdit(); onInfo(`"${classLabel(c.name)}" মুছে ফেলা হয়েছে।`); }
    catch (ex) { onError(errorText(ex)); } finally { setBusy(false); onChanged(); }
  };

  const bulk = async () => {
    if (!seatsOk(bulkSeats)) return setErr(SEATS_ERR);
    setErr(''); setBusy(true);
    let made = 0;
    try {
      for (const l of CLASS_LEVELS) for (const sh of SHIFTS) {
        const name = mkName(l, sh.key);
        if (existing.has(name)) continue;
        await api('/classes', { method: 'POST', body: { name, totalSeats: Number(bulkSeats) } });
        made += 1;
      }
      onInfo(made ? `${made}টি ক্লাস তৈরি হয়েছে।` : 'সব ক্লাস আগে থেকেই তৈরি আছে।');
    } catch (ex) { onError(errorText(ex)); } finally { setBusy(false); onChanged(); }
  };

  return (
    <>
      <div className="pagehead"><h1>ক্লাস ব্যবস্থাপনা</h1><p className="muted">শুধু স্কুল কর্তৃপক্ষের জন্য। অভিভাবক পোর্টালে ক্লাস তৈরির কোনো সুযোগ নেই।</p></div>
      <div className="grid2">
        <form className="card" onSubmit={create}>
          <h2>{editing ? `সম্পাদনা: ${classLabel(editing.name)}` : 'নতুন ক্লাস যোগ করুন'}</h2>
          <label htmlFor="lv">শ্রেণি</label>
          <select id="lv" value={level} onChange={(e) => setLevel(Number(e.target.value))}>{CLASS_LEVELS.map((l) => <option key={l} value={l}>ক্লাস {l}</option>)}</select>
          <label htmlFor="sh">শিফট</label>
          <select id="sh" value={shift} onChange={(e) => setShift(e.target.value)}>{SHIFTS.map((s) => <option key={s.key} value={s.key}>{s.bn}</option>)}</select>
          <label htmlFor="st">মোট আসন</label>
          <input id="st" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} />
          {err && <p className="field-error" role="alert">{err}</p>}
          <div className="row">
            <button type="submit" className="big" disabled={busy}>{busy ? 'অপেক্ষা করুন…' : editing ? 'হালনাগাদ করুন' : 'ক্লাস তৈরি করুন'}</button>
            {editing && <button type="button" className="ghost big" onClick={stopEdit}>বাদ দিন</button>}
          </div>
        </form>
        <div className="card">
          <h2>এক ক্লিকে সব ক্লাস</h2>
          <p className="muted">ষষ্ঠ থেকে দশম শ্রেণি, প্রভাতি ও দিবা দুই শিফট মিলিয়ে ১০টি ক্লাস একসাথে তৈরি হবে (যেগুলো আছে সেগুলো বাদ যাবে)।</p>
          <label htmlFor="bs">প্রতি ক্লাসে আসন</label>
          <input id="bs" inputMode="numeric" value={bulkSeats} onChange={(e) => setBulkSeats(e.target.value)} />
          <button className="big" disabled={busy} onClick={bulk}>সব ক্লাস যোগ করুন</button>
        </div>
      </div>
      <section className="card">
        <h2>বর্তমান ক্লাস ও আসন</h2>
        {classes && classes.length === 0 && <p className="muted">এখনও কোনো ক্লাস তৈরি হয়নি।</p>}
        {classes && classes.length > 0 && (
          <div className="tablewrap"><table>
            <thead><tr><th>ক্লাস</th><th>মোট আসন</th><th>ধরা আছে</th><th>নিশ্চিত</th><th>খালি</th><th>কাজ</th></tr></thead>
            <tbody>{[...classes].sort((a, b) => (parseClassName(a.name)?.level || 99) - (parseClassName(b.name)?.level || 99) || a.name.localeCompare(b.name)).map((c) => (
              <tr key={c.id}><td>{classLabel(c.name)}</td><td>{c.totalSeats}</td><td>{c.heldSeats}</td><td>{c.confirmedSeats}</td><td><b>{c.availableSeats}</b></td>
                <td><div className="row nowrap">
                  {parseClassName(c.name) && <button type="button" className="ghost" disabled={busy} onClick={() => startEdit(c)}>সম্পাদনা</button>}
                  <button type="button" className="secondary" disabled={busy} onClick={() => remove(c)}>মুছুন</button>
                </div></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
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
  const now = useNow();
  const isAdmin = route.startsWith('/admin');
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
  useEffect(() => { refreshAll(); const t = setInterval(refreshAll, REFRESH_MS); return () => clearInterval(t); }, [refreshAll]);

  const anyJustExpired = holds.some((h) => h.status === 'HELD' && Date.parse(h.expiresAt) <= now);
  useEffect(() => { if (anyJustExpired) refreshAll(); }, [anyJustExpired]); // eslint-disable-line

  // clear old messages when the page changes
  useEffect(() => { setInfo(''); }, [route]);

  const saveStudent = (v) => {
    localStorage.setItem(STORAGE_KEY, v);
    if (v !== studentId) { setHolds([]); setHoldsLoaded(false); }
    setStudentId(v); setError(''); setInfo('');
  };

  const current = loggedIn && holdsLoaded ? activeHold(holds, now) : null;
  const lock = !loggedIn ? 'noid' : current ? 'active' : '';

  const apply = async (c) => {
    if (lock) { setError(lock === 'noid' ? 'আগে উপরের ঘরে শিক্ষার্থীর জন্ম নিবন্ধন নম্বর লিখে সংরক্ষণ করুন।' : 'এই শিক্ষার্থীর একটি আবেদন ইতিমধ্যে আছে; একটি জন্ম নিবন্ধন নম্বর দিয়ে একটির বেশি আবেদন করা যায় না।'); return; }
    setError(''); setInfo(''); setBusyId('class:' + c.id);
    try {
      const h = await api(`/classes/${c.id}/holds`, { method: 'POST', studentId });
      await refreshAll();
      go('/application/' + h.holdId);
    } catch (ex) { setError(errorText(ex)); refreshAll(); }
    finally { setBusyId(''); }
  };

  const pay = async (h) => {
    setError(''); setInfo(''); setBusyId(h.holdId);
    try { await api(`/holds/${h.holdId}/confirm`, { method: 'POST', studentId }); await refreshAll(); go('/success/' + h.holdId); }
    catch (ex) { setError(errorText(ex)); refreshAll(); }
    finally { setBusyId(''); }
  };

  const cancel = async (h) => {
    if (!window.confirm('আবেদনটি বাতিল করতে চান? আসনটি ছেড়ে দেওয়া হবে।')) return;
    setError(''); setInfo(''); setBusyId(h.holdId);
    try { await api(`/holds/${h.holdId}`, { method: 'DELETE', studentId }); setInfo('আবেদন বাতিল হয়েছে, আসনটি ছেড়ে দেওয়া হয়েছে।'); }
    catch (ex) { setError(errorText(ex)); }
    finally { setBusyId(''); refreshAll(); }
  };

  const seg = route.split('/').filter(Boolean);
  const holdOf = (id) => holds.find((h) => h.holdId === id);

  let page;
  const needId = <div className="card center"><h2>প্রথমে শিক্ষার্থীর পরিচয় দিন</h2><p className="muted">উপরের ঘরে শিক্ষার্থীর ১৭ সংখ্যার জন্ম নিবন্ধন নম্বর লিখে "সংরক্ষণ করুন" চাপুন।</p></div>;
  const loadingCard = <p className="muted">লোড হচ্ছে…</p>;
  if (isAdmin) {
    page = <AdminPage classes={classes} onChanged={loadClasses} onError={setError} onInfo={setInfo} />;
  } else if (['application', 'pay', 'success', 'my'].includes(seg[0]) && !loggedIn) {
    page = needId;
  } else if (['application', 'pay', 'success'].includes(seg[0]) && !holdsLoaded) {
    page = loadingCard;
  } else if (seg[0] === 'application') {
    page = <StatusPage hold={holdOf(seg[1])} now={now} busyId={busyId} onCancel={cancel} />;
  } else if (seg[0] === 'pay') {
    page = <PayPage hold={holdOf(seg[1])} now={now} busy={busyId === seg[1]} onConfirm={pay} />;
  } else if (seg[0] === 'success') {
    page = <SuccessPage hold={holdOf(seg[1])} studentId={studentId} />;
  } else if (seg[0] === 'my') {
    page = holdsLoaded ? <MyPage holds={holds} now={now} busyId={busyId} onCancel={cancel} /> : loadingCard;
  } else {
    page = <ClassesPage classes={classes} busyId={busyId} onApply={apply} error={error} lock={lock} current={current} now={now} />;
  }

  return (
    <div className={isAdmin ? 'app admin' : 'app'}>
      <Header admin={isAdmin} route={route} />
      {!isAdmin && <StudentBar studentId={loggedIn ? studentId : ''} onSave={saveStudent} />}
      <main className="wrap">
        <Banner msg={error} onClose={() => setError('')} />
        <Banner msg={info} kind="info" onClose={() => setInfo('')} />
        {page}
      </main>
    </div>
  );
}
