import { describe, expect, it } from 'vitest';
import {
  bosDateTime,
  buildBosTimecardReport,
  draftBosTimecardCorrections,
  normalizeBosTimecardRow,
  normalizeBosTimecardCorrectionRequest,
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

  it('recognizes the live BOS underscore field names', () => {
    expect(normalizeBosTimecardRow({
      UserId: 9,
      EmployeeName: 'Live Row',
      DayDate: '7/21/2026',
      ClockIn: '7/21/2026 8:00 AM',
      ClockOut: '7/21/2026 4:00 PM',
      Working_Second: '28800',
      Working_Hr: '08:00',
      ClockId: '123',
      IsVoid: false,
    })).toMatchObject({
      employeeId: '9',
      employeeName: 'Live Row',
      clockDate: '2026-07-21',
      totalHours: 8,
      clockId: '123',
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

  it('drafts read-only correction candidates without enabling payroll writes', () => {
    const rows = [
      normalizeBosTimecardRow({ EmployeeId: 'e1', EmployeeName: 'Open', ClockIn: '2026-07-21T08:00:00', ClockOut: '', WorkingHours: 4 }),
      normalizeBosTimecardRow({ EmployeeId: 'e2', EmployeeName: 'Voided', ClockIn: '2026-07-21T08:00:00', ClockOut: '2026-07-21T09:00:00', WorkingHours: 1, Status: 'Void' }),
      normalizeBosTimecardRow({ EmployeeId: 'e3', EmployeeName: 'Zero', ClockIn: '2026-07-21T08:00:00', ClockOut: '2026-07-21T09:00:00', WorkingHours: 0 }),
      normalizeBosTimecardRow({ EmployeeId: 'e4', EmployeeName: 'Long', ClockIn: '2026-07-21T06:00:00', ClockOut: '2026-07-21T20:30:00', WorkingHours: 14.5 }),
      normalizeBosTimecardRow({ EmployeeId: 'e5', EmployeeName: 'Clean', ClockIn: '2026-07-21T08:00:00', ClockOut: '2026-07-21T16:00:00', WorkingHours: 8 }),
    ];

    const drafts = draftBosTimecardCorrections(rows);
    expect(drafts.map((draft) => draft.type)).toEqual(['missing_clock_out', 'voided_punch_review', 'zero_hour_punch', 'long_shift_review']);
    expect(drafts.map((draft) => draft.writeEnabled)).toEqual([false, false, false, false]);
    expect(drafts.every((draft) => draft.requiresApproval)).toBe(true);
    expect(drafts[0]).toMatchObject({ severity: 'critical', proposedAction: 'edit' });
  });

  it('includes correction drafts in built reports after employee filtering', () => {
    const report = buildBosTimecardReport([
      { EmployeeId: 'e1', EmployeeName: 'Larry Patel', ClockIn: '2026-07-21T08:00:00', ClockOut: '', WorkingHours: 4 },
      { EmployeeId: 'e2', EmployeeName: 'Ana Shah', ClockIn: '2026-07-21T08:00:00', ClockOut: '', WorkingHours: 4 },
    ], '2026-07-21', '2026-07-21', 'larry');

    expect(report.correctionDrafts).toHaveLength(1);
    expect(report.correctionDrafts[0]).toMatchObject({ employeeName: 'Larry Patel', writeEnabled: false });
  });

  it('normalizes approval requests without enabling BOS writes', () => {
    const result = normalizeBosTimecardCorrectionRequest({
      draft: {
        id: 'missing_clock_out:e1:clk-1',
        type: 'missing_clock_out',
        severity: 'critical',
        employeeId: 'e1',
        employeeName: '<Larry>',
        clockId: 'clk-1',
        clockDate: '7/21/2026',
        clockIn: '2026-07-21T08:00:00',
        currentHours: '4.25',
        proposedAction: 'edit',
      },
      proposedClockOut: '2026-07-21T12:15:00Z',
      reason: 'Forgot to clock out <script>',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      draftId: 'missing_clock_out:e1:clk-1',
      type: 'missing_clock_out',
      severity: 'critical',
      employeeName: 'Larry',
      clockDate: '2026-07-21',
      currentHours: 4.25,
      requiresApproval: true,
      writeEnabled: false,
      proposedChange: {
        clockOut: '2026-07-21T12:15:00.000Z',
        reason: 'Forgot to clock out script',
      },
    });
  });

  it('rejects unsupported approval request types', () => {
    expect(normalizeBosTimecardCorrectionRequest({
      draftId: 'x',
      type: 'delete_employee',
      reason: 'no',
    })).toEqual({ ok: false, error: 'Unsupported correction type' });
  });
});
