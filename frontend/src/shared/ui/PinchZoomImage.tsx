import React, { useEffect, useRef, useState } from 'react';

function distance(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * Pinch-zoom on the image while two fingers are down.
 * When fingers lift, the photo springs back to the original size.
 */
export default function PinchZoomImage({
  src,
  className,
  alt = '',
}: {
  src: string;
  className?: string;
  alt?: string;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const pinching = useRef(false);
  const startDist = useRef(1);
  const origin = useRef('50% 50%');
  const [style, setStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    const setOriginFromTouches = (a: Touch, b: Touch) => {
      const rect = img.getBoundingClientRect();
      const midX = (a.clientX + b.clientX) / 2;
      const midY = (a.clientY + b.clientY) / 2;
      const ox = ((midX - rect.left) / Math.max(rect.width, 1)) * 100;
      const oy = ((midY - rect.top) / Math.max(rect.height, 1)) * 100;
      origin.current = `${Math.min(100, Math.max(0, ox))}% ${Math.min(100, Math.max(0, oy))}%`;
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length < 2) return;
      e.preventDefault();
      pinching.current = true;
      img.dispatchEvent(new CustomEvent('pinchzoom', { bubbles: true, detail: { active: true } }));
      const a = e.touches[0];
      const b = e.touches[1];
      startDist.current = Math.max(distance(a, b), 1);
      setOriginFromTouches(a, b);
      setStyle({
        transform: 'scale(1)',
        transformOrigin: origin.current,
        transition: 'none',
        willChange: 'transform',
      });
    };

    const onMove = (e: TouchEvent) => {
      if (!pinching.current || e.touches.length < 2) return;
      e.preventDefault();
      const a = e.touches[0];
      const b = e.touches[1];
      const scale = Math.min(4, Math.max(1, distance(a, b) / startDist.current));
      setStyle({
        transform: `scale(${scale})`,
        transformOrigin: origin.current,
        transition: 'none',
        willChange: 'transform',
      });
    };

    const release = () => {
      if (!pinching.current) return;
      pinching.current = false;
      img.dispatchEvent(new CustomEvent('pinchzoom', { bubbles: true, detail: { active: false } }));
      setStyle({
        transform: 'scale(1)',
        transformOrigin: origin.current,
        transition: 'transform 220ms ease',
      });
    };

    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) release();
    };

    img.addEventListener('touchstart', onStart, { passive: false });
    img.addEventListener('touchmove', onMove, { passive: false });
    img.addEventListener('touchend', onEnd);
    img.addEventListener('touchcancel', onEnd);
    return () => {
      img.removeEventListener('touchstart', onStart);
      img.removeEventListener('touchmove', onMove);
      img.removeEventListener('touchend', onEnd);
      img.removeEventListener('touchcancel', onEnd);
    };
  }, [src]);

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      className={`touch-none ${className || ''}`}
      style={style}
      draggable={false}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
