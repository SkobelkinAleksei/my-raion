import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter, useNavigate as useRouterNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/shared/context/AuthContext';
import Sidebar from '@/features/layout/Sidebar';
import BottomNav from '@/features/layout/BottomNav';
import MobileTopBar from '@/features/layout/MobileTopBar';
import MobileSwipeBack from '@/features/layout/MobileSwipeBack';
import MobilePullToRefresh from '@/features/layout/MobilePullToRefresh';
import MyPage from '@/pages/MyPage';
import Friends from '@/pages/Friends';
import Chats from '@/pages/Chats';
import District from '@/pages/District';
import Settings from '@/pages/Settings';
import Events from '@/pages/Events';
import SignIn from '@/pages/SignIn';
import SignUp from '@/pages/SignUp';
import VerifyEmail from '@/pages/VerifyEmail';
import ForgotPassword from '@/pages/ForgotPassword';
import LegalDocumentPage from '@/pages/LegalDocumentPage';
import NeighborProfile from '@/pages/NeighborProfile';
import Photos from '@/pages/Photos';
import AdminApp from '@/admin/AdminApp';
import { ChatProvider } from '@/features/chat/ChatContext';
import { Sparkles, MapPin, X, Calendar } from 'lucide-react';
import {
  openNeighborProfile,
  pageFromLocation,
  urlForPage,
  normalizePathname,
  readHistoryState,
  persistLastPage,
  readLastPage,
  STATIC_PAGES,
  type AppOverlay,
} from '@/shared/utils/navigation';
import { useAppBackHandler } from '@/shared/hooks/useAppBackHandler';
import { showAppInfoToast } from '@/shared/utils/appToast';
import EventDetailsModal from '@/features/events/EventDetailsModal';
import CreateEventDrawer from '@/features/events/CreateEventDrawer';
import { ChatMediaLightbox } from '@/features/chat/ChatPhotoGrid';
import { fetchAvatarHistory, fetchGalleryPhoto, parsePhotoContextLabel, resolvePhotoUrl, toStoredPhoto } from '@/shared/utils/photoGallery';
import Notifications from '@/pages/Notifications';
import { NotificationProvider } from '@/shared/context/NotificationContext';
import api from '@/shared/lib/api';
import { runWithTimeoutRetry } from '@/shared/lib/loadWithTimeoutRetry';
import SegmentedRingLoader, { ParticipantsLoadRetry } from '@/shared/ui/SegmentedRingLoader';
import PostCard from '@/features/feed/PostCard';
import { ReportProvider } from '@/features/report/ReportModal';
import DevicePrompts from '@/features/device/DevicePrompts';

function requestsWaitingLabel(count: number): string {
  const n10 = count % 10;
  const n100 = count % 100;
  if (n10 === 1 && n100 !== 11) return `${count} заявка ждёт ответа`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${count} заявки ждут ответа`;
  return `${count} заявок ждут ответа`;
}

function AppShellSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-5 lg:px-6 py-6 animate-pulse space-y-4">
      <div className="h-36 rounded-[28px] bg-[#EDE6F5]" />
      <div className="grid grid-cols-3 gap-3">
        <div className="h-24 rounded-2xl bg-[#EDE6F5]" />
        <div className="h-24 rounded-2xl bg-[#EDE6F5]" />
        <div className="h-24 rounded-2xl bg-[#EDE6F5]" />
      </div>
      <div className="h-40 rounded-[24px] bg-[#EDE6F5]" />
      <div className="h-40 rounded-[24px] bg-[#EDE6F5]" />
    </div>
  );
}

const MAIN_PAGES = ['my-page', 'friends', 'chats', 'district', 'events'] as const;

function isMainPage(page: string) {
  return (MAIN_PAGES as readonly string[]).includes(page);
}

function AppContent() {
  const routerNavigate = useRouterNavigate();
  const [page, setPage] = useState<string>(() => {
    const fromUrl = pageFromLocation();
    const path = normalizePathname(window.location.pathname);
    if (path !== '/' && fromUrl !== 'my-page') return fromUrl;
    const saved = readLastPage();
    if (saved && ((STATIC_PAGES as readonly string[]).includes(saved) || saved.startsWith('neighbor-'))) {
      return saved;
    }
    return fromUrl;
  });

  const [globalActivePost, setGlobalActivePost] = useState<any | null>(null);
  const [eventsTab, setEventsTab] = useState<'past' | 'upcoming' | 'mine'>('past');
  const { isAuthenticated, user } = useAuth();
  const visitedMainPagesRef = useRef<Set<string>>(new Set());
  if (isAuthenticated && isMainPage(page)) {
    visitedMainPagesRef.current.add(page);
  }
  const [clickTicket, setClickTicket] = useState(0);
  const [globalAppEventId, setGlobalAppEventId] = useState<number | null>(null);
  const [globalIncomingRequests, setGlobalIncomingRequests] = useState<any[]>([]);
  const [globalAppEvent, setGlobalAppEvent] = useState<{ title?: string; eventDate?: string; locationName?: string } | null>(null);
  const [isGlobalAppsLoading, setIsGlobalAppsLoading] = useState(false);
  const [globalAppsFailed, setGlobalAppsFailed] = useState(false);
  const globalAppsAbortRef = useRef<AbortController | null>(null);
  const globalAppsLoadingRef = useRef(false);
  const globalAppsInFlightEventIdRef = useRef<number | null>(null);
  const lastGlobalAppsEventIdRef = useRef<number | null>(null);
  const [globalDetailsEvent, setGlobalDetailsEvent] = useState<any | null>(null);
  const [globalEditingEvent, setGlobalEditingEvent] = useState<any | null>(null);
  const [globalPhoto, setGlobalPhoto] = useState<{
    urls: string[];
    index: number;
    likeSpec: any;
    meta?: { timestamp?: string }[];
    openComments?: boolean;
    highlightCommentId?: number | null;
  } | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      visitedMainPagesRef.current = new Set();
    }
  }, [isAuthenticated]);

  const abortGlobalAppsLoad = useCallback(() => {
    globalAppsAbortRef.current?.abort();
    globalAppsAbortRef.current = null;
    globalAppsLoadingRef.current = false;
    globalAppsInFlightEventIdRef.current = null;
    setIsGlobalAppsLoading(false);
    setGlobalAppsFailed(false);
  }, []);

  const closeAllOverlays = useCallback(() => {
    abortGlobalAppsLoad();
    setGlobalActivePost(null);
    setGlobalPhoto(null);
    setGlobalAppEventId(null);
    setGlobalIncomingRequests([]);
    setGlobalAppEvent(null);
    setGlobalDetailsEvent(null);
  }, [abortGlobalAppsLoad]);

  const pushOverlay = useCallback((kind: AppOverlay) => {
    const prev = readHistoryState();
    window.history.pushState({ ...prev, overlay: kind, page }, '', window.location.href);
  }, [page]);

  const closeOverlay = useCallback((kind: AppOverlay) => {
    if (readHistoryState().overlay === kind) {
      window.history.back();
      return;
    }
    if (kind === 'post') setGlobalActivePost(null);
    if (kind === 'photo') setGlobalPhoto(null);
    if (kind === 'event-requests') {
      abortGlobalAppsLoad();
      setGlobalAppEventId(null);
      setGlobalIncomingRequests([]);
      setGlobalAppEvent(null);
    }
    if (kind === 'event-details') setGlobalDetailsEvent(null);
  }, [abortGlobalAppsLoad]);

  useAppBackHandler(!!globalAppEventId, () => closeOverlay('event-requests'));

  const navigate = useCallback((target: string, opts?: { eventsTab?: 'past' | 'upcoming' | 'mine' }) => {
    if (!target) return;
    if (opts?.eventsTab) setEventsTab(opts.eventsTab);

    const [pathPart, queryPart] = target.split('?');
    const pureTarget = pathPart || 'my-page';
    const queryId = new URLSearchParams(queryPart || '').get('id');
    if (queryId) {
      if (pureTarget === 'neighbor-profile') localStorage.setItem('openNeighborProfileId', queryId);
      if (pureTarget === 'neighbor-friends') localStorage.setItem('openNeighborFriendsId', queryId);
      if (pureTarget === 'neighbor-events') localStorage.setItem('openNeighborEventsId', queryId);
      if (pureTarget === 'neighbor-photos') localStorage.setItem('openNeighborPhotosId', queryId);
    }

    const nextUrl = urlForPage(pureTarget);
    const currentPath = normalizePathname(window.location.pathname);
    const nextPath = normalizePathname(nextUrl);
    const hist = readHistoryState();

    if (hist.overlay) {
      routerNavigate(nextUrl, { replace: true, state: { page: pureTarget } });
    } else if (currentPath !== nextPath) {
      routerNavigate(nextUrl, { state: { page: pureTarget } });
    } else {
      const here = `${window.location.pathname}${window.location.search}`;
      routerNavigate(here || nextUrl, { replace: true, state: { page: pureTarget } });
    }

    closeAllOverlays();
    persistLastPage(pureTarget);
    setPage(pureTarget);
    setClickTicket((n) => n + 1);
  }, [closeAllOverlays, routerNavigate]);

  useEffect(() => {
    if (window.location.pathname.startsWith('/moderation')) {
      navigate('my-page');
    }
  }, [navigate]);

  useEffect(() => {
    const hist = readHistoryState();
    const url = urlForPage(page);
    window.history.replaceState({ page, overlay: hist.overlay ?? null }, '', url);
    persistLastPage(page);
  }, []);

  useEffect(() => {
    const handlePageChange = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      if (customEvent.detail) {
        navigate(customEvent.detail);
      }
    };
    window.addEventListener('changePage', handlePageChange);
    return () => window.removeEventListener('changePage', handlePageChange);
  }, [navigate]);

  useEffect(() => {
    const handlePopState = () => {
      const overlay = readHistoryState().overlay;
      if (overlay !== 'post') setGlobalActivePost(null);
      if (overlay !== 'photo') setGlobalPhoto(null);
      if (overlay !== 'event-requests') {
        abortGlobalAppsLoad();
        setGlobalAppEventId(null);
        setGlobalIncomingRequests([]);
        setGlobalAppEvent(null);
      }
      if (overlay !== 'event-details') setGlobalDetailsEvent(null);
      const nextPage = pageFromLocation();
      persistLastPage(nextPage);
      setPage(nextPage);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [abortGlobalAppsLoad]);

  useEffect(() => {
    const handleCloseGlobal = () => closeOverlay('post');
    window.addEventListener('closeGlobalPostModal', handleCloseGlobal);
    return () => window.removeEventListener('closeGlobalPostModal', handleCloseGlobal);
  }, [closeOverlay]);

  useEffect(() => {
    const handleForceOpen = async (e: Event) => {
      const customEvent = e as CustomEvent;
      const { postId } = customEvent.detail;

      if (!postId) return;

      try {
        // Запрашиваем у бэкенда свежие данные конкретного поста, на который кликнули
        const res = await api.get(`/api/v1/social/posts/id/${postId}`);
        const p = res.data;
        const authorRes = await api.get(`/api/v1/social/users/${p.authorId}`).catch(() => ({ data: null }));
        const author = authorRes.data;
        const authorName = author
          ? `${author.firstName} ${author.lastName || ''}`.trim()
          : undefined;

        setGlobalActivePost({
          ...p,
          authorName,
          isLiked: Boolean(p.isLiked ?? p.liked),
          likesCount: p.likesCount || 0,
          commentsCount: p.commentsCount || 0,
          canComment: p.canComment,
          viewsCount: p.viewsCount || 0
        });
        if (readHistoryState().overlay !== 'post') pushOverlay('post');
      } catch (err) {
        console.error("Не удалось открыть пост из глобального уведомления:", err);
      }
    };

    window.addEventListener('forceOpenNotification', handleForceOpen);
    return () => window.removeEventListener('forceOpenNotification', handleForceOpen);
  }, [pushOverlay]);

  useEffect(() => {
    const handleForceOpenPhoto = async (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const parsed = parsePhotoContextLabel(detail.contextLabel);
      if (!parsed) return;
      const commentId = Number(detail.commentId || localStorage.getItem('openCommentId') || 0) || null;
      const commentExtras = commentId ? { openComments: true as const, highlightCommentId: commentId } : {};
      try {
        if (parsed.kind === 'GALLERY' && parsed.photoId) {
          const photo = await fetchGalleryPhoto(parsed.photoId);
          setGlobalPhoto({
            urls: [resolvePhotoUrl(photo.url)],
            index: 0,
            likeSpec: {
              allowLike: true,
              allowSave: true,
              allowComment: true,
              kind: 'GALLERY',
              ownerId: photo.ownerId,
              photoIds: [photo.id],
            },
            meta: [{ timestamp: photo.createdAt }],
            ...commentExtras,
          });
          if (readHistoryState().overlay !== 'photo') pushOverlay('photo');
          return;
        }
        if (parsed.kind === 'POST' && parsed.postId) {
          const res = await api.get(`/api/v1/social/posts/id/${parsed.postId}`);
          const photos = (res.data?.photos || []) as string[];
          const urls = photos.map((item) => resolvePhotoUrl(item));
          const stored = photos.map((item) => toStoredPhoto(item));
          const idx = stored.findIndex((item) => item === parsed.url || resolvePhotoUrl(item) === resolvePhotoUrl(parsed.url));
          setGlobalPhoto({
            urls: urls.length ? urls : [resolvePhotoUrl(parsed.url)],
            index: urls.length && idx >= 0 ? idx : 0,
            likeSpec: {
              allowLike: true,
              allowSave: true,
              kind: 'POST',
              postId: parsed.postId,
              ownerId: res.data?.authorId,
            },
            meta: (urls.length ? urls : [parsed.url]).map(() => ({ timestamp: res.data?.createdAt })),
            ...commentExtras,
          });
          if (readHistoryState().overlay !== 'photo') pushOverlay('photo');
          return;
        }
        if (parsed.kind === 'AVATAR' && parsed.ownerId) {
          const history = await fetchAvatarHistory(parsed.ownerId).catch(() => []);
          if (!history.length) {
            showAppInfoToast('Фото', 'У пользователя нет аватарки');
            return;
          }
          const byId = parsed.photoId ? history.findIndex((item) => item.id === parsed.photoId) : -1;
          const current = byId >= 0 ? byId : Math.max(0, history.findIndex((item) => item.current));
          setGlobalPhoto({
            urls: history.map((item) => resolvePhotoUrl(item.viewUrl || item.url)),
            index: current,
            likeSpec: {
              allowLike: true,
              allowSave: true,
              allowComment: true,
              kind: 'AVATAR',
              ownerId: parsed.ownerId,
              photoIds: history.map((item) => item.id),
            },
            meta: history.map((item) => ({ timestamp: item.createdAt })),
            ...commentExtras,
          });
          if (readHistoryState().overlay !== 'photo') pushOverlay('photo');
        }
      } catch {
        showAppInfoToast('Фото', 'Не удалось открыть это фото');
      }
    };
    window.addEventListener('forceOpenPhoto', handleForceOpenPhoto);
    return () => window.removeEventListener('forceOpenPhoto', handleForceOpenPhoto);
  }, [pushOverlay]);
  const closeGlobalApps = () => closeOverlay('event-requests');

  const handleOpenApplicantProfile = (person: any) => {
    openNeighborProfile(person.userId, `${person.firstName} ${person.lastName || ''}`.trim());
  };

  const handleWriteToApplicant = async (userId: number) => {
    if (!userId) return;
    try {
      await api.post(`/api/v1/social/chats/personal/init/${userId}`);
      localStorage.setItem('openDirectChatWith', String(userId));
      navigate('chats');
    } catch (error) {
      console.error('Не удалось открыть чат с соседом:', error);
      showAppInfoToast('Чат', 'Не удалось открыть переписку');
    }
  };

  const handleGlobalModerate = async (eventId: number, participantId: number, action: 'approve' | 'reject') => {
    try {
      await api.patch(`/api/v1/social/events/${eventId}/participants/${participantId}/${action}`);
      setGlobalIncomingRequests((prev) => prev.filter((p) => p.participantId !== participantId));

      window.dispatchEvent(new CustomEvent('refreshApplicationsData'));

      if (globalIncomingRequests.length <= 1) {
        closeGlobalApps();
      }
    } catch (err) {
      console.error('Ошибка модерации в глобальном окне:', err);
    }
  };
  const loadGlobalApps = useCallback(async (eventId: number) => {
    if (globalAppsLoadingRef.current && globalAppsInFlightEventIdRef.current === eventId) return;
    globalAppsAbortRef.current?.abort();
    const ac = new AbortController();
    globalAppsAbortRef.current = ac;
    globalAppsLoadingRef.current = true;
    globalAppsInFlightEventIdRef.current = eventId;
    if (lastGlobalAppsEventIdRef.current !== eventId) {
      setGlobalIncomingRequests([]);
      setGlobalAppEvent(null);
    }
    setIsGlobalAppsLoading(true);
    setGlobalAppsFailed(false);
    try {
      await runWithTimeoutRetry(async (signal) => {
        const [incomingRes, eventRes] = await Promise.all([
          api.get('/api/v1/social/events/incoming', { signal }),
          api.get(`/api/v1/social/events/${Number(eventId)}`, { signal }).catch((err) => {
            if (signal.aborted) throw err;
            return { data: null };
          })
        ]);
        if (signal.aborted || globalAppsAbortRef.current !== ac) return;
        const incomingMap = incomingRes.data || {};
        const requestsForThisEvent = incomingMap[Number(eventId)] || [];
        setGlobalAppEvent(eventRes.data ? {
          title: eventRes.data.title,
          eventDate: eventRes.data.eventDate,
          locationName: eventRes.data.locationName
        } : null);

        const enriched = await Promise.all(requestsForThisEvent.map(async (person: any) => {
          try {
            const profileRes = await api.get(`/api/v1/social/users/${person.userId}/profile`, { signal });
            return { ...person, canMessage: !!profileRes.data?.canMessage };
          } catch (err) {
            if (signal.aborted) throw err;
            return { ...person, canMessage: false };
          }
        }));
        if (signal.aborted || globalAppsAbortRef.current !== ac) return;
        setGlobalIncomingRequests(enriched);
        lastGlobalAppsEventIdRef.current = eventId;
      }, ac.signal);
    } catch (err) {
      if (globalAppsAbortRef.current !== ac || ac.signal.aborted) return;
      console.error("Не удалось загрузить входящие заявки в глобальный слой:", err);
      setGlobalAppsFailed(true);
    } finally {
      if (globalAppsAbortRef.current === ac) {
        globalAppsLoadingRef.current = false;
        globalAppsInFlightEventIdRef.current = null;
        setIsGlobalAppsLoading(false);
      }
    }
  }, []);

  // Эффект №1: Перехват события для открытия модалки ЗАЯВОК (для Владельца встречи)
  useEffect(() => {
    const handleOpenGlobalRequests = async (e: Event) => {
      const customEvent = e as CustomEvent;
      const { eventId } = customEvent.detail;
      if (!eventId || isNaN(Number(eventId))) return;

      setGlobalAppEventId(Number(eventId));
      if (readHistoryState().overlay !== 'event-requests') pushOverlay('event-requests');
      void loadGlobalApps(Number(eventId));
    };

    window.addEventListener('openGlobalRequestsModal', handleOpenGlobalRequests);
    return () => window.removeEventListener('openGlobalRequestsModal', handleOpenGlobalRequests);
  }, [pushOverlay, loadGlobalApps]);

  // Эффект в App.tsx: Легковесный перехват карточки встречи со статусом пользователя
  useEffect(() => {
    const handleOpenGlobalDetails = async (e: Event) => {
      const customEvent = e as CustomEvent;
      const { eventId } = customEvent.detail;
      if (!eventId || isNaN(Number(eventId))) return;

      try {
        // Параллельно запрашиваем саму встречу и точечный статус по твоему новому пути /status
        const [eventRes, statusRes] = await Promise.all([
          api.get(`/api/v1/social/events/${Number(eventId)}`),
          api.get(`/api/v1/social/events/${Number(eventId)}/participants/status`).catch(() => ({ data: { status: 'NONE' } }))
        ]);

        if (eventRes.data) {
          const eventData = eventRes.data;
          // Извлекаем чистую строку статуса, которую вернул бэкенд (REJECTED, BANNED и т.д.)
          const actualStatus = statusRes.data?.status?.toUpperCase() || 'NONE';

          // Обогащаем объект события актуальным статусом подписок
          const enrichedEvent = {
            ...eventData,
            user_status: actualStatus,
            userStatus: actualStatus
          };

          setGlobalDetailsEvent(enrichedEvent);
          if (readHistoryState().overlay !== 'event-details') pushOverlay('event-details');
        }
      } catch (err) {
        console.error("Не удалось открыть карточку деталей события с точечным статусом:", err);
      }
    };

    window.addEventListener('openGlobalDetailsModal', handleOpenGlobalDetails);
    return () => window.removeEventListener('openGlobalDetailsModal', handleOpenGlobalDetails);
  }, [pushOverlay]);


  const renderSecondaryPage = () => {
    switch (page) {
      case 'neighbor-friends': {
        const currentNeighborId = Number(localStorage.getItem('openNeighborFriendsId') || 0);
        return <Friends key={`guest-friends-${currentNeighborId}`} mode="guest" targetUserId={currentNeighborId} />;
      }
      case 'neighbor-events': {
        const currentNeighborId = Number(localStorage.getItem('openNeighborEventsId') || 0);
        return <Events key={`guest-events-${currentNeighborId}`} mode="guest" targetUserId={currentNeighborId} />;
      }
      case 'photos':
        return <Photos mode="owner" navigate={navigate} />;
      case 'neighbor-photos': {
        const currentNeighborId = Number(localStorage.getItem('openNeighborPhotosId') || 0);
        return <Photos key={`guest-photos-${currentNeighborId}`} mode="guest" targetUserId={currentNeighborId} navigate={navigate} />;
      }
      case 'notifications':
        return <Notifications navigate={navigate} />;
      case 'settings':
        return <Settings />;
      case 'privacy':
        return (
          <LegalDocumentPage
            doc="privacy"
            onBack={() => navigate('settings')}
            onOpenDoc={(id) => navigate(id)}
          />
        );
      case 'rules':
        return (
          <LegalDocumentPage
            doc="rules"
            onBack={() => navigate('settings')}
            onOpenDoc={(id) => navigate(id)}
          />
        );
      case 'neighbor-profile': {
        const currentProfileId = Number(localStorage.getItem('openNeighborProfileId') || 0);
        return <NeighborProfile key={`guest-profile-${currentProfileId}`} targetUserId={currentProfileId} navigate={navigate} />;
      }
      default:
        return null;
    }
  };

  return (
      <div className="min-h-screen min-h-dvh myraion-page-wash text-[#1A1916]">
        <Sidebar page={page} setPage={(targetPage) => navigate(targetPage)} />
        <MobileTopBar page={page} setPage={(targetPage) => navigate(targetPage)} />
        <DevicePrompts />
        <MobileSwipeBack />
        <MobilePullToRefresh />
        <main className={`md:ml-64 min-h-dvh md:min-h-screen ${
          page === 'chats'
            ? 'h-dvh overflow-hidden pb-0 pt-[calc(3.25rem+env(safe-area-inset-top))] md:pt-0'
            : 'h-dvh md:h-auto overflow-y-auto pt-[calc(3.25rem+env(safe-area-inset-top))] md:pt-0 md:pb-0 pb-[calc(4.25rem+env(safe-area-inset-bottom))]'
        }`}>
          {!isAuthenticated ? (
            <AppShellSkeleton />
          ) : (
            <>
              {visitedMainPagesRef.current.has('my-page') && (
                <div hidden={page !== 'my-page'}>
                  <MyPage navigate={navigate} />
                </div>
              )}
              {visitedMainPagesRef.current.has('friends') && (
                <div hidden={page !== 'friends'}>
                  <Friends mode="owner" />
                </div>
              )}
              {visitedMainPagesRef.current.has('chats') && (
                <div hidden={page !== 'chats'} className={page === 'chats' ? 'h-full' : undefined}>
                  <Chats pageActive={page === 'chats'} />
                </div>
              )}
              {visitedMainPagesRef.current.has('district') && (
                <div hidden={page !== 'district'}>
                  <District active={page === 'district'} />
                </div>
              )}
              {visitedMainPagesRef.current.has('events') && (
                <div hidden={page !== 'events'}>
                  <Events initialTab={eventsTab} />
                </div>
              )}
              {!isMainPage(page) && renderSecondaryPage()}
            </>
          )}
        </main>
        <BottomNav page={page} setPage={(targetPage) => navigate(targetPage)} />

        {/* ГЛОБАЛЬНЫЙ ПРОВОДНИК МОДАЛОК — ТЕПЕРЬ НА ВЕРХНЕМ УРОВНЕ И ВНЕ HIDDEN */}
        {globalActivePost && (
            <PostCard
                key={`global-toast-post-${globalActivePost.id}`}
                post={globalActivePost}
                currentUserId={Number(user?.id)}
                districtName={user?.districtName || 'На районе'}
                onPostDeleted={() => closeOverlay('post')}
                onPostUpdated={(id, text, photos) => setGlobalActivePost((prev: any) => prev ? { ...prev, content: text, photos: photos ?? prev.photos } : null)}
                onForceOpenOnMount={true}
                isGlobalModal={true}
            />
        )}

        {globalPhoto && (
          <ChatMediaLightbox
            urls={globalPhoto.urls}
            index={globalPhoto.index}
            onClose={() => closeOverlay('photo')}
            onIndexChange={(next) => setGlobalPhoto((prev) => prev ? { ...prev, index: next } : prev)}
            likeSpec={globalPhoto.likeSpec}
            meta={globalPhoto.meta}
            openCommentsOnMount={globalPhoto.openComments}
            highlightCommentId={globalPhoto.highlightCommentId}
          />
        )}

        {/* ================= ГЛОБАЛЬНЫЙ СЛОЙ МОДАЛЬНЫХ ОКЕН ДЛЯ ВСТРЕЧ ================= */}

        {/* 1. Всплывающее окно заявок для Владельца встречи */}
        {globalAppEventId && (
            <>
              <div className="fixed inset-0 z-40 bg-[#1A1916]/45 backdrop-blur-sm" onClick={closeGlobalApps} />
              <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 pointer-events-none">
                <div className="pointer-events-auto w-full max-w-2xl max-h-[85vh] bg-[#FAF6F0] rounded-t-[28px] md:rounded-[28px] shadow-2xl overflow-hidden flex flex-col border border-[#1A1916]/10 animate-fadeIn" onClick={(e) => e.stopPropagation()}>
                  <div className="p-6 border-b border-[#1A1916]/10 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="myraion-display text-[26px] leading-tight text-[#1A1916]">
                          Заявки на участие
                        </h3>
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#EDE6F5] text-[#5C4B7A] text-[12px]">
                          {requestsWaitingLabel(globalIncomingRequests.length)}
                        </span>
                      </div>
                      {globalAppEvent?.title ? (
                        <p className="text-sm text-[#1A1916] mt-2">
                          На встречу «{globalAppEvent.title}»
                        </p>
                      ) : (
                        <p className="text-sm text-[#6B645C] mt-2">Одобрите или отклоните запросы соседей</p>
                      )}
                      {(globalAppEvent?.eventDate || globalAppEvent?.locationName) && (
                        <div className="mt-2 space-y-1 text-[13px] text-[#6B645C]">
                          {globalAppEvent.eventDate && (
                            <div className="flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 shrink-0" />
                              <span>
                                {(() => {
                                  const dateObj = new Date(globalAppEvent.eventDate as string);
                                  const dayAndMonth = dateObj.toLocaleDateString('ru-RU', { month: 'long', day: 'numeric' });
                                  const hoursAndMins = dateObj.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                                  return `${dayAndMonth} в ${hoursAndMins}`;
                                })()}
                              </span>
                            </div>
                          )}
                          {globalAppEvent.locationName && (
                            <div className="flex items-center gap-1.5">
                              <MapPin className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate">{globalAppEvent.locationName}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <button onClick={closeGlobalApps} className="w-9 h-9 rounded-full bg-white hover:bg-[#F2EBE3] text-[#1A1916] border border-[#1A1916]/10 flex items-center justify-center shrink-0"><X className="w-4 h-4" /></button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-6 space-y-4" style={{ scrollbarWidth: 'none' }}>
                    {isGlobalAppsLoading && globalIncomingRequests.length === 0 ? (
                        <SegmentedRingLoader />
                    ) : globalAppsFailed && globalIncomingRequests.length === 0 ? (
                        <ParticipantsLoadRetry onRetry={() => { if (globalAppEventId) void loadGlobalApps(globalAppEventId); }} />
                    ) : globalIncomingRequests.length === 0 ? (
                        <p className="text-sm text-[#6B645C] text-center py-8">Заявок больше нет</p>
                    ) : (
                        <div className={`grid gap-4 ${globalIncomingRequests.length === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
                          {globalIncomingRequests.map((person) => (
                              <div key={String(person.participantId)} className="bg-[#FFFCFA] border border-[#1A1916]/10 rounded-[24px] p-5 flex flex-col space-y-4">
                                <div className="flex items-center gap-3">
                                  <div className="w-12 h-12 rounded-full bg-[#EDE6F5] flex items-center justify-center text-sm text-[#1A1916] uppercase">
                                    {person.firstName?.substring(0,1)}{person.lastName?.substring(0,1)}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <button
                                          type="button"
                                          onClick={() => handleOpenApplicantProfile(person)}
                                          className="myraion-display text-[18px] leading-tight text-[#1A1916] truncate hover:text-[#5C4B7A] transition text-left"
                                      >
                                        {person.firstName} {person.lastName || ''}
                                      </button>
                                      {person.status === 'RE_PENDING' && <span className="bg-[#EDE6F5] text-[#5C4B7A] text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full">Повторный запрос</span>}
                                    </div>
                                    <p className="text-[13px] text-[#6B645C] mt-1 flex items-start gap-1.5 leading-snug">
                                      <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                      <span className="break-words">{person.cityAndDistrict || 'Район не указан'}</span>
                                    </p>
                                  </div>
                                </div>
                                <div className="py-2.5 px-3 bg-[#EDE6F5]/70 border border-[#1A1916]/8 rounded-xl text-center flex items-center justify-center gap-1.5">
                                  <Sparkles className="w-4 h-4 text-[#5C4B7A]" />
                                  <span className="text-[13px] text-[#6B645C]">Репутация:</span>
                                  <span className={`text-[13px] ${person.reputation < 0 ? 'text-[#B85C5C]' : 'text-[#5C4B7A]'}`}>{person.reputation > 0 ? `+${person.reputation}` : person.reputation ?? 0}</span>
                                </div>
                                <div className="flex gap-2 pt-0.5 w-full">
                                  {person.canMessage && (
                                    <button type="button" onClick={() => handleWriteToApplicant(Number(person.userId))} className="flex-1 bg-[#5C4B7A] hover:bg-[#4A3C66] text-white text-[13px] h-10 rounded-full transition">Написать</button>
                                  )}
                                  <button type="button" onClick={() => handleGlobalModerate(globalAppEventId, Number(person.participantId), 'approve')} className="flex-1 px-2.5 bg-[#D4E8DC] text-[#3D6B56] text-[13px] h-10 rounded-full">Принять</button>
                                  <button type="button" onClick={() => handleGlobalModerate(globalAppEventId, Number(person.participantId), 'reject')} className={`flex-1 px-2.5 text-[13px] h-10 rounded-full ${person.status === 'RE_PENDING' ? 'bg-[#B85C5C] text-white' : 'bg-[#F3D4D0] text-[#7A3A3A]'}`}>
                                    {person.status === 'RE_PENDING' ? 'Отклонить навсегда' : 'Отклонить'}
                                  </button>
                                </div>
                              </div>
                          ))}
                        </div>
                    )}
                  </div>
                </div>
              </div>
            </>
        )}

        {/* 2. Всплывающее окно просмотра деталей встречи для Гостя на странице 7 файла App.tsx */}
        {globalDetailsEvent && (
            <EventDetailsModal
                event={globalDetailsEvent}
                onClose={() => closeOverlay('event-details')}
                onJoin={async (ev) => {
                  try {
                    await api.post(`/api/v1/social/events/${ev.id}/participants/join`);
                    window.dispatchEvent(new CustomEvent('refreshNeighborStatuses'));
                    const statusRes = await api.get(`/api/v1/social/events/${ev.id}/participants/status`);
                    const currentStatus = statusRes.data?.status?.toUpperCase() || 'JOINED';
                    setGlobalDetailsEvent((prev: any) => prev ? { ...prev, user_status: currentStatus, userStatus: currentStatus } : null);
                  } catch (err) { console.error(err); }
                }}
                onApply={async (ev) => {
                  try {
                    const wasRejected = String(ev.user_status || ev.userStatus || '').toUpperCase() === 'REJECTED';
                    await api.post(`/api/v1/social/events/${ev.id}/participants/apply`);
                    window.dispatchEvent(new CustomEvent('refreshNeighborStatuses'));
                    const statusRes = await api.get(`/api/v1/social/events/${ev.id}/participants/status`);
                    const currentStatus = statusRes.data?.status?.toUpperCase() || 'PENDING';
                    setGlobalDetailsEvent((prev: any) => prev ? { ...prev, user_status: currentStatus, userStatus: currentStatus } : null);
                    const title = ev.title || 'встречу';
                    showAppInfoToast(
                      wasRejected ? 'Повторная заявка' : 'Заявка отправлена',
                      wasRejected
                        ? `Повторная заявка на «${title}» отправлена организатору`
                        : `Заявка на приватную встречу «${title}» отправлена организатору`
                    );
                  } catch (err) { console.error(err); }
                }}
                onLeave={async (id) => {
                  try {
                    await api.post(`/api/v1/social/events/${id}/participants/leave`);
                    window.dispatchEvent(new CustomEvent('refreshNeighborStatuses'));
                    setGlobalDetailsEvent((prev: any) => prev ? { ...prev, user_status: 'NONE', userStatus: 'NONE' } : null);
                  } catch (err) { console.error(err); }
                }}
                onCancelEvent={() => closeOverlay('event-details')}
                onEditEvent={(ev) => {
                  setGlobalEditingEvent(ev);
                  setGlobalDetailsEvent(null);
                  if (readHistoryState().overlay === 'event-details') {
                    window.history.replaceState({ ...readHistoryState(), overlay: null }, '', window.location.href);
                  }
                }}
            />
        )}

        <CreateEventDrawer
            open={!!globalEditingEvent}
            mode="edit"
            initialDraft={globalEditingEvent}
            onClose={() => setGlobalEditingEvent(null)}
            onSuccess={() => setGlobalEditingEvent(null)}
        />

      </div>
  );
}

function authPageFromPath(): 'login' | 'register' | 'verify-email' | 'forgot-password' | 'privacy' | 'rules' {
  const path = window.location.pathname;
  if (path.includes('verify-email')) return 'verify-email';
  if (path.includes('forgot-password')) return 'forgot-password';
  if (path.includes('register')) return 'register';
  if (path.includes('privacy')) return 'privacy';
  if (path.includes('rules')) return 'rules';
  return 'login';
}

function AuthScreens() {
  const [page, setPage] = useState(authPageFromPath);
  const [legalOverlay, setLegalOverlay] = useState<'privacy' | 'rules' | null>(null);
  const legalDoc = legalOverlay || (page === 'privacy' || page === 'rules' ? page : null);
  const showForm = page === 'register' || page === 'login' || page === 'verify-email' || page === 'forgot-password';

  const closeLegal = () => {
    if (legalOverlay) {
      setLegalOverlay(null);
      return;
    }
    setPage('login');
  };

  const goAuth = (next: string) => {
    if (next === 'login' || next === 'register' || next === 'verify-email' || next === 'forgot-password' || next === 'privacy' || next === 'rules') {
      const url = urlForPage(next);
      if (normalizePathname(window.location.pathname) !== url) {
        window.history.pushState({}, '', url);
      }
      setPage(next);
    }
  };

  useEffect(() => {
    const onPop = () => setPage(authPageFromPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useAppBackHandler(!!legalDoc, closeLegal);

  return (
      <div className="min-h-screen min-h-dvh bg-[#EFEAF6]">
        {showForm && (
          <div hidden={!!legalOverlay}>
            {page === 'register' ? (
                <SignUp setPage={goAuth} onOpenLegal={setLegalOverlay} />
            ) : page === 'verify-email' ? (
                <VerifyEmail setPage={goAuth} />
            ) : page === 'forgot-password' ? (
                <ForgotPassword setPage={goAuth} />
            ) : (
                <SignIn setPage={goAuth} onOpenLegal={setLegalOverlay} />
            )}
          </div>
        )}
        {legalDoc && (
          <LegalDocumentPage
            doc={legalDoc}
            onBack={closeLegal}
            onOpenDoc={(id) => {
              if (legalOverlay) setLegalOverlay(id);
              else setPage(id);
            }}
          />
        )}
      </div>
  );
}

function AppGate() {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
        <div className="min-h-screen min-h-dvh myraion-page-wash text-[#1A1916]">
          <AppShellSkeleton />
        </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreens />;
  }

  if (user?.platformRole === 'ADMIN') {
    return <AdminApp />;
  }

  return (
      <ReportProvider>
        <ChatProvider>
          <NotificationProvider>
            <AppContent />
          </NotificationProvider>
        </ChatProvider>
      </ReportProvider>
  );
}

export default function App() {
  return (
      <BrowserRouter>
        <AuthProvider>
          <AppGate />
        </AuthProvider>
      </BrowserRouter>
  );
}
