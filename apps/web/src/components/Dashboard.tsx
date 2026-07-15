import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useWhitelabel } from '../whitelabel/WhitelabelProvider';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const API_BASE = (window as any).__AROS_API_URL__
  || (window.location.hostname === 'localhost' ? 'http://localhost:5457' : '');

interface HumanTask {
  id: string;
  title: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: 'pending' | 'running' | 'complete' | 'failed' | 'cancelled';
  project: string;
  nextAction: string;
  updatedAt: string;
}

interface HumanProject {
  id: string;
  name: string;
  status: 'on_track' | 'watch' | 'stalled';
  progress: number;
  openTasks: number;
  completedTasks: number;
  blockers: string[];
}

interface HumanGoal {
  id: string;
  name: string;
  status: 'on_track' | 'at_risk' | 'done';
  progress: number;
  metric: string;
  target: string;
}

interface HumanConnector {
  id: string;
  name: string;
  domain: string;
  status: 'active' | 'available' | 'needs_credentials';
  description: string;
  connectsTo: string[];
}

interface HumanBriefing {
  date: string;
  generatedAt: string;
  executiveSummary: string;
  focus: string;
  topPriorities: HumanTask[];
  decisionsNeeded: string[];
  waitingOn: string[];
  followUps: string[];
  alerts: string[];
}

interface HumanLayer {
  briefing: HumanBriefing;
  tasks: {
    total: number;
    open: number;
    overdue: number;
    urgent: number;
    items: HumanTask[];
  };
  projects: HumanProject[];
  goals: HumanGoal[];
  connectors: HumanConnector[];
  importantInfo: {
    unreadMessages: number;
    missedCalls: number;
    pendingDecisions: number;
    pendingFollowUps: number;
  };
}

interface DashboardData {
  todaySales: { revenue: number; changePercent: number };
  activeAlerts: { count: number; critical: number };
  aiAgents: { active: number; total: number; statuses: Record<string, number> };
  lowStock: { count: number; items: Array<{ name: string; current: number; threshold: number }> };
  humanLayer: HumanLayer;
  recentActivity: Array<{
    id: string;
    agent: string;
    action: string;
    timestamp: string;
    type: 'success' | 'warning' | 'info' | 'error';
  }>;
}

function createHumanLayerMock(): HumanLayer {
  return {
    briefing: {
      date: new Date().toISOString().slice(0, 10),
      generatedAt: new Date().toISOString(),
      executiveSummary: 'The human layer is online. Briefing, tasks, projects, goals, and connectors are ready to drive the day.',
      focus: 'Clear the first priority task',
      topPriorities: [
        {
          id: 'task-brief-1',
          title: 'Review overnight inbox',
          priority: 'critical',
          status: 'pending',
          project: 'Operations',
          nextAction: 'Open the inbox summary and triage the urgent queue',
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'task-brief-2',
          title: 'Check project blockers',
          priority: 'high',
          status: 'pending',
          project: 'Delivery',
          nextAction: 'Clear dependency issues before midday',
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'task-brief-3',
          title: 'Review goals and KPIs',
          priority: 'normal',
          status: 'pending',
          project: 'Strategy',
          nextAction: 'Compare today against the weekly target',
          updatedAt: new Date().toISOString(),
        },
      ],
      decisionsNeeded: ['Approve the top priority task queue'],
      waitingOn: ['Calendar sync and inbox connections'],
      followUps: ['Reconnect with key contacts this afternoon'],
      alerts: ['Human layer mock is active until live tasks are available'],
    },
    tasks: {
      total: 3,
      open: 3,
      overdue: 0,
      urgent: 1,
      items: [
        {
          id: 'task-brief-1',
          title: 'Review overnight inbox',
          priority: 'critical',
          status: 'pending',
          project: 'Operations',
          nextAction: 'Open the inbox summary and triage the urgent queue',
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'task-brief-2',
          title: 'Check project blockers',
          priority: 'high',
          status: 'pending',
          project: 'Delivery',
          nextAction: 'Clear dependency issues before midday',
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'task-brief-3',
          title: 'Review goals and KPIs',
          priority: 'normal',
          status: 'pending',
          project: 'Strategy',
          nextAction: 'Compare today against the weekly target',
          updatedAt: new Date().toISOString(),
        },
      ],
    },
    projects: [
      {
        id: 'ops',
        name: 'Operations',
        status: 'on_track',
        progress: 65,
        openTasks: 2,
        completedTasks: 4,
        blockers: ['Inbox triage'],
      },
      {
        id: 'delivery',
        name: 'Delivery',
        status: 'watch',
        progress: 42,
        openTasks: 3,
        completedTasks: 2,
        blockers: ['Dependency review'],
      },
      {
        id: 'strategy',
        name: 'Strategy',
        status: 'on_track',
        progress: 78,
        openTasks: 1,
        completedTasks: 5,
        blockers: [],
      },
    ],
    goals: [
      {
        id: 'goal-briefing',
        name: 'Daily briefing readiness',
        status: 'on_track',
        progress: 90,
        metric: 'Briefing generated at 6 AM',
        target: '100% of business days',
      },
      {
        id: 'goal-execution',
        name: 'Top task completion',
        status: 'at_risk',
        progress: 58,
        metric: '3 of 5 priority tasks complete',
        target: 'At least 80% completion',
      },
      {
        id: 'goal-connectors',
        name: 'Connector coverage',
        status: 'done',
        progress: 100,
        metric: 'Human connectors enabled',
        target: 'All connectors active',
      },
    ],
    connectors: [
      {
        id: 'gmail',
        name: 'Gmail',
        domain: 'communication',
        status: 'active',
        description: 'Inbox triage and follow-up capture.',
        connectsTo: ['briefing', 'tasks', 'projects'],
      },
      {
        id: 'calendar-google',
        name: 'Google Calendar',
        domain: 'time',
        status: 'active',
        description: 'Daily schedule, meetings, and buffers.',
        connectsTo: ['briefing', 'tasks'],
      },
      {
        id: 'asana',
        name: 'Asana',
        domain: 'projects',
        status: 'active',
        description: 'Project milestones and dependencies.',
        connectsTo: ['projects', 'tasks'],
      },
      {
        id: 'notion',
        name: 'Notion',
        domain: 'knowledge',
        status: 'active',
        description: 'Notes, decisions, and operating context.',
        connectsTo: ['knowledge', 'goals'],
      },
    ],
    importantInfo: {
      unreadMessages: 4,
      missedCalls: 1,
      pendingDecisions: 1,
      pendingFollowUps: 2,
    },
  };
}

const MOCK_DATA: DashboardData = {
  todaySales: { revenue: 4827.5, changePercent: 12.3 },
  activeAlerts: { count: 3, critical: 1 },
  aiAgents: { active: 4, total: 6, statuses: { running: 4, idle: 1, error: 1 } },
  lowStock: {
    count: 7,
    items: [
      { name: 'Paper Towels (6pk)', current: 3, threshold: 10 },
      { name: 'Energy Drink 16oz', current: 8, threshold: 24 },
      { name: 'AA Batteries (4pk)', current: 2, threshold: 12 },
    ],
  },
  humanLayer: createHumanLayerMock(),
  recentActivity: [
    { id: '1', agent: 'Inventory Agent', action: 'Generated reorder list for 7 low-stock items', timestamp: '2 min ago', type: 'warning' },
    { id: '2', agent: 'Sales Agent', action: 'Morning sales report processed — $1,240 in first 3 hours', timestamp: '18 min ago', type: 'success' },
    { id: '3', agent: 'Pricing Agent', action: 'Adjusted 12 promotional prices for weekend sale', timestamp: '45 min ago', type: 'info' },
    { id: '4', agent: 'Security Agent', action: 'Flagged unusual void pattern at Register 3', timestamp: '1 hr ago', type: 'error' },
    { id: '5', agent: 'Compliance Agent', action: 'Age verification audit completed — 100% pass rate', timestamp: '2 hr ago', type: 'success' },
  ],
};

const DOT_COLORS: Record<string, string> = {
  success: '#10B981',
  warning: '#F59E0B',
  info: '#3B82F6',
  error: '#EF4444',
};

function Skeleton({ width, height }: { width: string; height: string }) {
  return <div className="aros-skeleton" style={{ width, height }} />;
}

function MetricCard({
  label,
  value,
  sub,
  subColor,
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
  loading: boolean;
}) {
  return (
    <div className="aros-card">
      <h3>{label}</h3>
      {loading ? (
        <>
          <Skeleton width="120px" height="34px" />
          <div style={{ marginTop: 8 }}><Skeleton width="80px" height="14px" /></div>
        </>
      ) : (
        <>
          <p className="aros-metric">{value}</p>
          {sub && (
            <p style={{ fontSize: 13, color: subColor || '#334155', marginTop: 4, fontWeight: 600 }}>
              {sub}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function SectionCard({
  title,
  eyebrow,
  action,
  children,
}: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="aros-card" style={{ padding: 24 }}>
      {(eyebrow || action) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
          {eyebrow ? (
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#334155' }}>{eyebrow}</div>
          ) : <span />}
          {action}
        </div>
      )}
      <h2 style={{ margin: 0, marginBottom: 16, fontSize: 18, color: '#0F172A' }}>{title}</h2>
      {children}
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  const color = status === 'active' || status === 'on_track' || status === 'done'
    ? '#10B981'
    : status === 'watch' || status === 'at_risk' || status === 'high'
      ? '#F59E0B'
      : status === 'critical'
        ? '#EF4444'
      : '#94A3B8';
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '4px 10px',
      borderRadius: 999,
      background: `${color}18`,
      color,
      fontSize: 12,
      fontWeight: 700,
      textTransform: 'capitalize',
    }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function ConnectorCard({ connector }: { connector: HumanConnector }) {
  return (
    <div style={{
      border: '1px solid #E2E8F0',
      borderRadius: 14,
      padding: 14,
      background: '#fff',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700, color: '#0F172A' }}>{connector.name}</div>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>{connector.description}</div>
        </div>
        <StatusPill status={connector.status} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
        {connector.connectsTo.map((item) => (
          <span
            key={item}
            style={{
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 999,
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              color: '#475569',
            }}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function TaskRow({ task }: { task: HumanTask }) {
  const priorityColor = task.priority === 'critical'
    ? '#EF4444'
    : task.priority === 'high'
      ? '#F59E0B'
      : task.priority === 'normal'
        ? '#3B82F6'
        : '#94A3B8';

  return (
    <div style={{
      padding: '14px 0',
      borderBottom: '1px solid #E2E8F0',
      display: 'grid',
      gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
        <div>
          <div style={{ fontWeight: 700, color: '#0F172A' }}>{task.title}</div>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 3 }}>
            {task.project} · {task.nextAction}
          </div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: priorityColor, textTransform: 'uppercase' }}>
          {task.priority}
        </span>
      </div>
      <div style={{ fontSize: 12, color: '#94A3B8' }}>{task.status} · updated {task.updatedAt}</div>
    </div>
  );
}

const humanInputStyle: CSSProperties = {
  width: '100%',
  borderRadius: 10,
  border: '1px solid #CBD5E1',
  padding: '10px 12px',
  fontSize: 13,
  background: '#fff',
  color: '#0F172A',
};

const humanTextareaStyle: CSSProperties = {
  ...humanInputStyle,
  resize: 'vertical',
  minHeight: 96,
};

const humanButtonStyle: CSSProperties = {
  borderRadius: 10,
  border: 'none',
  padding: '10px 12px',
  background: '#0F172A',
  color: '#fff',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};

export function Dashboard() {
  const { config } = useWhitelabel();
  const { session, tenant } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activatingConnectors, setActivatingConnectors] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskPriority, setTaskPriority] = useState<'low' | 'normal' | 'high' | 'critical'>('normal');
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [goalName, setGoalName] = useState('');
  const [goalMetric, setGoalMetric] = useState('');
  const [goalTarget, setGoalTarget] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function fetchFromSupabase(): Promise<{ revenue: number; changePercent: number } | null> {
      if (!tenant?.id) return null;
      const today = new Date();
      const yday = new Date(today);
      yday.setDate(today.getDate() - 1);
      const toISO = (d: Date) => d.toISOString().slice(0, 10);
      const { data: rows, error } = await supabase
        .from('pos_sales_daily')
        .select('business_date, total_sales, total_transactions')
        .eq('tenant_id', tenant.id)
        .is('department', null)
        .gte('business_date', toISO(yday))
        .lte('business_date', toISO(today))
        .order('business_date', { ascending: false });
      if (error || !rows) return null;
      const todayRow = rows.find((r) => r.business_date === toISO(today));
      const ydayRow = rows.find((r) => r.business_date === toISO(yday));
      const todayRev = Number(todayRow?.total_sales ?? 0);
      const ydayRev = Number(ydayRow?.total_sales ?? 0);
      const changePercent = ydayRev > 0 ? ((todayRev - ydayRev) / ydayRev) * 100 : 0;
      return { revenue: todayRev, changePercent };
    }

    async function fetchDashboard(): Promise<DashboardData | null> {
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      try {
        const res = await fetch(`${API_BASE}/api/dashboard`, {
          credentials: 'include',
          headers,
        });
        if (!res.ok) throw new Error('API unavailable');
        return (await res.json()) as DashboardData;
      } catch {
        return null;
      }
    }

    async function loadDashboard() {
      const [sales, apiData] = await Promise.all([fetchFromSupabase(), fetchDashboard()]);
      if (cancelled) return;

      const next = apiData ?? MOCK_DATA;
      setData({ ...next, todaySales: sales ?? next.todaySales });
      setLoading(false);
    }

    loadDashboard();
    return () => { cancelled = true; };
  }, [session, tenant?.id, reloadKey]);

  const d = data;
  const changeSign = d && d.todaySales.changePercent >= 0 ? '+' : '';
  const changeColor = d && d.todaySales.changePercent >= 0 ? '#10B981' : '#EF4444';
  const activeConnectors = d?.humanLayer.connectors.filter((connector) => connector.status === 'active').length ?? 0;
  const connectorTotal = d?.humanLayer.connectors.length ?? 0;
  const taskItems = d?.humanLayer.tasks.items ?? [];

  async function handleActivateConnectors() {
    if (!session?.access_token || activatingConnectors) return;
    setActivatingConnectors(true);
    try {
      const res = await fetch(`${API_BASE}/api/human/connectors/activate`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (!res.ok) return;
      const payload = await res.json() as { connectors?: HumanConnector[] };
      if (payload.connectors?.length) {
        setData((prev) => prev ? {
          ...prev,
          humanLayer: {
            ...prev.humanLayer,
            connectors: payload.connectors!,
          },
        } : prev);
      }
    } finally {
      setActivatingConnectors(false);
    }
  }

  async function postHumanAction(path: string, body: Record<string, unknown>) {
    if (!session?.access_token) return false;
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
    return res.ok;
  }

  async function handleCreateTask(e: FormEvent) {
    e.preventDefault();
    if (!taskTitle.trim() || !taskDescription.trim()) return;
    const ok = await postHumanAction('/api/human/tasks', {
      title: taskTitle.trim(),
      description: taskDescription.trim(),
      priority: taskPriority,
      agentId: 'human-tasks-001',
      context: {
        project: 'operations',
        nextAction: taskDescription.trim(),
      },
      tags: ['human-layer'],
    });
    if (ok) {
      setTaskTitle('');
      setTaskDescription('');
      setTaskPriority('normal');
      setReloadKey((n) => n + 1);
    }
  }

  async function handleCreateProject(e: FormEvent) {
    e.preventDefault();
    if (!projectName.trim() || !projectDescription.trim()) return;
    const ok = await postHumanAction('/api/human/projects', {
      name: projectName.trim(),
      description: projectDescription.trim(),
      status: 'on_track',
    });
    if (ok) {
      setProjectName('');
      setProjectDescription('');
      setReloadKey((n) => n + 1);
    }
  }

  async function handleCreateGoal(e: FormEvent) {
    e.preventDefault();
    if (!goalName.trim() || !goalMetric.trim() || !goalTarget.trim()) return;
    const ok = await postHumanAction('/api/human/goals', {
      name: goalName.trim(),
      metric: goalMetric.trim(),
      target: goalTarget.trim(),
      status: 'on_track',
      progress: 0,
    });
    if (ok) {
      setGoalName('');
      setGoalMetric('');
      setGoalTarget('');
      setReloadKey((n) => n + 1);
    }
  }

  const dashboardStats = useMemo(() => {
    return [
      {
        label: 'Today\'s Sales',
        value: d ? `$${d.todaySales.revenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '',
        sub: d ? `${changeSign}${d.todaySales.changePercent}% vs yesterday` : undefined,
        color: changeColor,
      },
      {
        label: 'Active Alerts',
        value: d ? String(d.activeAlerts.count) : '',
        sub: d && d.activeAlerts.critical > 0 ? `${d.activeAlerts.critical} critical` : 'All clear',
        color: d && d.activeAlerts.critical > 0 ? '#EF4444' : '#10B981',
      },
      {
        label: 'AI Agents',
        value: d ? `${d.aiAgents.active} / ${d.aiAgents.total}` : '',
        sub: d ? `${d.aiAgents.active} running` : undefined,
        color: '#3B82F6',
      },
      {
        label: 'Human Connectors',
        value: d ? `${activeConnectors} / ${connectorTotal}` : '',
        sub: d ? 'In the human layer' : undefined,
        color: '#8B5CF6',
      },
    ];
  }, [activeConnectors, changeColor, changeSign, d, connectorTotal]);

  return (
    <div className="aros-dashboard">
      <div style={{
        padding: '28px 28px 24px',
        borderRadius: 20,
        marginBottom: 20,
        background: 'linear-gradient(135deg, #FFFFFF 0%, #EFF6FF 52%, #F8FAFC 100%)',
        border: '1px solid #E2E8F0',
        boxShadow: '0 24px 80px rgba(15, 23, 42, 0.08)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', alignItems: 'end' }}>
          <div>
            <h1 style={{ marginBottom: 8 }}>Human operating system</h1>
            <p style={{ marginBottom: 0 }}>
              {config.brand.tagline} The business layer now feeds the human layer: briefing, tasks, goals, projects, and connectors.
            </p>
          </div>
          <div style={{
            padding: '12px 16px',
            borderRadius: 16,
            background: '#0F172A',
            color: '#fff',
            minWidth: 220,
          }}>
            <div style={{ fontSize: 12, opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Daily briefing</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 6 }}>{d?.humanLayer.briefing.focus || 'Loading briefing...'}</div>
          </div>
        </div>
      </div>

      <div className="aros-dashboard-grid">
        {dashboardStats.map((card) => (
          <MetricCard
            key={card.label}
            label={card.label}
            value={card.value}
            sub={card.sub}
            subColor={card.color}
            loading={loading}
          />
        ))}
      </div>

      <div className="aros-human-grid aros-human-grid--summary">
        <SectionCard title="Daily Briefing" eyebrow="Human layer">
          {loading ? (
            <>
              <Skeleton width="90%" height="16px" />
              <div style={{ marginTop: 8 }}><Skeleton width="70%" height="16px" /></div>
              <div style={{ marginTop: 18 }}><Skeleton width="55%" height="12px" /></div>
            </>
          ) : (
            <>
              <p style={{ margin: 0, color: '#334155', lineHeight: 1.6 }}>{d?.humanLayer.briefing.executiveSummary}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
                <StatusPill status={d?.humanLayer.tasks.urgent ? 'watch' : 'on_track'} />
                <span style={{ fontSize: 12, color: '#64748B' }}>
                  {d?.humanLayer.tasks.open ?? 0} open tasks · {d?.humanLayer.tasks.urgent ?? 0} urgent · {d?.humanLayer.tasks.overdue ?? 0} overdue
                </span>
              </div>
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748B', marginBottom: 8 }}>
                  Top priorities
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {(d?.humanLayer.briefing.topPriorities ?? []).map((task) => (
                    <div key={task.id} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 16,
                      padding: '12px 14px',
                      borderRadius: 14,
                      border: '1px solid #E2E8F0',
                      background: '#fff',
                    }}>
                      <div>
                        <div style={{ fontWeight: 700, color: '#0F172A' }}>{task.title}</div>
                        <div style={{ fontSize: 12, color: '#64748B', marginTop: 3 }}>{task.project} · {task.nextAction}</div>
                      </div>
                      <StatusPill status={task.priority} />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </SectionCard>

        <SectionCard title="Important Info" eyebrow="What matters now">
          {loading ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <Skeleton width="100%" height="54px" />
              <Skeleton width="100%" height="54px" />
              <Skeleton width="100%" height="54px" />
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {[
                { label: 'Unread messages', value: d?.humanLayer.importantInfo.unreadMessages ?? 0 },
                { label: 'Missed calls', value: d?.humanLayer.importantInfo.missedCalls ?? 0 },
                { label: 'Pending decisions', value: d?.humanLayer.importantInfo.pendingDecisions ?? 0 },
                { label: 'Follow-ups due', value: d?.humanLayer.importantInfo.pendingFollowUps ?? 0 },
              ].map((item) => (
                <div key={item.label} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  border: '1px solid #E2E8F0',
                  borderRadius: 14,
                  padding: '14px 16px',
                  background: '#fff',
                }}>
                  <div style={{ color: '#64748B', fontSize: 13 }}>{item.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A' }}>{item.value}</div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="aros-human-grid aros-human-grid--work">
        <SectionCard title="Tasks" eyebrow="Execution">
          {loading ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <Skeleton width="100%" height="56px" />
              <Skeleton width="100%" height="56px" />
              <Skeleton width="100%" height="56px" />
            </div>
          ) : taskItems.length > 0 ? (
            <div>
              {taskItems.map((task) => <TaskRow key={task.id} task={task} />)}
            </div>
          ) : (
            <p style={{ margin: 0, color: '#64748B' }}>No open tasks yet. Capture work from email, calls, meetings, or chat to populate this queue.</p>
          )}
        </SectionCard>

        <SectionCard title="Goals + Projects" eyebrow="Direction">
          {loading ? (
            <div style={{ display: 'grid', gap: 14 }}>
              <Skeleton width="100%" height="80px" />
              <Skeleton width="100%" height="80px" />
              <Skeleton width="100%" height="80px" />
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748B', marginBottom: 10 }}>Goals</div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {(d?.humanLayer.goals ?? []).slice(0, 3).map((goal) => (
                    <div key={goal.id} style={{ border: '1px solid #E2E8F0', borderRadius: 14, padding: 14, background: '#fff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <div>
                          <div style={{ fontWeight: 700, color: '#0F172A' }}>{goal.name}</div>
                          <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>{goal.metric}</div>
                        </div>
                        <StatusPill status={goal.status} />
                      </div>
                      <div style={{ marginTop: 10, height: 8, borderRadius: 999, background: '#E2E8F0', overflow: 'hidden' }}>
                        <div style={{ width: `${goal.progress}%`, height: '100%', background: 'linear-gradient(90deg, #3B82F6, #8B5CF6)' }} />
                      </div>
                      <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 6 }}>{goal.progress}% · Target: {goal.target}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748B', marginBottom: 10 }}>Projects</div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {(d?.humanLayer.projects ?? []).slice(0, 3).map((project) => (
                    <div key={project.id} style={{ border: '1px solid #E2E8F0', borderRadius: 14, padding: 14, background: '#fff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <div>
                          <div style={{ fontWeight: 700, color: '#0F172A' }}>{project.name}</div>
                          <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>
                            {project.completedTasks}/{project.completedTasks + project.openTasks || 1} complete
                          </div>
                        </div>
                        <StatusPill status={project.status} />
                      </div>
                      <div style={{ marginTop: 10, height: 8, borderRadius: 999, background: '#E2E8F0', overflow: 'hidden' }}>
                        <div style={{ width: `${project.progress}%`, height: '100%', background: 'linear-gradient(90deg, #10B981, #14B8A6)' }} />
                      </div>
                      {project.blockers.length > 0 && (
                        <div style={{ marginTop: 8, fontSize: 12, color: '#B45309' }}>Blockers: {project.blockers.join(', ')}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="aros-human-grid aros-human-grid--signals">
        <SectionCard
          title="Connectors"
          eyebrow="Activated"
          action={(
            <button
              type="button"
              onClick={handleActivateConnectors}
              disabled={activatingConnectors}
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: '1px solid #CBD5E1',
                background: activatingConnectors ? '#E2E8F0' : '#0F172A',
                color: activatingConnectors ? '#475569' : '#fff',
                fontSize: 12,
                fontWeight: 700,
                cursor: activatingConnectors ? 'wait' : 'pointer',
              }}
            >
              {activatingConnectors ? 'Activating...' : 'Activate all'}
            </button>
          )}
        >
          {loading ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <Skeleton width="100%" height="74px" />
              <Skeleton width="100%" height="74px" />
              <Skeleton width="100%" height="74px" />
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {d?.humanLayer.connectors.map((connector) => <ConnectorCard key={connector.id} connector={connector} />)}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Recent Activity" eyebrow="Business signal">
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[1, 2, 3].map((i) => (
                <div key={i} style={{ display: 'flex', gap: 12 }}>
                  <Skeleton width="8px" height="8px" />
                  <div style={{ flex: 1 }}>
                    <Skeleton width="80%" height="16px" />
                    <div style={{ marginTop: 6 }}><Skeleton width="60px" height="12px" /></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ul className="aros-activity-list">
              {d?.recentActivity.map((item) => (
                <li key={item.id} className="aros-activity-item">
                  <span className="aros-activity-dot" style={{ background: DOT_COLORS[item.type] || '#94A3B8' }} />
                  <div className="aros-activity-content">
                    <p className="aros-activity-text">
                      <strong>{item.agent}</strong> — {item.action}
                    </p>
                    <p className="aros-activity-time">{item.timestamp}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Manage Human Layer"
        eyebrow="Quick capture"
        action={(
          <button
            type="button"
            onClick={() => setReloadKey((n) => n + 1)}
            style={{
              padding: '8px 12px',
              borderRadius: 10,
              border: '1px solid #CBD5E1',
              background: '#fff',
              color: '#0F172A',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Refresh briefing
          </button>
        )}
      >
        <div className="aros-human-manage-grid">
          <form onSubmit={handleCreateTask} style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>Task</div>
            <input
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="Task title"
              style={humanInputStyle}
            />
            <textarea
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
              placeholder="Next action and context"
              rows={4}
              style={humanTextareaStyle}
            />
            <select value={taskPriority} onChange={(e) => setTaskPriority(e.target.value as typeof taskPriority)} style={humanInputStyle}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <button type="submit" style={humanButtonStyle}>Add task</button>
          </form>

          <form onSubmit={handleCreateProject} style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>Project</div>
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Project name"
              style={humanInputStyle}
            />
            <textarea
              value={projectDescription}
              onChange={(e) => setProjectDescription(e.target.value)}
              placeholder="Project outcome and scope"
              rows={4}
              style={humanTextareaStyle}
            />
            <button type="submit" style={humanButtonStyle}>Add project</button>
          </form>

          <form onSubmit={handleCreateGoal} style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>Goal</div>
            <input
              value={goalName}
              onChange={(e) => setGoalName(e.target.value)}
              placeholder="Goal name"
              style={humanInputStyle}
            />
            <input
              value={goalMetric}
              onChange={(e) => setGoalMetric(e.target.value)}
              placeholder="Metric"
              style={humanInputStyle}
            />
            <input
              value={goalTarget}
              onChange={(e) => setGoalTarget(e.target.value)}
              placeholder="Target"
              style={humanInputStyle}
            />
            <button type="submit" style={humanButtonStyle}>Add goal</button>
          </form>
        </div>
      </SectionCard>

      <div className="aros-activity-feed" style={{ marginTop: 0 }}>
        <h2>Low Stock Items</h2>
        {loading ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <Skeleton width="100%" height="18px" />
            <Skeleton width="100%" height="18px" />
            <Skeleton width="100%" height="18px" />
          </div>
        ) : d?.lowStock.items.length ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {d.lowStock.items.map((item) => (
              <div key={item.name} style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 16,
                borderBottom: '1px solid #F1F5F9',
                paddingBottom: 10,
              }}>
                <div>
                  <div style={{ fontWeight: 700, color: '#0F172A' }}>{item.name}</div>
                  <div style={{ fontSize: 12, color: '#64748B' }}>Threshold {item.threshold}</div>
                </div>
                <div style={{ fontWeight: 700, color: '#EF4444' }}>{item.current}</div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, color: '#64748B' }}>Stock levels are clean.</p>
        )}
      </div>
    </div>
  );
}
