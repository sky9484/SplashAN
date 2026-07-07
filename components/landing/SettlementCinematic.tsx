'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
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

import CityScene, { CITY_VIEW } from '@/components/landing/CityScene';
import RoomScene, { ROOM_VIEW } from '@/components/landing/RoomScene';
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

/* ── Acts on the scroll track ─────────────────────────────────────────
   0.00-0.12  city + hero copy
   0.10-0.34  camera dives toward the bright window (telemetry pops)
   0.32-0.40  crossfade into the room
   0.40-0.60  camera pushes into the monitor screen
   0.56-0.68  the screen fills the rectangular frame — light burst
   0.66-0.86  the product act (with the metrics band docked at its foot)
   0.86-1.00  everything melts down into Infrastructure & Partners      */

const telemetry = [
  {
    id: 'corridor',
    className: 'cin-callout-a',
    enter: 0.13,
    exit: 0.3,
    tag: 'Corridor · Testnet',
    value: 'USD → PHP',
    meta: lockedCopy.speed,
    badge: '/cinematic/token-php.png',
    badgeAlt: 'Philippine peso token',
  },
  {
    id: 'fee',
    className: 'cin-callout-b',
    enter: 0.16,
    exit: 0.3,
    tag: 'Edge fee · Modeled',
    value: lockedCopy.fee,
    meta: lockedCopy.feeFootnote,
  },
  {
    id: 'treasury',
    className: 'cin-callout-c',
    enter: 0.42,
    exit: 0.56,
    tag: 'Treasury · Approval-gated',
    value: 'USDY posture',
    meta: lockedCopy.yield,
  },
  {
    id: 'agent',
    className: 'cin-callout-d',
    enter: 0.45,
    exit: 0.56,
    tag: 'Agent · Human-final',
    value: '0xWal desk',
    meta: lockedCopy.agent,
    badge: '/cinematic/agent-bot.png',
    badgeAlt: '0xWal assistant robot',
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

function Callout({
  progress,
  enter,
  exit,
  className,
  children,
}: {
  progress: MotionValue<number>;
  enter: number;
  exit: number;
  className: string;
  children: ReactNode;
}) {
  const opacity = useTransform(progress, [enter, enter + 0.04, exit, exit + 0.05], [0, 1, 1, 0]);
  const y = useTransform(progress, [enter, enter + 0.06], [22, 0]);
  return (
    <motion.div className={`cin-callout ${className}`} style={{ opacity, y }}>
      {children}
    </motion.div>
  );
}

function CalloutBody({
  tag,
  value,
  meta,
  badge,
  badgeAlt,
}: {
  tag: string;
  value: string;
  meta: string;
  badge?: string;
  badgeAlt?: string;
}) {
  return (
    <>
      {badge ? (
        <span className="cin-callout-badge">
          <Image src={badge} alt={badgeAlt ?? ''} width={1024} height={1024} sizes="72px" loading="eager" />
        </span>
      ) : null}
      <i>{tag}</i>
      <strong>{value}</strong>
      <small>{meta}</small>
    </>
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
  const scrollLift = useTransform(progress, [0, 0.3], [0, rate]);
  const y = useTransform([mouseLift, scrollLift], ([a, b]) => (a as number) + (b as number));
  const opacity = useTransform(progress, [0.18, 0.3], [1, 0]);

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
          <CityScene />
        </div>
        <div className="iso-shell cin-copy cin-copy-static">
          <HeroCopy animated={false} />
        </div>
      </div>
      <div className="iso-shell cin-static-telemetry" aria-label="Network telemetry, simulated view">
        {telemetry.map((item) => (
          <div className="cin-callout cin-callout-static" key={item.id}>
            <CalloutBody tag={item.tag} value={item.value} meta={item.meta} badge={item.badge} badgeAlt={item.badgeAlt} />
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

/* The city artwork renders bottom-anchored "contain" (cream sky above);
   the room renders centred "cover". Either way the bright window / the
   monitor screen lands at a viewport position that depends on aspect
   ratio, so the camera's transform-origin is measured at runtime. */
function containBottomTarget(view: typeof CITY_VIEW, vw: number, vh: number) {
  const s = Math.min(vw / view.width, vh / view.height);
  const x = (((vw - view.width * s) / 2 + view.targetX * s) / vw) * 100;
  const y = ((vh - view.height * s + view.targetY * s) / vh) * 100;
  return { x, y };
}

function coverTarget(view: typeof ROOM_VIEW, vw: number, vh: number) {
  const s = Math.max(vw / view.width, vh / view.height);
  const x = (((vw - view.width * s) / 2 + view.targetX * s) / vw) * 100;
  const y = (((vh - view.height * s) / 2 + view.targetY * s) / vh) * 100;
  return { x, y };
}

export default function SettlementCinematic() {
  const containerRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  const [origins, setOrigins] = useState({ city: { x: 58, y: 55 }, room: { x: 50, y: 40 } });

  useEffect(() => {
    function measureOrigins() {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setOrigins({ city: containBottomTarget(CITY_VIEW, vw, vh), room: coverTarget(ROOM_VIEW, vw, vh) });
    }
    measureOrigins();
    window.addEventListener('resize', measureOrigins);
    return () => window.removeEventListener('resize', measureOrigins);
  }, []);

  /* Section-scoped scroll progress, driven manually so it never falls back
     to page-level measurement. */
  const scrollYProgress = useMotionValue(0);

  /* Pointer parallax, normalised to -0.5..0.5 and springed for weight. */
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const mouseX = useSpring(pointerX, { stiffness: 42, damping: 15 });
  const mouseY = useSpring(pointerY, { stiffness: 42, damping: 15 });

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

  /* Act I — hero copy holds, then lifts away as the dive begins. */
  const heroOpacity = useTransform(scrollYProgress, [0, 0.07, 0.15], [1, 1, 0]);
  const heroY = useTransform(scrollYProgress, [0.06, 0.15], [0, -72]);
  const heroPointerEvents = useTransform(scrollYProgress, (value) => (value > 0.12 ? 'none' : 'auto'));
  const hintOpacity = useTransform(scrollYProgress, [0, 0.05], [1, 0]);

  /* The city: hold, then dive into the bright window. The target point
     stays pinned by transform-origin, so a translate ramp glides it to
     the viewport centre as the camera closes in. */
  const cityScale = useTransform(scrollYProgress, [0, 0.1, 0.36], [1, 1.04, 7.4]);
  const cityOpacity = useTransform(scrollYProgress, [0.3, 0.37], [1, 0]);
  const cityX = useTransform(scrollYProgress, [0.12, 0.34], ['0%', `${(50 - origins.city.x).toFixed(2)}%`]);
  const cityY = useTransform(scrollYProgress, [0.12, 0.34], ['0%', `${(50 - origins.city.y).toFixed(2)}%`]);

  /* The room: arrive through the window, then push in until the monitor
     screen fills the rectangular frame. */
  const roomScale = useTransform(scrollYProgress, [0.31, 0.4, 0.62], [0.82, 1, 2.15]);
  const roomOpacity = useTransform(scrollYProgress, [0.31, 0.38, 0.56, 0.63], [0, 1, 1, 0]);
  const roomX = useTransform(scrollYProgress, [0.4, 0.58], ['0%', `${(50 - origins.room.x).toFixed(2)}%`]);
  const roomY = useTransform(scrollYProgress, [0.4, 0.58], ['0%', `${(50 - origins.room.y).toFixed(2)}%`]);

  /* The rectangular frame the screen settles into. */
  const frameOpacity = useTransform(scrollYProgress, [0.44, 0.5, 0.62, 0.68], [0, 1, 1, 0]);
  const frameScale = useTransform(scrollYProgress, [0.44, 0.62], [1.1, 1]);

  /* Screen-light burst as the monitor fills the viewport. */
  const flashOpacity = useTransform(scrollYProgress, [0.56, 0.64, 0.72, 0.8], [0, 0.95, 0.4, 0]);

  /* The product act. */
  const visionOpacity = useTransform(scrollYProgress, [0.64, 0.72], [0, 1]);
  const visionScale = useTransform(scrollYProgress, [0.64, 0.76], [0.94, 1]);
  const visionY = useTransform(scrollYProgress, [0.64, 0.74], [40, 0]);
  const visionPointerEvents = useTransform(scrollYProgress, (value) =>
    value > 0.66 && value < 0.87 ? 'auto' : 'none',
  );

  /* The metrics band docks at the foot of the act and melts with it. */
  const bandOpacity = useTransform(scrollYProgress, [0.66, 0.72], [0, 1]);
  const bandY = useTransform(scrollYProgress, [0.66, 0.74, 0.9, 1], [46, 0, 0, 420]);
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
    window.scrollTo({ top: node.offsetTop + node.offsetHeight * 0.7, behavior: 'smooth' });
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

        {/* The city, diving toward one bright window. */}
        <motion.div
          className="cin-scene-layer"
          style={{
            scale: cityScale,
            opacity: cityOpacity,
            x: cityX,
            y: cityY,
            transformOrigin: `${origins.city.x}% ${origins.city.y}%`,
          }}
        >
          <CityScene />
          <span
            className="cin-city-beacon"
            style={{ left: `${origins.city.x}%`, top: `${origins.city.y}%` }}
            aria-hidden="true"
          />
        </motion.div>

        {/* Inside the window: the boy at his desk. */}
        <motion.div
          className="cin-scene-layer"
          style={{
            scale: roomScale,
            opacity: roomOpacity,
            x: roomX,
            y: roomY,
            transformOrigin: `${origins.room.x}% ${origins.room.y}%`,
          }}
        >
          <RoomScene />
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

        {/* The rectangular frame the monitor screen settles into. */}
        <motion.div
          className="cin-scan"
          style={{ opacity: frameOpacity, scale: frameScale }}
          aria-hidden="true"
        >
          <span className="cin-scan-corner is-tl" /><span className="cin-scan-corner is-tr" />
          <span className="cin-scan-corner is-bl" /><span className="cin-scan-corner is-br" />
        </motion.div>

        {telemetry.map((item) => (
          <Callout
            key={item.id}
            progress={scrollYProgress}
            enter={item.enter}
            exit={item.exit}
            className={item.className}
          >
            <CalloutBody tag={item.tag} value={item.value} meta={item.meta} badge={item.badge} badgeAlt={item.badgeAlt} />
          </Callout>
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
