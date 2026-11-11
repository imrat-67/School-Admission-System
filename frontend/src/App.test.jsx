import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { fmtCountdown, effectiveStatus, HoldCard, parseClassName, classLabel } from './App.jsx';
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
