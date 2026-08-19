import React, { useEffect, useState } from 'react';
import api from '@/shared/lib/api';
import { useAuth } from '@/shared/context/AuthContext';
import Card from '@/shared/ui/Card';
import Button from '@/shared/ui/Button';
import StatusMenuButton from '@/shared/ui/StatusMenuButton';
import Badge from '@/shared/ui/Badge';
import Section from '@/shared/ui/Section';
import PostComments, { Comment } from '@/features/feed/PostComments';
import PostCard from '@/features/feed/PostCard';
import AvatarPhotoViewer from '@/features/photos/AvatarPhotoViewer';
import ProfilePhotosPreview from '@/features/photos/ProfilePhotosPreview';
import { DEFAULT_COVER_COLOR, fetchPhotos, resolvePhotoUrl } from '@/shared/utils/photoGallery';
import { openNeighborProfile, openNeighborFriends, getAvatarUrl, openNeighborEvents, openNeighborPhotos, readStoredUserId } from '@/shared/utils/navigation';
import { fetchPresence, PRESENCE_INTERVAL_MS } from '@/shared/utils/presence';
import { showAppConfirm, showAppInfoToast } from '@/shared/utils/appToast';

import {
    MapPin,
    Heart,
    MessageCircle,
    Send,
    Award,
    Users,
    Calendar,
    MessageSquare,
    UserX,
    Eye,
} from 'lucide-react';

interface Post {
    id: number;
    authorId: number;
    content: string;
    commentsAllowed: boolean;
    createdAt: string;
    authorName?: string;
    authorAvatarUrl?: string | null;
    isLiked: boolean;
    likesCount: number;
    viewsCount: number;
    canComment?: boolean;
    commentsCount: number;
    photos?: string[];
}

interface NeighborUser {
    userId: number;
    firstName: string;
    lastName: string;
    city: string;
    districtName: string;
    bio?: string;
    reputation: number;
    canMessage: boolean;
    canComment: boolean;
    allowSeeFriendsFromAll?: boolean;
    allowSeeEventsFromAll?: boolean;
    avatarUrl?: string | null;
    coverMode?: string | null;
    coverColor?: string | null;
    coverUrl?: string | null;
    canSeePhotos?: boolean;
    online?: boolean;
    lastSeenAt?: string | null;
    accountStatus?: string | null;
    blockedByMe?: boolean;
    blockedMe?: boolean;
}

interface NeighborProfileProps {
    targetUserId: number;
    navigate?: (target: string, opts?: any) => void;
}
export default function NeighborProfile({ targetUserId, navigate }: NeighborProfileProps) {
    const { user: currentUser } = useAuth();
    const [neighbor, setNeighbor] = useState<NeighborUser | null>(null);
    const PAGE_SIZE = 7;
    const [postsState, setPostsState] = useState<{
        items: Post[];
        page: number;
        hasMore: boolean;
    }>({ items: [], page: 0, hasMore: false });    const [loading, setLoading] = useState(false);

    const [friendshipState, setFriendshipState] = useState({
        isFriend: false,
        hasPendingRequest: false,
        isIncomingRequest: false,
        theySubscribeToYou: false,
        status: undefined as string | undefined,
        requestId: null as number | null
    });

    const [stats, setStats] = useState({
        visitedCount: 0,
        createdCount: 0,
        friendsCount: 0,
        followersCount: 0
    });
    const [photoPreview, setPhotoPreview] = useState<{ total: number; urls: string[]; hidden: boolean }>({ total: 0, urls: [], hidden: false });
    const [avatarOpen, setAvatarOpen] = useState(false);

    useEffect(() => {
        const myId = currentUser?.id || readStoredUserId();

        if (myId && String(myId) === String(targetUserId)) {
            window.dispatchEvent(new CustomEvent('changePage', { detail: 'my-page' }));
            return;
        }

        if (targetUserId) {
            loadNeighborProfile().then((hideContent) => {
                if (hideContent) {
                    setPostsState({ items: [], page: 0, hasMore: false });
                    setPhotoPreview({ total: 0, urls: [], hidden: true });
                    return;
                }
                loadNeighborStats();
                loadNeighborPosts(0);
                loadPhotoPreview();
            });
        }
    }, [targetUserId, currentUser?.id]);

    useEffect(() => {
        if (!targetUserId) return;
        let cancelled = false;
        const tick = async () => {
            try {
                const map = await fetchPresence([targetUserId]);
                if (cancelled) return;
                const info = map[String(targetUserId)];
                setNeighbor((prev) => (prev ? {
                    ...prev,
                    online: info?.online ?? false,
                    lastSeenAt: info?.lastSeenAt ?? null,
                } : prev));
            } catch {
                // статус подтянется на следующем тике
            }
        };
        const intervalId = window.setInterval(tick, PRESENCE_INTERVAL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [targetUserId]);


    useEffect(() => {
        const handleLiveLike = (e: Event) => {
            const customEvent = e as CustomEvent;
            const { postId, senderId, isRemoved } = customEvent.detail;

            // ЗАЩИТА: Если лайк прилетел от нас самих, игнорируем инкремент.
            // Карточка PostCard внутри себя уже сделала Оптимистичный UI.
            if (senderId && currentUser?.id && String(senderId) === String(currentUser.id)) {
                return;
            }

            setPostsState(prev => ({
                ...prev,
                items: prev.items.map(p => {
                    if (p.id === Number(postId)) {
                        const newCount = isRemoved ? Math.max(0, p.likesCount - 1) : p.likesCount + 1;
                        return { ...p, likesCount: newCount };
                    }
                    return p;
                })
            }));
        };

        window.addEventListener('liveLikeUpdate', handleLiveLike);
        return () => window.removeEventListener('liveLikeUpdate', handleLiveLike);
    }, [currentUser]);

    const loadNeighborProfile = async (): Promise<boolean> => {
        try {
            const res = await api.get(`/api/v1/social/users/${targetUserId}/profile`);
            if (res.data) {
                setNeighbor(res.data);
            }
            const status = String(res.data?.accountStatus || 'ACTIVE').toUpperCase();
            if (status === 'DELETED' || status === 'BANNED' || res.data?.blockedMe) {
                return true;
            }
            const listParams = { page: 0, size: 100 };
            const [friendsCheckRes, outPendingRes, outRejectedRes, incPendingRes, incRejectedRes] = await Promise.all([
                api.get('/api/v1/social/friends/public/check', { params: { userId1: currentUser?.id, userId2: targetUserId } }).catch(() => ({ data: false })),
                api.get('/api/v1/social/friends/requests/outgoing', { params: { status: 'PENDING', ...listParams } }).catch(() => ({ data: [] })),
                api.get('/api/v1/social/friends/requests/outgoing', { params: { status: 'REJECTED', ...listParams } }).catch(() => ({ data: [] })),
                api.get('/api/v1/social/friends/requests/incoming', { params: { status: 'PENDING', ...listParams } }).catch(() => ({ data: [] })),
                api.get('/api/v1/social/friends/requests/incoming', { params: { status: 'REJECTED', ...listParams } }).catch(() => ({ data: [] }))
            ]);
            const isFriend = Boolean(friendsCheckRes.data);
            const matchesTarget = (id: any) => String(id) === String(targetUserId);
            const foundOutgoingPending = (outPendingRes.data || []).find((r: any) => matchesTarget(r.addresseeId || r.receiverId));
            const foundOutgoingRejected = (outRejectedRes.data || []).find((r: any) => matchesTarget(r.addresseeId || r.receiverId));
            const foundIncomingPending = (incPendingRes.data || []).find((r: any) => matchesTarget(r.requesterId || r.senderId));
            const foundIncomingRejected = (incRejectedRes.data || []).find((r: any) => matchesTarget(r.requesterId || r.senderId));

            setFriendshipState({
                isFriend,
                hasPendingRequest: !!foundOutgoingPending,
                isIncomingRequest: !!foundIncomingPending,
                theySubscribeToYou: !!foundIncomingRejected && !foundIncomingPending,
                status: foundOutgoingPending ? 'PENDING' : (foundOutgoingRejected ? 'REJECTED' : undefined),
                requestId: foundIncomingPending?.id
                    || foundOutgoingPending?.id
                    || foundIncomingRejected?.id
                    || foundOutgoingRejected?.id
                    || null
            });
            return false;
        } catch (error) {
            console.error("Ошибка загрузки профиля соседа:", error);
            return false;
        }
    };

    const loadPhotoPreview = async () => {
        try {
            const data = await fetchPhotos(targetUserId, { page: 0, size: 16 });
            setPhotoPreview({
                total: Number(data.total) || 0,
                urls: (data.items || []).map((item) => resolvePhotoUrl(item.url)),
                hidden: Boolean(data.hidden),
            });
        } catch (error: any) {
            setPhotoPreview({ total: 0, urls: [], hidden: error?.response?.status === 403 });
        }
    };

    const loadNeighborStats = async () => {
        try {
            // Запускаем параллельно ТРИ запроса: друзья, счетчики событий и количество подписчиков
            const [friendsRes, countersRes, subscribersCountRes] = await Promise.all([
                api.get(`/api/v1/social/friends/public/${targetUserId}/count`).catch(() => ({ data: 0 })),
                api.get(`/api/v1/social/events/public/user/${targetUserId}/counters`).catch(() => ({ data: { visited: 0, created: 0 } })),
                api.get(`/api/v1/social/friends/requests/count/subscribers/${targetUserId}`).catch(() => ({ data: 0 })) // Новый запрос!
            ]);

            // Записываем честные цифры в стейт
            setStats({
                visitedCount: countersRes.data?.visited ?? 0,
                createdCount: countersRes.data?.created ?? 0,
                friendsCount: Number(friendsRes.data || 0),
                followersCount: typeof subscribersCountRes.data === 'number' ? subscribersCountRes.data : 0 // СЮДА!
            });
        } catch (error) {
            console.error("Ошибка подсчета статистики соседа:", error);
        }
    };

    const loadNeighborPosts = async (pageToLoad = 0) => {
        setLoading(true);
        try {
            const response = await api.get(`/api/v1/social/posts/user/${targetUserId}`, {
                params: { page: pageToLoad, size: PAGE_SIZE }
            });

            const postList = response.data || [];

            const fullPosts: Post[] = postList.map((p: any) => ({
                id: p.id,
                authorId: p.authorId,
                content: p.content,
                commentsAllowed: p.commentsAllowed,
                canComment: p.canComment,
                createdAt: p.createdAt,
                isLiked: Boolean(p.isLiked ?? p.liked),
                likesCount: p.likesCount || 0,
                commentsCount: p.commentsCount || 0,
                viewsCount: p.viewsCount || 0,
                photos: p.photos || []
            }));

            setPostsState(prev => ({
                items: pageToLoad === 0 ? fullPosts : [...prev.items, ...fullPosts],
                page: pageToLoad,
                hasMore: postList.length === PAGE_SIZE // Если пришло ровно 5, значит на бэке есть ещё посты
            }));

        } catch (error) {
            console.error("Ошибка загрузки публикаций соседа:", error);
        } finally {
            setLoading(false);
        }
    };


    const handleAddFriend = async () => {
        try {
            await api.post(`/api/v1/social/friends/requests/${targetUserId}`);
            setFriendshipState(prev => ({
                ...prev,
                hasPendingRequest: true,
                theySubscribeToYou: false,
                status: 'PENDING'
            }));
        } catch (error) { console.error("Ошибка отправки заявки:", error); }
    };

    const handleRemoveFriend = async () => {
        try {
            await api.delete('/api/v1/social/friends/private', { params: { userId2: targetUserId } });
            setFriendshipState(prev => ({
                ...prev,
                isFriend: false,
                hasPendingRequest: false,
                theySubscribeToYou: false,
                status: undefined,
                requestId: null
            }));
        } catch (error) { console.error("Ошибка удаления из друзей:", error); }
    };

    const handleCancelRequest = async () => {
        try {
            await api.delete('/api/v1/social/friends/requests', { params: { addresseeId: targetUserId } });
            setFriendshipState(prev => ({
                ...prev,
                hasPendingRequest: false,
                status: undefined,
                requestId: null
            }));
        } catch (error) { console.error("Ошибка отзыва заявки:", error); }
    };

    const handleAcceptRequest = async () => {
        const requestId = friendshipState.requestId;
        if (!requestId) return;

        try {
            await api.put(`/api/v1/social/friends/requests/${requestId}`, null, {
                params: { status: 'ACCEPTED' }
            });
            setFriendshipState(prev => ({
                ...prev,
                isFriend: true,
                isIncomingRequest: false,
                hasPendingRequest: false,
                theySubscribeToYou: false,
                status: undefined
            }));
        } catch (error) {
            console.error("Ошибка одобрения заявки в друзья:", error);
        }
    };

    const handleDeclineRequest = async () => {
        const requestId = friendshipState.requestId;
        if (!requestId) return;

        try {
            await api.put(`/api/v1/social/friends/requests/${requestId}`, null, {
                params: { status: 'REJECTED' }
            });
            setFriendshipState(prev => ({
                ...prev,
                isIncomingRequest: false,
                hasPendingRequest: false,
                theySubscribeToYou: true
            }));
        } catch (error) {
            console.error("Ошибка отклонения заявки в друзья:", error);
        }
    };

    const handleBlock = async () => {
        const confirmed = await showAppConfirm({
            title: 'Заблокировать соседа',
            message: 'Он не сможет писать вам, не будет виден в поиске, заявка в друзья не пройдёт. Это не бан на весь район — только между вами.',
            confirmText: 'Заблокировать',
            cancelText: 'Отмена',
            danger: true,
        });
        if (!confirmed) return;
        try {
            await api.post(`/api/v1/social/friends/blocks/${targetUserId}`);
            setNeighbor(prev => prev ? { ...prev, blockedByMe: true, canMessage: false } : prev);
            setFriendshipState({
                isFriend: false,
                hasPendingRequest: false,
                isIncomingRequest: false,
                theySubscribeToYou: false,
                status: undefined,
                requestId: null,
            });
        } catch (error) {
            console.error('Не удалось заблокировать соседа:', error);
            showAppInfoToast('Не удалось заблокировать', 'Сервис друзей не ответил. Обновите страницу и попробуйте снова.');
        }
    };

    const handleUnblock = async () => {
        const confirmed = await showAppConfirm({
            title: 'Разблокировать соседа',
            message: 'Снова можно будет писать и отправлять заявку в друзья — если он тоже не держит вас в чёрном списке.',
            confirmText: 'Разблокировать',
            cancelText: 'Отмена',
        });
        if (!confirmed) return;
        try {
            await api.delete(`/api/v1/social/friends/blocks/${targetUserId}`);
            await loadNeighborProfile();
        } catch (error) {
            console.error('Не удалось разблокировать соседа:', error);
        }
    };

    const handleWriteMessage = async () => {
        try {
            await api.post(`/api/v1/social/chats/personal/init/${targetUserId}`);
            localStorage.setItem('openDirectChatWith', targetUserId.toString());
            navigate?.('chats');
        } catch (error) { console.error("Не удалось открыть чат:", error); }
    };

    if (!neighbor) return <div className="p-8 text-center text-slate-500">Загружаем профиль соседа…</div>;
    const accountStatus = String(neighbor.accountStatus || 'ACTIVE').toUpperCase();
    const accountUnavailable = accountStatus === 'DELETED' || accountStatus === 'BANNED';
    if (accountUnavailable) {
        return (
            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 md:py-8 min-h-screen">
                <Card className="p-8 text-center">
                    <div className="mx-auto w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                        <UserX className="w-7 h-7 text-slate-400" />
                    </div>
                    <h1 className="myraion-display text-2xl text-[#1C1824]">
                        {accountStatus === 'DELETED' ? 'Аккаунт удалён' : 'Профиль недоступен'}
                    </h1>
                    {accountStatus !== 'DELETED' ? (
                    <p className="mt-2 text-sm text-slate-500">
                        Этот профиль временно недоступен.
                    </p>
                    ) : null}
                </Card>
            </div>
        );
    }
    const photosHidden = neighbor.blockedMe || photoPreview.hidden || neighbor.canSeePhotos === false;
    const coverMode = String(neighbor.coverMode || '').toUpperCase();
    const hasCoverBanner = coverMode === 'COLOR' || coverMode === 'PHOTO';
    const writeMessageBtn = (
        <div className="max-lg:contents min-w-0 lg:w-full">
            {neighbor.canMessage && (
                friendshipState.isFriend ? (
                    <Button size="sm" onClick={handleWriteMessage} className="flex-1 lg:hidden bg-[#5C4B7A] hover:bg-[#4A3C66] text-white font-bold h-9 text-xs rounded-xl shadow-sm">
                        Написать
                    </Button>
                ) : (
                    <Button size="sm" variant="secondary" onClick={handleWriteMessage} className="lg:hidden w-9 h-9 p-0 text-[#5C4B7A] border border-slate-200 hover:bg-[#EDE6F5] rounded-xl flex items-center justify-center transition shrink-0" title="Написать">
                        <MessageSquare className="w-4 h-4" />
                    </Button>
                )
            )}
            <Button
                size="sm"
                variant="secondary"
                disabled={!neighbor.canMessage}
                onClick={handleWriteMessage}
                title={neighbor.canMessage ? 'Написать сообщение' : 'Сообщения недоступны'}
                className={`hidden lg:inline-flex w-full h-9 px-4 text-xs font-semibold rounded-xl justify-center min-w-0 ${
                    neighbor.canMessage
                        ? 'text-[#5C4B7A] border border-slate-200 hover:bg-[#EDE6F5]'
                        : 'text-slate-400 bg-slate-100 border border-slate-200'
                }`}
            >
                Написать сообщение
            </Button>
        </div>
    );
    return (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 md:py-8 min-h-screen">
            <Card padded={false} className={`relative overflow-visible mb-4 md:mb-6 h-auto ${hasCoverBanner ? '' : '!rounded-[24px]'}`}>
                {hasCoverBanner && (
                <div
                    className={`h-24 md:h-32 relative overflow-hidden rounded-t-[24px] md:rounded-t-[32px] ${coverMode === 'COLOR' ? '' : 'bg-[#EDE6F5]'}`}
                    style={coverMode === 'COLOR' ? { background: neighbor.coverColor || DEFAULT_COVER_COLOR } : undefined}
                >
                    {coverMode === 'PHOTO' && neighbor.coverUrl && (
                        <img src={resolvePhotoUrl(neighbor.coverUrl)} alt="" className="absolute inset-0 w-full h-full object-cover" />
                    )}
                    {coverMode !== 'PHOTO' && (
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.25),transparent_60%)]" />
                    )}
                </div>
                )}
                <div className={`px-4 md:px-6 relative z-[15] ${hasCoverBanner ? 'pt-0 pb-3 md:pb-6 -mt-8 md:-mt-12' : 'py-3.5 md:py-6'}`}>
                    <div className="flex items-start gap-3 md:gap-5">
                        <div className="relative shrink-0">
                        {photosHidden ? (
                            <img src={getAvatarUrl(neighbor.userId, neighbor.avatarUrl)} alt="" className="w-16 h-16 md:w-28 md:h-28 rounded-full object-cover border-[3px] md:border-4 border-white shadow-md" />
                        ) : (
                            <button type="button" onClick={() => setAvatarOpen(true)}>
                                <img src={getAvatarUrl(neighbor.userId, neighbor.avatarUrl)} alt="" className="w-16 h-16 md:w-28 md:h-28 rounded-full object-cover border-[3px] md:border-4 border-white shadow-md" />
                            </button>
                        )}
                        <span
                            className={`absolute bottom-0.5 right-0.5 md:bottom-1 md:right-1 w-3 h-3 md:w-3.5 md:h-3.5 rounded-full border-2 border-white ${neighbor.online ? 'bg-[#4A8B6F]' : 'bg-slate-300'}`}
                            title={neighbor.online ? 'В сети' : 'Не в сети'}
                        />
                        </div>
                        <div className={`flex-1 min-w-0 ${hasCoverBanner ? 'pt-8 md:pt-14' : 'pt-0.5'}`}>
                            <div className="flex flex-col gap-3">
                                <div className="min-w-0">
                                    <h1 className="myraion-display text-[18px] md:text-[36px] leading-[1.2] md:leading-[0.95] text-[#1C1824] break-words">{neighbor.firstName} {neighbor.lastName}</h1>
                                    <div className="mt-2 md:mt-3 flex items-center gap-1 text-[12px] md:text-sm text-slate-500 min-w-0">
                                            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                            <span className="truncate">{neighbor.city}, {neighbor.districtName}</span>
                                    </div>
                                    {neighbor.bio ? (
                                        <p className="mt-1.5 text-[13px] md:text-sm leading-snug text-slate-600 break-words [overflow-wrap:anywhere] max-w-full min-w-0">
                                            {neighbor.bio}
                                        </p>
                                    ) : null}
                                </div>
                                <div className="flex items-center gap-2 w-full lg:grid lg:grid-cols-2 lg:items-stretch">
                            {neighbor.blockedByMe ? (
                                <StatusMenuButton
                                    className="flex-1 min-w-0 lg:w-full lg:col-span-2"
                                    variant="muted"
                                    label="В чёрном списке"
                                    items={[{ label: 'Разблокировать', onClick: handleUnblock }]}
                                />
                            ) : neighbor.blockedMe ? null : friendshipState.isFriend ? (
                                <>
                                    {writeMessageBtn}
                                    <StatusMenuButton
                                        className="flex-1 min-w-0 lg:w-full"
                                        variant="muted"
                                        label="В друзьях"
                                        items={[
                                            { label: 'Удалить из друзей', onClick: handleRemoveFriend, tone: 'danger' },
                                            { label: 'Заблокировать', onClick: handleBlock, tone: 'danger' },
                                        ]}
                                    />
                                </>
                            ) : friendshipState.hasPendingRequest ? (
                                <>
                                    <StatusMenuButton
                                        className="flex-1 min-w-0 lg:w-full"
                                        variant="amber"
                                        label="Заявка отправлена"
                                        items={[
                                            { label: 'Отменить заявку', onClick: handleCancelRequest, tone: 'danger' },
                                            { label: 'Заблокировать', onClick: handleBlock, tone: 'danger' },
                                        ]}
                                    />
                                    {writeMessageBtn}
                                </>
                            ) : friendshipState.isIncomingRequest ? (
                                <>
                                    <StatusMenuButton
                                        className="flex-1 min-w-0 lg:w-full"
                                        variant="accent"
                                        label="Заявка в друзья"
                                        items={[
                                            { label: 'Принять', onClick: handleAcceptRequest, tone: 'success' },
                                            { label: 'Отклонить', onClick: handleDeclineRequest, tone: 'danger' },
                                            { label: 'Заблокировать', onClick: handleBlock, tone: 'danger' },
                                        ]}
                                    />
                                    {writeMessageBtn}
                                </>
                            ) : friendshipState.theySubscribeToYou ? (
                                <>
                                    <StatusMenuButton
                                        className="flex-1 min-w-0 lg:w-full"
                                        variant="muted"
                                        label="Подписан на вас"
                                        items={[
                                            { label: 'Добавить в друзья', onClick: handleAcceptRequest, tone: 'success' },
                                            { label: 'Заблокировать', onClick: handleBlock, tone: 'danger' },
                                        ]}
                                    />
                                    {writeMessageBtn}
                                </>
                            ) : friendshipState.status === 'REJECTED' ? (
                                <>
                                    <StatusMenuButton
                                        className="flex-1 min-w-0 lg:w-full"
                                        variant="muted"
                                        label="Вы подписаны"
                                        items={[
                                            { label: 'Отписаться', onClick: handleCancelRequest, tone: 'danger' },
                                            { label: 'Заблокировать', onClick: handleBlock, tone: 'danger' },
                                        ]}
                                    />
                                    {writeMessageBtn}
                                </>
                            ) : (
                                <>
                                    <StatusMenuButton
                                        className="flex-1 min-w-0 lg:w-full"
                                        variant="accent"
                                        label="Добавить в друзья"
                                        items={[
                                            { label: 'Добавить в друзья', onClick: handleAddFriend },
                                            { label: 'Заблокировать', onClick: handleBlock, tone: 'danger' },
                                        ]}
                                    />
                                    {writeMessageBtn}
                                </>
                            )}
                        </div>
                            </div>
                        </div>
                    </div>
                </div>
            </Card>
            {neighbor.blockedMe ? (
                <Card className="px-4 py-8 sm:px-6 md:px-10 md:py-10 text-center">
                    <div className="mx-auto w-14 h-14 rounded-full bg-[#EDE6F5] flex items-center justify-center mb-4">
                        <UserX className="w-6 h-6 text-[#5C4B7A]" />
                    </div>
                    <p className="myraion-display text-[17px] sm:text-xl text-[#1C1824] leading-[1.35] text-balance">
                        Этот пользователь ограничил взаимодействие с вами.
                    </p>
                </Card>
            ) : (
            <>
            {/* ТРИ СИММЕТРИЧНЫХ БЛОКА СТАТИСТИКИ */}
            <div className="grid grid-cols-3 gap-2.5 md:gap-4 mb-4 md:mb-6">
                <div className="w-full min-w-0 bg-[#FFFCFA] rounded-2xl md:rounded-[32px] p-2.5 md:p-5 flex flex-col justify-between">
                    <div className="flex items-center gap-1 md:gap-1.5 text-slate-500 text-[11px] md:text-sm font-medium mb-1.5 w-full">
                        <Award className="w-3.5 h-3.5 md:w-4 md:h-4 text-[#5C4B7A] shrink-0" />
                        <span className="truncate"><span className="md:hidden">Вклад</span><span className="hidden md:inline">Вклад соседа</span></span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1 md:gap-1.5 w-full pt-0.5">
                        <div className="flex items-baseline justify-between gap-1 md:block">
                            <div className="text-[9px] md:text-[10px] uppercase tracking-wide text-slate-400 font-bold">Репутация</div>
                            <div className="text-sm md:text-xl font-bold text-slate-900 leading-tight md:mt-0.5 tabular-nums">{neighbor.reputation > 0 ? `+${neighbor.reputation}` : neighbor.reputation}</div>
                        </div>
                        <div className="flex items-baseline justify-between gap-1 md:block md:border-l md:border-slate-100 md:pl-3">
                            <div className="text-[9px] md:text-[10px] uppercase tracking-wide text-slate-400 font-bold">Посты</div>
                            <div className="text-sm md:text-xl font-bold text-slate-900 leading-tight md:mt-0.5 tabular-nums">{postsState.items.length}</div>
                        </div>
                    </div>
                </div>

                <button
                    type="button"
                    disabled={neighbor.allowSeeFriendsFromAll === false && !friendshipState.isFriend}
                    onClick={() => {
                        if (!neighbor.userId) {
                            return;
                        }

                        openNeighborFriends(neighbor.userId);
                    }}
                    className="w-full min-w-0 bg-[#FFFCFA] rounded-2xl md:rounded-[32px] p-2.5 md:p-5 text-left hover:shadow-md disabled:opacity-70 flex flex-col justify-between"
                >
                    <div className="flex items-center gap-1 md:gap-1.5 text-slate-500 text-[11px] md:text-sm font-medium mb-1.5 w-full">
                        <Users className="w-3.5 h-3.5 md:w-4 md:h-4 text-[#5C4B7A] shrink-0" />
                        <span className="truncate">Связи</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1 md:gap-1.5 w-full pt-0.5">
                        {neighbor.allowSeeFriendsFromAll === false && !friendshipState.isFriend ? (
                            <div className="text-[10px] text-slate-400">🔒 Скрыто</div>
                        ) : (
                            <>
                                <div className="flex items-baseline justify-between gap-1 md:block">
                                    <div className="text-[9px] md:text-[10px] uppercase tracking-wide text-slate-400 font-bold">Друзья</div>
                                    <div className="text-sm md:text-xl font-bold text-slate-900 leading-tight md:mt-0.5 tabular-nums">{stats.friendsCount}</div>
                                </div>
                                <div className="flex items-baseline justify-between gap-1 md:block md:border-l md:border-slate-100 md:pl-3">
                                    <div className="text-[9px] md:text-[10px] uppercase tracking-wide text-slate-400 font-bold">Подписчики</div>
                                    <div className="text-sm md:text-xl font-bold text-[#5C4B7A] leading-tight md:mt-0.5 tabular-nums">{stats.followersCount}</div>
                                </div>
                            </>
                        )}
                    </div>
                </button>

                <button
                    type="button"
                    onClick={() => {
                        if (!neighbor.userId) return;
                        openNeighborEvents(neighbor.userId);
                    }}
                    className="w-full min-w-0 bg-[#FFFCFA] rounded-2xl md:rounded-[32px] p-2.5 md:p-5 text-left hover:shadow-md flex flex-col justify-between"
                >
                    <div className="flex items-center gap-1 md:gap-1.5 text-slate-500 text-[11px] md:text-sm font-medium mb-1.5 w-full">
                        <Calendar className="w-3.5 h-3.5 md:w-4 md:h-4 text-[#5C4B7A] shrink-0" />
                        <span className="truncate">События</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1 md:gap-1.5 w-full pt-0.5">
                        {neighbor.allowSeeEventsFromAll === false && !friendshipState.isFriend ? (
                            <div className="text-[10px] text-slate-400">🔒 Скрыто</div>
                        ) : (
                            <>
                                <div className="flex items-baseline justify-between gap-1 md:block">
                                    <div className="text-[9px] md:text-[10px] uppercase tracking-wide text-slate-400 font-bold">Посетил</div>
                                    <div className="text-sm md:text-xl font-bold text-slate-900 leading-tight md:mt-0.5 tabular-nums">{stats.visitedCount}</div>
                                </div>
                                <div className="flex items-baseline justify-between gap-1 md:block md:border-l md:border-slate-100 md:pl-3">
                                    <div className="text-[9px] md:text-[10px] uppercase tracking-wide text-slate-400 font-bold">Создал</div>
                                    <div className="text-sm md:text-xl font-bold text-[#5C4B7A] leading-tight md:mt-0.5 tabular-nums">{stats.createdCount}</div>
                                </div>
                            </>
                        )}
                    </div>
                </button>
            </div>

            {!photosHidden && photoPreview.urls.length > 0 && (
                <div className="mb-6">
                    <ProfilePhotosPreview
                        userId={Number(neighbor.userId)}
                        total={photoPreview.total}
                        urls={photoPreview.urls}
                        onOpenAll={() => openNeighborPhotos(neighbor.userId)}
                    />
                </div>
            )}

            <div className="space-y-4">
                {loading && postsState.items.length === 0 && (
                    <div className="space-y-4 animate-pulse">
                        <div className="h-36 rounded-[24px] bg-[#EDE6F5]" />
                        <div className="h-36 rounded-[24px] bg-[#EDE6F5]" />
                    </div>
                )}
                {!loading && postsState.items.length === 0 && (
                    <div className="text-center py-12 bg-[#FFFCFA] rounded-[32px] text-[#8A8494] text-sm">
                        Публикаций пока нет
                    </div>
                )}
                {postsState.items.map((p) => {
                    const postWithAuthorName = {
                        ...p,
                        authorName: p.authorId === neighbor.userId
                            ? `${neighbor.firstName} ${neighbor.lastName || ''}`.trim()
                            : (p.authorName || 'Сосед'),
                        authorAvatarUrl: p.authorId === neighbor.userId ? neighbor.avatarUrl : p.authorAvatarUrl,
                        commentsCount: p.commentsCount || 0
                    };

                    return (
                        <PostCard
                            key={p.id}
                            post={postWithAuthorName}
                            currentUserId={Number(currentUser?.id)}
                            districtName={neighbor.districtName}
                            onForceOpenOnMount={false}

                            // СИНХРОНИЗАЦИЯ ЛАЙКОВ: Чтобы лайк гостя из модалки не сбрасывался родителем
                            onPostLiked={(id, isLiked, count) => setPostsState(prev => ({
                                ...prev,
                                items: prev.items.map(item => item.id === id ? { ...item, isLiked, likesCount: count } : item)
                            }))}

                            // СИНХРОНИЗАЦИЯ ДАННЫХ: Передаем рабочий метод обновления стейта для гостя
                            onPostUpdated={(id, newContent, photos) => setPostsState(prev => ({
                                ...prev,
                                items: prev.items.map(item => item.id === id ? { ...item, content: newContent, photos: photos ?? item.photos } : item)
                            }))}

                            // СИНХРОНИЗАЦИЯ ЖИВЫХ КОММЕНТАРИЕВ ДЛЯ ГОСТЯ
                            onPostCommentCountChanged={(id, newCommentCount) => setPostsState(prev => ({
                                ...prev,
                                items: prev.items.map(item => item.id === id ? { ...item, commentsCount: newCommentCount } : item)
                            }))}

                            onPostDeleted={(id) => setPostsState(prev => ({
                                ...prev,
                                items: prev.items.filter(item => item.id !== id)
                            }))}
                        />
                    );
                })}
            </div>

            {avatarOpen && !photosHidden && !neighbor.blockedMe && (
                <AvatarPhotoViewer
                    userId={neighbor.userId}
                    owner={false}
                    onClose={() => setAvatarOpen(false)}
                />
            )}

            </>
            )}

        </div>
    );
}
