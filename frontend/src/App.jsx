import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorText, serverNow, NET_MSG } from './api.js';

const ID_RE = /^\d{17}$/;
const STORAGE_KEY = 'studentId';
const REFRESH_MS = 4000;

const STATUS_BN = {
  HELD: 'আবেদন চলমান (আসন ধরা আছে)',
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

// effective status: a HELD application whose time is over counts as EXPIRED right away (no reload needed)
export const effectiveStatus = (h, now) =>
  h.status === 'HELD' && Date.parse(h.expiresAt) <= now ? 'EXPIRED' : h.status;

function useNow() {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 500);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Banner({ msg, kind = 'error', onClose }) {
  if (!msg) return null;
  return (
    <div className={`banner ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span>{msg}</span>
      <button className="link" onClick={onClose} aria-label="বন্ধ করুন">✕</button>
    </div>
  );
}

function StudentBox({ studentId, onSave }) {
  const [text, setText] = useState(studentId);
  const [err, setErr] = useState('');
  const save = () => {
    const v = text.trim();
    if (!ID_RE.test(v)) {
      setErr('জন্ম নিবন্ধন নম্বর ঠিক ১৭টি সংখ্যার হতে হবে (শুধু ০-৯ নয়, ইংরেজি 0-9 সংখ্যা লিখুন)।');
      return;
    }
    setErr('');
    onSave(v);
  };
  return (
    <section className="card">
      <label htmlFor="sid"><b>শিক্ষার্থীর জন্ম নিবন্ধন নম্বর (১৭ সংখ্যা)</b></label>
      <div className="row">
        <input id="sid" inputMode="numeric" maxLength={17} value={text} placeholder="যেমন 20120101234567890"
               onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <button onClick={save}>সংরক্ষণ করুন</button>
      </div>
      {err && <p className="field-error" role="alert">{err}</p>}
      {studentId && !err && <p className="muted">বর্তমান শিক্ষার্থী: <b>{studentId}</b></p>}
    </section>
  );
}

function CreateClass({ onCreated, onError }) {
  const [name, setName] = useState('');
  const [seats, setSeats] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const n = name.trim();
    const t = Number(seats);
    if (!n) return setErr('ক্লাসের নাম লিখুন।');
    if (!/^\d+$/.test(seats.trim()) || t < 1 || t > 100000) return setErr('আসন সংখ্যা ১ থেকে ১,০০,০০০ এর মধ্যে একটি পূর্ণ সংখ্যা হতে হবে।');
    setErr(''); setBusy(true);
    try {
      await api('/classes', { method: 'POST', body: { name: n, totalSeats: t } });
      setName(''); setSeats('');
      onCreated(`"${n}" ক্লাসটি তৈরি হয়েছে।`);
    } catch (ex) { onError(errorText(ex)); } finally { setBusy(false); }
  };
  return (
    <section className="card">
      <h2>নতুন ক্লাস তৈরি (অ্যাডমিন)</h2>
      <form onSubmit={submit}>
        <div className="row">
          <input aria-label="ক্লাসের নাম" placeholder="যেমন: Class 6 Morning Shift" value={name} onChange={(e) => setName(e.target.value)} />
          <input aria-label="মোট আসন" inputMode="numeric" placeholder="মোট আসন" style={{ maxWidth: 140 }} value={seats} onChange={(e) => setSeats(e.target.value)} />
          <button type="submit" disabled={busy}>{busy ? 'অপেক্ষা করুন…' : 'ক্লাস তৈরি করুন'}</button>
        </div>
        {err && <p className="field-error" role="alert">{err}</p>}
      </form>
    </section>
  );
}

export function HoldCard({ h, now, busy, onPay, onCancel }) {
  const st = effectiveStatus(h, now);
  const left = Date.parse(h.expiresAt) - now;
  return (
    <div className={`hold ${st.toLowerCase()}`}>
      <div>
        <b>{h.className || h.classId}</b>
        <div className="muted">আবেদন নম্বর: {h.holdId}</div>
        <div>অবস্থা: <span className="badge">{STATUS_BN[st] || st}</span></div>
        {st === 'HELD' && <div className="timer">⏱ বাকি সময়: <b data-testid="countdown">{fmtCountdown(left)}</b></div>}
        {st === 'EXPIRED' && <div className="muted">সময় শেষ হয়ে গেছে, আসনটি ছেড়ে দেওয়া হয়েছে।</div>}
      </div>
      <div className="row">
        <button disabled={st !== 'HELD' || busy} onClick={() => onPay(h)}>ভর্তি ফি দিন</button>
        <button className="secondary" disabled={st !== 'HELD' || busy} onClick={() => onCancel(h)}>বাতিল</button>
      </div>
    </div>
  );
}

export default function App() {
  const [studentId, setStudentId] = useState(() => localStorage.getItem(STORAGE_KEY) || '');
  const [classes, setClasses] = useState(null);
  const [holds, setHolds] = useState([]);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busyId, setBusyId] = useState('');
  const [focusId, setFocusId] = useState('');
  const now = useNow();

  const loadClasses = useCallback(async () => {
    try { setClasses(await api('/classes')); setError((e) => (e === NET_MSG ? '' : e)); }
    catch (ex) { setError(errorText(ex)); }
  }, []);

  const loadHolds = useCallback(async () => {
    if (!ID_RE.test(studentId)) { setHolds([]); return; }
    try { setHolds(await api('/me/holds', { studentId })); }
    catch (ex) { setError(errorText(ex)); }
  }, [studentId]);

  const refreshAll = useCallback(() => Promise.all([loadClasses(), loadHolds()]), [loadClasses, loadHolds]);

  useEffect(() => { refreshAll(); const t = setInterval(refreshAll, REFRESH_MS); return () => clearInterval(t); }, [refreshAll]);

  // when a countdown reaches zero, refresh immediately so seat counts and statuses follow
  const anyJustExpired = holds.some((h) => h.status === 'HELD' && Date.parse(h.expiresAt) <= now);
  useEffect(() => { if (anyJustExpired) refreshAll(); }, [anyJustExpired]); // eslint-disable-line

  const saveStudent = (v) => { localStorage.setItem(STORAGE_KEY, v); setStudentId(v); setError(''); setInfo('শিক্ষার্থীর নম্বর সংরক্ষণ করা হয়েছে।'); };

  const apply = async (c) => {
    setError(''); setInfo('');
    if (!ID_RE.test(studentId)) { setError('আগে উপরে শিক্ষার্থীর ১৭ সংখ্যার জন্ম নিবন্ধন নম্বর লিখে সংরক্ষণ করুন।'); return; }
    setBusyId('class:' + c.id);
    try {
      const h = await api(`/classes/${c.id}/holds`, { method: 'POST', studentId });
      setFocusId(h.holdId);
      setInfo('আবেদন সফল হয়েছে! সময়ের মধ্যে ভর্তি ফি দিয়ে আসনটি নিশ্চিত করুন।');
    } catch (ex) { setError(errorText(ex)); }
    finally { setBusyId(''); refreshAll(); }
  };

  const pay = async (h) => {
    setError(''); setInfo(''); setBusyId(h.holdId);
    try { await api(`/holds/${h.holdId}/confirm`, { method: 'POST', studentId }); setInfo('ভর্তি ফি জমা হয়েছে, আপনার ভর্তি নিশ্চিত!'); }
    catch (ex) { setError(errorText(ex)); }
    finally { setBusyId(''); refreshAll(); }
  };

  const cancel = async (h) => {
    if (!window.confirm('আবেদনটি বাতিল করতে চান?')) return;
    setError(''); setInfo(''); setBusyId(h.holdId);
    try { await api(`/holds/${h.holdId}`, { method: 'DELETE', studentId }); setInfo('আবেদন বাতিল হয়েছে, আসনটি ছেড়ে দেওয়া হয়েছে।'); }
    catch (ex) { setError(errorText(ex)); }
    finally { setBusyId(''); refreshAll(); }
  };

  const focused = useMemo(() => holds.find((h) => h.holdId === focusId), [holds, focusId]);

  return (
    <main className="wrap">
      <h1>স্কুল ভর্তি ব্যবস্থা</h1>
      <Banner msg={error} onClose={() => setError('')} />
      <Banner msg={info} kind="info" onClose={() => setInfo('')} />
      <StudentBox studentId={studentId} onSave={saveStudent} />

      <CreateClass onCreated={(m) => { setInfo(m); loadClasses(); }} onError={setError} />

      <section className="card">
        <h2>ক্লাসের তালিকা</h2>
        {classes === null && !error && <p className="muted">লোড হচ্ছে…</p>}
        {classes && classes.length === 0 && <p className="muted">এখনও কোনো ক্লাস তৈরি হয়নি।</p>}
        {classes && classes.length > 0 && (
          <div className="tablewrap">
            <table>
              <thead><tr><th>ক্লাস</th><th>মোট আসন</th><th>ধরা আছে</th><th>নিশ্চিত</th><th>খালি</th><th></th></tr></thead>
              <tbody>
                {classes.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td><td>{c.totalSeats}</td><td>{c.heldSeats}</td><td>{c.confirmedSeats}</td>
                    <td><b>{c.availableSeats}</b></td>
                    <td>
                      <button disabled={c.availableSeats <= 0 || busyId === 'class:' + c.id} onClick={() => apply(c)}>
                        {c.availableSeats <= 0 ? 'আসন নেই' : 'আবেদন করুন'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">প্রতি কয়েক সেকেন্ড পরপর আসন সংখ্যা নিজে থেকেই হালনাগাদ হয়।</p>
      </section>

      {focused && (
        <section className="card">
          <h2>আবেদনের অবস্থা</h2>
          <HoldCard h={focused} now={now} busy={busyId === focused.holdId} onPay={pay} onCancel={cancel} />
        </section>
      )}

      <section className="card">
        <h2>আমার আবেদনসমূহ</h2>
        {!ID_RE.test(studentId) && <p className="muted">আপনার আবেদনগুলো দেখতে উপরে জন্ম নিবন্ধন নম্বর সংরক্ষণ করুন।</p>}
        {ID_RE.test(studentId) && holds.length === 0 && <p className="muted">এই শিক্ষার্থীর কোনো আবেদন নেই।</p>}
        {holds.map((h) => (
          <HoldCard key={h.holdId} h={h} now={now} busy={busyId === h.holdId} onPay={pay} onCancel={cancel} />
        ))}
      </section>
    </main>
  );
}
