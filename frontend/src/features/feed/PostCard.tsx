import React, {useEffect, useRef, useState} from 'react';
import { createPortal } from 'react-dom';
import { Heart, MessageCircle, Eye, MoreHorizontal, Pencil, Trash2, X, ArrowDown, Share2, ImageIcon } from 'lucide-react';
import Card from '@/shared/ui/Card';
import Button from '@/shared/ui/Button';
import PostComments, { Comment } from '@/features/feed/PostComments';
import { useNotification } from '@/shared/context/NotificationContext';
import { useAuth } from '@/shared/context/AuthContext';
import { useChat } from '@/features/chat/ChatContext';
import { ReportIconButton, useReport } from '@/features/report/ReportModal';


import { theme } from '@/shared/ui/theme';
import api, { uploadPostPhoto } from '@/shared/lib/api';
import { openNeighborProfile, getAvatarUrl } from '@/shared/utils/navigation';
import ChatPhotoGrid from '@/features/chat/ChatPhotoGrid';
import ForwardModal from '@/features/chat/ForwardModal';
import { toStoredChatPhoto } from '@/features/chat/chatPhotos';
import { buildSharePostContent, publishChatMessages } from '@/shared/utils/shareToChat';
import { showAppInfoToast } from '@/shared/utils/appToast';
import { useAppBackHandler } from '@/shared/hooks/useAppBackHandler';
import { useChatPhotoAttach } from '@/features/feed/useChatPhotoAttach';
import { runWithTimeoutRetry } from '@/shared/lib/loadWithTimeoutRetry';

// Интерфейс данных публикации
export interface Post {
    id: number;
    authorId: number;
    content: string;
    commentsAllowed: boolean;
    canComment?: boolean;
    createdAt: string;
    authorName?: string;
    authorAvatarUrl?: string | null;
    isLiked: boolean;
    likesCount: number;
    viewsCount: number;
    commentsCount: number;
    photos?: string[];
}

const POST_PREVIEW_CHARS = 280;
const POST_PREVIEW_LINES = 6;
const POST_TEXT_CLASS =
    'text-sm text-slate-800 font-normal leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] break-all min-w-0 max-w-full';

function postNeedsCollapse(text: string): boolean {
    if (!text) return false;
    if (text.length > POST_PREVIEW_CHARS) return true;
    let lines = 1;
    for (const ch of text) if (ch === '\n') lines += 1;
    return lines > POST_PREVIEW_LINES;
}

function postPreview(text: string): string {
    const parts = text.split('\n');
    let cut = parts.length > POST_PREVIEW_LINES ? parts.slice(0, POST_PREVIEW_LINES).join('\n') : text;
    if (cut.length > POST_PREVIEW_CHARS) cut = cut.slice(0, POST_PREVIEW_CHARS);
    return cut;
}

function FeedPostText({ content, className = '' }: { content: string; className?: string }) {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        setOpen(false);
    }, [content]);
    const long = postNeedsCollapse(content);
    const shown = !long || open ? content : postPreview(content);
    return (
        <div className={`min-w-0 max-w-full overflow-hidden ${className}`}>
            <p className={POST_TEXT_CLASS}>{shown}</p>
            {long && !open && (
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="mt-1.5 text-sm font-semibold text-[#5C4B7A] hover:text-[#4A3C66] transition"
                >
                    Читать полностью
                </button>
            )}
        </div>
    );
}

// Пропсы, которые карточка принимает от родительской страницы
interface PostCardProps {
    post: Post;
    currentUserId: number;
    districtName: string;
    onPostDeleted: (postId: number) => void;
    onPostUpdated: (postId: number, newContent: string, photos?: string[]) => void;
    onPostLiked?: (postId: number, isLiked: boolean, count: number) => void
    onPostCommentCountChanged?: (postId: number, newCount: number) => void;
    onForceOpenOnMount?: boolean;
    isGlobalModal?: boolean;
}

export default function PostCard(
    {
        post, currentUserId, onPostDeleted, onPostUpdated, onPostLiked, onPostCommentCountChanged, onForceOpenOnMount, isGlobalModal
    }: PostCardProps) {
    // Локальный стейт поста, чтобы лайки и правки текста менялись мгновенно внутри карточки
    const { stompClient, stompConnected } = useNotification() as any;
    const { stompClient: chatStomp } = useChat();
    const { user } = useAuth();
    const { openReport } = useReport();
    const [p, setLocalPost] = useState<Post>(post);
    const [isModalOpen, setIsModalOpen] = useState(false); // Открыта ли модалка комментов
    const [openMenu, setOpenMenu] = useState(false);       // Открыто ли меню "три точки"
    const [isEditing, setIsEditing] = useState(false);     // Режим редактирования текста поста
    const [shareOpen, setShareOpen] = useState(false);
    const [editText, setEditText] = useState(p.content);
    const editPhotos = useChatPhotoAttach(10, uploadPostPhoto);
    const [animatingLike, setAnimatingLike] = useState(false);
    const modalScrollRef = useRef<HTMLDivElement | null>(null);
    const cardRef = useRef<HTMLDivElement | null>(null);
    const viewSentRef = useRef(false);
    const [showScrollDown, setShowScrollDown] = useState(false);
    const [highlightedCommentId, setHighlightedCommentId] = useState<number | null>(null);

    useEffect(() => {
        if (!highlightedCommentId) return;
        const timer = window.setTimeout(() => setHighlightedCommentId(null), 1100);
        return () => window.clearTimeout(timer);
    }, [highlightedCommentId]);

    const authorDisplayName = (
        p.authorName?.trim()
        || (Number(p.authorId) === Number(currentUserId) && user
            ? `${user.firstName} ${user.lastName || ''}`.trim()
            : '')
        || 'Сосед'
    );

    const reportPost = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        openReport({
            category: 'POST',
            accusedId: p.authorId,
            accusedName: authorDisplayName,
            targetId: p.id,
            targetTitle: 'Пост',
            snapshotText: p.content,
        });
    };

    const handleSharePost = (targets: { recipientId?: number; chatId?: number }[], comment?: string) => {
        const cover = toStoredChatPhoto(p.photos?.[0]);
        publishChatMessages(chatStomp, user, targets, {
            content: buildSharePostContent(p.id, authorDisplayName, p.content, comment, p.authorId),
            photos: cover ? [cover] : [],
        });
    };

    useEffect(() => {
        if (onForceOpenOnMount) {
            // Мгновенно запускаем открытие модалки комментов, как только App.tsx примонтирует этот пост
            openCommentsModal();
        }
    }, [onForceOpenOnMount]);

    useEffect(() => {
        setLocalPost(prevLocalPost => {
            // Перезаписываем стейт из родителя только если админ/автор отредактировал сам текст поста
            if (prevLocalPost.content !== post.content) {
                return post;
            }
            // Если изменился только лайк, но локально мы его уже записали — сохраняем локальное состояние
            if (prevLocalPost.isLiked === post.isLiked && prevLocalPost.likesCount === post.likesCount) {
                return prevLocalPost;
            }
            return post;
        });

        setEditText(post.content);
    }, [post]);

    // Уникальный просмотр: пост заметно в зоне видимости (центр/область экрана)
    useEffect(() => {
        if (!cardRef.current || viewSentRef.current) return;
        if (Number(currentUserId) === Number(p.authorId)) return;

        const node = cardRef.current;
        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (!entry?.isIntersecting || viewSentRef.current) return;
                viewSentRef.current = true;
                api.post(`/api/v1/social/posts/${p.id}/view`)
                    .then((res) => {
                        const next = typeof res.data === 'number' ? res.data : p.viewsCount;
                        setLocalPost((prev) => ({ ...prev, viewsCount: next }));
                    })
                    .catch(() => {
                        // если не удалось — разрешим ещё одну попытку при следующем появлении
                        viewSentRef.current = false;
                    });
            },
            { threshold: 0.55 }
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [p.id, p.authorId, currentUserId]);

    // Вставьте этот useEffect внутрь компонента PostCard, рядом с другими useEffect
    useEffect(() => {
        const handleLiveLike = (e: Event) => {
            const customEvent = e as CustomEvent;
            const { postId, isRemoved, senderId } = customEvent.detail;

            // Если событие прилетело для текущего поста, который мы смотрим
            if (Number(p.id) === Number(postId)) {
                setLocalPost(prev => {
                    // Вычисляем новое количество лайков
                    const newCount = isRemoved
                        ? Math.max(0, prev.likesCount - 1)
                        : prev.likesCount + 1;

                    return {
                        ...prev,
                        likesCount: newCount,
                        // Если лайк поставил/убрал ТЕКУЩИЙ пользователь с другого устройства/вкладки
                        isLiked: currentUserId === senderId ? !isRemoved : prev.isLiked
                    };
                });
            }
        };

        window.addEventListener('liveLikeUpdate', handleLiveLike);
        return () => window.removeEventListener('liveLikeUpdate', handleLiveLike);
    }, [p.id, currentUserId]);
    // Эффект для живого обновления комментариев и счетчика от других пользователей
    useEffect(() => {
        // ИСПРАВЛЕНО: используем stompClient из хука context
        if (!isModalOpen || !stompClient || !stompClient.connected || !stompConnected) return;
        const subscription = stompClient.subscribe(
            `/topic/posts/${p.id}/comments`,
            (message: any) => {
                const serverComment = JSON.parse(message.body);
                if (!serverComment) return;

                if (serverComment.eventType === 'VOTE') {
                    setCommentsState(prev => ({
                        ...prev,
                        items: prev.items.map((item) => Number(item.id) === Number(serverComment.id)
                            ? {
                                ...item,
                                likesCount: Number(serverComment.likesCount) || 0,
                                dislikesCount: Number(serverComment.dislikesCount) || 0,
                            }
                            : item)
                    }));
                    return;
                }

                if (serverComment.eventType === 'EDIT' && serverComment.id) {
                    setCommentsState(prev => ({
                        ...prev,
                        items: prev.items.map((item) => Number(item.id) === Number(serverComment.id)
                            ? { ...item, text: serverComment.content ?? item.text }
                            : item)
                    }));
                    return;
                }

                if (serverComment.eventType && serverComment.eventType !== 'COMMENT') return;

                // Игнорируем свои сообщения (они уже добавились через функцию addComment)
                if (Number(serverComment.authorId) === Number(currentUserId)) return;

                const incomingId = Number(serverComment.id);
                if (!incomingId) return;

                const fullName = `${serverComment.authorFirstName || 'Сосед'} ${serverComment.authorLastName || ''}`.trim();

                const freshComment = {
                    id: incomingId,
                    authorId: Number(serverComment.authorId),
                    authorName: fullName,
                    avatar: getAvatarUrl(serverComment.authorId, serverComment.authorAvatarUrl),
                    text: serverComment.content,
                    createdAt: serverComment.createdAt ? new Date(serverComment.createdAt).toISOString() : new Date().toISOString(),
                    replyToUserId: serverComment.replyToUserId ? Number(serverComment.replyToUserId) : null,
                    replyToAuthorName: serverComment.replyToAuthorName || null,
                    likesCount: Number(serverComment.likesCount) || 0,
                    dislikesCount: Number(serverComment.dislikesCount) || 0,
                    myVote: null as string | null,
                };

                setCommentsState(prev => {
                    if (prev.items.some((item) => Number(item.id) === incomingId)) return prev;
                    setLocalPost(postPrev => {
                        const nextCount = postPrev.commentsCount + 1;
                        if (onPostCommentCountChanged) {
                            onPostCommentCountChanged(p.id, nextCount);
                        }
                        return { ...postPrev, commentsCount: nextCount };
                    });
                    return { ...prev, items: [...prev.items, freshComment] };
                });
            }
        );

        return () => subscription.unsubscribe();
    }, [isModalOpen, p.id, currentUserId, stompClient, stompConnected]);

    const scrollToBottom = () => {
        if (modalScrollRef.current) {
            modalScrollRef.current.scrollTo({
                top: modalScrollRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    };
    // Метод отслеживает, если юзер открутил наверх — показываем стрелочку вниз
    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget;
        // Если до низа осталось больше 150px — зажигаем стрелочку
        const isFarFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight > 150;
        setShowScrollDown(isFarFromBottom);
    };
    // Изолированный пагинационный стейт комментариев строго для этого поста
    const [commentsState, setCommentsState] = useState<{
        items: Comment[];
        page: number;
        hasMore: boolean;
    }>({ items: [], page: 0, hasMore: false });
    const [commentsLoading, setCommentsLoading] = useState(false);
    const [commentsLoadFailed, setCommentsLoadFailed] = useState(false);
    const commentsLoadingRef = useRef(false);
    const commentsAbortRef = useRef<AbortController | null>(null);

    const closeCommentsModal = () => {
        commentsAbortRef.current?.abort();
        commentsAbortRef.current = null;
        commentsLoadingRef.current = false;
        setCommentsLoading(false);
        setCommentsLoadFailed(false);
        setIsModalOpen(false);
        setHighlightedCommentId(null);
        setCommentsState({ items: [], page: 0, hasMore: false });
        setShowScrollDown(false);
        if (onForceOpenOnMount) {
            window.dispatchEvent(new CustomEvent('closeGlobalPostModal'));
        }
    };

    useAppBackHandler(isModalOpen, closeCommentsModal);

    useEffect(() => {
        if (!isModalOpen) return;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prevOverflow;
        };
    }, [isModalOpen]);

    const openAuthorProfile = () => {
        if (!p.authorId) return;
        closeCommentsModal();
        openNeighborProfile(p.authorId, authorDisplayName);
    };
    const likeInFlightRef = useRef(false);

    // Мгновенный Оптимистичный лайк (Optimistic UI)
    const handleLike = async () => {
        if (likeInFlightRef.current) return;
        likeInFlightRef.current = true;
        setAnimatingLike(true);
        setTimeout(() => setAnimatingLike(false), 300);

        try {
            const response = await api.post(`/api/v1/social/likes/${p.id}`);
            const payload = response.data;
            const serverLikesCount = typeof payload === 'object' && payload != null
                ? Number(payload.likesCount)
                : Number(payload);
            const nextIsLiked = typeof payload === 'object' && payload != null && typeof payload.liked === 'boolean'
                ? Boolean(payload.liked)
                : !p.isLiked;

            setLocalPost(prev => ({ ...prev, isLiked: nextIsLiked, likesCount: serverLikesCount }));

            if (onPostLiked) {
                onPostLiked(p.id, nextIsLiked, serverLikesCount);
            }
        } catch (error) {
            console.error("Критическая ошибка при отправке лайка:", error);
            setLocalPost(prev => ({ ...prev, isLiked: post.isLiked, likesCount: post.likesCount }));
        } finally {
            likeInFlightRef.current = false;
        }
    };

    const COMMENTS_PAGE_SIZE = 5;

    const mapCommentDto = (c: any) => {
        const name = `${c.authorFirstName || 'Сосед'} ${c.authorLastName || ''}`.trim();
        return {
            id: Number(c.id),
            authorId: Number(c.authorId),
            authorName: name || 'Сосед',
            avatar: getAvatarUrl(c.authorId, c.authorAvatarUrl),
            text: c.content,
            createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString(),
            replyToUserId: c.replyToUserId ? Number(c.replyToUserId) : null,
            replyToAuthorName: c.replyToAuthorName || null,
            likesCount: Number(c.likesCount) || 0,
            dislikesCount: Number(c.dislikesCount) || 0,
            myVote: c.myVote || null,
        };
    };

    const loadComments = async (focusId: number | null) => {
        if (commentsLoadingRef.current) return;
        commentsAbortRef.current?.abort();
        const ac = new AbortController();
        commentsAbortRef.current = ac;
        commentsLoadingRef.current = true;
        setCommentsLoading(true);
        setCommentsLoadFailed(false);
        try {
            await runWithTimeoutRetry(async (signal) => {
                const res = await api.get(`/api/v1/social/comments/public/post/${p.id}`, {
                    params: { page: 0, size: focusId ? 50 : COMMENTS_PAGE_SIZE },
                    signal,
                });
                if (signal.aborted || commentsAbortRef.current !== ac) return;
                const rawComments = res.data.content || [];
                const mapped = rawComments.map(mapCommentDto);
                const chronologicalComments = [...mapped].reverse();
                setCommentsState({
                    items: chronologicalComments,
                    page: 1,
                    hasMore: !res.data.last
                });
                setTimeout(scrollToBottom, 100);
                const totalCount = Number(res.data.totalElements) || post.commentsCount;
                setLocalPost(prev => ({ ...prev, commentsCount: totalCount }));
            }, ac.signal);
        } catch (e) {
            if (commentsAbortRef.current !== ac || ac.signal.aborted) return;
            console.error(e);
            setCommentsLoadFailed(true);
        } finally {
            if (commentsAbortRef.current === ac) {
                commentsLoadingRef.current = false;
                setCommentsLoading(false);
            }
        }
    };

    const openCommentsModal = async () => {
        setIsModalOpen(true);
        const focusIdRaw = localStorage.getItem('openCommentId');
        const focusId = focusIdRaw ? Number(focusIdRaw) : null;
        if (focusId) {
            localStorage.removeItem('openCommentId');
            setHighlightedCommentId(focusId);
        }
        if (commentsState.items.length > 0) return;
        await loadComments(focusId);
    };

    const loadMoreComments = async () => {
        if (!commentsState.hasMore) return;

        const scrollContainer = modalScrollRef.current;
        const previousScrollHeight = scrollContainer ? scrollContainer.scrollHeight : 0;
        const previousScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

        try {
            const res = await api.get(`/api/v1/social/comments/public/post/${p.id}`, {
                params: {
                    page: commentsState.page,
                    size: COMMENTS_PAGE_SIZE
                }
            });

            const rawComments = res.data.content || [];
            const fetchedComments = rawComments.map(mapCommentDto);

            const orderedFetched = [...fetchedComments].reverse();
            setCommentsState(prev => ({
                ...prev,
                items: [...orderedFetched, ...prev.items],
                page: prev.page + 1,
                hasMore: !res.data.last
            }));

            if (res.data.totalElements !== undefined) {
                setLocalPost(prev => ({ ...prev, commentsCount: Number(res.data.totalElements) }));
            }

            setTimeout(() => {
                if (modalScrollRef.current) {
                    const newScrollHeight = modalScrollRef.current.scrollHeight;
                    modalScrollRef.current.scrollTop = previousScrollTop + (newScrollHeight - previousScrollHeight);
                }
            }, 30);

        } catch (err) {
            console.error("Ошибка пагинации комментариев", err);
        }
    };

    const addComment = async (text: string, reply?: { userId: number; commentId: number }) => {
        try {
            const res = await api.post(`/api/v1/social/comments/public/post/${p.id}`, {
                content: text,
                replyToUserId: reply?.userId,
                replyToCommentId: reply?.commentId,
            });
            const created = res.data;
            const createdId = Number(created?.id);
            if (!Number.isFinite(createdId) || createdId <= 0) {
                showAppInfoToast('Комментарий', 'Не удалось сохранить комментарий');
                return;
            }
            const freshComment = {
                id: createdId,
                authorId: Number(created?.authorId ?? currentUserId),
                authorName: created?.authorFirstName
                    ? `${created.authorFirstName} ${created.authorLastName || ''}`.trim()
                    : 'Вы',
                avatar: getAvatarUrl(created?.authorId ?? currentUserId, created?.authorAvatarUrl || user?.avatarUrl),
                text: created?.content ?? text,
                createdAt: created?.createdAt
                    ? new Date(created.createdAt).toISOString()
                    : new Date().toISOString(),
                replyToUserId: created?.replyToUserId ? Number(created.replyToUserId) : reply?.userId || null,
                replyToAuthorName: created?.replyToAuthorName || null,
                likesCount: Number(created?.likesCount) || 0,
                dislikesCount: Number(created?.dislikesCount) || 0,
                myVote: created?.myVote || null,
            };

            setCommentsState(prev => ({ ...prev, items: [...prev.items, freshComment] }));
            setLocalPost(prev => ({ ...prev, commentsCount: prev.commentsCount + 1 }));
            if (onPostCommentCountChanged) {
                onPostCommentCountChanged(p.id, p.commentsCount + 1);
            }
        } catch (e) {
            console.error("Ошибка добавления комментария:", e);
        }
    };

    // Удаление текущего поста
    const deletePost = async () => {
        try {
            await api.delete(`/api/v1/social/posts/${p.id}`);
            onPostDeleted(p.id); // Сигнализируем MyPage, чтобы убрал пост из общего стейта ленты
        } catch (e) {
            console.error("Ошибка удаления поста:", e);
        }
    };

    // Сохранение отредактированного текста поста
    const saveEditPost = async () => {
        if (!editText.trim()) return;
        if (editPhotos.count > 0 && !editPhotos.allReady) return;
        const nextPhotos = editPhotos.storedUrls;
        try {
            await api.put(`/api/v1/social/posts/${p.id}`, { content: editText.trim(), photos: nextPhotos });
            setLocalPost({ ...p, content: editText.trim(), photos: nextPhotos });
            onPostUpdated(p.id, editText.trim(), nextPhotos);
            setIsEditing(false);
        } catch (e) {
            console.error("Ошибка редактирования поста:", e);
            showAppInfoToast('Пост', 'Не удалось сохранить изменения');
        }
    };
    return (
        <>
            {/* РЕНДЕР КАРТОЧКИ В ОБЩЕЙ ЛЕНТЕ */}
            <div ref={cardRef} className="min-w-0 max-w-full">
            <Card padded={false} className={`overflow-hidden min-w-0 max-w-full p-5 relative ${isGlobalModal ? 'hidden' : ''}`}>
                <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                        <button type="button" onClick={() => p.authorId !== currentUserId && openNeighborProfile(p.authorId)} className="shrink-0 focus:outline-none cursor-pointer">
                            <img src={getAvatarUrl(p.authorId, p.authorAvatarUrl)} alt="" className="w-10 h-10 rounded-full object-cover border border-slate-100 shadow-sm" />
                        </button>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <button type="button" onClick={() => p.authorId !== currentUserId && openNeighborProfile(p.authorId)} className="font-bold text-sm text-slate-900 focus:outline-none text-left cursor-pointer">
                                    {authorDisplayName}
                                </button>
                            </div>
                            <div className="text-[11px] text-slate-400 font-medium mt-0.5">
                                {new Date(p.createdAt).toLocaleDateString('ru-RU', { month: 'long', day: 'numeric' })}, {new Date(p.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                        </div>
                    </div>

                    {p.authorId === currentUserId && (
                        <div className="relative">
                            <button onClick={() => setOpenMenu(!openMenu)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-50 transition cursor-pointer">
                                <MoreHorizontal className="w-4 h-4" />
                            </button>
                            {openMenu && (
                                <div className="absolute right-0 top-full mt-1 w-36 bg-white border border-slate-200 rounded-xl shadow-lg z-20 py-1.5">
                                    <button onClick={() => { setEditText(p.content); editPhotos.hydrate(p.photos || []); setIsEditing(true); setOpenMenu(false); }} className="w-full px-3 py-1.5 text-xs text-slate-700 font-medium hover:bg-slate-50 flex items-center gap-2 text-left cursor-pointer">
                                        <Pencil className="w-3.5 h-3.5 text-slate-400" /> Редактировать
                                    </button>
                                    <button onClick={deletePost} className="w-full px-3 py-1.5 text-xs text-red-600 font-medium hover:bg-red-50 flex items-center gap-2 text-left cursor-pointer">
                                        <Trash2 className="w-3.5 h-3.5 text-red-400" /> Удалить
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {isEditing ? (
                    <div className="mt-3 space-y-2">
                        <textarea value={editText} onChange={(e) => setEditText(e.target.value.slice(0, 3000))} maxLength={3000} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#5C4B7A]/40 resize-none text-slate-800" rows={3} />
                        <div className="flex justify-end">
                            <span className="text-[11px] text-slate-400 tabular-nums">{editText.length}/3000</span>
                        </div>
                        {editPhotos.count > 0 && (
                            <div className="flex gap-2 overflow-x-auto pb-1">
                                {editPhotos.pending.map((item) => (
                                    <div key={item.localId} className="relative w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-xl overflow-hidden bg-[#EDE6F5]">
                                        <img src={item.url || item.preview} alt="" className="w-full h-full object-cover" />
                                        {item.uploading && <div className="absolute inset-0 bg-white/50" />}
                                        <button
                                            type="button"
                                            onClick={() => editPhotos.remove(item.localId)}
                                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-[#1A1916]/70 text-white flex items-center justify-center"
                                            aria-label="Удалить фото"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="flex items-center justify-between gap-2">
                            <div>
                                <input
                                    ref={editPhotos.inputRef}
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp,image/gif"
                                    multiple
                                    className="hidden"
                                    onChange={(e) => {
                                        editPhotos.addFiles(e.target.files);
                                        e.target.value = '';
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={editPhotos.openPicker}
                                    disabled={editPhotos.count >= editPhotos.max}
                                    className="inline-flex items-center gap-1.5 text-slate-400 hover:text-[#5C4B7A] transition disabled:opacity-40"
                                    title="Добавить фото"
                                >
                                    <ImageIcon className="w-5 h-5" />
                                </button>
                            </div>
                            <div className="flex gap-2 justify-end">
                                <Button variant="secondary" size="sm" className="text-xs" onClick={() => { setIsEditing(false); editPhotos.clear(); }}>Отмена</Button>
                                <Button size="sm" className="text-xs" disabled={!editText.trim() || (editPhotos.count > 0 && !editPhotos.allReady)} onClick={saveEditPost}>Сохранить</Button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        <FeedPostText content={p.content} className="mt-3" />
                        <ChatPhotoGrid photos={p.photos} layout="post" postId={p.id} authorId={p.authorId} addedAt={p.createdAt} />
                    </>
                )}

                <div className="mt-4 pt-3 border-t border-slate-50 flex items-center gap-4 text-xs font-semibold text-slate-400">
                    <button onClick={handleLike} className="inline-flex items-center gap-1.5 text-slate-400 hover:text-red-500 transition-colors focus:outline-none cursor-pointer group/like">
                        <Heart className={`w-4 h-4 transition-all duration-300 ${p.isLiked ? 'fill-red-400 text-red-400 animate-like-heart' : 'group-hover/like:scale-110'}`} />
                        <span className={p.isLiked ? 'text-red-500' : 'text-slate-500'}>{p.likesCount}</span>
                    </button>

                    {p.commentsAllowed && (
                        <button
                            onClick={openCommentsModal}
                            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-lg transition focus:outline-none cursor-pointer ${
                                isModalOpen ? 'text-[#5C4B7A] bg-[#EDE6F5]' : 'text-slate-400 hover:text-[#5C4B7A] hover:bg-[#EDE6F5]/50'
                            }`}
                        >
                            <MessageCircle className="w-4 h-4" />
                            <span>{p.commentsCount}</span>
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            setShareOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 text-slate-400 hover:text-[#5C4B7A] transition-colors focus:outline-none cursor-pointer"
                        title="Поделиться постом в чате"
                    >
                        <Share2 className="w-4 h-4" />
                    </button>
                    {p.authorId !== currentUserId && (
                        <ReportIconButton
                            onClick={reportPost}
                            className="inline-flex items-center gap-1.5 text-slate-400 hover:text-[#5C4B7A] transition-colors focus:outline-none cursor-pointer"
                            iconClassName="w-4 h-4"
                        />
                    )}

                    <span className="inline-flex items-center gap-1.5 ml-auto font-medium text-slate-400 select-none" title="Просмотры">
                        <Eye className="w-4 h-4 text-slate-300" />
                        <span>{p.viewsCount ?? 0}</span>
                    </span>
                </div>
            </Card>
            </div>

            {/* ПРОДАКШЕН МОДАЛЬНОЕ ОКНО С ФИКСИРОВАННЫМИ БЛОКАМИ */}
            {isModalOpen && createPortal(
                <div
                    className="fixed inset-0 z-[80] flex items-stretch md:items-center justify-center p-0 md:p-4 bg-slate-900/40 backdrop-blur-md animate-fadeIn"
                    data-post-modal
                    onClick={closeCommentsModal}
                >
                    <div
                        className="bg-[#FFFCFA] rounded-none md:rounded-[32px] shadow-[0_20px_44px_-28px_rgba(92,75,122,0.45)] w-full max-w-2xl h-[100dvh] max-h-[100dvh] md:h-auto md:max-h-[85vh] flex flex-col overflow-hidden relative overscroll-contain"
                        onClick={(e) => e.stopPropagation()}
                    >

                        {/* 1. НАМЕРТВО ЗАФИКСИРОВАННАЯ ШАПКА ПОСТА */}
                        <div className="flex items-start justify-between shrink-0 px-5 pb-3 border-b border-[#1C1824]/8 bg-[#FFFCFA] z-10 pt-5 max-md:pt-[max(1.25rem,env(safe-area-inset-top))]">
                            <div className="flex items-start gap-3 min-w-0">
                                <button
                                    type="button"
                                    onClick={openAuthorProfile}
                                    className="shrink-0 focus:outline-none cursor-pointer"
                                    title="Открыть страницу автора"
                                >
                                    <img src={getAvatarUrl(p.authorId, p.authorAvatarUrl)} className="w-10 h-10 rounded-full object-cover border border-slate-100 shadow-sm" alt="" />
                                </button>
                                <div className="min-w-0">
                                    <button
                                        type="button"
                                        onClick={openAuthorProfile}
                                        className="font-bold text-sm text-slate-900 hover:text-[#5C4B7A] focus:outline-none text-left cursor-pointer truncate max-w-full"
                                        title="Открыть страницу автора"
                                    >
                                        {authorDisplayName}
                                    </button>
                                    <div className="text-[11px] text-slate-400 font-medium mt-0.5">
                                        {new Date(p.createdAt).toLocaleDateString('ru-RU', { month: 'long', day: 'numeric' })}
                                    </div>
                                </div>
                            </div>
                            <button onClick={closeCommentsModal} className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-50 transition cursor-pointer">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* 2. НАМЕРТВО ЗАФИКСИРОВАННЫЙ ТЕКСТ ПОСТА И ЛАЙКИ */}
                        <div className="shrink-0 px-5 py-3 bg-[#EFEAF6]/50 border-b border-[#1C1824]/8 min-w-0">
                            <div className="max-h-[30vh] overflow-y-auto min-w-0">
                                <p className={POST_TEXT_CLASS}>{p.content}</p>
                            </div>
                            <ChatPhotoGrid photos={p.photos} layout="post" postId={p.id} authorId={p.authorId} addedAt={p.createdAt} />
                            <div className="mt-3 flex items-center gap-4 text-xs font-semibold text-slate-400">
                                <button onClick={handleLike} className="inline-flex items-center gap-1.5 text-slate-400 hover:text-red-500 transition-colors focus:outline-none cursor-pointer group/modal-like" type="button">
                                    <Heart className={`w-4 h-4 transition-all duration-300 ${p.isLiked ? 'fill-red-400 text-red-400' : 'group-hover/modal-like:scale-110'}`} />
                                    <span className={p.isLiked ? 'text-red-500' : 'text-slate-500'}>{p.likesCount}</span>
                                </button>
                                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5C4B7A] bg-[#EDE6F5] px-2 py-0.5 rounded-lg">
                                    <MessageCircle className="w-4 h-4" />
                                    <span>{p.commentsCount}</span>
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setShareOpen(true)}
                                    className="inline-flex items-center gap-1.5 text-slate-400 hover:text-[#5C4B7A] transition-colors focus:outline-none cursor-pointer"
                                    title="Поделиться постом в чате"
                                >
                                    <Share2 className="w-4 h-4" />
                                </button>
                                {p.authorId !== currentUserId && (
                                    <ReportIconButton
                                        onClick={reportPost}
                                        className="inline-flex items-center gap-1.5 text-slate-400 hover:text-[#5C4B7A] transition-colors focus:outline-none cursor-pointer"
                                        iconClassName="w-4 h-4"
                                    />
                                )}
                                <span className="inline-flex items-center gap-1.5 ml-auto font-medium text-slate-400 select-none">
                                    <Eye className="w-4 h-4 text-slate-300" />
                                    <span>{p.viewsCount ?? 0}</span>
                                </span>
                            </div>
                        </div>

                        {/* 3. ЗОНА СКРОЛЛА: ПРОКРУЧИВАЕТСЯ СТРОГО ВНУТРИ ЭТОГО КОНТЕЙНЕРА */}
                        <div className="flex-1 min-h-0 flex flex-col relative bg-[#EFEAF6]/30">
                            <PostComments
                                className="flex-1 min-h-0"
                                listScrollRef={modalScrollRef}
                                onListScroll={handleScroll}
                                comments={commentsState.items}
                                hasMore={commentsState.hasMore}
                                onLoadMore={loadMoreComments}
                                loading={commentsLoading}
                                loadFailed={commentsLoadFailed}
                                onRetryLoad={() => { void loadComments(highlightedCommentId); }}
                                currentUserId={currentUserId}
                                postOwnerId={p.authorId}
                                currentUserAvatar={getAvatarUrl(currentUserId, user?.avatarUrl)}
                                canComment={Boolean(p.commentsAllowed && p.canComment)}
                                highlightedCommentId={highlightedCommentId}
                                onAdd={(text, reply) => {
                                    addComment(text, reply);
                                    setTimeout(scrollToBottom, 60);
                                }}
                                onDelete={async (cid) => {
                                    try {
                                        await api.delete(`/api/v1/social/comments/private/${cid}`);
                                        setCommentsState(prev => ({ ...prev, items: prev.items.filter(c => c.id !== cid) }));
                                        const nextCount = Math.max(0, p.commentsCount - 1);
                                        setLocalPost(prev => ({ ...prev, commentsCount: nextCount }));
                                        onPostCommentCountChanged?.(p.id, nextCount);
                                    } catch (error) {
                                        console.error('Ошибка удаления комментария:', error);
                                        showAppInfoToast('Комментарий', 'Не удалось удалить комментарий');
                                    }
                                }}
                                onEdit={async (cid, text) => {
                                    setCommentsState(prev => ({ ...prev, items: prev.items.map(c => c.id === cid ? { ...c, text } : c) }));
                                }}
                                onVote={(cid, likesCount, dislikesCount, myVote) => {
                                    setCommentsState(prev => ({
                                        ...prev,
                                        items: prev.items.map(c => c.id === cid ? { ...c, likesCount, dislikesCount, myVote } : c)
                                    }));
                                }}
                                onOpenProfile={(id) => {
                                    closeCommentsModal();
                                    openNeighborProfile(id);
                                }}
                            />
                        </div>

                        {/* ПЛАВАЮЩАЯ ПАСТЕЛЬНАЯ СТРЕЛОЧКА ДЛЯ БЫСТРОГО СПУСКА */}
                        {showScrollDown && (
                            <button onClick={scrollToBottom} className="absolute bottom-24 right-8 z-20 w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-[#5C4B7A] hover:bg-[#EDE6F5] hover:border-[#5C4B7A]/30 shadow-md flex items-center justify-center transition-all duration-300 transform scale-100 hover:scale-110 cursor-pointer animate-bounce" title="Спуститься к свежим комментариям">
                                <ArrowDown className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </div>,
                document.body
            )}

            <ForwardModal
                isOpen={shareOpen}
                onClose={() => setShareOpen(false)}
                onSelectChats={handleSharePost}
            />


        </>
    );
}
