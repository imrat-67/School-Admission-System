import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App, { fmtCountdown, effectiveStatus, activeHold, HoldCard, parseClassName, classLabel } from './App.jsx';
import { errorText, ApiError } from './api.js';

const NOW = Date.parse('2026-01-01T10:00:00Z');
const hold = (status, expiresAt) => ({ holdId: 'h_1', classId: 'c_1', className: 'Class 6', status, expiresAt });

describe('countdown and status helpers', () => {
  it('formats the countdown as mm:ss', () => {
    expect(fmtCountdown(65000)).toBe('01:05');
    expect(fmtCountdown(-500)).toBe('00:00');
  });

  it('treats a HELD hold with a past expiresAt as EXPIRED', () => {
    expect(effectiveStatus(hold('HELD', '2026-01-01T09:59:59Z'), NOW)).toBe('EXPIRED');
    expect(effectiveStatus(hold('HELD', '2026-01-01T10:05:00Z'), NOW)).toBe('HELD');
    expect(effectiveStatus(hold('CONFIRMED', '2026-01-01T09:00:00Z'), NOW)).toBe('CONFIRMED');
  });
});

describe('HoldCard', () => {
  it('enables the pay button and shows a countdown while the hold is active', () => {
    render(<HoldCard h={hold('HELD', '2026-01-01T10:05:00Z')} now={NOW} busy={false} onPay={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('ভর্তি ফি দিন')).toBeEnabled();
    expect(screen.getByTestId('countdown')).toHaveTextContent('05:00');
  });

  it('disables the pay button once the time is over, without any reload', () => {
    render(<HoldCard h={hold('HELD', '2026-01-01T09:59:00Z')} now={NOW} busy={false} onPay={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('ভর্তি ফি দিন')).toBeDisabled();
    expect(screen.queryByTestId('countdown')).toBeNull();
  });
});

describe('error messages', () => {
  it('shows friendly text for sold out and server down', () => {
    expect(errorText(new ApiError(409, 'SEATS_FULL', 'x'))).toContain('আসন');
    expect(errorText(new ApiError(0, 'NETWORK', 'network'))).toContain('সার্ভার');
  });
});

describe('class names', () => {
  it('understands Bangladesh class and shift names', () => {
    expect(parseClassName('Class 8 Day Shift')).toEqual({ level: 8, shift: 'Day' });
    expect(classLabel('Class 10 Morning Shift')).toContain('ক্লাস 10');
    expect(classLabel('Something else')).toBe('Something else');
  });
});

describe('one student, one application', () => {
  it('finds a running or confirmed application', () => {
    expect(activeHold([hold('HELD', '2026-01-01T10:05:00Z')], NOW)).not.toBeNull();
    expect(activeHold([hold('CONFIRMED', '2026-01-01T09:00:00Z')], NOW)).not.toBeNull();
  });

  it('ignores expired, time-over and cancelled applications', () => {
    expect(activeHold([hold('EXPIRED', '2026-01-01T09:00:00Z')], NOW)).toBeNull();
    expect(activeHold([hold('HELD', '2026-01-01T09:59:00Z')], NOW)).toBeNull();
    expect(activeHold([hold('CANCELLED', '2026-01-01T10:05:00Z')], NOW)).toBeNull();
    expect(activeHold([], NOW)).toBeNull();
  });
});

describe('apply when the student already has an application', () => {
  it('opens a dialog that tells the user to change the birth registration number', async () => {
    localStorage.setItem('studentId', '20120101234567890');
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const reply = (data) => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve(data) });
    vi.stubGlobal('fetch', vi.fn((url) => String(url).endsWith('/me/holds')
      ? reply([{ holdId: 'h_1', classId: 'c_1', className: 'Class 6 Morning Shift', status: 'HELD', expiresAt: future }])
      : reply([{ id: 'c_2', name: 'Class 7 Day Shift', totalSeats: 10, heldSeats: 0, confirmedSeats: 0, availableSeats: 10 }])));
    window.location.hash = '#/';
    render(<App />);
    fireEvent.click(await screen.findByRole('tab', { name: /ক্লাস 7/ }));
    const btn = await screen.findByRole('button', { name: 'আবেদন করুন' });
    await waitFor(() => expect(screen.getByText(/নম্বর পরিবর্তন করুন/, { selector: 'button.link' })).toBeInTheDocument());
    fireEvent.click(btn);
    expect(await screen.findByRole('dialog')).toHaveTextContent('ইতিমধ্যে আবেদন করেছে');
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/holds'), expect.objectContaining({ method: 'POST' }));
    vi.unstubAllGlobals();
  });
});
