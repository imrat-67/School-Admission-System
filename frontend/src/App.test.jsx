import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import App, { fmtCountdown, effectiveStatus, activeInClass, toAsciiDigits, HoldCard } from './App.jsx';
import { errorText, ApiError } from './api.js';

const NOW = Date.parse('2026-01-01T10:00:00Z');
const hold = (status, expiresAt, classId = 'c_1') => ({ holdId: 'h_1', classId, className: 'Class 6', status, expiresAt });
const SID = '20120101234567890';

// tiny fake backend: "METHOD /path" -> reply (or a function returning a reply)
const reply = (data, status = 200) =>
  Promise.resolve({ ok: status < 400, status, headers: { get: () => null }, json: () => Promise.resolve(data) });
function fakeBackend(routes) {
  const fn = vi.fn((url, opts = {}) => {
    const key = `${opts.method || 'GET'} ${String(url).replace('http://localhost:8080', '')}`;
    const r = routes[key];
    return r === undefined ? reply({ code: 'NOT_FOUND', error: 'x' }, 404) : typeof r === 'function' ? r(opts) : reply(r);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const inMinutes = (m) => new Date(Date.now() + m * 60 * 1000).toISOString();
const cls = (id, name, o = {}) => ({ id, name, totalSeats: 10, heldSeats: 0, confirmedSeats: 0, availableSeats: 10, ...o });

beforeEach(() => { localStorage.clear(); window.location.hash = '#/'; });
afterEach(() => vi.unstubAllGlobals());

describe('helpers', () => {
  it('formats the countdown as mm:ss', () => {
    expect(fmtCountdown(65000)).toBe('01:05');
    expect(fmtCountdown(-500)).toBe('00:00');
  });

  it('treats a HELD hold with a past expiresAt as EXPIRED, without asking the server', () => {
    expect(effectiveStatus(hold('HELD', '2026-01-01T09:59:59Z'), NOW)).toBe('EXPIRED');
    expect(effectiveStatus(hold('HELD', '2026-01-01T10:05:00Z'), NOW)).toBe('HELD');
    expect(effectiveStatus(hold('CONFIRMED', '2026-01-01T09:00:00Z'), NOW)).toBe('CONFIRMED');
  });

  it('turns Bengali digits into 0-9', () => {
    expect(toAsciiDigits('২০১২০১০১২৩৪৫৬৭৮৯০')).toBe('20120101234567890');
    expect(toAsciiDigits(' 12 34 ')).toBe('1234');
  });

  it('finds a running or confirmed application only in the same class', () => {
    const h = [hold('HELD', '2026-01-01T10:05:00Z', 'c_1')];
    expect(activeInClass(h, 'c_1', NOW)).not.toBeNull();
    expect(activeInClass(h, 'c_2', NOW)).toBeNull(); // another class is not blocked (spec: one per class)
    expect(activeInClass([hold('EXPIRED', '2026-01-01T09:00:00Z')], 'c_1', NOW)).toBeNull();
    expect(activeInClass([hold('HELD', '2026-01-01T09:59:00Z')], 'c_1', NOW)).toBeNull();
    expect(activeInClass([hold('CANCELLED', '2026-01-01T10:05:00Z')], 'c_1', NOW)).toBeNull();
  });
});

describe('HoldCard', () => {
  it('enables the pay button and shows a countdown while the hold is active', () => {
    render(<HoldCard h={hold('HELD', '2026-01-01T10:05:00Z')} now={NOW} busy={false} onPay={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('ভর্তি ফি দিন')).toBeEnabled();
    expect(screen.getByTestId('countdown')).toHaveTextContent('05:00');
    expect(screen.getByText('বাতিল')).toBeEnabled();
  });

  it('disables the pay button once the time is over', () => {
    render(<HoldCard h={hold('HELD', '2026-01-01T09:59:00Z')} now={NOW} busy={false} onPay={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('ভর্তি ফি দিন')).toBeDisabled();
    expect(screen.queryByTestId('countdown')).toBeNull();
  });
});

describe('error messages', () => {
  it('shows friendly Bengali text for sold out and server down', () => {
    expect(errorText(new ApiError(409, 'SEATS_FULL', 'x'))).toContain('আসন');
    expect(errorText(new ApiError(0, 'NETWORK', 'network'))).toContain('সার্ভার');
    expect(errorText(new ApiError(409, 'HOLD_EXPIRED', 'x'))).toContain('সময়');
    expect(errorText(new ApiError(400, 'INVALID_SEATS', 'x'))).toContain('আসন');
  });
});

describe('the screens', () => {
  it('lists every class, whatever its name, with total / held / confirmed / available seats', async () => {
    localStorage.setItem('studentId', SID);
    fakeBackend({
      'GET /classes': [cls('c_1', 'Class 6 Morning Shift', { totalSeats: 120, heldSeats: 15, confirmedSeats: 80, availableSeats: 25 }), cls('c_2', 'Evening Shift')],
      'GET /me/holds': []
    });
    render(<App />);
    const row = (await screen.findByText('Class 6 Morning Shift')).closest('tr');
    expect(within(row).getAllByRole('cell').map((c) => c.textContent).slice(1, 5)).toEqual(['120', '15', '80', '25']);
    expect(await screen.findByText('Evening Shift')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'আবেদন করুন' })).toHaveLength(2);
  });

  it('a student with a running application in one class can still apply to another class', async () => {
    localStorage.setItem('studentId', SID);
    const f = fakeBackend({
      'GET /classes': [cls('c_1', 'Class 6 Morning Shift'), cls('c_2', 'Class 6 Day Shift')],
      'GET /me/holds': [{ holdId: 'h_1', classId: 'c_1', className: 'Class 6 Morning Shift', status: 'HELD', expiresAt: inMinutes(5) }],
      'POST /classes/c_2/holds': () => reply({ holdId: 'h_2', classId: 'c_2', studentId: SID, status: 'HELD', expiresAt: inMinutes(10) }, 201)
    });
    render(<App />);
    const dayRow = (await screen.findByText('Class 6 Day Shift')).closest('tr');
    const morningRow = screen.getByText('Class 6 Morning Shift').closest('tr');
    expect(within(morningRow).queryByRole('button', { name: 'আবেদন করুন' })).toBeNull(); // already applied to this class
    fireEvent.click(within(dayRow).getByRole('button', { name: 'আবেদন করুন' }));
    await waitFor(() => expect(f).toHaveBeenCalledWith(expect.stringContaining('/classes/c_2/holds'), expect.objectContaining({ method: 'POST' })));
    // after a successful apply the UI opens the application screen (wait for it so it cannot leak into the next test)
    await waitFor(() => expect(window.location.hash).toBe('#/application/h_2'));
  });

  it('shows the error in friendly words when the last seat is taken by someone else', async () => {
    localStorage.setItem('studentId', SID);
    fakeBackend({
      'GET /classes': [cls('c_1', 'Class 6 Morning Shift')],
      'GET /me/holds': [],
      'POST /classes/c_1/holds': () => reply({ code: 'SEATS_FULL', error: 'full' }, 409)
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'আবেদন করুন' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('আসন খালি নেই');
  });

  it('asks for the student number instead of failing when none is saved', async () => {
    fakeBackend({ 'GET /classes': [cls('c_1', 'Class 6 Morning Shift')] });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'আবেদন করুন' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('জন্ম নিবন্ধন নম্বর');
  });

  it('turns Bengali digits typed in the student box into 0-9', async () => {
    fakeBackend({ 'GET /classes': [] });
    render(<App />);
    const box = await screen.findByLabelText(/জন্ম নিবন্ধন নম্বর/);
    fireEvent.change(box, { target: { value: '২০১২০১০১২৩৪৫৬৭৮৯০' } });
    expect(box).toHaveValue(SID);
  });

  it('shows a Bengali error (not a blank page) when the server is down', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('সার্ভার');
  });

  it('flips an application to "সময় শেষ" and disables the pay button by itself when the time is over', async () => {
    localStorage.setItem('studentId', SID);
    window.location.hash = '#/my';
    const soon = new Date(Date.now() + 1500).toISOString();
    fakeBackend({
      'GET /classes': [],
      'GET /me/holds': [{ holdId: 'h_1', classId: 'c_1', className: 'Class 6 Morning Shift', status: 'HELD', expiresAt: soon }]
    });
    render(<App />);
    const pay = await screen.findByRole('button', { name: 'ভর্তি ফি দিন' });
    expect(pay).toBeEnabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'ভর্তি ফি দিন' })).toBeDisabled(), { timeout: 4000 });
    expect(screen.getAllByText('সময় শেষ').length).toBeGreaterThan(0);
  });

  it('"ভর্তি ফি দিন" confirms the application', async () => {
    localStorage.setItem('studentId', SID);
    window.location.hash = '#/my';
    const f = fakeBackend({
      'GET /classes': [],
      'GET /me/holds': [{ holdId: 'h_1', classId: 'c_1', className: 'Class 6 Morning Shift', status: 'HELD', expiresAt: inMinutes(5) }],
      'POST /holds/h_1/confirm': () => reply({ holdId: 'h_1', status: 'CONFIRMED' })
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'ভর্তি ফি দিন' }));
    await waitFor(() => expect(f).toHaveBeenCalledWith(expect.stringContaining('/holds/h_1/confirm'), expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByText(/ভর্তি নিশ্চিত হয়েছে/)).toBeInTheDocument();
  });
});

describe('admin: create class (name and seats)', () => {
  it('sends the typed name and seat number (Bengali digits accepted)', async () => {
    window.location.hash = '#/admin';
    const f = fakeBackend({
      'GET /classes': [],
      'POST /classes': () => reply({ id: 'c_9', name: 'Class 6 Morning Shift', totalSeats: 120 }, 201)
    });
    render(<App />);
    fireEvent.change(await screen.findByLabelText('ক্লাসের নাম'), { target: { value: '  Class 6 Morning Shift ' } });
    fireEvent.change(screen.getByLabelText('মোট আসন সংখ্যা'), { target: { value: '১২০' } });
    fireEvent.click(screen.getByRole('button', { name: 'ক্লাস তৈরি করুন' }));
    await waitFor(() => expect(f).toHaveBeenCalledWith(expect.stringContaining('/classes'), expect.objectContaining({ method: 'POST' })));
    const call = f.mock.calls.find(([, o]) => o && o.method === 'POST');
    expect(JSON.parse(call[1].body)).toEqual({ name: 'Class 6 Morning Shift', totalSeats: 120 });
  });

  it('refuses an empty name or bad seat number with a clear message and sends nothing', async () => {
    window.location.hash = '#/admin';
    const f = fakeBackend({ 'GET /classes': [] });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'ক্লাস তৈরি করুন' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ক্লাসের নাম লিখুন');
    fireEvent.change(screen.getByLabelText('ক্লাসের নাম'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('মোট আসন সংখ্যা'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'ক্লাস তৈরি করুন' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('আসন সংখ্যা');
    expect(f.mock.calls.some(([, o]) => o && o.method === 'POST')).toBe(false);
  });
});
