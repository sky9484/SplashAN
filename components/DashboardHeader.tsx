'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ChevronDown,
  LogOut,
  Search,
  Settings,
} from 'lucide-react';

interface DashboardHeaderProps {
  collapsed: boolean;
}

export default function DashboardHeader({ collapsed }: DashboardHeaderProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [avatar,      setAvatar]      = useState<string | null>(null);

  const profileRef   = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Close profile dropdown on outside click */
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatar(URL.createObjectURL(file));
    setProfileOpen(false);
  }

  return (
    <header
      className={`fintech-dashboard-header fixed top-0 right-0 z-20 hidden h-[60px] items-center justify-between border-b border-[#326273]/10 bg-[#F6F0ED] px-5 shadow-sm md:flex transition-[left] duration-300 ${
        collapsed ? 'left-20' : 'left-60'
      }`}
    >
      {/* ── Search ─────────────────────────────────────────── */}
      <div className="flex max-w-sm flex-1 items-center gap-2 rounded-xl border border-[#326273]/10 bg-white px-3 py-2 shadow-sm">
        <Search size={14} className="shrink-0 text-[#326273]/35" />
        <input
          type="text"
          placeholder="Search dashboard…"
          className="flex-1 bg-transparent text-sm text-[#326273] placeholder-[#326273]/35 outline-none"
        />
      </div>

      {/* ── Right controls ─────────────────────────────────── */}
      <div className="flex items-center gap-2.5">

        {/* Profile + dropdown */}
        <div ref={profileRef} className="relative">
          <button
            type="button"
            onClick={() => setProfileOpen((v) => !v)}
            className="flex items-center gap-2 rounded-xl border border-[#326273]/10 bg-white py-1.5 pl-1.5 pr-2.5 shadow-sm transition-colors hover:bg-[#F6F0ED]"
          >
            {/* Avatar */}
            <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#1F4452]">
              {avatar
                ? <Image src={avatar} alt="Profile" width={28} height={28} unoptimized className="h-full w-full object-cover" />
                : <span className="text-[11px] font-bold text-white">D</span>
              }
            </div>
            {/* Name */}
            <div className="hidden text-left sm:block">
              <div className="text-xs font-semibold leading-none text-[#326273]">Daniel</div>
              <div className="mt-0.5 text-[10px] leading-none text-[#326273]/40">Admin</div>
            </div>
            <ChevronDown
              size={13}
              className={`text-[#326273]/40 transition-transform duration-200 ${profileOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {profileOpen && (
            <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-52 overflow-hidden rounded-2xl border border-[#326273]/10 bg-white shadow-xl">
              {/* User info header */}
              <div className="flex items-center gap-3 border-b border-[#326273]/8 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#1F4452]">
                  {avatar
                    ? <Image src={avatar} alt="Profile" width={36} height={36} unoptimized className="h-full w-full object-cover" />
                    : <span className="text-sm font-bold text-white">D</span>
                  }
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#326273]">Daniel</div>
                  <div className="truncate text-[10px] text-[#326273]/40">
                    skyhandsome94@gmail.com
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-0.5 p-1.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs text-[#326273]/65 transition-colors hover:bg-[#F6F0ED] hover:text-[#326273]"
                >
                  <Camera size={13} />
                  Change profile photo
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs text-[#326273]/65 transition-colors hover:bg-[#F6F0ED] hover:text-[#326273]"
                >
                  <Settings size={13} />
                  Account settings
                </button>
              </div>

              <div className="border-t border-[#326273]/8 p-1.5">
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs text-[#E39774] transition-colors hover:bg-orange-50"
                >
                  <LogOut size={13} />
                  Log out
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Hidden file input for avatar upload */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleAvatarChange}
        />
      </div>
    </header>
  );
}
