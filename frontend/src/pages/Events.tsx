import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '@/shared/lib/api';
import { runWithTimeoutRetry } from '@/shared/lib/loadWithTimeoutRetry';
import SegmentedRingLoader, { ParticipantsLoadRetry } from '@/shared/ui/SegmentedRingLoader';
import { showAppInfoToast, showAppConfirm } from '@/shared/utils/appToast';
import Button from '@/shared/ui/Button';
import StatusMenuButton from '@/shared/ui/StatusMenuButton';
import { useAuth } from '@/shared/context/AuthContext';
import { useChat } from '@/features/chat/ChatContext';
import {
  Calendar,
  MapPin,
  Users,
  Plus,
  CheckCircle2,
  Clock,
  X
} from 'lucide-react';
import EventDetailsModal from '@/features/events/EventDetailsModal';
import CreateEventDrawer from '@/features/events/CreateEventDrawer';
import EventMeetingCard from '@/features/events/EventMeetingCard';
import WeekDateStrip from '@/features/events/WeekDateStrip';
import { EVENT_CATEGORY_VISUAL, eventCategoryKey, toDayKey } from '@/features/events/eventVisuals';
import { resolveEventPhotoUrl } from '@/features/events/eventPhotos';

export interface EventFull {
  id: string;
  title: string;
  date: string;
  location: string;
  locationName?: string;
  latitude?: number;
  longitude?: number;
  participants: number;
  limit?: number;
  participantLimit?: number;
  image: string;
  photos?: string[];
  status?: 'past' | 'upcoming';
  role?: 'attendee' | 'organizer';
  category?: string;
  privacy?: 'open' | 'approval';
  isPrivate?: boolean;
  tags?: string[];
  description?: string;
  organizer_id?: string;
  organizer_name?: string;
  organizer_avatar?: string;
  organizerId?: number;
  user_status?: 'none' | 'joined' | 'pending' | 'PENDING' | 'RE_PENDING' | 'REJECTED' | 'BANNED' | 'KICKED' | 'NONE';
  people?: { firstName?: string; lastName?: string }[];
  eventDate?: string;
  eventDateIso?: string;
  isPast?: boolean;
  canVoteReputation?: boolean;
  reputationOpensAt?: string;
  reputationClosesAt?: string;
}

type MainTab = 'past' | 'upcoming' | 'mine' | 'applications';
type MineFilter = 'upcoming' | 'past';
type CategoryFilter = 'all' | 'SOS' | 'Движ' | 'События';

interface EventsProps {
  initialTab?: MainTab;
  mode?: 'owner' | 'guest';
  targetUserId?: number | string | null;
}
export function isEventLocked(e: EventFull): boolean {
  if (e.role === 'organizer') return false;
  if (e.status === 'past') return false;
  if (e.privacy !== 'approval') return false;
  const currentStatus = String(e.user_status || (e as any).userStatus || '').toUpperCase();
  return currentStatus !== 'JOINED';
}

function mapOutgoingToEventFull(ev: any): EventFull {
  const rawDate = ev.eventDate || ev.date;
  const status = String(ev.status || 'PENDING').toUpperCase();
  return {
    id: String(ev.id),
    title: ev.title || `Приватная встреча #${ev.id}`,
    date: rawDate
      ? new Date(rawDate).toLocaleString('ru-RU', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'Дата уточняется',
    location: ev.locationName || 'Адрес скрыт до одобрения',
    locationName: ev.locationName || '',
    participants: 0,
    image: '',
    category: ev.category || 'События',
    privacy: 'approval',
    isPrivate: true,
    organizerId: Number(ev.organizerId || 0),
    organizer_id: String(ev.organizerId || ''),
    user_status: status === 'JOINED' ? 'joined' : (status as EventFull['user_status']),
    people: [],
    eventDate: rawDate || '',
    eventDateIso: rawDate || '',
    role: 'attendee',
    status: 'upcoming',
  };
}

export default function Events({ initialTab = 'upcoming', mode = 'owner', targetUserId }: EventsProps) {
  const { user } = useAuth();
  const { refreshEventRooms } = useChat();

  const isOwner = mode === 'owner';
  const neighborId = targetUserId ? Number(targetUserId) : 0;

  const [tab, setTab] = useState<MainTab>(isOwner ? 'upcoming' : 'mine');
  const [mineFilter, setMineFilter] = useState<MineFilter>('upcoming');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const tabChipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const categoryChipRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const scrollChip = (el: HTMLButtonElement | null) => {
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  };

  const selectTab = (next: MainTab) => {
    setTab(next);
    requestAnimationFrame(() => scrollChip(tabChipRefs.current[next]));
  };

  const selectCategory = (next: CategoryFilter) => {
    const resolved = categoryFilter === next && next !== 'all' ? 'all' : next;
    setCategoryFilter(resolved);
    requestAnimationFrame(() => scrollChip(categoryChipRefs.current[resolved]));
  };
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [events, setEvents] = useState<EventFull[]>([]);
  const [editingEvent, setEditingEvent] = useState<EventFull | null>(null);
  const [detailsEvent, setDetailsEvent] = useState<EventFull | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [counts, setCounts] = useState({
    past: 0,
    upcoming: 0,
    mine: 0,
    mineUpcoming: 0,
    minePast: 0
  });

  const [appSubTab, setAppSubTab] = useState<'incoming' | 'outgoing'>('incoming');
  const [selectedAppEventId, setSelectedAppEventId] = useState<number | null>(null);
  const [incomingMap, setIncomingMap] = useState<Record<number, any[]>>({});
  const [outgoingEvents, setOutgoingEvents] = useState<any[]>([]);
  const [isLoadingApps, setIsLoadingApps] = useState(false);
  const [appsLoadFailed, setAppsLoadFailed] = useState(false);
  const appsLoadingRef = useRef(false);
  const appsAbortRef = useRef<AbortController | null>(null);

  const loadApplicationsData = async () => {
    if (!user) return;
    appsAbortRef.current?.abort();
    const ac = new AbortController();
    appsAbortRef.current = ac;
    appsLoadingRef.current = true;
    setIsLoadingApps(true);
    setAppsLoadFailed(false);
    try {
      await runWithTimeoutRetry(async (signal) => {
        if (appSubTab === 'incoming') {
          const res = await api.get('/api/v1/social/events/incoming', { signal });
          if (signal.aborted || appsAbortRef.current !== ac) return;
          setIncomingMap(res.data || {});
        } else {
          const res = await api.get('/api/v1/social/events/outgoing', { signal });
          if (signal.aborted || appsAbortRef.current !== ac) return;
          setOutgoingEvents(res.data || []);
        }
      }, ac.signal);
    } catch (err) {
      if (appsAbortRef.current !== ac || ac.signal.aborted) return;
      console.error('Ошибка загрузки данных в табе заявок:', err);
      setAppsLoadFailed(true);
    } finally {
      if (appsAbortRef.current === ac) {
        appsLoadingRef.current = false;
        setIsLoadingApps(false);
      }
    }
  };
  const handleModerateInCenter = async (eventId: number, participantId: number, action: 'approve' | 'reject') => {
    try {
      await api.patch(`/api/v1/social/events/${eventId}/participants/${participantId}/${action}`);
      showToast(action === 'approve' ? 'Заявка соседа успешно одобрена!' : 'Заявка соседа отклонена');
      setIncomingMap((prev) => {
        const next = { ...prev };
        if (next[eventId]) {
          next[eventId] = next[eventId].filter((p) => p.participantId !== participantId);
          if (next[eventId].length === 0) delete next[eventId];
        }
        return next;
      });
    } catch (err) { console.error('Ошибка при модерации заявки:', err); }
  };

  const handleCancelOutgoingRequest = async (eventId: number) => {
    try {
      await api.post(`/api/v1/social/events/${eventId}/participants/leave`);
      showToast('Вы успешно отозвали свою заявку на встречу');
      setOutgoingEvents((prev) => prev.filter((ev) => Number(ev.id) !== eventId));
      if (refreshEventRooms) {
        setTimeout(async () => { await refreshEventRooms(); }, 350);
      }
    } catch (err) { console.error('Ошибка при отзыве исходящей заявки:', err); }
  };
  // Продакшн-слушатель: ловит сигнал из глобальной модалки App.tsx и тихо обновляет списки на странице
  useEffect(() => {
    const handleLiveRefresh = () => {
      if (tab === 'applications' && isOwner) {
        loadApplicationsData(); // Теперь метод и переменные tab, isOwner здесь видны идеально!
      }
    };
    window.addEventListener('refreshApplicationsData', handleLiveRefresh);
    return () => window.removeEventListener('refreshApplicationsData', handleLiveRefresh);
  }, [tab, isOwner]);

  useEffect(() => {
    if (user && isOwner) {
      api.get('/api/v1/social/events/incoming')
          .then((res) => setIncomingMap(res.data || {}))
          .catch((err) => console.error('Ошибка фоновой загрузки счетчика:', err));
    }
  }, [user, isOwner]);

  useEffect(() => {
    if (tab === 'applications' && isOwner) {
      loadApplicationsData();
    }
  }, [tab, appSubTab, isOwner]);
  const loadUserEvents = async () => {
    if (!user) return;
    try {
      let requestUrl = '/api/v1/social/events/list';
      let requestParams: any = {};

      if (isOwner) {
        let backendFilter = 'ALL_UPCOMING';
        if (tab === 'past') backendFilter = 'ALL_PAST';
        if (tab === 'mine') {
          backendFilter = mineFilter === 'upcoming' ? 'MY_UPCOMING' : 'MY_PAST';
        }
        requestParams = { filter: backendFilter };
      } else {
        requestUrl = `/api/v1/social/events/public/user/${neighborId}`;
        requestParams = { filter: tab === 'past' ? 'USER_PAST' : 'USER_CREATED' };
      }

      const res = await api.get(requestUrl, { params: requestParams });
      const rawList = res.data || [];
      const mapToEventFull = (e: any): EventFull => {
        const isOrganizer = e.organizerId === user.id;
        const isPastEvent = e.eventDate ? new Date(e.eventDate).getTime() < Date.now() : false;
        const upperStatus = String(e.userStatus || e.user_status || '').toUpperCase();
        const previewPeople = Array.isArray(e.peoplePreview) ? e.peoplePreview : [];
        const finalOrganizerName = e.organizerName
          || (isOrganizer ? `${user.firstName} ${user.lastName || ''}`.trim() : 'Организатор');
        return {
          id: String(e.id || Math.random()),
          title: e.title || 'Событие на районе',
          date: e.eventDate ? new Date(e.eventDate).toLocaleString('ru-RU', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Дата уточняется',
          location: e.locationName || 'Адрес уточняется',
          locationName: e.locationName || '',
          latitude: e.latitude,
          longitude: e.longitude,
          participants: e.currentParticipants || 0,
          limit: e.participantLimit,
          participantLimit: e.participantLimit,
          isPrivate: Boolean(e.isPrivate),
          image: resolveEventPhotoUrl(e.photos && e.photos.length > 0 ? e.photos[0] : ''),
          photos: (e.photos || []).map((item: string) => resolveEventPhotoUrl(item)).filter(Boolean),
          status: isPastEvent ? 'past' : 'upcoming',
          role: isOrganizer ? 'organizer' : 'attendee',
          category: e.category || 'События',
          privacy: e.isPrivate ? 'approval' : 'open',
          tags: e.tags || [],
          description: e.description || '',
          organizer_id: String(e.organizerId || ''),
          organizerId: Number(e.organizerId || 0),
          organizer_name: finalOrganizerName,
          organizer_avatar: e.organizerAvatarUrl || undefined,
          user_status: (isOrganizer ? 'joined' : (upperStatus === 'JOINED' ? 'joined' : (upperStatus || 'NONE'))) as EventFull['user_status'],
          people: previewPeople.map((p: any) => ({ firstName: p.firstName, lastName: p.lastName })),
          eventDate: e.eventDate || '',
          eventDateIso: e.eventDate || '',
          isPast: isPastEvent,
          canVoteReputation: e.canVoteReputation === true,
          reputationOpensAt: e.reputationOpensAt,
          reputationClosesAt: e.reputationClosesAt
        };
      };

      setEvents(rawList.map((e: any) => mapToEventFull(e)));

      if (isOwner) {
        const countersRes = await api.get('/api/v1/social/events/me/tab-counters').catch(() => ({ data: null }));
        const c = countersRes.data || {};
        const mUpCount = Number(c.mineUpcoming || 0);
        const mPastCount = Number(c.minePast || 0);
        setCounts({
          past: Number(c.past || 0),
          upcoming: Number(c.upcoming || 0),
          mine: mUpCount + mPastCount,
          mineUpcoming: mUpCount,
          minePast: mPastCount
        });
      }
    } catch (error) { console.error("Ошибка во время загрузки контента событий:", error); }
  };

  useEffect(() => { loadUserEvents(); }, [user, tab, mineFilter, isOwner, neighborId]);

  useEffect(() => {
    setSelectedDayKey(null);
  }, [tab, mineFilter]);

  const handleJoin = async (ev: EventFull) => {
    try { await api.post(`/api/v1/social/events/${ev.id}/participants/join`); showToast('Вы присоединились к событию соседа!'); loadUserEvents(); setTimeout(async () => { await refreshEventRooms(); }, 500); } catch (error) { console.error(error); }
  };
  const handleApply = async (ev: EventFull) => {
    try {
      await api.post(`/api/v1/social/events/${ev.id}/participants/apply`);
      const isRepeat = ev.user_status === 'REJECTED' || (ev as any).userStatus === 'REJECTED';
      const title = ev.title || 'встречу';
      showAppInfoToast(
        isRepeat ? 'Повторная заявка' : 'Заявка отправлена',
        isRepeat
          ? `Повторная заявка на «${title}» отправлена организатору`
          : `Заявка на приватную встречу «${title}» отправлена организатору`
      );
      loadUserEvents();
      if (tab === 'applications' && isOwner) loadApplicationsData();
    } catch (error) { console.error(error); }
  };
  const handleLeave = async (eventId: string) => {
    try { await api.post(`/api/v1/social/events/${eventId}/participants/leave`); showToast('Вы успешно отказались от участия в событии'); loadUserEvents(); if (tab === 'applications' && isOwner) loadApplicationsData(); if (refreshEventRooms) { setTimeout(async () => { await refreshEventRooms(); }, 350); } } catch (error) { console.error(error); }
  };
  const handleCancelEvent = async (ev: EventFull) => {
    const confirmed = await showAppConfirm({
      title: 'Отменить встречу',
      message: 'Встреча будет отменена, чат удалится.',
      confirmText: 'Отменить встречу',
      cancelText: 'Назад',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.delete(`/api/v1/social/events/${ev.id}`);
      setDetailsEvent(null);
      showToast('Встреча успешно отменена организатором');
      loadUserEvents();
      if (refreshEventRooms) {
        setTimeout(async () => { await refreshEventRooms(); }, 350);
      }
    } catch (error) {
      console.error(error);
    }
  };
  const handleEditEvent = (ev: EventFull) => { setDetailsEvent(null); setEditingEvent(ev); };
  const showToast = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 2400); };
  const filterByCategory = (list: EventFull[]) => {
    if (categoryFilter === 'all') return list;
    return list.filter((e) => {
      const catLower = (e.category || '').toLowerCase().trim();
      if (categoryFilter === 'SOS') return catLower === 'sos';
      if (categoryFilter === 'Движ') return catLower === 'движ';
      if (categoryFilter === 'События') return catLower === 'события';
      return false;
    });
  };

  const eventDayKeys = useMemo(
    () => events.map((e) => toDayKey(e.eventDateIso)).filter((key): key is string => Boolean(key)),
    [events]
  );

  const list = useMemo(() => {
    let next = filterByCategory(events);
    if (isOwner && selectedDayKey) {
      next = next.filter((e) => toDayKey(e.eventDateIso) === selectedDayKey);
    }
    return next;
  }, [events, categoryFilter, selectedDayKey, isOwner]);
  const categoryCounts = useMemo(() => {
    const scoped = isOwner && selectedDayKey
      ? events.filter((e) => toDayKey(e.eventDateIso) === selectedDayKey)
      : events;
    return {
      all: scoped.length,
      SOS: scoped.filter((e) => (e.category || '').toLowerCase().trim() === 'sos').length,
      'Движ': scoped.filter((e) => (e.category || '').toLowerCase().trim() === 'движ').length,
      'События': scoped.filter((e) => (e.category || '').toLowerCase().trim() === 'события').length,
    };
  }, [events, selectedDayKey, isOwner]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 min-h-screen">
        <div className="myraion-events-board rounded-[36px] p-6 sm:p-8">
        {/* Шапка раздела */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#6B645C] mb-2">Район · встречи</p>
            <h1 className="myraion-display text-[32px] sm:text-[44px] md:text-[52px] leading-[0.92] text-[#1A1916]">
              {isOwner ? 'События' : 'События'}
            </h1>
            <p className="text-sm text-[#6B645C] mt-3 max-w-xl">
              {isOwner ? 'Знакомьтесь с соседями и собирайтесь рядом.' : 'Просматривайте архивные и предстоящие события этого пользователя'}
            </p>
          </div>
          {isOwner && (
              <Button onClick={() => setIsCreateOpen(true)} className="bg-[#5C4B7A] hover:bg-[#4A3C66] text-white py-3 px-5 rounded-full self-start sm:self-center flex items-center gap-2 text-sm">
                <Plus className="w-4 h-4" /> Создать событие
              </Button>
          )}
        </div>

        {/* Переключатели вкладок (Табы) */}
        <div className="flex flex-nowrap md:flex-wrap gap-2 mb-7 overflow-x-auto md:overflow-visible pb-0.5 -mx-1 px-1 md:mx-0 md:px-0 scroll-px-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {isOwner ? (
              <>
                <button ref={(el) => { tabChipRefs.current.upcoming = el; }} onClick={() => selectTab('upcoming')} className={`shrink-0 px-4 py-2.5 rounded-full text-sm transition ${tab === 'upcoming' ? 'bg-[#1C1824] text-[#FFFCFA]' : 'bg-[#FFFCFA] text-[#1C1824] hover:bg-white'}`}>
                  Будущие встречи <span className={`ml-1.5 text-[15px] font-bold tabular-nums ${tab === 'upcoming' ? 'text-[#EDE6F5]' : 'text-[#5C4B7A]'}`}>{counts.upcoming}</span>
                </button>
                <button ref={(el) => { tabChipRefs.current.mine = el; }} onClick={() => selectTab('mine')} className={`shrink-0 px-4 py-2.5 rounded-full text-sm transition ${tab === 'mine' ? 'bg-[#1C1824] text-[#FFFCFA]' : 'bg-[#FFFCFA] text-[#1C1824] hover:bg-white'}`}>
                  Мои события <span className={`ml-1.5 text-[15px] font-bold tabular-nums ${tab === 'mine' ? 'text-[#EDE6F5]' : 'text-[#5C4B7A]'}`}>{counts.mine}</span>
                </button>
                <button ref={(el) => { tabChipRefs.current.past = el; }} onClick={() => selectTab('past')} className={`shrink-0 px-4 py-2.5 rounded-full text-sm transition ${tab === 'past' ? 'bg-[#1C1824] text-[#FFFCFA]' : 'bg-[#FFFCFA] text-[#1C1824] hover:bg-white'}`}>
                  Прошедшие <span className={`ml-1.5 text-[15px] font-bold tabular-nums ${tab === 'past' ? 'text-[#EDE6F5]' : 'text-[#8A8494]'}`}>{counts.past}</span>
                </button>
                <button ref={(el) => { tabChipRefs.current.applications = el; }} onClick={() => selectTab('applications')} className={`shrink-0 px-4 py-2.5 rounded-full text-sm transition flex items-center gap-1.5 ${tab === 'applications' ? 'bg-[#1C1824] text-[#FFFCFA]' : 'bg-[#FFFCFA] text-[#1C1824] hover:bg-white'}`}>
                  <span>Заявки</span>
                  {Object.keys(incomingMap).length > 0 && <span className={`text-[15px] font-bold tabular-nums ${tab === 'applications' ? 'text-[#EDE6F5]' : 'text-[#B85C5C]'}`}>{Object.keys(incomingMap).length}</span>}
                </button>
              </>
          ) : (
              <>
                <button ref={(el) => { tabChipRefs.current.mine = el; }} onClick={() => selectTab('mine')} className={`shrink-0 px-4 py-2.5 rounded-full text-sm transition border ${tab === 'mine' ? 'bg-[#1A1916] text-[#F2EBE3] border-[#1A1916]' : 'bg-transparent text-[#1A1916] border-[#1A1916]/15 hover:border-[#1A1916]/40'}`}>
                  Личные события
                </button>
                <button ref={(el) => { tabChipRefs.current.past = el; }} onClick={() => selectTab('past')} className={`shrink-0 px-4 py-2.5 rounded-full text-sm transition border ${tab === 'past' ? 'bg-[#1A1916] text-[#F2EBE3] border-[#1A1916]' : 'bg-transparent text-[#1A1916] border-[#1A1916]/15 hover:border-[#1A1916]/40'}`}>
                  Прошедшие встречи
                </button>
              </>
          )}
        </div>

        {/* Подвкладки только для своих «Мои события» */}
        {isOwner && tab === 'mine' && (
            <div className="flex flex-wrap gap-2 mb-7">
              <button onClick={() => setMineFilter('upcoming')} className={`px-4 py-2 rounded-full text-xs transition ${mineFilter === 'upcoming' ? 'bg-[#1C1824] text-[#FFFCFA]' : 'bg-[#FFFCFA] text-[#1C1824] hover:bg-white'}`}>
                <span>Предстоящие</span>
              </button>
              <button onClick={() => setMineFilter('past')} className={`px-4 py-2 rounded-full text-xs transition ${mineFilter === 'past' ? 'bg-[#1C1824] text-[#FFFCFA]' : 'bg-[#FFFCFA] text-[#1C1824] hover:bg-white'}`}>
                <span>Прошедшие</span>
              </button>
            </div>
        )}
        {/* Строка дат — только на своих событиях, у чужого профиля не нужна */}
        {isOwner && tab !== 'applications' && (
            <div className="mb-7">
            <WeekDateStrip
                selectedDayKey={selectedDayKey}
                onSelect={setSelectedDayKey}
                eventDayKeys={eventDayKeys}
            />
            </div>
        )}
        {/* Фильтр Категорий */}
        {tab !== 'applications' && (
            <div className="flex flex-nowrap gap-2 mb-7 overflow-x-auto pb-0.5 -mx-1 px-1 scroll-px-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {(['all', 'SOS', 'Движ', 'События'] as CategoryFilter[]).map((cat) => {
                const isActive = categoryFilter === cat;
                const visual = cat === 'all' ? EVENT_CATEGORY_VISUAL.default : EVENT_CATEGORY_VISUAL[eventCategoryKey(cat)];
                const btnClasses = isActive ? visual.filterActive : visual.filterIdle;
                return (
                    <button key={cat} ref={(el) => { categoryChipRefs.current[cat] = el; }} onClick={() => selectCategory(cat)} className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-bold border transition duration-150 ${btnClasses}`}>
                      {cat === 'all' ? 'Все категории' : cat}
                      <span className={`text-[15px] font-bold tabular-nums leading-none ${isActive ? visual.countActive : visual.count}`}>{categoryCounts[cat]}</span>
                    </button>
                );
              })}
            </div>
        )}

        {/* Сетка Карточек событий */}
        {tab !== 'applications' && (
            list.length === 0 ? (
                <div className={`text-center py-16 bg-[#FAF6F0] border border-[#1A1916]/10 rounded-[28px] text-[#6B645C] ${
                  isOwner && selectedDayKey ? 'text-xs px-4' : 'text-[12px] md:text-sm whitespace-nowrap px-2'
                }`}>
                  {isOwner && selectedDayKey ? 'На эту дату пока нет встреч.' : 'В этой вкладке нет событий.'}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {list.map((event) => {
                    const locked = isEventLocked(event);
                    const pill = 'w-full h-11 rounded-full text-[13px] flex items-center justify-center gap-1.5 transition border';
                    const footer =
                              event.status === 'past' ? (
                                  <div className={`${pill} border-[#1C1824]/10 text-[#8A8494]`}>Событие прошло</div>
                              ) : event.role === 'organizer' ? (
                                  <button type="button" onClick={() => handleCancelEvent(event)} className={`${pill} border-[#B85C5C]/30 text-[#B85C5C] hover:bg-[#B85C5C] hover:text-white hover:border-[#B85C5C]`}>Отменить встречу</button>
                              ) : event.user_status === 'joined' ? (
                                  <StatusMenuButton
                                      className="w-full"
                                      variant="success"
                                      label="Вы идёте"
                                      buttonClassName="!h-11 !rounded-full !text-[13px]"
                                      items={[{ label: 'Отказаться', onClick: () => handleLeave(event.id), tone: 'danger' }]}
                                      desktop={
                                        <button type="button" onClick={() => handleLeave(event.id)} className={`${pill} bg-[#4A8B6F] border-[#4A8B6F] text-white hover:bg-[#B85C5C] hover:border-[#B85C5C] group/btn`}><CheckCircle2 className="w-3.5 h-3.5 group-hover/btn:hidden" /><X className="w-3.5 h-3.5 hidden group-hover/btn:inline" /><span className="group-hover/btn:hidden">Вы идёте</span><span className="hidden group-hover/btn:inline">Отказаться</span></button>
                                      }
                                  />
                              ) : (event.user_status === 'PENDING' || (event as any).userStatus === 'PENDING') ? (
                                  <StatusMenuButton
                                      className="w-full"
                                      variant="amber"
                                      label="Заявка отправлена"
                                      buttonClassName="!h-11 !rounded-full !text-[13px]"
                                      items={[{ label: 'Отменить заявку', onClick: () => handleLeave(event.id), tone: 'danger' }]}
                                      desktop={<div className={`${pill} border-[#5C4B7A]/25 text-[#5C4B7A]`}><Clock className="w-3.5 h-3.5 animate-pulse" /> Заявка отправлена</div>}
                                  />
                              ) : (event.user_status === 'RE_PENDING' || (event as any).userStatus === 'RE_PENDING') ? (
                                  <StatusMenuButton
                                      className="w-full"
                                      variant="amber"
                                      label="Повторная заявка отправлена"
                                      buttonClassName="!h-11 !rounded-full !text-[13px]"
                                      items={[{ label: 'Отменить заявку', onClick: () => handleLeave(event.id), tone: 'danger' }]}
                                      desktop={<div className={`${pill} border-[#5C4B7A]/25 text-[#5C4B7A]`}><Clock className="w-3.5 h-3.5 animate-pulse" /> Повторная заявка отправлена</div>}
                                  />
                              ) : (event.user_status === 'REJECTED' || (event as any).userStatus === 'REJECTED') ? (
                                  <button type="button" onClick={() => handleApply(event)} className={`${pill} border-[#5C4B7A] bg-[#5C4B7A] text-white hover:bg-[#4A3C66]`}><Plus className="w-3.5 h-3.5" /> Подать заявку повторно</button>
                              ) : (event.user_status === 'KICKED' || (event as any).userStatus === 'KICKED') ? (
                                  <div className={`${pill} border-[#B85C5C] bg-[#B85C5C] text-white`}>Вас исключили из встречи</div>
                              ) : (event.user_status === 'BANNED' || (event as any).userStatus === 'BANNED') ? (
                                  <div className={`${pill} border-[#B85C5C] bg-[#B85C5C] text-white`}>Вам отказано организатором</div>
                              ) : event.privacy === 'approval' ? (
                                  <button type="button" onClick={() => handleApply(event)} className={`${pill} bg-[#5C4B7A] border-[#5C4B7A] text-white hover:bg-[#4A3C66]`}>Подать заявку</button>
                              ) : (
                                  <button type="button" onClick={() => handleJoin(event)} className={`${pill} bg-[#5C4B7A] border-[#5C4B7A] text-white hover:bg-[#4A3C66]`}>Пойти</button>
                              );
                    return (
                        <EventMeetingCard
                            key={event.id}
                            title={event.title}
                            date={event.date}
                            location={event.location}
                            participants={event.participants}
                            limit={event.limit}
                            image={event.image}
                            category={event.category}
                            privacy={event.privacy}
                            locked={locked}
                            organizerId={Number(event.organizerId || event.organizer_id || 0)}
                            currentUserId={user?.id}
                            people={event.people}
                            onClick={() => setDetailsEvent(event)}
                            footer={footer}
                        />
                    );
                  })}
                </div>
            )
        )}
        {tab === 'applications' && isOwner && (
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="flex border-b border-[#1A1916]/12 gap-6 mb-6 overflow-x-auto scrollbar-none select-none">
                <button onClick={() => { setAppSubTab('incoming'); setSelectedAppEventId(null); }} className={`pb-3 text-sm transition relative shrink-0 flex items-center gap-1.5 ${appSubTab === 'incoming' ? 'text-[#1A1916] font-bold' : 'text-[#6B645C] hover:text-[#1A1916]'}`}>
                  <span>Входящие</span>{Object.keys(incomingMap).length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#EDE6DC] text-[#1A1916]">{Object.keys(incomingMap).length}</span>}{appSubTab === 'incoming' && <div className="absolute bottom-0 left-0 right-0 h-px bg-[#1A1916]" />}
                </button>
                <button onClick={() => { setAppSubTab('outgoing'); setSelectedAppEventId(null); }} className={`pb-3 text-sm transition relative shrink-0 flex items-center gap-1.5 ${appSubTab === 'outgoing' ? 'text-[#1A1916] font-bold' : 'text-[#6B645C] hover:text-[#1A1916]'}`}>
                  <span>Исходящие</span>{outgoingEvents.filter((e: any) => e.status === 'PENDING').length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#EDE6DC] text-[#1A1916]">{outgoingEvents.filter((e: any) => e.status === 'PENDING').length}</span>}{appSubTab === 'outgoing' && <div className="absolute bottom-0 left-0 right-0 h-px bg-[#1A1916]" />}
                </button>
              </div>
              {isLoadingApps && (appSubTab === 'incoming' ? Object.keys(incomingMap).length === 0 : outgoingEvents.length === 0) ? (
                  <SegmentedRingLoader />
              ) : appsLoadFailed && (appSubTab === 'incoming' ? Object.keys(incomingMap).length === 0 : outgoingEvents.length === 0) ? (
                  <ParticipantsLoadRetry onRetry={() => { void loadApplicationsData(); }} />
              ) : appSubTab === 'outgoing' ? (
                  outgoingEvents.length === 0 ? <div className="text-center py-12 bg-[#FAF6F0] border border-[#1A1916]/10 rounded-3xl text-[#6B645C] text-sm">Вы пока не отправляли заявок на приватные встречи соседей.</div> : (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {outgoingEvents.map((ev) => {
                          const event = mapOutgoingToEventFull(ev);
                          const status = String(ev.status || '').toUpperCase();
                          const pill = 'w-full h-10 rounded-full text-xs font-bold flex items-center justify-center gap-1.5 transition-all duration-200';
                          const footer =
                            status === 'KICKED' ? (
                              <div className={`${pill} bg-[#F3D4D0] text-[#7A3A3A]`}>Вас исключили из встречи</div>
                            ) : status === 'BANNED' ? (
                              <div className={`${pill} bg-[#F3D4D0] text-[#7A3A3A]`}>Вам отказано организатором</div>
                            ) : status === 'RE_PENDING' ? (
                              <StatusMenuButton
                                className="w-full"
                                variant="amber"
                                label="Повторная заявка отправлена"
                                buttonClassName="!h-10 !rounded-full"
                                items={[{ label: 'Отменить заявку', onClick: () => handleCancelOutgoingRequest(Number(event.id)), tone: 'danger' }]}
                                desktop={<button type="button" onClick={() => handleCancelOutgoingRequest(Number(event.id))} className={`${pill} bg-[#F3D4D0] hover:bg-[#E8B8B4] text-[#7A3A3A] group/out`}><Clock className="w-4 h-4 text-amber-500 animate-pulse group-hover/out:hidden" /><X className="w-4 h-4 text-red-500 hidden group-hover/out:inline" /><span className="group-hover/out:hidden">Повторная заявка отправлена</span><span className="hidden group-hover/out:inline">Отменить заявку</span></button>}
                              />
                            ) : status === 'REJECTED' ? (
                              <button type="button" onClick={() => handleApply(event)} className={`${pill} bg-[#5C4B7A] text-white hover:bg-[#4A3C66]`}><Plus className="w-3.5 h-3.5" /> Подать заявку повторно</button>
                            ) : (
                              <StatusMenuButton
                                className="w-full"
                                variant="amber"
                                label="Заявка отправлена"
                                buttonClassName="!h-10 !rounded-full"
                                items={[{ label: 'Отменить заявку', onClick: () => handleCancelOutgoingRequest(Number(event.id)), tone: 'danger' }]}
                                desktop={<button type="button" onClick={() => handleCancelOutgoingRequest(Number(event.id))} className={`${pill} bg-[#EDE6F5] hover:bg-[#F3D4D0] text-[#5C4B7A] hover:text-[#7A3A3A] group/out`}><Clock className="w-4 h-4 text-[#8A76B0] animate-pulse group-hover/out:hidden" /><X className="w-4 h-4 text-red-500 hidden group-hover/out:inline" /><span className="group-hover/out:hidden">Заявка отправлена</span><span className="hidden group-hover/out:inline">Отменить заявку</span></button>}
                              />
                            );
                          return (
                            <EventMeetingCard
                              key={event.id}
                              title={event.title}
                              date={event.date}
                              location={event.location}
                              participants={event.participants}
                              image={event.image}
                              category={event.category}
                              privacy="approval"
                              locked
                              organizerId={Number(event.organizerId || 0)}
                              currentUserId={user?.id}
                              people={event.people}
                              onClick={() => setDetailsEvent(event)}
                              footer={footer}
                            />
                          );
                        })}
                      </div>
                  )
              ) : Object.keys(incomingMap).length === 0 ? <div className="text-center py-12 bg-[#FAF6F0] border border-[#1A1916]/10 rounded-3xl text-[#6B645C] text-sm">Новых входящих заявок от соседей пока нет.</div> : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {Object.keys(incomingMap).map((idStr) => {
                      const evId = Number(idStr); const requestsList = incomingMap[evId] || []; const fullEvent = events.find((e) => String(e.id) === String(evId));
                      return (
                          <div key={evId} onClick={() => {
                            window.dispatchEvent(new CustomEvent('openGlobalRequestsModal', {
                              detail: { eventId: evId }
                            }));
                          }} className={`overflow-hidden bg-[#FAF6F0] border rounded-2xl transition-all duration-300 flex flex-col group cursor-pointer relative ${selectedAppEventId === evId ? 'border-[#1A1916] ring-1 ring-[#1A1916]/20' : 'border-[#1A1916]/10'}`}>
                            <div className="h-32 relative bg-[#EDE6F5] overflow-hidden">{fullEvent?.image ? <img src={fullEvent.image} alt="" className="w-full h-full object-cover transition duration-300" /> : <div className="w-full h-full bg-gradient-to-br from-[#E8E2F0] to-[#D5C8E8]" />}<div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" /><div className="absolute top-3 right-3 bg-amber-500 text-white text-[11px] font-black px-2.5 py-1 rounded-full shadow-md animate-pulse flex items-center gap-1 z-10"><Users className="w-3 h-3" /><span>Заявок: {requestsList.length}</span></div></div>
                            <div className="p-4 flex flex-col flex-1 justify-between gap-3 min-w-0"><h4 className="text-[#1A1916] text-sm leading-snug tracking-tight truncate">{fullEvent?.title || `Приватная встреча #${evId}`}</h4><div className="space-y-1.5 text-[11px] text-[#6B645C]"><div className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /><span>{fullEvent?.date || 'Дата уточняется'}</span></div><div className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /><span>{fullEvent?.location || 'Адрес скрыт'}</span></div></div><div className="text-[10px] uppercase tracking-[0.12em] text-center py-1.5 rounded-xl border border-[#1A1916]/10 text-[#6B645C] group-hover:bg-[#1A1916] group-hover:text-[#F2EBE3] transition duration-200">{selectedAppEventId === evId ? 'Посмотреть список' : 'Открыть список заявок'}</div></div>
                          </div>
                      );
                    })}
                  </div>
              )}
            </div>
        )}

        {detailsEvent && (
            <EventDetailsModal onClose={() => setDetailsEvent(null)} event={detailsEvent as any} onJoin={handleJoin} onApply={handleApply} onLeave={(id) => handleLeave(String(id))} onCancelEvent={handleCancelEvent} onEditEvent={handleEditEvent} />
        )}
        <CreateEventDrawer open={isCreateOpen} onClose={() => setIsCreateOpen(false)} onSuccess={() => { setIsCreateOpen(false); loadUserEvents(); }} />
        {editingEvent && (
            <CreateEventDrawer open={!!editingEvent} mode="edit" initialDraft={editingEvent} onClose={() => setEditingEvent(null)} onSuccess={() => { setEditingEvent(null); loadUserEvents(); }} />
        )}
        {toast && (
            <div className="fixed bottom-6 right-6 bg-[#1C1824] text-[#FFFCFA] text-xs py-3 px-4 rounded-full shadow-xl z-50 animate-slideUp">{toast}</div>
        )}
        </div>
      </div>
  );
}
