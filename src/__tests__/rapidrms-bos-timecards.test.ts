import { describe, expect, it } from 'vitest';
import {
  bosDateTime,
  buildBosTimecardReport,
  normalizeBosTimecardRow,
  parseRowsFromBosPayload,
  summarizeBosTimecards,
} from '../../connectors/rapidrms-bos.js';

describe('RapidRMS BOS timecard adapter', () => {
  it('formats BOS report bounds as the verified local UI shape', () => {
    expect(bosDateTime('2026-07-21', 'start')).toBe('7/21/2026 12:00 AM');
    expect(bosDateTime('2026-07-21', 'end')).toBe('7/21/2026 11:59 PM');
  });

  it('parses common RapidRMS payload envelopes', () => {
    expect(parseRowsFromBosPayload(JSON.stringify({ data: JSON.stringify([{ EmployeeName: 'Asha' }]) }))).toEqual([{ EmployeeName: 'Asha' }]);
    expect(parseRowsFromBosPayload(JSON.stringify({ aaData: [{ EmployeeName: 'Nir' }] }))).toEqual([{ EmployeeName: 'Nir' }]);
    expect(parseRowsFromBosPayload('<html>login</html>')).toEqual([]);
  });

  it('normalizes payroll-relevant row keys and computes hours from seconds', () => {
    expect(normalizeBosTimecardRow({
      EmployeeId: 7,
      EmployeeName: 'Larry',
      ClockId: 'clk-1',
      ClockIn: '2026-07-21T08:00:00',
      ClockOut: '2026-07-21T16:30:00',
      WorkingSeconds: 30600,
      Status: 'Complete',
    })).toMatchObject({
      employeeId: '7',
      employeeName: 'Larry',
      clockId: 'clk-1',
      clockDate: '2026-07-21',
      totalHours: 8.5,
      status: 'Complete',
      isVoid: false,
    });
  });

  it('summarizes hours by employee and excludes voided punch hours', () => {
    const rows = [
      normalizeBosTimecardRow({ EmployeeId: 'e1', EmployeeName: 'Larry', WorkingHours: 8, ClockOut: '2026-07-21T16:00:00' }),
      normalizeBosTimecardRow({ EmployeeId: 'e1', EmployeeName: 'Larry', WorkingHours: 2, Status: 'Void' }),
      normalizeBosTimecardRow({ EmployeeId: 'e2', EmployeeName: 'Ana', WorkingHours: '07:30', ClockOut: '' }),
    ];
    expect(summarizeBosTimecards(rows)).toEqual([
      { employeeId: 'e1', employeeName: 'Larry', totalHours: 8, punchCount: 2, openPunches: 0, voidedPunches: 1 },
      { employeeId: 'e2', employeeName: 'Ana', totalHours: 7.5, punchCount: 1, openPunches: 1, voidedPunches: 0 },
    ]);
  });

  it('applies employee filters before totals and reports the exact date range', () => {
    const report = buildBosTimecardReport([
      { EmployeeId: 'e1', EmployeeName: 'Larry Patel', WorkingHours: 8 },
      { EmployeeId: 'e2', EmployeeName: 'Ana Shah', WorkingHours: 4 },
    ], '2026-07-20', '2026-07-21', 'larry');
    expect(report.from).toBe('2026-07-20');
    expect(report.to).toBe('2026-07-21');
    expect(report.employeeFilter).toBe('larry');
    expect(report.totals).toMatchObject({ hours: 8, punches: 1 });
    expect(report.employees.map((employee) => employee.employeeName)).toEqual(['Larry Patel']);
  });
});
