import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Image as ImageIcon, MessageSquare, Mic, X } from 'lucide-react';
import api from '@/shared/lib/api';
import { runWithTimeoutRetry } from '@/shared/lib/loadWithTimeoutRetry';
import SegmentedRingLoader, { ParticipantsLoadRetry } from '@/shared/ui/SegmentedRingLoader';
import { resolveChatMediaUrl } from '@/features/chat/chatPhotos';
import { ChatMediaLightbox } from '@/features/chat/ChatPhotoGrid';
import ChatVoiceBubble from '@/features/chat/ChatVoiceBubble';
import { formatFileSize } from '@/features/chat/ChatFileBubble';

export type ChatPhotoSource =
  | { type: 'personal'; partnerId: string | number }
  | { type: 'group'; chatId: string | number };

type MediaTab = 'photos' | 'files' | 'voices';

type PhotoItem = {
  messageId: number;
  url: string;
  timestamp: string;
  name?: string;
  size?: number;
  mimeType?: string;
  duration?: number;
  senderId?: number;
  senderFirstName?: string;
  senderLastName?: string;
};

const PAGE_SIZE = 24;

function monthLabel(iso?: string): string {
  if (!iso) return 'Без даты';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Без даты';
  const raw = date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function senderFullName(item: PhotoItem): string {
  const name = `${item.senderFirstName || ''} ${item.senderLastName || ''}`.trim();
  if (name) return name;
  return item.senderId ? `Пользователь #${item.senderId}` : 'Участник';
}

function mapItems(raw: PhotoItem[] | undefined): PhotoItem[] {
  return (raw || [])
    .map((item) => ({ ...item, url: resolveChatMediaUrl(item.url) }))
    .filter((item) => item.url);
}

function GoToMessageButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 w-8 h-8 rounded-lg bg-[#EDE6F5] text-[#5C4B7A] flex items-center justify-center hover:bg-[#DDD4F0]"
      title="Перейти к сообщению"
    >
      <MessageSquare className="w-3.5 h-3.5" />
    </button>
  );
}

export default function ChatMaterialsGallery({
  open,
  onClose,
  source,
  onGoToMessage,
}: {
  open: boolean;
  onClose: () => void;
  source: ChatPhotoSource;
  onGoToMessage?: (messageId: number) => void;
}) {
  const [tab, setTab] = useState<MediaTab>('photos');
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const loadingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const localAllRef = useRef<PhotoItem[] | null>(null);
  const sourceType = source.type;
  const sourceId = source.type === 'personal' ? source.partnerId : source.chatId;

  const pathFor = (kind: MediaTab) => {
    const suffix = kind === 'photos' ? 'photos' : kind === 'files' ? 'files' : 'voices';
    return sourceType === 'personal'
      ? `/api/v1/social/chats/history/${sourceId}/${suffix}`
      : `/api/v1/social/chats/room/${sourceId}/${suffix}`;
  };

  const applySlice = (all: PhotoItem[], nextPage: number, replace: boolean) => {
    const from = nextPage * PAGE_SIZE;
    const slice = all.slice(from, from + PAGE_SIZE);
    setItems((prev) => replace ? slice : [...prev, ...slice]);
    setPage(nextPage);
    setHasMore(from + slice.length < all.length);
    setTotal(all.length);
  };

  const loadPage = useCallback(async (nextPage: number, replace: boolean, kind: MediaTab) => {
    if (!replace && loadingRef.current) return;
    if (replace) localAllRef.current = null;
    if (localAllRef.current) {
      applySlice(localAllRef.current, nextPage, replace);
      return;
    }
    let ac: AbortController | null = null;
    if (replace) {
      abortRef.current?.abort();
      ac = new AbortController();
      abortRef.current = ac;
    }
    loadingRef.current = true;
    if (replace) {
      setLoading(true);
      setLoadFailed(false);
    } else setLoadingMore(true);
    const applyResponse = (data: any) => {
      if (Array.isArray(data) || (data?.items && data.items.length > PAGE_SIZE)) {
        const all = mapItems(Array.isArray(data) ? data : data.items);
        localAllRef.current = all;
        applySlice(all, nextPage, replace);
        return;
      }
      const mapped = mapItems(data?.items);
      setItems((prev) => {
        const next = replace ? mapped : [...prev, ...mapped];
        const knownTotal = typeof data?.total === 'number' ? data.total : next.length;
        setHasMore(Boolean(data?.hasMore) || next.length < knownTotal);
        setTotal(knownTotal);
        return next;
      });
      setPage(typeof data?.page === 'number' ? data.page : nextPage);
    };
    try {
      if (replace && ac) {
        await runWithTimeoutRetry(async (signal) => {
          const res = await api.get(pathFor(kind), { params: { page: nextPage, size: PAGE_SIZE }, signal });
          if (signal.aborted || abortRef.current !== ac) return;
          applyResponse(res.data);
        }, ac.signal);
      } else {
        const res = await api.get(pathFor(kind), { params: { page: nextPage, size: PAGE_SIZE } });
        applyResponse(res.data);
      }
    } catch (err) {
      if (replace && ac && (ac.signal.aborted || abortRef.current !== ac)) return;
      console.error('Не удалось загрузить материалы чата:', err);
      if (replace) setLoadFailed(true);
    } finally {
      loadingRef.current = false;
      if (!replace || abortRef.current === ac) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [sourceType, sourceId]);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      loadingRef.current = false;
      localAllRef.current = null;
      setItems([]);
      setPage(0);
      setHasMore(false);
      setTotal(0);
      setLightboxIndex(null);
      setTab('photos');
      setLoadFailed(false);
      setLoading(false);
      return;
    }
    localAllRef.current = null;
    setItems([]);
    setPage(0);
    setLightboxIndex(null);
    loadPage(0, true, tab);
  }, [open, tab, sourceType, sourceId, loadPage]);

  const groups = useMemo(() => {
    const map = new Map<string, PhotoItem[]>();
    items.forEach((item) => {
      const key = monthLabel(item.timestamp);
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    });
    return Array.from(map.entries());
  }, [items]);

  const urls = items.map((item) => item.url);
  const tabs: { id: MediaTab; label: string; icon: React.ReactNode }[] = [
    { id: 'voices', label: 'Голосовые', icon: <Mic className="w-3.5 h-3.5" /> },
    { id: 'photos', label: 'Фотографии', icon: <ImageIcon className="w-3.5 h-3.5" /> },
    { id: 'files', label: 'Файлы', icon: <FileText className="w-3.5 h-3.5" /> },
  ];

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-[#1A1916]/45 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[71] flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-3xl max-h-[88vh] bg-[#FAF6F0] rounded-[28px] shadow-2xl overflow-hidden flex flex-col border border-[#1A1916]/10">
          <div className="p-5 border-b border-[#1A1916]/10">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="myraion-display text-[24px] text-[#1A1916] leading-tight">Материалы чата</h3>
                <p className="text-[13px] text-[#6B645C] mt-1">
                  {loading ? '…' : total > 0
                    ? (items.length < total ? `Показано ${items.length} из ${total}` : `${total}`)
                    : loadFailed ? '' : 'Пока пусто'}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-9 h-9 rounded-full bg-white hover:bg-[#F2EBE3] text-[#1A1916] border border-[#1A1916]/10 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-4 flex gap-1 p-1 rounded-2xl bg-white border border-[#1A1916]/10">
              {tabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-semibold transition ${
                    tab === item.id ? 'bg-[#EDE6F5] text-[#5C4B7A]' : 'text-[#6B645C] hover:bg-[#FAF6F0]'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {loading && items.length === 0 ? (
              <SegmentedRingLoader />
            ) : loadFailed && items.length === 0 ? (
              <ParticipantsLoadRetry onRetry={() => { void loadPage(0, true, tab); }} />
            ) : items.length === 0 ? (
              <p className="text-sm text-[#6B645C] text-center py-10">
                {tab === 'photos' ? 'В этом чате ещё нет фото' : tab === 'files' ? 'В этом чате ещё нет файлов' : 'В этом чате ещё нет голосовых'}
              </p>
            ) : tab === 'photos' ? (
              groups.map(([label, photos]) => (
                <section key={label}>
                  <div className="flex items-center gap-3 mb-3">
                    <h4 className="text-[12px] uppercase tracking-[0.16em] text-[#5C4B7A] shrink-0">{label}</h4>
                    <div className="h-px flex-1 bg-[#1A1916]/10" />
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                    {photos.map((photo) => {
                      const globalIndex = items.findIndex((item) => item.url === photo.url && item.messageId === photo.messageId);
                      return (
                        <button
                          key={`${photo.messageId}-${photo.url}`}
                          type="button"
                          onClick={() => setLightboxIndex(globalIndex < 0 ? 0 : globalIndex)}
                          className="aspect-square overflow-hidden rounded-xl bg-[#EDE6F5] cursor-zoom-in"
                        >
                          <img src={photo.url} alt="" className="w-full h-full object-cover" />
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))
            ) : (
              groups.map(([label, list]) => (
                <section key={label} className="space-y-1.5">
                  <div className="flex items-center gap-3 mb-2">
                    <h4 className="text-[12px] uppercase tracking-[0.16em] text-[#5C4B7A] shrink-0">{label}</h4>
                    <div className="h-px flex-1 bg-[#1A1916]/10" />
                  </div>
                  {list.map((item) => (
                    <div key={`${item.messageId}-${item.url}`} className="bg-white border border-[#1A1916]/10 rounded-xl px-2.5 py-1.5 flex items-center gap-2.5">
                      {tab === 'voices' ? (
                        <ChatVoiceBubble url={item.url} duration={item.duration} compact />
                      ) : (
                        <a
                          href={resolveChatMediaUrl(item.url)}
                          download={item.name || true}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2.5 min-w-0 flex-1"
                        >
                          <div className="w-8 h-8 rounded-lg bg-[#EDE6F5] text-[#5C4B7A] flex items-center justify-center shrink-0">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-semibold text-[#1A1916] truncate">{item.name || 'Файл'}</div>
                          </div>
                          <span className="text-[11px] text-[#6B645C] shrink-0">{formatFileSize(item.size)}</span>
                        </a>
                      )}
                      <span className="text-[12px] text-[#6B645C] truncate max-w-[28%] shrink-0" title={senderFullName(item)}>
                        {senderFullName(item)}
                      </span>
                      {onGoToMessage && item.messageId ? (
                        <GoToMessageButton onClick={() => onGoToMessage(item.messageId)} />
                      ) : null}
                    </div>
                  ))}
                </section>
              ))
            )}
            {hasMore && !loading && (
              <div className="pt-2 pb-1 flex justify-center">
                {loadingMore ? (
                  <p className="text-sm text-[#6B645C]">Загрузка...</p>
                ) : (
                  <button
                    type="button"
                    onClick={() => loadPage(page + 1, false, tab)}
                    className="px-4 py-2 rounded-full bg-white border border-[#1A1916]/10 text-[13px] text-[#5C4B7A] hover:bg-[#EDE6F5]"
                  >
                    Показать ещё
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {tab === 'photos' && lightboxIndex != null && urls[lightboxIndex] && (
        <ChatMediaLightbox
          urls={urls}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
          meta={items.map((item) => ({
            senderName: senderFullName(item),
            timestamp: item.timestamp,
            messageId: item.messageId,
          }))}
          onGoToMessage={onGoToMessage}
        />
      )}
    </>
  );
}
