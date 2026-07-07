'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion';

import { lockedCopy } from '@/content/claims';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

const riseParent = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.09, delayChildren: 0.2 } },
};

const rise = {
  hidden: { opacity: 0, y: 28 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EASE_OUT_EXPO } },
};

/* ── The landmark island ──────────────────────────────────────────────
   One floating island carries the four SEA landmarks around a gold
   ring. The camera zooms in and swings landmark to landmark; each stop
   pops its telemetry plaque. Geometry is measured on the artwork's
   1024x1024 basis (rendered object-fit contain, centred). */

const ISLAND_SIZE = 1024;

const tourStops = [
  {
    id: 'fee',
    landmark: 'Marina Bay Sands · Singapore',
    target: { x: 722, y: 338 },
    rotate: -10,
    enter: 0.16,
    exit: 0.26,
    side: 'left' as const,
    tag: 'Edge fee · Modeled',
    value: lockedCopy.fee,
    meta: lockedCopy.feeFootnote,
  },
  {
    id: 'corridor',
    landmark: 'Petronas Towers · Kuala Lumpur',
    target: { x: 320, y: 274 },
    rotate: 12,
    enter: 0.325,
    exit: 0.42,
    side: 'right' as const,
    tag: 'Corridor · Testnet',
    value: 'USD → PHP',
    meta: lockedCopy.speed,
  },
  {
    id: 'treasury',
    landmark: 'Monas · Jakarta',
    target: { x: 329, y: 567 },
    rotate: -12,
    enter: 0.485,
    exit: 0.56,
    side: 'right' as const,
    tag: 'Treasury · Approval-gated',
    value: 'USDY posture',
    meta: lockedCopy.yield,
  },
  {
    id: 'agent',
    landmark: 'Wat Arun · Bangkok',
    target: { x: 704, y: 558 },
    rotate: 10,
    enter: 0.625,
    exit: 0.7,
    side: 'left' as const,
    tag: 'Agent · Human-final',
    value: '0xWal desk',
    meta: lockedCopy.agent,
  },
];

const marqueeItems = [
  ['1 live testnet', 'MY to PH corridor'],
  ['Modeled routes', 'expand with controls'],
  ['~400ms', 'Sui settlement finality'],
  ['From 0.80%', 'starting edge fee'],
  ['Human approved', 'AI recommendations'],
  ['Stored proof', 'Walrus + Sui audit'],
];

const tokens = [
  { className: 'cin-token-usd', src: '/cinematic/token-usd.png', alt: 'US dollar token', float: 'cin-float-slow', depth: -26, rate: -170 },
  { className: 'cin-token-myr', src: '/cinematic/token-myr.png', alt: 'Malaysian ringgit token', float: 'cin-float', depth: 30, rate: -120 },
  { className: 'cin-token-sui', src: '/cinematic/token-sui.png', alt: 'Sui token', float: 'cin-float-drift', depth: 44, rate: -240 },
];

/* Camera keyframes: between stops the island swings (rotate) while the
   zoom breathes out and back in; during each dwell it holds still.
   Translation keyframes re-centre the active landmark, computed from
   the island's rendered geometry at the current viewport size. */
function buildCamera(vw: number, vh: number) {
  const s = Math.min(vw, vh) / ISLAND_SIZE;
  const offsetX = (vw - ISLAND_SIZE * s) / 2;
  const offsetY = (vh - ISLAND_SIZE * s) / 2;
  const centre = { x: vw / 2, y: vh / 2 };

  const ZOOM = 2.35;
  const BREATHE = 1.9;

  const shift = (stop: (typeof tourStops)[number], zoom: number) => {
    const px = { x: offsetX + stop.target.x * s, y: offsetY + stop.target.y * s };
    const rad = (stop.rotate * Math.PI) / 180;
    const v = { x: px.x - centre.x, y: px.y - centre.y };
    return {
      x: -(v.x * Math.cos(rad) - v.y * Math.sin(rad)) * zoom,
      y: -(v.x * Math.sin(rad) + v.y * Math.cos(rad)) * zoom,
    };
  };

  const p: number[] = [0, 0.09];
  const x: number[] = [vw * 0.17, vw * 0.17];
  const y: number[] = [0, 0];
  const scale: number[] = [1, 1.05];
  const rotate: number[] = [0, 0];

  tourStops.forEach((stop, index) => {
    const at = shift(stop, ZOOM);
    p.push(stop.enter, stop.exit);
    x.push(at.x, at.x);
    y.push(at.y, at.y);
    scale.push(ZOOM, ZOOM);
    rotate.push(stop.rotate, stop.rotate);
    const next = tourStops[index + 1];
    if (next) {
      const mid = (stop.exit + next.enter) / 2;
      const midRotate = (stop.rotate + next.rotate) / 2;
      const a = shift(stop, BREATHE);
      const b = shift(next, BREATHE);
      p.push(mid);
      x.push((a.x + b.x) / 2);
      y.push((a.y + b.y) / 2);
      scale.push(BREATHE);
      rotate.push(midRotate);
    }
  });

  /* Exit: pull back slightly and keep drifting as the flash takes over. */
  p.push(0.76);
  x.push(0);
  y.push(-vh * 0.06);
  scale.push(1.24);
  rotate.push(0);

  return { p, x, y, scale, rotate };
}

function CalloutBody({ tag, value, meta }: { tag: string; value: string; meta: string }) {
  return (
    <>
      <i>{tag}</i>
      <strong>{value}</strong>
      <small>{meta}</small>
    </>
  );
}

/* The telemetry plaque: generated gold-framed teal glass panel, popped
   with a scroll-linked overshoot and counter-rotated to stay upright. */
function StopCallout({
  progress,
  islandRotate,
  stop,
}: {
  progress: MotionValue<number>;
  islandRotate: MotionValue<number>;
  stop: (typeof tourStops)[number];
}) {
  const { enter, exit } = stop;
  const opacity = useTransform(progress, [enter, enter + 0.018, exit - 0.02, exit], [0, 1, 1, 0]);
  const scale = useTransform(progress, [enter, enter + 0.024, enter + 0.04], [0.55, 1.07, 1]);
  const yPop = useTransform(progress, [enter, enter + 0.04], [30, 0]);
  const rotate = useTransform(islandRotate, (value) => value * -0.35);

  return (
    <motion.div
      className={`cin-stop cin-stop-${stop.id} is-${stop.side}`}
      style={{ opacity, scale, y: yPop, rotate }}
    >
      <span className={`cin-stop-art ${stop.side === 'left' ? 'is-flipped' : ''}`} aria-hidden="true" />
      <span className="cin-stop-ping" aria-hidden="true" />
      <div className="cin-stop-body">
        <CalloutBody tag={stop.tag} value={stop.value} meta={stop.meta} />
        <em>{stop.landmark}</em>
      </div>
    </motion.div>
  );
}

function SpinButton({ src, alt, float, sizes }: { src: string; alt: string; float: string; sizes: string }) {
  const [spinning, setSpinning] = useState(false);
  return (
    <button
      type="button"
      className={`cin-token-button ${spinning ? 'is-spinning' : ''}`}
      onClick={() => setSpinning(true)}
      onAnimationEnd={(event) => {
        if (event.animationName === 'cin-spin') setSpinning(false);
      }}
      aria-label={`${alt} — spin`}
    >
      <span className={`cin-token-inner ${float}`}>
        <Image src={src} alt="" width={1024} height={1024} sizes={sizes} loading="eager" />
      </span>
    </button>
  );
}

function Token({
  progress,
  mouseX,
  mouseY,
  className,
  src,
  alt,
  float,
  depth,
  rate,
}: {
  progress: MotionValue<number>;
  mouseX: MotionValue<number>;
  mouseY: MotionValue<number>;
  className: string;
  src: string;
  alt: string;
  float: string;
  depth: number;
  rate: number;
}) {
  const x = useTransform(mouseX, (value) => value * depth);
  const mouseLift = useTransform(mouseY, (value) => value * depth * 0.6);
  const scrollLift = useTransform(progress, [0, 0.2], [0, rate]);
  const y = useTransform([mouseLift, scrollLift], ([a, b]) => (a as number) + (b as number));
  const opacity = useTransform(progress, [0.09, 0.17], [1, 0]);

  return (
    <div className={`cin-token ${className}`}>
      <motion.div style={{ x, y, opacity }}>
        <SpinButton src={src} alt={alt} float={float} sizes="220px" />
      </motion.div>
    </div>
  );
}

function HeroCopy({ animated, onEnterEngine }: { animated: boolean; onEnterEngine?: () => void }) {
  return (
    <motion.div
      variants={animated ? riseParent : undefined}
      initial={animated ? 'hidden' : false}
      animate={animated ? 'shown' : undefined}
    >
      <motion.p variants={animated ? rise : undefined} className="iso-kicker">
        Splash · Settlement network on Sui
      </motion.p>
      <motion.h1 variants={animated ? rise : undefined} className="iso-display">
        Move money.
        <span>Settle everything.</span>
      </motion.h1>
      <motion.p variants={animated ? rise : undefined} className="iso-hero-description">
        A compliance-gated B2B account network for cross-border money. Between the invoice and the
        settlement, Splash nets, yields, discounts, and escrows — with human approval on every action.
      </motion.p>
      <motion.div variants={animated ? rise : undefined} className="iso-hero-actions">
        <Link href="/signup" className="iso-button">
          Open payment desk
          <ArrowRight aria-hidden="true" />
        </Link>
        {onEnterEngine ? (
          <button type="button" className="iso-button iso-button-ghost" onClick={onEnterEngine}>
            See the network
          </button>
        ) : null}
      </motion.div>
      <motion.div variants={animated ? rise : undefined} className="iso-proof-line">
        <span><Check aria-hidden="true" /> Compliance-gated</span>
        <span><Check aria-hidden="true" /> {lockedCopy.speed}</span>
        <span><Check aria-hidden="true" /> Human-approved AI</span>
      </motion.div>
    </motion.div>
  );
}

function MetricsBand() {
  return (
    <div className="iso-marquee cin-marquee" aria-label="Platform metrics">
      <div className="iso-marquee-track">
        {[...marqueeItems, ...marqueeItems].map(([value, label], index) => (
          <div className="iso-marquee-item" key={`${value}-${index}`}>
            <strong>{value}</strong>
            <span>{label}</span>
            <i aria-hidden="true">◆</i>
          </div>
        ))}
      </div>
    </div>
  );
}

/* One melting piece of the product act. Melt is scroll-linked, so its
   speed follows the user's scroll speed; origin-top scaleY + downward
   drift + blur reads as ice softening and running down the page. */
function MeltItem({
  progress,
  index,
  className,
  children,
}: {
  progress: MotionValue<number>;
  index: number;
  className?: string;
  children: ReactNode;
}) {
  const start = 0.865 + index * 0.011;
  const end = Math.min(start + 0.115, 1);
  const y = useTransform(progress, [start, end], [0, 540]);
  const scaleY = useTransform(progress, [start, end], [1, 2.6]);
  const scaleX = useTransform(progress, [start, end], [1, 0.88]);
  const blur = useTransform(progress, [start, end], [0, 12]);
  const opacity = useTransform(progress, [start + (end - start) * 0.45, end], [1, 0]);
  const filter = useMotionTemplate`blur(${blur}px)`;
  return (
    <motion.div
      className={className}
      style={{ y, scaleY, scaleX, opacity, filter, transformOrigin: 'top center' }}
    >
      {children}
    </motion.div>
  );
}

/* Gold droplets that stretch downward while the act melts. */
function MeltDrip({
  progress,
  offset,
  left,
  height,
}: {
  progress: MotionValue<number>;
  offset: number;
  left: string;
  height: number;
}) {
  const scaleY = useTransform(progress, [0.87 + offset, 0.985], [0, 1]);
  const opacity = useTransform(progress, [0.87 + offset, 0.9 + offset, 0.99, 1], [0, 0.9, 0.9, 0]);
  return (
    <motion.span
      className="cin-melt-drip"
      style={{ left, height, scaleY, opacity, transformOrigin: 'top center' }}
      aria-hidden="true"
    />
  );
}

function VisionCopy({ progress }: { progress?: MotionValue<number> }) {
  const wrap = (index: number, node: ReactNode, className?: string) =>
    progress ? (
      <MeltItem progress={progress} index={index} className={className}>
        {node}
      </MeltItem>
    ) : (
      <div className={className}>{node}</div>
    );

  return (
    <>
      {wrap(0, (
        <Image
          src="/cinematic/brand-mark.png"
          alt=""
          width={256}
          height={256}
          className="cin-vision-mark"
          loading="eager"
        />
      ), 'cin-melt-center')}
      {wrap(1, <span className="cin-vision-chip">The product</span>, 'cin-melt-center')}
      {wrap(2, (
        <h2 className="cin-vision-title">
          Payments are the feature.
          <span>Treasury is the product.</span>
        </h2>
      ))}
      {wrap(3, (
        <p className="cin-vision-lede">
          Stripe and Airwallex move money. Splash runs everything between the invoice and the
          settlement — netting it, yielding it, discounting it, escrowing it.
        </p>
      ))}
      {wrap(4, (
        <div className="cin-vision-pillars" aria-hidden="true">
          <span>Netting</span>
          <span>Yield</span>
          <span>Discounting</span>
          <span>Escrow</span>
        </div>
      ))}
      {wrap(5, (
        <div className="cin-vision-actions">
          <Link href="/signup" className="iso-button iso-button-gold">
            Open payment desk
            <ArrowRight aria-hidden="true" />
          </Link>
          <Link href="/login" className="iso-button iso-button-ghost">
            Log in
          </Link>
        </div>
      ))}
    </>
  );
}

/** Non-pinned fallback for prefers-reduced-motion: same story, no choreography. */
function StaticCinematic() {
  return (
    <section id="cinematic" className="cin-section cin-section-static" aria-label="Splash settlement network">
      <div className="cin-static-hero">
        <div className="cin-orb cin-orb-gold" aria-hidden="true" />
        <div className="cin-orb cin-orb-mint" aria-hidden="true" />
        <div className="cin-static-stage" aria-hidden="true">
          <Image src="/cinematic/hero-district-v2.png" alt="" width={2048} height={2048} sizes="90vw" quality={90} priority />
        </div>
        <div className="iso-shell cin-copy cin-copy-static">
          <HeroCopy animated={false} />
        </div>
      </div>
      <div className="iso-shell cin-static-telemetry" aria-label="Network telemetry, simulated view">
        {tourStops.map((stop) => (
          <div className="cin-stop cin-stop-static" key={stop.id}>
            <span className="cin-stop-art" aria-hidden="true" />
            <div className="cin-stop-body">
              <CalloutBody tag={stop.tag} value={stop.value} meta={stop.meta} />
              <em>{stop.landmark}</em>
            </div>
          </div>
        ))}
      </div>
      <div className="iso-shell cin-vision cin-vision-static">
        <VisionCopy />
      </div>
      <MetricsBand />
    </section>
  );
}

export default function SettlementCinematic() {
  const containerRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  const [viewport, setViewport] = useState({ vw: 1280, vh: 800 });

  /* Section-scoped scroll progress, driven manually so it never falls back
     to page-level measurement. */
  const scrollYProgress = useMotionValue(0);

  /* Pointer parallax, normalised to -0.5..0.5 and springed for weight. */
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const mouseX = useSpring(pointerX, { stiffness: 42, damping: 15 });
  const mouseY = useSpring(pointerY, { stiffness: 42, damping: 15 });

  useEffect(() => {
    function measure() {
      setViewport({ vw: window.innerWidth, vh: window.innerHeight });
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    let top = 0;
    let range = 1;

    function update() {
      const value = (window.scrollY - top) / range;
      scrollYProgress.set(Math.min(Math.max(value, 0), 1));
    }

    function measure() {
      const rect = node!.getBoundingClientRect();
      top = rect.top + window.scrollY;
      range = Math.max(node!.offsetHeight - window.innerHeight, 1);
      update();
    }

    measure();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', measure);
    };
  }, [scrollYProgress]);

  const camera = useMemo(() => buildCamera(viewport.vw, viewport.vh), [viewport]);

  /* Act I — hero copy holds, then lifts away as the tour begins. */
  const heroOpacity = useTransform(scrollYProgress, [0, 0.06, 0.13], [1, 1, 0]);
  const heroY = useTransform(scrollYProgress, [0.05, 0.13], [0, -72]);
  const heroPointerEvents = useTransform(scrollYProgress, (value) => (value > 0.1 ? 'none' : 'auto'));
  const hintOpacity = useTransform(scrollYProgress, [0, 0.05], [1, 0]);

  /* Act II — the landmark tour. */
  const islandX = useTransform(scrollYProgress, camera.p, camera.x);
  const islandY = useTransform(scrollYProgress, camera.p, camera.y);
  const islandScale = useTransform(scrollYProgress, camera.p, camera.scale);
  const islandRotate = useTransform(scrollYProgress, camera.p, camera.rotate);
  const islandOpacity = useTransform(scrollYProgress, [0.7, 0.77], [1, 0]);

  /* Act III — screen-light burst, the product act, the melt. */
  const flashOpacity = useTransform(scrollYProgress, [0.66, 0.74, 0.8, 0.87], [0, 0.95, 0.4, 0]);
  const visionOpacity = useTransform(scrollYProgress, [0.72, 0.8], [0, 1]);
  const visionScale = useTransform(scrollYProgress, [0.72, 0.84], [0.94, 1]);
  const visionY = useTransform(scrollYProgress, [0.72, 0.82], [40, 0]);
  const visionPointerEvents = useTransform(scrollYProgress, (value) =>
    value > 0.74 && value < 0.87 ? 'auto' : 'none',
  );

  const bandOpacity = useTransform(scrollYProgress, [0.73, 0.79], [0, 1]);
  const bandY = useTransform(scrollYProgress, [0.73, 0.8, 0.9, 1], [46, 0, 0, 420]);
  const bandScaleY = useTransform(scrollYProgress, [0.9, 1], [1, 2.2]);
  const bandBlur = useTransform(scrollYProgress, [0.9, 1], [0, 10]);
  const bandFilter = useMotionTemplate`blur(${bandBlur}px)`;
  const bandMeltOpacity = useTransform(scrollYProgress, [0.94, 1], [1, 0]);
  const bandFinalOpacity = useTransform([bandOpacity, bandMeltOpacity], ([a, b]) => (a as number) * (b as number));

  if (reducedMotion) {
    return <StaticCinematic />;
  }

  function enterEngine() {
    const node = containerRef.current;
    if (!node) return;
    window.scrollTo({ top: node.offsetTop + node.offsetHeight * 0.2, behavior: 'smooth' });
  }

  function trackPointer(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse') return;
    pointerX.set(event.clientX / window.innerWidth - 0.5);
    pointerY.set(event.clientY / window.innerHeight - 0.5);
  }

  return (
    <section id="cinematic" ref={containerRef} className="cin-section" aria-label="Splash settlement network">
      <div className="cin-sticky" onPointerMove={trackPointer}>
        <div className="cin-orb cin-orb-gold" aria-hidden="true" />
        <div className="cin-orb cin-orb-mint" aria-hidden="true" />

        {/* The landmark island under the swinging camera. */}
        <motion.div
          className="cin-scene-layer"
          style={{
            x: islandX,
            y: islandY,
            scale: islandScale,
            rotate: islandRotate,
            opacity: islandOpacity,
          }}
        >
          <div className="cin-island">
            <Image
              src="/cinematic/hero-district-v2.png"
              alt="Floating island carrying the Petronas Towers, Marina Bay Sands, Monas, and Wat Arun around a gold coin ring"
              width={2048}
              height={2048}
              sizes="(max-width: 880px) 160vw, 100vh"
              quality={90}
              priority
            />
          </div>
        </motion.div>

        {/* Floating currency tokens with mouse + scroll parallax. */}
        <div className="cin-tokens">
          {tokens.map((token) => (
            <Token
              key={token.className}
              progress={scrollYProgress}
              mouseX={mouseX}
              mouseY={mouseY}
              {...token}
            />
          ))}
        </div>

        <div className="cin-vignette" aria-hidden="true" />

        {/* The four tour stops with their telemetry plaques. */}
        {tourStops.map((stop) => (
          <StopCallout key={stop.id} progress={scrollYProgress} islandRotate={islandRotate} stop={stop} />
        ))}

        {/* Act I — hero copy. */}
        <motion.div
          className="cin-copy-layer"
          style={{ opacity: heroOpacity, y: heroY, pointerEvents: heroPointerEvents }}
        >
          <div className="iso-shell cin-copy">
            <HeroCopy animated onEnterEngine={enterEngine} />
          </div>
        </motion.div>

        {/* Screen-light burst + the product act. */}
        <motion.div className="cin-flash" style={{ opacity: flashOpacity }} aria-hidden="true" />
        <motion.div
          className="cin-vision"
          style={{ opacity: visionOpacity, scale: visionScale, y: visionY, pointerEvents: visionPointerEvents }}
        >
          <VisionCopy progress={scrollYProgress} />
        </motion.div>

        {/* Melt drips running down toward the partners rail. */}
        <div className="cin-melt-drips" aria-hidden="true">
          <MeltDrip progress={scrollYProgress} offset={0} left="18%" height={150} />
          <MeltDrip progress={scrollYProgress} offset={0.012} left="37%" height={230} />
          <MeltDrip progress={scrollYProgress} offset={0.004} left="52%" height={180} />
          <MeltDrip progress={scrollYProgress} offset={0.018} left="66%" height={250} />
          <MeltDrip progress={scrollYProgress} offset={0.008} left="82%" height={140} />
        </div>

        {/* Metrics band docked at the foot of the product act. */}
        <motion.div
          className="cin-band"
          style={{ opacity: bandFinalOpacity, y: bandY, scaleY: bandScaleY, filter: bandFilter, transformOrigin: 'top center' }}
        >
          <MetricsBand />
        </motion.div>

        <motion.div className="cin-hint" style={{ opacity: hintOpacity }} aria-hidden="true">
          <span className="cin-hint-wheel" />
          Scroll to settle
        </motion.div>
      </div>
    </section>
  );
}
