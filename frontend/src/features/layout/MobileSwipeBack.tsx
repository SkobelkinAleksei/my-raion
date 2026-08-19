import React, { useEffect, useRef, useState } from 'react';
import {
  MOBILE_SWIPE_BACK_EDGE,
  hasAppBackHandler,
  isCompactViewport,
  performAppBack,
  swipeBackOriginX,
} from '@/shared/utils/navigation';
import { getViewingChat } from '@/shared/lib/viewingChat';

const COMMIT_PX = 72;

export default function MobileSwipeBack() {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const trackingRef = useRef(false);
  const pullRef = useRef(0);
  const [pull, setPull] = useState(0);

  useEffect(() => {
    const reset = () => {
      startRef.current = null;
      trackingRef.current = false;
      pullRef.current = 0;
      setPull(0);
    };

    const edgeLimit = () => {
      const origin = swipeBackOriginX();
      const chatOpen = Boolean(getViewingChat());
      if (chatOpen) return origin + Math.min(window.innerWidth * 0.4, 180);
      if (hasAppBackHandler()) return origin + 80;
      return origin + MOBILE_SWIPE_BACK_EDGE;
    };

    const onStart = (e: TouchEvent) => {
      if (!isCompactViewport() || e.touches.length !== 1) return;
      if ((e.target as Element | null)?.closest?.('[data-district-map], .leaflet-container, [data-photo-swipe]')) return;
      const touch = e.touches[0];
      const origin = swipeBackOriginX();
      if (touch.clientX < origin || touch.clientX > edgeLimit()) return;
      startRef.current = { x: touch.clientX, y: touch.clientY };
      trackingRef.current = false;
      pullRef.current = 0;
    };

    const onMove = (e: TouchEvent) => {
      const start = startRef.current;
      if (!start || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (!trackingRef.current) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (dx < 8 || Math.abs(dy) >= Math.abs(dx)) {
          startRef.current = null;
          return;
        }
        trackingRef.current = true;
      }
      if (!trackingRef.current) return;
      if (e.cancelable) e.preventDefault();
      const next = Math.max(0, Math.min(140, dx));
      pullRef.current = next;
      setPull(next);
    };

    const onEnd = () => {
      const committed = trackingRef.current && pullRef.current >= COMMIT_PX;
      reset();
      if (committed) performAppBack();
    };

    window.addEventListener('touchstart', onStart, { capture: true, passive: false });
    window.addEventListener('touchmove', onMove, { capture: true, passive: false });
    window.addEventListener('touchend', onEnd, { capture: true });
    window.addEventListener('touchcancel', onEnd, { capture: true });
    return () => {
      window.removeEventListener('touchstart', onStart, true);
      window.removeEventListener('touchmove', onMove, true);
      window.removeEventListener('touchend', onEnd, true);
      window.removeEventListener('touchcancel', onEnd, true);
    };
  }, []);

  if (pull <= 0) return null;

  return (
    <div
      className="lg:hidden pointer-events-none fixed z-[95] top-1/2 -translate-y-1/2"
      style={{ left: swipeBackOriginX() + 6 + pull * 0.35 }}
      aria-hidden
    >
      <div
        className="w-1.5 rounded-full bg-[#5C4B7A]/55 shadow-sm"
        style={{ height: 48 + Math.min(pull, 40) }}
      />
    </div>
  );
}
