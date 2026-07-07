import Image from 'next/image';

/* Inside the bright window: the boy at his desk, back to camera, facing
   the monitor. Rendered centred "cover"; the camera pushes into the
   monitor screen. Geometry measured on the artwork's 1376x768 basis. */

export const ROOM_VIEW = { width: 1376, height: 768, targetX: 689, targetY: 272 };

export default function RoomScene() {
  return (
    <div className="cin-room" aria-hidden="true">
      <Image
        src="/cinematic/hero-room.png"
        alt=""
        width={2752}
        height={1541}
        sizes="100vw"
        quality={90}
        loading="eager"
      />
    </div>
  );
}
