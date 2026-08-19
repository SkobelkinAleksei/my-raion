import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Image as ImageIcon, Plus } from 'lucide-react';
import { ChatMediaLightbox } from '@/features/chat/ChatPhotoGrid';
import {
  deleteGalleryPhoto,
  fetchPhotos,
  GalleryPhoto,
  resolvePhotoUrl,
} from '@/shared/utils/photoGallery';
import { showAppInfoToast } from '@/shared/utils/appToast';

export default function ProfilePhotosPreview({
  userId,
  total,
  urls,
  owner,
  emptyHint,
  onOpenAll,
  onChanged,
}: {
  userId: number;
  total: number;
  urls: string[];
  owner?: boolean;
  emptyHint?: string;
  onOpenAll: () => void;
  onChanged?: () => void;
}) {
  const [viewer, setViewer] = useState<{ items: GalleryPhoto[]; index: number } | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const canScroll = urls.length > 4 || total > 4;
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(canScroll);

  const syncArrows = () => {
    const el = scrollerRef.current;
    if (!canScroll) {
      setCanLeft(false);
      setCanRight(false);
      return;
    }
    if (!el || el.clientWidth < 2) {
      setCanLeft(false);
      setCanRight(true);
      return;
    }
    setCanLeft(el.scrollLeft > 2);
    const measuredMore = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    const layoutNotReady = el.scrollWidth <= el.clientWidth + 2;
    setCanRight(measuredMore || (layoutNotReady && el.scrollLeft <= 2));
  };

  useEffect(() => {
    syncArrows();
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => syncArrows();
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', syncArrows);
    const ro = new ResizeObserver(() => syncArrows());
    ro.observe(el);
    const imgs = Array.from(el.querySelectorAll('img'));
    imgs.forEach((img) => {
      if (!img.complete) img.addEventListener('load', syncArrows);
    });
    const raf = window.requestAnimationFrame(() => {
      syncArrows();
      window.requestAnimationFrame(syncArrows);
    });
    return () => {
      window.cancelAnimationFrame(raf);
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', syncArrows);
      ro.disconnect();
      imgs.forEach((img) => img.removeEventListener('load', syncArrows));
    };
  }, [urls, total, canScroll]);

  const scrollByCard = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const card = el.querySelector('[data-photo-card]') as HTMLElement | null;
    const step = (card?.offsetWidth || 80) + 8;
    el.scrollBy({ left: dir * step, behavior: 'smooth' });
  };

  const openAt = async (index: number) => {
    try {
      const data = await fetchPhotos(userId, { page: 0, size: 40 });
      const items = data.items || [];
      if (!items.length) {
        onOpenAll();
        return;
      }
      setViewer({ items, index: Math.min(index, items.length - 1) });
    } catch {
      onOpenAll();
    }
  };

  if (urls.length === 0) {
    return (
      <button
        type="button"
        onClick={onOpenAll}
        className="w-full bg-[#FFFCFA] rounded-2xl lg:rounded-[32px] text-left hover:shadow-md transition group px-4 py-3"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-full bg-[#EDE6F5] flex items-center justify-center shrink-0">
              <Plus className="w-4 h-4 text-[#5C4B7A]" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#5C4B7A]">Фотографии</div>
              {emptyHint ? <div className="text-xs text-[#8A8494]">{emptyHint}</div> : null}
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-[#8A8494] shrink-0 group-hover:translate-x-0.5 transition" />
        </div>
      </button>
    );
  }

  return (
    <>
      <div className="w-full bg-[#FFFCFA] rounded-2xl lg:rounded-[32px] p-3 md:p-4 lg:p-5 hover:shadow-md transition">
        <button type="button" onClick={onOpenAll} className="w-full flex items-center justify-between mb-3 text-left group">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-[#5C4B7A]" />
            <span className="text-sm font-semibold text-[#5C4B7A]">Фотографии</span>
            <span className="text-xs text-[#8A8494] tabular-nums">{total}</span>
          </div>
          <ChevronRight className="w-4 h-4 text-[#8A8494] group-hover:translate-x-0.5 transition" />
        </button>
        <div data-photo-swipe className="relative">
          <div
            ref={scrollerRef}
            className="flex gap-2 h-20 md:h-24 lg:h-36 overflow-x-auto overflow-y-hidden snap-x snap-mandatory touch-pan-x overscroll-x-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          >
            {urls.map((url, i) => (
              <button
                key={`${url}-${i}`}
                type="button"
                data-photo-card
                onClick={() => void openAt(i)}
                className={`snap-start h-full rounded-2xl overflow-hidden bg-[#EDE6F5] ${
                  urls.length > 4 ? 'shrink-0 w-[calc((100%-1.5rem)/4)]' : 'flex-1 min-w-0'
                }`}
              >
                <img src={url} alt="" draggable={false} className="w-full h-full object-cover select-none pointer-events-none" />
              </button>
            ))}
          </div>
          {canLeft && (
            <button
              type="button"
              onClick={() => scrollByCard(-1)}
              className="hidden md:flex absolute left-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 border border-[#1A1916]/10 text-[#1A1916] items-center justify-center hover:bg-white shadow-sm z-10"
              aria-label="Предыдущие фото"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          {canRight && (
            <button
              type="button"
              onClick={() => scrollByCard(1)}
              className="hidden md:flex absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 border border-[#1A1916]/10 text-[#1A1916] items-center justify-center hover:bg-white shadow-sm z-10"
              aria-label="Следующие фото"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      {viewer && (
        <ChatMediaLightbox
          urls={viewer.items.map((photo) => resolvePhotoUrl(photo.url))}
          index={viewer.index}
          onClose={() => setViewer(null)}
          onIndexChange={(index) => setViewer((prev) => (prev ? { ...prev, index } : prev))}
          meta={viewer.items.map((photo) => ({ timestamp: photo.createdAt }))}
          likeSpec={{
            allowLike: true,
            allowSave: true,
            allowComment: true,
            kind: 'GALLERY',
            ownerId: userId,
            photoIds: viewer.items.map((photo) => photo.id),
          }}
          onDelete={owner ? async (index) => {
            const photo = viewer.items[index];
            if (!photo) return;
            try {
              await deleteGalleryPhoto(photo.id);
              const next = viewer.items.filter((item) => item.id !== photo.id);
              onChanged?.();
              if (!next.length) setViewer(null);
              else setViewer({ items: next, index: Math.min(index, next.length - 1) });
            } catch (error: any) {
              showAppInfoToast('Фото', error?.response?.data?.detail || 'Не удалось удалить');
            }
          } : undefined}
        />
      )}
    </>
  );
}
