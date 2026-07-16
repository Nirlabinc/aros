/**
 * AROS Phase 1 Skills — Registry & Exports
 *
 * 26 skills across 8 categories:
 * - Owner Intelligence (2)
 * - Sales & Revenue (4)
 * - Inventory (4)
 * - Cash & Financial (2)
 * - Workforce (4)
 * - Loss Prevention (4)
 * - Procurement (3)
 * - Marketing (3)
 */

// ── Types ──
export type {
  StoreType,
  DayOfWeek,
  OperatingHours,
  StoreConfig,
  InvoiceRow,
  InvoiceItemRow,
  InventoryRow,
  VendorPriceRow,
  EmployeeRow,
  RegisterReadingRow,
  ReviewRow,
  ChecklistItem,
  ChecklistCompletion,
  TimecardRow,
  InventoryAdjustmentRow,
  WasteLogRow,
  BankDepositRow,
  DateRange,
  DataConnector,
  AlertSeverity,
  Alert,
  Action,
  SkillOutput,
  SkillCategory,
  SkillFrequency,
  SkillContext,
  ArosSkill,
  SkillRegistry,
} from './types.js';

// ── Connector ──
export { RapidRmsConnector, DEFAULT_RAPIDRMS_CONFIG } from './connectors/rapidrms.js';
export type { RapidRmsConfig } from './connectors/rapidrms.js';

// ── Owner Intelligence ──
export { MorningBriefingSkill } from './skills/morning-briefing.js';
export { WeeklyScorecardSkill } from './skills/weekly-scorecard.js';

// ── Sales & Revenue ──
export { DailyFlashSkill, computeDailyFlash } from './skills/daily-flash.js';
export { MarginMonitorSkill, computeMargins } from './skills/margin-monitor.js';
export { TransactionProfilerSkill } from './skills/transaction-profiler.js';
export { ItemProfilerSkill } from './skills/item-profiler.js';

// ── Inventory ──
export { StockPulseSkill, computeStockPulse } from './skills/stock-pulse.js';
export { AutoReorderSkill } from './skills/auto-reorder.js';
export { WasteLoggerSkill } from './skills/waste-logger.js';
export { DeadItemKillerSkill } from './skills/dead-item-killer.js';

// ── Cash & Financial ──
export { CashReconcilerSkill } from './skills/cash-reconciler.js';
export { BankReconcilerSkill } from './skills/bank-reconciler.js';

// ── Workforce ──
export { CashierScorecardSkill } from './skills/cashier-scorecard.js';
export { OpeningClosingChecklistSkill } from './skills/opening-closing-checklist.js';
export { TimecardAuditorSkill } from './skills/timecard-auditor.js';
export { LaborCostTrackerSkill } from './skills/labor-cost-tracker.js';

// ── Loss Prevention ──
export { VoidRefundAuditorSkill } from './skills/void-refund-auditor.js';
export { PriceChangeMonitorSkill } from './skills/price-change-monitor.js';
export { CostChangeTrackerSkill } from './skills/cost-change-tracker.js';
export { QtyChangeMonitorSkill } from './skills/qty-change-monitor.js';

// ── Procurement ──
export { DealHunterSkill } from './skills/deal-hunter.js';
export { CostComparisonSkill } from './skills/cost-comparison.js';

// ── Marketing ──
export { ReputationManagerSkill } from './skills/reputation-manager.js';
export { LocalSeoSkill } from './skills/local-seo.js';
export { CustomerProfilerSkill } from './skills/customer-profiler.js';
export { BasketBundlerSkill } from './skills/basket-bundler.js';

// ── Skill Runner (feed + audit integration) ──
export { runSkill } from './runner.js';
export type { RunSkillOptions } from './runner.js';

// ── Registry ──
import type { ArosSkill, SkillRegistry } from './types.js';
import { MorningBriefingSkill } from './skills/morning-briefing.js';
import { WeeklyScorecardSkill } from './skills/weekly-scorecard.js';
import { DailyFlashSkill } from './skills/daily-flash.js';
import { MarginMonitorSkill } from './skills/margin-monitor.js';
import { TransactionProfilerSkill } from './skills/transaction-profiler.js';
import { ItemProfilerSkill } from './skills/item-profiler.js';
import { StockPulseSkill } from './skills/stock-pulse.js';
import { AutoReorderSkill } from './skills/auto-reorder.js';
import { WasteLoggerSkill } from './skills/waste-logger.js';
import { DeadItemKillerSkill } from './skills/dead-item-killer.js';
import { CashReconcilerSkill } from './skills/cash-reconciler.js';
import { BankReconcilerSkill } from './skills/bank-reconciler.js';
import { CashierScorecardSkill } from './skills/cashier-scorecard.js';
import { OpeningClosingChecklistSkill } from './skills/opening-closing-checklist.js';
import { TimecardAuditorSkill } from './skills/timecard-auditor.js';
import { LaborCostTrackerSkill } from './skills/labor-cost-tracker.js';
import { VoidRefundAuditorSkill } from './skills/void-refund-auditor.js';
import { PriceChangeMonitorSkill } from './skills/price-change-monitor.js';
import { CostChangeTrackerSkill } from './skills/cost-change-tracker.js';
import { QtyChangeMonitorSkill } from './skills/qty-change-monitor.js';
import { DealHunterSkill } from './skills/deal-hunter.js';
import { CostComparisonSkill } from './skills/cost-comparison.js';
import { ReputationManagerSkill } from './skills/reputation-manager.js';
import { LocalSeoSkill } from './skills/local-seo.js';
import { CustomerProfilerSkill } from './skills/customer-profiler.js';
import { BasketBundlerSkill } from './skills/basket-bundler.js';

/**
 * Create a registry of all AROS Phase 1 skills.
 * Returns a Map keyed by skill ID for easy lookup.
 */
export function createSkillRegistry(): SkillRegistry {
  const skills: ArosSkill[] = [
    // Owner Intelligence
    new MorningBriefingSkill(),
    new WeeklyScorecardSkill(),
    // Sales & Revenue
    new DailyFlashSkill(),
    new MarginMonitorSkill(),
    new TransactionProfilerSkill(),
    new ItemProfilerSkill(),
    // Inventory
    new StockPulseSkill(),
    new AutoReorderSkill(),
    new WasteLoggerSkill(),
    new DeadItemKillerSkill(),
    // Cash & Financial
    new CashReconcilerSkill(),
    new BankReconcilerSkill(),
    // Workforce
    new CashierScorecardSkill(),
    new OpeningClosingChecklistSkill(),
    new TimecardAuditorSkill(),
    new LaborCostTrackerSkill(),
    // Loss Prevention
    new VoidRefundAuditorSkill(),
    new PriceChangeMonitorSkill(),
    new CostChangeTrackerSkill(),
    new QtyChangeMonitorSkill(),
    // Procurement
    new DealHunterSkill(),
    new CostComparisonSkill(),
    // Marketing
    new ReputationManagerSkill(),
    new LocalSeoSkill(),
    new CustomerProfilerSkill(),
    new BasketBundlerSkill(),
  ];

  const registry: SkillRegistry = new Map();
  for (const skill of skills) {
    registry.set(skill.id, skill);
  }
  return registry;
}

// ── Skill catalog (skills as data) ──
// Machine-readable view of the registry so provisioning manifests and the
// marketplace can publish these skills with their connector requirements,
// instead of the catalog living only in code.

/** Data sets each store connector type can serve to skills. */
export const CONNECTOR_DATA_COVERAGE: Record<string, readonly string[]> = {
  'rapidrms-api': [
    'invoices', 'invoice_items', 'inventory', 'vendor_prices', 'employees',
    'register_readings', 'reviews', 'checklist_templates', 'checklist_completions',
    'timecards', 'inventory_adjustments', 'waste_logs', 'bank_deposits',
  ],
};

export interface SkillCatalogEntry {
  id: string;
  name: string;
  category: import('./types.js').SkillCategory;
  frequency: import('./types.js').SkillFrequency;
  requiredData: string[];
  /** Store connector types whose data coverage satisfies requiredData. */
  requiredConnectorTypes: string[];
}

export function buildSkillCatalog(): SkillCatalogEntry[] {
  return [...createSkillRegistry().values()].map(skill => ({
    id: skill.id,
    name: skill.name,
    category: skill.category,
    frequency: skill.frequency,
    requiredData: [...skill.requiredData],
    requiredConnectorTypes: Object.entries(CONNECTOR_DATA_COVERAGE)
      .filter(([, coverage]) => skill.requiredData.every(data => coverage.includes(data)))
      .map(([type]) => type),
  }));
}
