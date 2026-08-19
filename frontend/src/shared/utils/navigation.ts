import { resolveChatPhotoUrl } from '@/features/chat/chatPhotos';

export const NAV_EVENT_CHANGE_PAGE = 'changePage';
export const NAV_EVENT_OPEN_CHAT = 'openChatFromNotification';
export const NAV_EVENT_RELOAD_CHAT_HISTORY = 'reloadChatHistory';
export const NAV_KEY_NEIGHBOR_ID = 'openNeighborProfileId';
export const NAV_PAGE_NEIGHBOR_FRIENDS = 'neighbor-friends';

export const STATIC_PAGES = [
    'my-page', 'friends', 'chats', 'district',
    'events', 'notifications', 'settings', 'photos',
    'login', 'register', 'verify-email', 'forgot-password', 'privacy', 'rules',
] as const;

export type AppOverlay = 'post' | 'photo' | 'event-requests' | 'event-details';

export type AppHistoryState = {
    page?: string;
    overlay?: AppOverlay | null;
    chatOpen?: boolean;
};

/** Ширина левого края, с которого начинается свайп «назад». */
export const MOBILE_SWIPE_BACK_EDGE = 36;

/** Полный десктоп — от 1024px, как Tailwind `lg`. Ниже — телефон и планшет. */
export const DESKTOP_VIEWPORT_MQ = '(min-width: 1024px)';
export const COMPACT_VIEWPORT_MQ = '(max-width: 1023px)';
export const SIDEBAR_VISIBLE_MQ = '(min-width: 768px)';
export const SIDEBAR_WIDTH_PX = 256;

export function isDesktopViewport(): boolean {
    return typeof window !== 'undefined' && window.matchMedia(DESKTOP_VIEWPORT_MQ).matches;
}

export function isCompactViewport(): boolean {
    return typeof window !== 'undefined' && !window.matchMedia(DESKTOP_VIEWPORT_MQ).matches;
}

/** Левый край зоны свайпа «назад»: на планшете — сразу после сайдбара. */
export function swipeBackOriginX(): number {
    if (typeof window === 'undefined') return 0;
    return window.matchMedia(SIDEBAR_VISIBLE_MQ).matches && isCompactViewport()
        ? SIDEBAR_WIDTH_PX
        : 0;
}

type AppBackHandler = () => boolean;
const appBackHandlers: AppBackHandler[] = [];

export function registerAppBackHandler(handler: AppBackHandler): () => void {
    appBackHandlers.push(handler);
    return () => {
        const index = appBackHandlers.lastIndexOf(handler);
        if (index >= 0) appBackHandlers.splice(index, 1);
    };
}

export function hasAppBackHandler(): boolean {
    return appBackHandlers.length > 0;
}

/** Сначала закрывает открытый экран/модалку, иначе — как кнопка «назад» в браузере. */
export function performAppBack(): boolean {
    for (let i = appBackHandlers.length - 1; i >= 0; i -= 1) {
        try {
            if (appBackHandlers[i]()) return true;
        } catch {
            /* ignore */
        }
    }
    if (window.history.length <= 1) return false;
    window.history.back();
    return true;
}

export function requestChangePage(page: string): void {
    window.dispatchEvent(new CustomEvent(NAV_EVENT_CHANGE_PAGE, { detail: page }));
}

function dispatchPage(page: string): void {
    requestChangePage(page);
}

const SESSION_OPEN_CHAT = 'myraion.openChat';

export type PersistedOpenChat = { kind: 'personal' | 'group'; id: string };

export function isGroupChatNotificationLabel(label?: string | null): boolean {
    return String(label || '').replace(/^(MENTION:|PIN:)/, '').startsWith('GROUP:');
}

export function persistOpenChat(kind: 'personal' | 'group', id: string | number): void {
    try {
        sessionStorage.setItem(SESSION_OPEN_CHAT, JSON.stringify({ kind, id: String(id) }));
    } catch {
        /* ignore */
    }
}

export function clearPersistedOpenChat(): void {
    try {
        sessionStorage.removeItem(SESSION_OPEN_CHAT);
    } catch {
        /* ignore */
    }
}

export function readPersistedOpenChat(): PersistedOpenChat | null {
    try {
        const raw = sessionStorage.getItem(SESSION_OPEN_CHAT);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if ((parsed?.kind === 'personal' || parsed?.kind === 'group') && parsed?.id) {
            return { kind: parsed.kind, id: String(parsed.id) };
        }
    } catch {
        /* ignore */
    }
    return null;
}

let openChatClearTimer = 0;

/** Стереть открытый чат только если это уход со страницы, а не reload (на мобильных часто нет beforeunload). */
export function scheduleClearPersistedOpenChatIfVisible(): void {
    if (typeof window === 'undefined') return;
    if (openChatClearTimer) window.clearTimeout(openChatClearTimer);
    openChatClearTimer = window.setTimeout(() => {
        openChatClearTimer = 0;
        if (document.visibilityState === 'hidden') return;
        clearPersistedOpenChat();
    }, 400);
}

export function cancelScheduledClearPersistedOpenChat(): void {
    if (typeof window === 'undefined') return;
    if (!openChatClearTimer) return;
    window.clearTimeout(openChatClearTimer);
    openChatClearTimer = 0;
}

const SESSION_CHATS_TAB = 'myraion.chatsTab';

export type PersistedChatsTab = 'personal' | 'events';

export function persistChatsSidebarTab(tab: PersistedChatsTab): void {
    try {
        sessionStorage.setItem(SESSION_CHATS_TAB, tab);
    } catch {
        /* ignore */
    }
}

export function readPersistedChatsSidebarTab(): PersistedChatsTab | null {
    try {
        const raw = sessionStorage.getItem(SESSION_CHATS_TAB);
        if (raw === 'personal' || raw === 'events') return raw;
    } catch {
        /* ignore */
    }
    return null;
}

/** Открыть конкретный чат с любого экрана. Если он уже открыт — ничего не дергаем. */
export function requestOpenChatFromNotification(opts: {
    isGroup?: boolean;
    groupId?: number | string | null;
    personalUserId?: number | string | null;
}): void {
    if (opts.isGroup && opts.groupId != null && String(opts.groupId) !== '') {
        localStorage.setItem('activeGroupId', String(opts.groupId));
        localStorage.removeItem('activePersonalId');
        localStorage.removeItem('openDirectChatWith');
    } else if (opts.personalUserId != null && String(opts.personalUserId) !== '') {
        const id = String(opts.personalUserId);
        localStorage.setItem('activePersonalId', id);
        localStorage.setItem('openDirectChatWith', id);
        localStorage.removeItem('activeGroupId');
    } else {
        return;
    }
    dispatchPage('chats');
    window.dispatchEvent(new CustomEvent(NAV_EVENT_OPEN_CHAT));
}

export function readStoredUserId(): string | null {
    const direct = localStorage.getItem('userId');
    if (direct) return direct;
    try {
        const raw = localStorage.getItem('user');
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed?.id != null ? String(parsed.id) : null;
    } catch {
        return null;
    }
}

export function readHistoryState(): AppHistoryState {
    const state = window.history.state;
    return state && typeof state === 'object' ? state as AppHistoryState : {};
}

export function normalizePathname(pathname: string): string {
    const path = pathname.replace(/\/+$/, '') || '/';
    if (path === '/my-page') return '/';
    return path;
}

export function urlForPage(page: string): string {
    if (page === 'my-page' || page === '') return '/';
    if (page === 'login') return '/login';
    if (page === 'register') return '/register';
    if (page === 'neighbor-profile') {
        const id = localStorage.getItem(NAV_KEY_NEIGHBOR_ID);
        return id ? `/users/${id}` : '/';
    }
    if (page === 'neighbor-friends') {
        const id = localStorage.getItem('openNeighborFriendsId');
        return id ? `/users/${id}/friends` : '/friends';
    }
    if (page === 'neighbor-events') {
        const id = localStorage.getItem('openNeighborEventsId');
        return id ? `/users/${id}/events` : '/events';
    }
    if (page === 'neighbor-photos') {
        const id = localStorage.getItem('openNeighborPhotosId');
        return id ? `/users/${id}/photos` : '/photos';
    }
    return `/${page}`;
}

export function persistLastPage(page: string): void {
    try {
        sessionStorage.setItem('myraion.lastPage', page);
    } catch {
        /* ignore */
    }
}

export function readLastPage(): string | null {
    try {
        return sessionStorage.getItem('myraion.lastPage');
    } catch {
        return null;
    }
}

export function pageFromLocation(pathname = window.location.pathname, search = window.location.search): string {
    const currentPath = pathname.replace(/^\//, '').split('?')[0];
    const idFromQuery = new URLSearchParams(search).get('id');

    if (currentPath.startsWith('users/')) {
        const pathSegments = currentPath.split('/');
        const targetId = pathSegments[1];
        if (targetId && !Number.isNaN(Number(targetId))) {
            const subPage = pathSegments[2];
            if (subPage === 'friends') {
                localStorage.setItem('openNeighborFriendsId', targetId);
                return 'neighbor-friends';
            }
            if (subPage === 'events') {
                localStorage.setItem('openNeighborEventsId', targetId);
                return 'neighbor-events';
            }
            if (subPage === 'photos') {
                localStorage.setItem('openNeighborPhotosId', targetId);
                return 'neighbor-photos';
            }
            localStorage.setItem(NAV_KEY_NEIGHBOR_ID, targetId);
            return 'neighbor-profile';
        }
    }

    if (idFromQuery) {
        if (currentPath === 'neighbor-profile') localStorage.setItem(NAV_KEY_NEIGHBOR_ID, idFromQuery);
        if (currentPath === 'neighbor-friends') localStorage.setItem('openNeighborFriendsId', idFromQuery);
        if (currentPath === 'neighbor-events') localStorage.setItem('openNeighborEventsId', idFromQuery);
        if (currentPath === 'neighbor-photos') localStorage.setItem('openNeighborPhotosId', idFromQuery);
    }

    if (!currentPath) return 'my-page';
    return (STATIC_PAGES as readonly string[]).includes(currentPath) ? currentPath : 'my-page';
}

/**
 * Хелпер для бесшовного перехода на профиль чужого или своего пользователя.
 */
export const openNeighborProfile = (userId: string | number | undefined | null, firstName?: string): void => {
    if (!userId) {
        console.warn('[Navigation] Попытка перехода на пустой userId');
        return;
    }

    const targetIdStr = String(userId);

    const currentUserId = readStoredUserId();

    if (currentUserId && String(currentUserId) === targetIdStr) {
        dispatchPage('my-page');
        return;
    }

    if (firstName) {
        localStorage.setItem('openNeighborName', firstName);
    }
    localStorage.setItem(NAV_KEY_NEIGHBOR_ID, targetIdStr);
    dispatchPage('neighbor-profile');
};

/**
 * Переход на страницу друзей конкретного соседа (гостевой режим)
 */
export const openNeighborFriends = (targetUserId: string | number): void => {
    if (!targetUserId) return;
    localStorage.setItem('openNeighborFriendsId', String(targetUserId));
    dispatchPage(NAV_PAGE_NEIGHBOR_FRIENDS);
};

/**
 * Переход на страницу событий конкретного соседа (гостевой режим)
 */
export const openNeighborEvents = (targetUserId: string | number): void => {
    if (!targetUserId) return;
    localStorage.setItem('openNeighborEventsId', String(targetUserId));
    dispatchPage('neighbor-events');
};

export const openNeighborPhotos = (targetUserId: string | number): void => {
    if (!targetUserId) return;
    localStorage.setItem('openNeighborPhotosId', String(targetUserId));
    dispatchPage('neighbor-photos');
};

export const openMyPhotos = (): void => {
    dispatchPage('photos');
};

/** Серая заглушка с силуэтом: квадрат, чтобы не было белых углов в скруглённой рамке. */
export const DEFAULT_AVATAR_PLACEHOLDER =
    'data:image/svg+xml;charset=UTF-8,' +
    encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="#B0B0B0"/>
  <g fill="#ffffff">
    <circle cx="100" cy="76" r="34"/>
    <path d="M32 176c8-42 36-62 68-62s60 20 68 62v8H32z"/>
  </g>
</svg>`
    );

export const hasAvatarPhoto = (avatarUrl?: string | null): boolean => Boolean(avatarUrl && String(avatarUrl).trim());

/**
 * URL аватарки: своё фото, иначе серая заглушка.
 */
export const getAvatarUrl = (_authorId?: string | number | null, avatarUrl?: string | null): string => {
    if (hasAvatarPhoto(avatarUrl)) return resolveChatPhotoUrl(avatarUrl);
    return DEFAULT_AVATAR_PLACEHOLDER;
};
