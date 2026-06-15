'use client';

import Image from 'next/image';
import { useState, type ReactNode } from 'react';
import FloatingCopilot from '../../components/FloatingCopilot';
import DashboardHeader from '../../components/DashboardHeader';
import {
  Bot,
  FileText,
  History,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Phone,
  Send,
  Settings,
  Timer,
  TrendingUp,
  UserCircle,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

// ─── Nav structure ────────────────────────────────────────────────────────────

type NavItem = { label: string; href: string; icon: LucideIcon; badge?: string };
type NavGroup = { title: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    title: 'Payments',
    items: [
      { label: 'Overview',     href: '/dashboard',          icon: LayoutDashboard },
      { label: 'Transfer',     href: '/dashboard/transfer', icon: Send },
      { label: 'Rate holds',   href: '/dashboard/transfers', icon: Timer },
      { label: 'Batch Payout', href: '/dashboard/batch',    icon: Layers },
    ],
  },
  {
    title: 'Finance',
    items: [
      { label: 'Treasury',   href: '/dashboard/treasury', icon: TrendingUp },
      { label: 'Invoices',   href: '/dashboard/invoices', icon: FileText },
      { label: '0xWal', href: '/dashboard/0xwal',  icon: Bot,        badge: 'AI' },
    ],
  },
  {
    title: 'Contacts',
    items: [
      { label: 'Recipients', href: '/dashboard/recipients', icon: UserCircle },
      { label: 'History',    href: '/dashboard/history',    icon: History },
    ],
  },
];

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const [collapsed,  setCollapsed]  = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const router   = useRouter();
  const pathname = usePathname();

  function logout() {
    router.replace('/login');
  }

  return (
    <div className="fintech-dashboard-shell flex min-h-screen splash-page-bg">

      {/* ── Desktop top header ───────────────────────────────── */}
      <DashboardHeader collapsed={collapsed} />

      {/* ── Desktop sidebar ──────────────────────────────────── */}
      <aside
        className={`fintech-dashboard-sidebar hidden flex-col bg-[#1F4452] p-4 text-white transition-all duration-300 md:flex fixed left-0 top-0 z-30 h-screen ${
          collapsed ? 'w-20' : 'w-60'
        }`}
      >
        {/* Logo / collapse toggle */}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className={`mb-8 flex items-center rounded-xl transition-colors hover:bg-white/10 ${
            collapsed ? 'mx-auto justify-center p-2' : 'gap-3 px-2 py-2'
          }`}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          <Image
            src="/splash-main-icon.png"
            alt="Splash"
            width={32}
            height={32}
            className="h-8 w-8 shrink-0 object-contain"
            unoptimized
          />
          {!collapsed && (
            <span className="grid text-left">
              <strong className="text-xl font-bold tracking-tight text-white">
                Splash<span className="text-[#5C9EAD]">.</span>
              </strong>
              <small className="text-[8px] font-bold uppercase tracking-[0.18em] text-white/40">Global settlement engine</small>
            </span>
          )}
        </button>

        {/* Nav groups */}
        <nav className="flex-1 space-y-5 overflow-y-auto">
          {navGroups.map((group) => (
            <div key={group.title}>
              {!collapsed && (
                <div className="mb-1 px-2 text-[10px] font-bold uppercase tracking-widest text-white/25">
                  {group.title}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map(({ label, href, icon: Icon, badge }) => {
                  const active = pathname === href;
                  return (
                    <Link
                      key={href}
                      href={href}
                      title={collapsed ? label : undefined}
                      className={`flex items-center rounded-lg px-2 py-2 text-sm transition-colors ${
                        collapsed ? 'justify-center' : 'gap-3'
                      } ${
                        active
                          ? 'bg-white/15 text-white'
                          : 'text-white/55 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <Icon size={18} className={active ? 'text-[#5C9EAD]' : ''} />
                      {!collapsed && (
                        <>
                          <span className="flex-1 font-medium">{label}</span>
                          {badge && (
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                                badge === 'New'
                                  ? 'bg-[#E39774]/25 text-[#E39774]'
                                  : 'bg-[#5C9EAD]/20 text-[#5C9EAD]'
                              }`}
                            >
                              {badge}
                            </span>
                          )}
                        </>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom items */}
        {!collapsed && (
          <div className="fintech-sidebar-signal">
            <Image src="/isometric/sui-logo-clean.svg" alt="" width={32} height={42} />
            <span>
              <small>Settlement rail</small>
              <strong><i /> Sui network live</strong>
            </span>
          </div>
        )}

        <div className="space-y-0.5 border-t border-white/10 pt-4">
          <Link
            href="/dashboard/settings"
            title={collapsed ? 'Settings' : undefined}
            className={`flex items-center rounded-lg px-2 py-2 text-sm transition-colors hover:bg-white/10 hover:text-white ${
              collapsed ? 'justify-center' : 'gap-3'
            } ${
              pathname === '/dashboard/settings'
                ? 'bg-white/15 text-white'
                : 'text-white/55'
            }`}
          >
            <Settings size={18} />
            {!collapsed && <span className="font-medium">Settings</span>}
          </Link>
          <Link
            href="/dashboard/customer-service"
            title={collapsed ? 'Support' : undefined}
            className={`flex items-center rounded-lg px-2 py-2 text-sm text-white/55 transition-colors hover:bg-white/10 hover:text-white ${
              collapsed ? 'justify-center' : 'gap-3'
            }`}
          >
            <Phone size={18} />
            {!collapsed && <span className="font-medium">Support</span>}
          </Link>
          <button
            type="button"
            onClick={logout}
            title={collapsed ? 'Log out' : undefined}
            className={`flex w-full items-center rounded-lg px-2 py-2 text-sm text-white/55 transition-colors hover:bg-white/10 hover:text-[#E39774] ${
              collapsed ? 'justify-center' : 'gap-3'
            }`}
          >
            <LogOut size={18} />
            {!collapsed && <span className="font-medium">Log out</span>}
          </button>
        </div>
      </aside>

      {/* ── Mobile top header ─────────────────────────────────── */}
      <header className="fixed left-0 right-0 top-0 z-40 flex items-center justify-between bg-[#1F4452] px-4 py-3 md:hidden">
        <div className="flex items-center gap-3">
          <Image
            src="/splash-main-icon.png"
            alt="Splash"
            width={28}
            height={28}
            className="h-7 w-7 object-contain"
            unoptimized
          />
          <span className="text-lg font-bold text-white">
            Splash<span className="text-[#5C9EAD]">.</span>
          </span>
        </div>
        <button type="button" onClick={() => setMobileOpen((v) => !v)} className="text-white">
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </header>

      {/* ── Mobile overlay ────────────────────────────────────── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 bg-[#1F4452] pt-16 md:hidden">
          <div className="flex h-full flex-col p-6">
            <nav className="flex-1 space-y-1 overflow-y-auto">
              {navGroups.flatMap((g) => g.items).map(({ label, href, icon: Icon }) => (
                <Link
                  key={href}
                  onClick={() => setMobileOpen(false)}
                  href={href}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3 text-white transition-colors hover:bg-white/10 ${
                    pathname === href ? 'bg-white/15 text-[#5C9EAD]' : ''
                  }`}
                >
                  <Icon size={20} />
                  <span className="font-semibold">{label}</span>
                </Link>
              ))}
            </nav>
            <button
              type="button"
              onClick={() => { setMobileOpen(false); logout(); }}
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-white transition-colors hover:bg-white/10 hover:text-[#E39774]"
            >
              <LogOut size={20} />
              <span className="font-semibold">Log out</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Main content ──────────────────────────────────────── */}
      {/* Mobile top pad = 60 px (mobile header); desktop = 76 px (desktop header + gap) */}
      <main
        className={`fintech-dashboard-main relative z-0 min-w-0 flex-1 overflow-x-hidden transition-all duration-300 p-4 pt-[60px] pb-16 md:px-8 md:pb-8 md:pt-[76px] ${
          collapsed ? 'md:ml-20' : 'md:ml-60'
        }`}
      >
        {children}
      </main>

      {/* ── Floating AI Copilot widget ────────────────────────── */}
      <FloatingCopilot />
    </div>
  );
}
