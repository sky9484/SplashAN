'use client';

import { useRef, type ReactNode } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

type DashRiseProps = {
  children: ReactNode;
  className?: string;
  stagger?: number;
  y?: number;
};

/**
 * Staggered rise-in for a grid/list of cards. Unlike the CSS
 * .dash-reveal-stagger (capped at 6 children), this staggers every child.
 * Transform-only — a display:none mount can never freeze content invisible.
 */
export default function DashRise({ children, className, stagger = 0.06, y = 18 }: DashRiseProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const targets = ref.current ? Array.from(ref.current.children) : [];
    if (targets.length === 0) return;
    gsap.from(targets, {
      y,
      duration: 0.5,
      ease: 'power3.out',
      stagger,
      clearProps: 'transform',
    });
  }, { scope: ref });

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
