import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const serverSource = readFileSync(join(process.cwd(), 'src/server.ts'), 'utf8');

describe('StorePulse agent skillsets', () => {
  it('uses the public AROS agent names from the website', () => {
    for (const agent of ['Ana', 'Victor', 'Larry', 'Marco', 'Tessa']) {
      expect(serverSource).toContain(`agent: '${agent}'`);
    }
    expect(serverSource).not.toContain("name: 'Retail Analyst Agent'");
    expect(serverSource).toContain("row.name === 'Retail Analyst Agent'");
    expect(serverSource).toContain('Replaced by named AROS StorePulse agents');
  });

  it('publishes the requested missing report families as grouped skills', () => {
    for (const skill of [
      'Tender Reports',
      'Tax Breakdown',
      'Gift Card Activity',
      'Gift Card Liability',
      'Liability Review',
      'Promotion Performance',
      'Payout and Drop Review',
      'Fuel Pump Breakdown',
      'Hourly Sales',
      'Hourly Margin',
      'Hourly Customer Accounts',
      'Item Comparison',
      'Report Comparison',
      'Department Comparison',
      'Vendor Comparison',
      'Store and Date Comparison',
    ]) {
      expect(serverSource).toContain(`'${skill}'`);
    }
  });
});
