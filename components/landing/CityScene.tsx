import Image from 'next/image';

/* The establishing shot: a city of familiar towers with ONE window lit
   brighter than the rest. Rendered bottom-anchored "contain", so the
   camera math in SettlementCinematic can aim at the bright window.
   Geometry is measured on the artwork's 1376x768 basis. */

export const CITY_VIEW = { width: 1376, height: 768, targetX: 802, targetY: 374 };

export default function CityScene() {
  return (
    <div className="cin-city" aria-hidden="true">
      <Image
        src="/cinematic/hero-city.png"
        alt=""
        width={2752}
        height={1541}
        sizes="100vw"
        quality={90}
        priority
      />
    </div>
  );
}
