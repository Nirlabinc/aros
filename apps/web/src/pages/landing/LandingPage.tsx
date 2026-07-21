import { useRef, useState } from 'react';
import {
  motion,
  useScroll,
  useTransform,
  useInView,
  AnimatePresence,
  type Variants,
} from 'framer-motion';

/* ─── brand tokens ─── */
const brand = {
  navy: '#0F172A',
  blue: '#3B82F6',
  emerald: '#10B981',
  indigo: '#3b5bdb',
  slate: '#64748B',
  lightSlate: '#94A3B8',
  surface: '#F8FAFC',
  white: '#FFFFFF',
  gradient: 'linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)',
  heroGlow:
    'radial-gradient(ellipse 80% 60% at 50% 40%, rgba(59,130,246,0.15) 0%, rgba(16,185,129,0.08) 40%, transparent 70%)',
};

const font = "Inter, -apple-system, system-ui, 'Segoe UI', sans-serif";

/* ─── animation variants ─── */
const fadeUp: Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] } },
};

const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.6 } },
};

const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};

const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: 'easeOut' } },
};

/* ─── animated counter hook ─── */
function AnimatedCounter({ value, suffix = '' }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });
  return (
    <motion.span
      ref={ref}
      initial={{ opacity: 0 }}
      animate={isInView ? { opacity: 1 } : {}}
      transition={{ duration: 0.4 }}
    >
      <motion.span
        initial={{ opacity: 0 }}
        animate={isInView ? { opacity: 1 } : {}}
      >
        {isInView ? value.toLocaleString() : '0'}
      </motion.span>
      {suffix}
    </motion.span>
  );
}

/* ─── section wrapper with scroll reveal ─── */
function RevealSection({
  children,
  style,
  id,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  id?: string;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-80px' });
  return (
    <motion.section
      ref={ref}
      id={id}
      initial="hidden"
      animate={isInView ? 'visible' : 'hidden'}
      variants={staggerContainer}
      style={style}
    >
      {children}
    </motion.section>
  );
}

/* ─── floating orbs background ─── */
function FloatingOrbs() {
  const orbs = [
    { size: 320, x: '10%', y: '20%', color: 'rgba(59,130,246,0.08)', duration: 20 },
    { size: 240, x: '80%', y: '60%', color: 'rgba(16,185,129,0.06)', duration: 25 },
    { size: 180, x: '60%', y: '10%', color: 'rgba(59,91,219,0.07)', duration: 18 },
    { size: 280, x: '30%', y: '70%', color: 'rgba(59,130,246,0.05)', duration: 22 },
  ];
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {orbs.map((o, i) => (
        <motion.div
          key={i}
          style={{
            position: 'absolute',
            width: o.size,
            height: o.size,
            borderRadius: '50%',
            background: o.color,
            left: o.x,
            top: o.y,
            filter: 'blur(60px)',
          }}
          animate={{
            x: [0, 30, -20, 0],
            y: [0, -25, 15, 0],
            scale: [1, 1.1, 0.95, 1],
          }}
          transition={{
            duration: o.duration,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

/* ─── animated grid lines ─── */
function GridBackground() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        opacity: 0.03,
        backgroundImage:
          'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
        backgroundSize: '60px 60px',
      }}
    />
  );
}

/* ─── feature data ─── */
const features = [
  {
    title: 'POS Integration',
    desc: 'Connect RapidRMS, Verifone Commander, and more — real-time transaction sync with automated inventory management.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={brand.blue} strokeWidth="2" strokeLinecap="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
    image: '/images/feature-pos.png',
    gradient: 'linear-gradient(135deg, rgba(59,130,246,0.1), rgba(59,130,246,0.02))',
  },
  {
    title: 'AI Analytics',
    desc: 'Daily sales reports, trend detection, cost breakdowns, and predictive reordering — generated automatically.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={brand.emerald} strokeWidth="2" strokeLinecap="round">
        <path d="M3 3v18h18" />
        <path d="M7 16l4-8 4 4 5-9" />
      </svg>
    ),
    image: '/images/feature-analytics.png',
    gradient: 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.02))',
  },
  {
    title: 'Agent Workforce',
    desc: 'Up to 14 specialized AI agents handle support, analytics, operations, inventory, and marketing.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={brand.indigo} strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M5 20c0-4 3-7 7-7s7 3 7 7" />
        <circle cx="20" cy="6" r="2" />
        <circle cx="4" cy="6" r="2" />
      </svg>
    ),
    image: '/images/feature-agents.png',
    gradient: 'linear-gradient(135deg, rgba(59,91,219,0.1), rgba(59,91,219,0.02))',
  },
  {
    title: 'Fleet Management',
    desc: 'Multi-store operators get unified dashboards, cross-location analytics, and centralized agent management.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={brand.blue} strokeWidth="2" strokeLinecap="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
    image: '/images/feature-fleet.png',
    gradient: 'linear-gradient(135deg, rgba(59,130,246,0.1), rgba(59,130,246,0.02))',
  },
  {
    title: 'Marketplace',
    desc: 'Browse and install integrations — POS connectors, cloud storage, payments, messaging, and more.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={brand.emerald} strokeWidth="2" strokeLinecap="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
        <polyline points="9,22 9,12 15,12 15,22" />
      </svg>
    ),
    image: '/images/feature-marketplace.png',
    gradient: 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.02))',
  },
  {
    title: 'Self-Hosted',
    desc: 'Run AROS on your own server with Docker. Your data stays on your hardware. Full privacy, zero vendor lock-in.',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={brand.indigo} strokeWidth="2" strokeLinecap="round">
        <rect x="2" y="2" width="20" height="8" rx="2" />
        <rect x="2" y="14" width="20" height="8" rx="2" />
        <circle cx="6" cy="6" r="1" fill={brand.indigo} />
        <circle cx="6" cy="18" r="1" fill={brand.indigo} />
      </svg>
    ),
    image: '/images/feature-selfhosted.png',
    gradient: 'linear-gradient(135deg, rgba(59,91,219,0.1), rgba(59,91,219,0.02))',
  },
];

/* ─── stats ─── */
const stats = [
  { value: 200, suffix: '+', label: 'Stores Trained On' },
  { value: 14, suffix: '', label: 'AI Agents' },
  { value: 99.9, suffix: '%', label: 'Uptime SLA' },
  { value: 60, suffix: 's', label: 'Avg Setup Time' },
];

/* ─── pricing ─── */
const plans = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    desc: 'Self-hosted, 1 store',
    features: ['1 store, 1 user', 'Local AI (Ollama)', 'Basic dashboards', 'Community support'],
    cta: 'Start Free',
    popular: false,
    href: '/signup',
  },
  {
    name: 'Starter',
    price: '$49',
    period: '/mo per store',
    desc: 'Managed hosting, cloud AI',
    features: ['1 store, 3 users', '5 AI agents', 'Cloud AI', 'Daily backups', 'Email support'],
    cta: 'Get Started',
    popular: true,
    href: '/signup',
  },
  {
    name: 'Pro',
    price: '$149',
    period: '/mo per store',
    desc: 'Advanced analytics',
    features: ['Up to 10 stores', '14 AI agents', 'Custom dashboards', 'API access', 'Priority support'],
    cta: 'Go Pro',
    popular: false,
    href: '/signup',
  },
  {
    name: 'Business',
    price: '$499',
    period: '/mo per store',
    desc: 'Fleet analytics, SSO',
    features: ['Up to 50 stores', 'All AI agents', 'Fleet analytics', 'SSO / SAML', 'White-label', 'Dedicated support'],
    cta: 'Contact Sales',
    popular: false,
    href: '/contact',
  },
];

/* ─── FAQ ─── */
const faqs = [
  {
    q: 'How long does setup take?',
    a: 'Under an hour. Connect your POS credentials, AROS syncs your data, and your AI agents are ready the same day. No hardware, no IT team needed.',
  },
  {
    q: 'Will this work with my POS system?',
    a: 'AROS integrates with RapidRMS, Clover, Square, and Toast. New integrations are added regularly via the Marketplace.',
  },
  {
    q: 'Is my data safe?',
    a: 'Your data stays on your infrastructure by default. AROS processes everything locally. Built for PCI-DSS compliance with zero PII transmission without consent.',
  },
  {
    q: 'How is this different from my POS reporting?',
    a: 'Your POS records transactions. AROS analyzes them in real-time — alerting you to void spikes mid-shift, not in an end-of-day report.',
  },
];

/* ─── main page ─── */
export function LandingPage() {
  const heroRef = useRef(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  });

  const heroY = useTransform(scrollYProgress, [0, 1], [0, 150]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  const [menuOpen, setMenuOpen] = useState(false);

  const navLinks = [
    { label: 'Features', href: '#features' },
    { label: 'Pricing', href: '#pricing' },
    { label: 'Marketplace', href: '/login?returnTo=%2Fmarketplace' },
    { label: 'Developers', href: '/login?returnTo=%2Fdevelopers' },
    { label: 'Support', href: 'https://support.nirtek.net', ext: true },
    { label: 'Sign In', href: '/login' },
  ];

  return (
    <div className="aros-landing" style={{ fontFamily: font, color: brand.navy, background: brand.white, overflowX: 'hidden' }}>
      {/* ══════ NAVBAR ══════ */}
      <motion.nav
        initial={{ y: -80 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        style={s.nav}
      >
        <div style={s.navInner}>
          <a href="/" style={s.navBrand}>
            <span style={{ color: brand.emerald }}>A</span>ROS
          </a>
          {/* Desktop nav */}
          <div className="nav-desktop" style={s.navLinks}>
            {navLinks.map((l) => (
              <a
                key={l.label}
                href={l.href}
                {...(l.ext ? { target: '_blank', rel: 'noopener' } : {})}
                style={s.navLink}
              >
                {l.label}
              </a>
            ))}
            <motion.a
              href="/signup"
              style={s.navCta}
              whileHover={{ scale: 1.05, boxShadow: '0 4px 20px rgba(59,130,246,0.4)' }}
              whileTap={{ scale: 0.97 }}
            >
              Get Started
            </motion.a>
          </div>
          {/* Mobile hamburger */}
          <button
            className="nav-hamburger"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
            style={{
              display: 'none', background: 'none', border: 'none', cursor: 'pointer',
              padding: 8, color: brand.navy, fontSize: 24, lineHeight: 1,
            }}
          >
            {menuOpen ? '\u2715' : '\u2630'}
          </button>
        </div>
        {/* Mobile menu overlay */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              className="nav-mobile-menu"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              style={{
                overflow: 'hidden', background: 'rgba(255,255,255,0.98)',
                borderTop: '1px solid #F0F0F0', padding: '0 24px',
              }}
            >
              {navLinks.map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  {...(l.ext ? { target: '_blank', rel: 'noopener' } : {})}
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: 'block', padding: '14px 0', fontSize: 15, fontWeight: 500,
                    color: brand.slate, textDecoration: 'none', borderBottom: '1px solid #F5F5F5',
                  }}
                >
                  {l.label}
                </a>
              ))}
              <a
                href="/signup"
                onClick={() => setMenuOpen(false)}
                style={{
                  display: 'block', textAlign: 'center', margin: '16px 0', padding: '14px 0',
                  borderRadius: 10, background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
                  color: '#fff', fontWeight: 700, fontSize: 15, textDecoration: 'none',
                }}
              >
                Get Started
              </a>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.nav>

      {/* ══════ HERO ══════ */}
      <section ref={heroRef} className="hero-section" style={s.hero}>
        <FloatingOrbs />
        <GridBackground />
        <motion.div style={{ ...s.heroInner, y: heroY, opacity: heroOpacity }}>
          <motion.div
            variants={fadeIn}
            initial="hidden"
            animate="visible"
            transition={{ delay: 0.3 }}
            style={s.badge}
          >
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: brand.emerald, marginRight: 8, animation: 'pulse 2s infinite' }} />
            AI-Powered Retail Platform
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
            style={s.heroTitle}
          >
            Your Store,{' '}
            <span
              style={{
                background: 'linear-gradient(135deg, #3B82F6, #10B981)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Run by AI Agents
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.6 }}
            className="hero-desc"
            style={s.heroDesc}
          >
            AROS is the operating system for modern retail. AI agents handle inventory,
            analytics, customer support, and operations — so you can focus on growing your business.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.8 }}
            className="hero-btns"
            style={s.heroBtns}
          >
            <motion.a
              href="/signup"
              style={s.heroBtn}
              whileHover={{ scale: 1.05, boxShadow: '0 8px 30px rgba(59,130,246,0.5)' }}
              whileTap={{ scale: 0.97 }}
            >
              Start Free
              <span style={{ marginLeft: 8, display: 'inline-block' }}>&#8594;</span>
            </motion.a>
            <motion.a
              href="#features"
              style={s.heroBtnOutline}
              whileHover={{ scale: 1.03, background: 'rgba(255,255,255,0.15)' }}
              whileTap={{ scale: 0.97 }}
            >
              See How It Works
            </motion.a>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2 }}
            style={s.heroNote}
          >
            No credit card required &middot; Free plan includes 1 store &middot; Works with RapidRMS, Clover, Square & Toast
          </motion.p>

          {/* hero visual — animated dashboard mockup */}
          <motion.div
            initial={{ opacity: 0, y: 60, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 1, delay: 1 }}
            className="hero-dashboard"
            style={s.heroDashboard}
          >
            <div style={s.dashboardBar}>
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{ ...s.dot, background: '#EF4444' }} />
                <span style={{ ...s.dot, background: '#F59E0B' }} />
                <span style={{ ...s.dot, background: '#10B981' }} />
              </div>
              <span style={{ fontSize: 11, color: brand.lightSlate }}>aros-dashboard</span>
            </div>
            <div style={s.dashboardBody}>
              {/* animated bar chart */}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 120, padding: '20px 24px' }}>
                {[65, 45, 80, 55, 90, 70, 95].map((h, i) => (
                  <motion.div
                    key={i}
                    initial={{ height: 0 }}
                    animate={{ height: `${h}%` }}
                    transition={{ duration: 0.8, delay: 1.3 + i * 0.1, ease: 'easeOut' }}
                    style={{
                      flex: 1,
                      borderRadius: 4,
                      background: i === 6
                        ? 'linear-gradient(180deg, #3B82F6, #10B981)'
                        : `rgba(59,130,246,${0.15 + i * 0.08})`,
                    }}
                  />
                ))}
              </div>
              {/* animated metrics row */}
              <div style={{ display: 'flex', gap: 12, padding: '0 24px 20px' }}>
                {[
                  { label: 'Revenue', val: '$12,847', color: brand.emerald },
                  { label: 'Orders', val: '284', color: brand.blue },
                  { label: 'Agents', val: '12 active', color: brand.indigo },
                ].map((m, i) => (
                  <motion.div
                    key={m.label}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 2 + i * 0.15 }}
                    style={{
                      flex: 1,
                      padding: '12px 14px',
                      borderRadius: 8,
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <div style={{ fontSize: 10, color: brand.lightSlate, marginBottom: 4 }}>{m.label}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: m.color }}>{m.val}</div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      </section>

      {/* ══════ STATS BAR ══════ */}
      <RevealSection style={s.statsBar}>
        <div className="stats-inner" style={s.statsInner}>
          {stats.map((stat) => (
            <motion.div key={stat.label} variants={scaleIn} className="stat-item" style={s.statItem}>
              <div className="stat-value" style={s.statValue}>
                <AnimatedCounter value={stat.value} suffix={stat.suffix} />
              </div>
              <div style={s.statLabel}>{stat.label}</div>
            </motion.div>
          ))}
        </div>
      </RevealSection>

      {/* ══════ PROBLEM → SOLUTION ══════ */}
      <RevealSection style={{ ...s.section, textAlign: 'center' as const }}>
        <motion.div variants={fadeUp} style={s.problemBadge}>The Problem</motion.div>
        <motion.h2 variants={fadeUp} style={s.sectionTitle}>
          Running a store shouldn't mean running on fumes
        </motion.h2>
        <motion.p variants={fadeUp} style={{ ...s.sectionDesc, maxWidth: 640, margin: '0 auto 48px' }}>
          Your POS records transactions. It doesn't analyze them. By the time you review the numbers,
          the problems are already baked in.
        </motion.p>
        <div className="problem-cards" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' as const, justifyContent: 'center' }}>
          {[
            { title: 'Flying Blind', desc: 'Void spikes, shrinkage patterns, and margin erosion hide in plain sight because nobody is watching in real-time.' },
            { title: 'Data Everywhere', desc: 'Register sales, DoorDash payouts, labor costs — five different systems. Getting a true P&L means midnight spreadsheets.' },
            { title: 'No Time to Analyze', desc: 'You work 60+ hours on the floor. A two-hour analysis session isn\'t a scheduling problem — it\'s a physics problem.' },
          ].map((p, i) => (
            <motion.div
              key={p.title}
              variants={fadeUp}
              custom={i}
              className="problem-card"
              style={s.problemCard}
            >
              <div style={{ fontSize: 28, marginBottom: 12 }}>
                {i === 0 ? '🔍' : i === 1 ? '📊' : '⏰'}
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{p.title}</h3>
              <p style={{ fontSize: 14, color: brand.slate, lineHeight: 1.6, margin: 0 }}>{p.desc}</p>
            </motion.div>
          ))}
        </div>
      </RevealSection>

      {/* ══════ SOLUTION BRIDGE ══════ */}
      <RevealSection style={{ ...s.section, background: brand.gradient, color: brand.white, maxWidth: 'none', borderRadius: 0, position: 'relative' as const }}>
        <GridBackground />
        <div style={{ maxWidth: 700, margin: '0 auto', textAlign: 'center' as const, position: 'relative' as const, zIndex: 1 }}>
          <motion.div variants={fadeUp} style={{ ...s.problemBadge, background: 'rgba(16,185,129,0.15)', color: brand.emerald }}>
            The Solution
          </motion.div>
          <motion.h2 variants={fadeUp} style={{ ...s.sectionTitle, color: brand.white }}>
            AROS watches your business so you can run it
          </motion.h2>
          <motion.p variants={fadeUp} style={{ fontSize: 17, color: brand.lightSlate, lineHeight: 1.7 }}>
            AROS connects to your POS and monitors every transaction in real-time. It detects anomalies
            before they become losses, unifies your revenue into a single P&L, and gives you AI agents
            that answer questions about your business in seconds.
          </motion.p>
        </div>
      </RevealSection>

      {/* ══════ FEATURES ══════ */}
      <RevealSection id="features" style={s.section}>
        <motion.h2 variants={fadeUp} style={s.sectionTitle}>
          Everything your store needs
        </motion.h2>
        <motion.p variants={fadeUp} style={s.sectionDesc}>
          AI agents that work 24/7, learning and improving with every transaction.
        </motion.p>
        <div className="feature-grid" style={s.featureGrid}>
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              variants={fadeUp}
              custom={i}
              whileHover={{
                y: -6,
                boxShadow: '0 12px 40px rgba(0,0,0,0.08)',
                transition: { duration: 0.25 },
              }}
              style={s.featureCard}
            >
              {f.image && (
                <div style={{
                  width: '100%',
                  height: 160,
                  borderRadius: 12,
                  marginBottom: 16,
                  overflow: 'hidden',
                  background: f.gradient,
                }}>
                  <img
                    src={f.image}
                    alt={f.title}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}
              <div style={{ ...s.featureIcon, background: f.gradient }}>
                {f.icon}
              </div>
              <h3 style={s.featureTitle}>{f.title}</h3>
              <p style={s.featureDesc}>{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </RevealSection>

      {/* ══════ SOCIAL PROOF ══════ */}
      <RevealSection style={{ ...s.section, background: brand.surface, maxWidth: 'none', borderRadius: 0 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <motion.h2 variants={fadeUp} style={s.sectionTitle}>
            Trained on real store data. Ready for yours.
          </motion.h2>
          <motion.p variants={fadeUp} style={s.sectionDesc}>
            AROS launches pre-trained on anonymized data from 200+ RapidRMS retail locations. Day-one insights — no cold start.
          </motion.p>
          <div className="proof-cards" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' as const, justifyContent: 'center' }}>
            {[
              { cap: 'Real-time revenue', what: 'See sales as they happen' },
              { cap: 'Void detection', what: 'Catch patterns humans miss' },
              { cap: 'Auto reporting', what: 'Zero manual spreadsheets' },
              { cap: 'Cross-store benchmarks', what: 'Compare to anonymized peers' },
            ].map((c, i) => (
              <motion.div
                key={c.cap}
                variants={scaleIn}
                custom={i}
                className="proof-card"
                style={s.proofCard}
              >
                <div style={{ fontSize: 14, fontWeight: 700, color: brand.navy, marginBottom: 4 }}>{c.cap}</div>
                <div style={{ fontSize: 13, color: brand.slate }}>{c.what}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </RevealSection>

      {/* ══════ PRICING ══════ */}
      <RevealSection id="pricing" style={s.section}>
        <motion.h2 variants={fadeUp} style={s.sectionTitle}>
          Simple, transparent pricing
        </motion.h2>
        <motion.p variants={fadeUp} style={s.sectionDesc}>
          Start free. Scale as you grow. No hidden fees.
        </motion.p>
        <div className="pricing-grid" style={s.pricingGrid}>
          {plans.map((p, i) => (
            <motion.div
              key={p.name}
              variants={fadeUp}
              custom={i}
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
              style={{
                ...s.pricingCard,
                border: p.popular ? '2px solid #3B82F6' : '1px solid #E5E7EB',
                boxShadow: p.popular ? '0 8px 30px rgba(59,130,246,0.15)' : 'none',
              }}
            >
              {p.popular && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.5, type: 'spring' }}
                  style={s.popularBadge}
                >
                  Most Popular
                </motion.div>
              )}
              <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{p.name}</h3>
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1 }}>{p.price}</span>
                <span style={{ fontSize: 14, color: brand.slate }}>{p.period}</span>
              </div>
              <p style={{ fontSize: 13, color: brand.slate, marginBottom: 20 }}>{p.desc}</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px 0', flex: 1 }}>
                {p.features.map((f) => (
                  <li key={f} style={{ fontSize: 13, color: '#374151', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: brand.emerald, fontSize: 14, fontWeight: 700 }}>&#10003;</span>
                    {f}
                  </li>
                ))}
              </ul>
              <motion.a
                href={p.href}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                style={{
                  display: 'block',
                  textAlign: 'center',
                  padding: '14px 0',
                  borderRadius: 10,
                  fontWeight: 600,
                  fontSize: 14,
                  textDecoration: 'none',
                  background: p.popular
                    ? 'linear-gradient(135deg, #3B82F6, #2563EB)'
                    : '#F3F4F6',
                  color: p.popular ? '#fff' : '#374151',
                  cursor: 'pointer',
                }}
              >
                {p.cta}
              </motion.a>
            </motion.div>
          ))}
        </div>
      </RevealSection>

      {/* ══════ FAQ ══════ */}
      <RevealSection style={{ ...s.section, background: brand.surface, maxWidth: 'none', borderRadius: 0 }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <motion.h2 variants={fadeUp} style={s.sectionTitle}>
            Questions operators ask
          </motion.h2>
          <motion.p variants={fadeUp} style={{ ...s.sectionDesc, marginBottom: 36 }}>
            Everything you need to know before getting started.
          </motion.p>
          {faqs.map((faq, i) => (
            <motion.div
              key={faq.q}
              variants={fadeUp}
              custom={i}
              style={s.faqItem}
            >
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{faq.q}</h3>
              <p style={{ fontSize: 14, color: brand.slate, lineHeight: 1.7, margin: 0 }}>{faq.a}</p>
            </motion.div>
          ))}
        </div>
      </RevealSection>

      {/* ══════ FINAL CTA ══════ */}
      <RevealSection style={{ ...s.section, textAlign: 'center' as const, position: 'relative' as const }}>
        <motion.h2 variants={fadeUp} style={{ ...s.sectionTitle, fontSize: 36 }}>
          Your POS data already has the answers.{' '}
          <span style={{ background: 'linear-gradient(135deg, #3B82F6, #10B981)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Start asking.
          </span>
        </motion.h2>
        <motion.p variants={fadeUp} style={{ ...s.sectionDesc, maxWidth: 500, margin: '0 auto 36px' }}>
          Connect your POS in under an hour. Ask your AI agents the first question today.
        </motion.p>
        <motion.a
          variants={fadeUp}
          href="/signup"
          whileHover={{ scale: 1.06, boxShadow: '0 12px 40px rgba(59,130,246,0.4)' }}
          whileTap={{ scale: 0.97 }}
          style={{
            ...s.heroBtn,
            display: 'inline-block',
            padding: '18px 56px',
            fontSize: 16,
          }}
        >
          Start Your Free Trial &#8594;
        </motion.a>
        <motion.p variants={fadeIn} style={{ ...s.heroNote, marginTop: 20 }}>
          No credit card required. Works with RapidRMS, Clover, Square & Toast.
        </motion.p>
      </RevealSection>

      {/* ══════ FOOTER ══════ */}
      <footer style={s.footer}>
        <div className="footer-inner" style={s.footerInner}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>
              <span style={{ color: brand.emerald }}>A</span>ROS
            </div>
            <div style={{ fontSize: 13, color: brand.slate }}>Agentic Retail Operating System</div>
            <div style={{ fontSize: 12, color: brand.lightSlate, marginTop: 8 }}>By Nirlab Inc.</div>
          </div>
          <div className="footer-links" style={{ display: 'flex', gap: 36, flexWrap: 'wrap' as const }}>
            {[
              {
                heading: 'Product',
                links: [
                  { label: 'Features', href: '#features' },
                  { label: 'Pricing', href: '#pricing' },
                  { label: 'Marketplace', href: '/login?returnTo=%2Fmarketplace' },
                  { label: 'Status', href: 'https://status.nirtek.net', ext: true },
                ],
              },
              {
                heading: 'Integrations',
                links: [
                  { label: 'POS Integrations', href: 'https://nirtek.net/pos/', ext: true },
                  { label: 'RapidRMS', href: 'https://nirtek.net/pos/rapidrms.html', ext: true },
                  { label: 'Verifone Commander', href: 'https://nirtek.net/pos/verifone-commander.html', ext: true },
                  { label: 'Partners', href: 'https://nirtek.net/partners.html', ext: true },
                ],
              },
              {
                heading: 'Developers',
                links: [
                  { label: 'Developer Portal', href: '/login?returnTo=%2Fdevelopers' },
                  { label: 'API', href: 'https://api.nirtek.net', ext: true },
                  { label: 'SDK Docs', href: 'https://developers.nirtek.net', ext: true },
                  { label: 'GitHub', href: 'https://github.com/nirlab/aros', ext: true },
                ],
              },
              {
                heading: 'Resources',
                links: [
                  { label: 'Blog', href: 'https://nirtek.net/blog.html', ext: true },
                  { label: 'Support', href: 'https://support.nirtek.net', ext: true },
                  { label: 'Platform', href: 'https://nirtek.net/platform.html', ext: true },
                ],
              },
              {
                heading: 'Legal',
                links: [
                  { label: 'Terms', href: 'https://nirtek.net/terms.html', ext: true },
                  { label: 'Privacy', href: 'https://nirtek.net/privacy.html', ext: true },
                  { label: 'Contact', href: '/contact' },
                ],
              },
            ].map((col) => (
              <div key={col.heading}>
                <div style={s.footerHeading}>{col.heading}</div>
                {col.links.map((l) => (
                  <a
                    key={l.label}
                    href={l.href}
                    {...(l.ext ? { target: '_blank', rel: 'noopener' } : {})}
                    style={s.footerLink}
                  >
                    {l.label}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div style={{ maxWidth: 1100, margin: '24px auto 0', paddingTop: 24, borderTop: '1px solid #E5E7EB', fontSize: 12, color: brand.lightSlate, textAlign: 'center' as const }}>
          &copy; {new Date().getFullYear()} Nirlab Inc. All rights reserved.
        </div>
      </footer>

      {/* keyframes + responsive styles */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }
        html { scroll-behavior: smooth; }
        * { box-sizing: border-box; margin: 0; }
        a:hover { opacity: 0.85; }

        /* ── Mobile: hide desktop nav, show hamburger ── */
        @media (max-width: 768px) {
          .nav-desktop { display: none !important; }
          .nav-hamburger { display: block !important; }
        }
        @media (min-width: 769px) {
          .nav-hamburger { display: none !important; }
          .nav-mobile-menu { display: none !important; }
        }

        /* ── Tablet (≤ 900px) ── */
        @media (max-width: 900px) {
          .aros-landing h1 { font-size: 36px !important; letter-spacing: -1px !important; }
          .aros-landing h2 { font-size: 26px !important; }
          .aros-landing section { padding: 48px 16px !important; }
          .hero-section { min-height: auto !important; padding: 80px 16px 48px !important; }
          .hero-btns { flex-direction: column !important; align-items: center !important; }
          .hero-btns a { width: 100% !important; max-width: 320px !important; text-align: center !important; }
          .hero-dashboard { display: none !important; }
          .stats-inner { gap: 16px !important; }
          .stat-item { min-width: 100px !important; }
          .stat-value { font-size: 28px !important; }
          .feature-grid { grid-template-columns: 1fr !important; }
          .pricing-grid { grid-template-columns: 1fr 1fr !important; }
          .problem-cards { flex-direction: column !important; align-items: center !important; }
          .problem-card { max-width: 100% !important; }
          .footer-inner { flex-direction: column !important; gap: 24px !important; }
          .footer-links { gap: 24px !important; }
          .proof-cards { flex-direction: column !important; align-items: center !important; }
          .proof-card { max-width: 100% !important; }
        }

        /* ── Mobile (≤ 600px) ── */
        @media (max-width: 600px) {
          .aros-landing h1 { font-size: 28px !important; letter-spacing: -0.5px !important; }
          .aros-landing h2 { font-size: 22px !important; }
          .aros-landing section { padding: 36px 14px !important; }
          .hero-section { padding: 64px 14px 36px !important; }
          .hero-desc { font-size: 15px !important; }
          .pricing-grid { grid-template-columns: 1fr !important; }
          .stats-inner { flex-direction: column !important; gap: 20px !important; }
          .footer-links { flex-direction: column !important; gap: 20px !important; }
        }
      `}</style>
    </div>
  );
}

/* ─── styles ─── */
const s: Record<string, React.CSSProperties> = {
  nav: {
    position: 'sticky',
    top: 0,
    background: 'rgba(255,255,255,0.85)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    borderBottom: '1px solid rgba(0,0,0,0.06)',
    zIndex: 100,
  },
  navInner: {
    maxWidth: 1140,
    margin: '0 auto',
    padding: '14px 24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  navBrand: {
    fontSize: 24,
    fontWeight: 800,
    color: brand.navy,
    textDecoration: 'none',
    letterSpacing: -1,
  },
  navLinks: {
    display: 'flex',
    alignItems: 'center',
    gap: 24,
  },
  navLink: {
    fontSize: 14,
    fontWeight: 500,
    color: brand.slate,
    textDecoration: 'none',
  },
  navCta: {
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
    textDecoration: 'none',
    background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
    padding: '9px 22px',
    borderRadius: 8,
    display: 'inline-block',
  },
  hero: {
    position: 'relative',
    padding: '100px 24px 80px',
    textAlign: 'center' as const,
    background: brand.gradient,
    color: brand.white,
    overflow: 'hidden',
    minHeight: '90vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroInner: {
    maxWidth: 800,
    margin: '0 auto',
    position: 'relative',
    zIndex: 2,
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: 12,
    fontWeight: 600,
    color: brand.lightSlate,
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.1)',
    padding: '8px 18px',
    borderRadius: 100,
    marginBottom: 28,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
  heroTitle: {
    fontSize: 56,
    fontWeight: 800,
    lineHeight: 1.08,
    letterSpacing: -2,
    marginBottom: 24,
  },
  heroDesc: {
    fontSize: 18,
    lineHeight: 1.7,
    color: brand.lightSlate,
    marginBottom: 36,
    maxWidth: 560,
    margin: '0 auto 36px',
  },
  heroBtns: {
    display: 'flex',
    justifyContent: 'center',
    gap: 14,
  },
  heroBtn: {
    padding: '15px 38px',
    background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
    color: '#fff',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 700,
    textDecoration: 'none',
    border: 'none',
    cursor: 'pointer',
    display: 'inline-block',
  },
  heroBtnOutline: {
    padding: '15px 38px',
    background: 'rgba(255,255,255,0.06)',
    color: '#fff',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    textDecoration: 'none',
    border: '1px solid rgba(255,255,255,0.15)',
    cursor: 'pointer',
    display: 'inline-block',
  },
  heroNote: {
    fontSize: 13,
    color: brand.lightSlate,
    marginTop: 20,
    opacity: 0.8,
  },
  heroDashboard: {
    marginTop: 56,
    borderRadius: 14,
    overflow: 'hidden',
    background: '#0D1117',
    border: '1px solid rgba(255,255,255,0.08)',
    boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
    maxWidth: 640,
    marginLeft: 'auto',
    marginRight: 'auto',
  },
  dashboardBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 16px',
    background: '#161B22',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    display: 'inline-block',
  },
  dashboardBody: {
    minHeight: 180,
  },

  /* stats */
  statsBar: {
    padding: '48px 24px',
    borderBottom: '1px solid #F0F0F0',
  },
  statsInner: {
    maxWidth: 900,
    margin: '0 auto',
    display: 'flex',
    justifyContent: 'space-around',
    flexWrap: 'wrap' as const,
    gap: 24,
  },
  statItem: {
    textAlign: 'center' as const,
    minWidth: 140,
  },
  statValue: {
    fontSize: 36,
    fontWeight: 800,
    letterSpacing: -1,
    background: 'linear-gradient(135deg, #3B82F6, #10B981)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  statLabel: {
    fontSize: 13,
    color: brand.slate,
    marginTop: 4,
    fontWeight: 500,
  },

  /* sections */
  section: {
    padding: '80px 24px',
    maxWidth: 1140,
    margin: '0 auto',
  },
  sectionTitle: {
    fontSize: 34,
    fontWeight: 800,
    textAlign: 'center' as const,
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  sectionDesc: {
    fontSize: 16,
    color: brand.slate,
    textAlign: 'center' as const,
    marginBottom: 48,
    lineHeight: 1.6,
  },

  /* problem cards */
  problemBadge: {
    display: 'inline-block',
    fontSize: 12,
    fontWeight: 700,
    color: brand.blue,
    background: 'rgba(59,130,246,0.08)',
    padding: '6px 14px',
    borderRadius: 100,
    marginBottom: 16,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  problemCard: {
    flex: '1 1 280px',
    maxWidth: 340,
    padding: 24,
    borderRadius: 14,
    background: brand.surface,
    border: '1px solid #F0F0F0',
    textAlign: 'left' as const,
  },

  /* features */
  featureGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: 20,
  },
  featureCard: {
    padding: 28,
    borderRadius: 16,
    background: brand.white,
    border: '1px solid #F0F0F0',
    cursor: 'default',
    transition: 'box-shadow 0.25s',
  },
  featureIcon: {
    width: 52,
    height: 52,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  featureTitle: {
    fontSize: 17,
    fontWeight: 700,
    marginBottom: 8,
  },
  featureDesc: {
    fontSize: 14,
    color: brand.slate,
    lineHeight: 1.65,
    margin: 0,
  },

  /* proof */
  proofCard: {
    flex: '1 1 200px',
    maxWidth: 240,
    padding: '18px 22px',
    borderRadius: 12,
    background: brand.white,
    border: '1px solid #E5E7EB',
  },

  /* pricing */
  pricingGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
    gap: 18,
    maxWidth: 1000,
    margin: '0 auto',
  },
  pricingCard: {
    background: brand.white,
    borderRadius: 16,
    padding: '28px 22px',
    display: 'flex',
    flexDirection: 'column' as const,
    position: 'relative' as const,
  },
  popularBadge: {
    position: 'absolute' as const,
    top: -12,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
    color: '#fff',
    fontSize: 11,
    fontWeight: 700,
    padding: '5px 14px',
    borderRadius: 100,
    whiteSpace: 'nowrap' as const,
  },

  /* faq */
  faqItem: {
    padding: '20px 0',
    borderBottom: '1px solid #F0F0F0',
  },

  /* footer */
  footer: {
    borderTop: '1px solid #F0F0F0',
    padding: '48px 24px 32px',
    background: brand.surface,
  },
  footerInner: {
    maxWidth: 1140,
    margin: '0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    flexWrap: 'wrap' as const,
    gap: 40,
  },
  footerHeading: {
    fontSize: 12,
    fontWeight: 700,
    color: brand.navy,
    marginBottom: 12,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  footerLink: {
    display: 'block',
    fontSize: 13,
    color: brand.slate,
    textDecoration: 'none',
    marginBottom: 8,
  },
};
