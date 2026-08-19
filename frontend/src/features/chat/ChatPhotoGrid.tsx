import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '@/shared/lib/api';
import { Bookmark, ChevronLeft, ChevronRight, Heart, MessageSquare, Share2, Trash2, X } from 'lucide-react';
import { resolveChatPhotoUrl, toStoredChatPhoto } from '@/features/chat/chatPhotos';
import { useAuth } from '@/shared/context/AuthContext';
import { useChat } from '@/features/chat/ChatContext';
import ForwardModal from '@/features/chat/ForwardModal';
import SavePhotoModal from '@/features/photos/SavePhotoModal';
import PostComments, { Comment } from '@/features/feed/PostComments';
import { publishChatMessages } from '@/shared/utils/shareToChat';
import { showAppInfoToast, showAppConfirm } from '@/shared/utils/appToast';
import { getAvatarUrl, openNeighborProfile, isCompactViewport, COMPACT_VIEWPORT_MQ } from '@/shared/utils/navigation';
import { useAppBackHandler } from '@/shared/hooks/useAppBackHandler';
import { useNotification } from '@/shared/context/NotificationContext';
import { ReportIconButton, useReport, type ReportTarget } from '@/features/report/ReportModal';
import PinchZoomImage from '@/shared/ui/PinchZoomImage';
import {
  countPhotoComments,
  createPhotoComment,
  fetchPhotoComments,
  fetchPhotoLikeStatus,
  PhotoLikeKind,
  photoLikeTargetKey,
  togglePhotoLike,
} from '@/shared/utils/photoGallery';

export type PhotoLightboxLikeSpec = {
  allowLike?: boolean;
  allowSave?: boolean;
  allowComment?: boolean;
  kind?: PhotoLikeKind;
  ownerId?: number;
  postId?: number;
  photoIds?: Array<number | undefined>;
};

export type ChatLightboxMeta = {
  senderName?: string;
  timestamp?: string;
  messageId?: number;
};

export type ChatPhotoReport = {
  accusedId: number;
  accusedName?: string;
  targetId: number;
  roomId?: number;
};

function formatPhotoSentAt(iso?: string | number | Date | null): string {
  if (iso == null || iso === '') return '';
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ChatMediaLightbox({
  urls,
  index,
  onClose,
  onIndexChange,
  meta,
  onGoToMessage,
  likeSpec,
  onDelete,
  openCommentsOnMount,
  highlightCommentId,
  messageReport,
}: {
  urls: string[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  meta?: ChatLightboxMeta[];
  onGoToMessage?: (messageId: number) => void;
  likeSpec?: PhotoLightboxLikeSpec;
  onDelete?: (index: number) => void | Promise<void>;
  openCommentsOnMount?: boolean;
  highlightCommentId?: number | null;
  messageReport?: ChatPhotoReport;
}) {
  const pointerStartX = useRef<number | null>(null);
  const pointerStartY = useRef<number | null>(null);
  const dragging = useRef(false);
  const swipeAxis = useRef<'x' | 'y' | null>(null);
  const activePointers = useRef(new Set<number>());
  const [dragX, setDragX] = useState(0);
  const [dragY, setDragY] = useState(0);
  const ignoreClick = useRef(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsPage, setCommentsPage] = useState(0);
  const [commentsHasMore, setCommentsHasMore] = useState(false);
  const [commentsCount, setCommentsCount] = useState(0);
  const [canComment, setCanComment] = useState(true);
  const [highlightedCommentId, setHighlightedCommentId] = useState<number | null>(highlightCommentId ?? null);
  const [compact, setCompact] = useState(() => isCompactViewport());
  const { stompClient } = useChat();
  const { stompClient: notifyStomp, stompConnected } = useNotification() as any;
  const { user } = useAuth();
  const { openReport } = useReport();

  useEffect(() => {
    const mq = window.matchMedia(COMPACT_VIEWPORT_MQ);
    const onChange = () => setCompact(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useAppBackHandler(true, () => {
    if (commentsOpen) setCommentsOpen(false);
    else onClose();
  });
  const allowSave = likeSpec?.allowSave !== false;
  const allowLike = Boolean(likeSpec?.allowLike && likeSpec?.kind);
  const currentPhotoId = likeSpec?.photoIds?.[index];
  const commentKind = likeSpec?.kind === 'GALLERY' || likeSpec?.kind === 'AVATAR' ? likeSpec.kind : undefined;
  const allowComment = Boolean(likeSpec?.allowComment && commentKind && currentPhotoId);
  const likeKey = allowLike && likeSpec?.kind
    ? photoLikeTargetKey(likeSpec.kind, urls[index], currentPhotoId, likeSpec.ownerId)
    : '';

  useEffect(() => {
    if (!allowLike || !likeSpec?.kind || !likeKey) {
      setLiked(false);
      setLikesCount(0);
      return;
    }
    fetchPhotoLikeStatus({
      kind: likeSpec.kind,
      targetKey: likeKey,
      ownerId: likeSpec.ownerId,
      postId: likeSpec.postId,
    }).then((data) => {
      setLiked(Boolean(data.liked));
      setLikesCount(Number(data.likesCount) || 0);
    }).catch(() => undefined);
  }, [allowLike, likeKey, likeSpec?.kind, likeSpec?.ownerId, likeSpec?.postId]);

  const mapCommentDto = (c: any): Comment => {
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

  const loadComments = async (pageToLoad = 0) => {
    if (!allowComment || !commentKind || !currentPhotoId) return;
    try {
      const [pageData, total] = await Promise.all([
        fetchPhotoComments(commentKind, currentPhotoId, pageToLoad, highlightedCommentId ? 50 : 5),
        pageToLoad === 0 ? countPhotoComments(commentKind, currentPhotoId) : Promise.resolve(commentsCount),
      ]);
      const raw = pageData.content || [];
      const mapped = raw.map(mapCommentDto);
      const chronological = [...mapped].reverse();
      setComments((prev) => (pageToLoad === 0 ? chronological : [...chronological, ...prev]));
      setCommentsPage(pageToLoad + 1);
      setCommentsHasMore(!pageData.last);
      if (pageToLoad === 0) setCommentsCount(Number(pageData.totalElements ?? total) || 0);
    } catch {
      if (pageToLoad === 0) {
        setComments([]);
        setCommentsCount(0);
      }
    }
  };

  useEffect(() => {
    setComments([]);
    setCommentsPage(0);
    setCommentsHasMore(false);
    setCommentsCount(0);
    setCanComment(true);
    if (allowComment && currentPhotoId && commentKind) {
      countPhotoComments(commentKind, currentPhotoId).then(setCommentsCount).catch(() => setCommentsCount(0));
    }
  }, [index, allowComment, currentPhotoId, commentKind]);

  useEffect(() => {
    if (openCommentsOnMount && allowComment) {
      setCommentsOpen(true);
      if (highlightCommentId) setHighlightedCommentId(highlightCommentId);
    }
  }, [openCommentsOnMount, allowComment, highlightCommentId]);

  useEffect(() => {
    if (!highlightedCommentId) return;
    const timer = window.setTimeout(() => setHighlightedCommentId(null), 1100);
    return () => window.clearTimeout(timer);
  }, [highlightedCommentId]);

  useEffect(() => {
    if (!notifyStomp?.connected || !stompConnected || !commentKind || !currentPhotoId) return;
    const sub = notifyStomp.subscribe(
      `/topic/photos/${commentKind}/${currentPhotoId}/comments`,
      (message: any) => {
        const body = JSON.parse(message.body);
        if (!body) return;
        if (body.eventType === 'VOTE' && body.id) {
          setComments((prev) => prev.map((item) => Number(item.id) === Number(body.id)
            ? { ...item, likesCount: Number(body.likesCount) || 0, dislikesCount: Number(body.dislikesCount) || 0 }
            : item));
          return;
        }
        if (body.eventType === 'EDIT' && body.id) {
          setComments((prev) => prev.map((item) => Number(item.id) === Number(body.id)
            ? { ...item, text: body.content ?? item.text }
            : item));
          return;
        }
        if (body.eventType && body.eventType !== 'COMMENT') return;
        if (Number(body.authorId) === Number(user?.id)) return;
        const incomingId = Number(body.id);
        if (!incomingId) return;
        setComments((prev) => {
          if (prev.some((item) => Number(item.id) === incomingId)) return prev;
          setCommentsCount((n) => n + 1);
          return [...prev, mapCommentDto(body)];
        });
      }
    );
    return () => sub.unsubscribe();
  }, [notifyStomp, stompConnected, commentKind, currentPhotoId, user?.id]);

  useEffect(() => {
    if (commentsOpen) loadComments(0);
  }, [commentsOpen, currentPhotoId]);
  const canNav = urls.length > 1;
  const go = (dir: number) => onIndexChange((index + dir + urls.length) % urls.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (forwardOpen || saveOpen) return;
        if (commentsOpen) {
          setCommentsOpen(false);
          return;
        }
        onClose();
      }
      const typing = e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
      if (typing) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, urls.length, forwardOpen, saveOpen, commentsOpen]);

  useEffect(() => {
    setDragX(0);
    setDragY(0);
  }, [index]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overscrollBehavior;
    const prevBody = body.style.overscrollBehavior;
    html.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';
    return () => {
      html.style.overscrollBehavior = prevHtml;
      body.style.overscrollBehavior = prevBody;
    };
  }, []);

  const current = meta?.[index];
  const sentAt = formatPhotoSentAt(current?.timestamp);
  const canJump = Boolean(onGoToMessage && current?.messageId);

  const handleForwardPhoto = (targets: { recipientId?: number; chatId?: number }[], comment?: string) => {
    const photo = toStoredChatPhoto(urls[index]);
    if (!photo) {
      showAppInfoToast('Фото', 'Не удалось переслать это изображение');
      return;
    }
    publishChatMessages(stompClient, user, targets, {
      content: comment?.trim() || '',
      photos: [photo],
    });
  };

  const handleToggleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!allowLike || !likeSpec?.kind || !likeKey) return;
    try {
      const data = await togglePhotoLike({
        kind: likeSpec.kind,
        targetKey: likeKey,
        ownerId: likeSpec.ownerId,
        postId: likeSpec.postId,
      });
      setLiked(Boolean(data.liked));
      setLikesCount(Number(data.likesCount) || 0);
    } catch (error: any) {
      showAppInfoToast('Фото', error?.response?.data?.detail || 'Не удалось поставить лайк');
    }
  };

  const toolbarBtn =
    'h-9 sm:h-10 px-2 sm:px-3.5 rounded-full bg-white/90 border border-[#1A1916]/10 text-[#1A1916] flex items-center gap-1.5 hover:bg-white transition shrink-0';

  const photoReport = ((): ReportTarget | null => {
    if (!user) return null;
    const me = Number(user.id);
    const ownerId = Number(likeSpec?.ownerId || 0);
    if (likeSpec?.kind === 'GALLERY' && currentPhotoId && ownerId && ownerId !== me) {
      return { category: 'PHOTO', accusedId: ownerId, targetId: Number(currentPhotoId), targetTitle: 'GALLERY', snapshotText: urls[index] };
    }
    if (likeSpec?.kind === 'AVATAR' && currentPhotoId && ownerId && ownerId !== me) {
      return { category: 'PHOTO', accusedId: ownerId, targetId: Number(currentPhotoId), targetTitle: 'AVATAR', snapshotText: urls[index] };
    }
    if (likeSpec?.kind === 'POST' && likeSpec.postId && ownerId && ownerId !== me) {
      return { category: 'POST', accusedId: ownerId, targetId: Number(likeSpec.postId), targetTitle: 'Пост', snapshotText: urls[index] };
    }
    if (messageReport && Number(messageReport.accusedId) !== me && messageReport.targetId) {
      return {
        category: 'MESSAGE',
        accusedId: Number(messageReport.accusedId),
        accusedName: messageReport.accusedName,
        targetId: Number(messageReport.targetId),
        roomId: messageReport.roomId,
        targetTitle: 'Фото в чате',
        snapshotText: urls[index],
      };
    }
    return null;
  })();

  const beginSwipe = (e: React.PointerEvent) => {
    activePointers.current.add(e.pointerId);
    if (activePointers.current.size >= 2) {
      dragging.current = false;
      swipeAxis.current = null;
      pointerStartX.current = null;
      pointerStartY.current = null;
      setDragX(0);
      setDragY(0);
      ignoreClick.current = true;
      try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
      return;
    }
    if (commentsOpen || forwardOpen || saveOpen) return;
    if ((e.target as HTMLElement).closest('button')) return;
    pointerStartX.current = e.clientX;
    pointerStartY.current = e.clientY;
    dragging.current = true;
    swipeAxis.current = null;
    ignoreClick.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const moveSwipe = (e: React.PointerEvent) => {
    if (activePointers.current.size >= 2) return;
    if (!dragging.current || pointerStartX.current == null || pointerStartY.current == null) return;
    const dx = e.clientX - pointerStartX.current;
    const dy = e.clientY - pointerStartY.current;
    if (!swipeAxis.current) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dx) >= Math.abs(dy)) swipeAxis.current = 'x';
      else if (dy < 0) swipeAxis.current = 'y';
      else return;
    }
    if (swipeAxis.current === 'x' && canNav) setDragX(dx);
    if (swipeAxis.current === 'y' && dy < 0) setDragY(dy);
  };

  const endSwipe = (e: React.PointerEvent) => {
    activePointers.current.delete(e.pointerId);
    if (!dragging.current) return;
    dragging.current = false;
    const dx = pointerStartX.current == null ? 0 : e.clientX - pointerStartX.current;
    const dy = pointerStartY.current == null ? 0 : e.clientY - pointerStartY.current;
    const axis = swipeAxis.current;
    pointerStartX.current = null;
    pointerStartY.current = null;
    swipeAxis.current = null;
    setDragX(0);
    setDragY(0);
    if (axis === 'x' && canNav && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) {
      ignoreClick.current = true;
      go(dx < 0 ? 1 : -1);
      return;
    }
    if (axis === 'y' && isCompactViewport() && dy < -64) {
      ignoreClick.current = true;
      onClose();
    }
  };

  const commentsScreen = Boolean(commentsOpen && allowComment && commentKind && currentPhotoId && user);
  const compactComments = commentsScreen && compact;
  const desktopComments = commentsScreen && !compact;

  const commentsPanel = user ? (
        <div
          className="flex-1 min-h-0 flex flex-col bg-[#FFFCFA] h-full"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div
            className="shrink-0 px-4 pb-3 border-b border-[#1A1916]/10 flex items-center justify-between"
            style={{ paddingTop: compactComments ? 'max(0.75rem, env(safe-area-inset-top))' : '0.75rem' }}
          >
            <div className="myraion-display text-xl text-[#1C1824]">Комментарии</div>
            <button
              type="button"
              onClick={() => setCommentsOpen(false)}
              className="w-11 h-11 rounded-full hover:bg-[#EDE6F5] flex items-center justify-center"
              aria-label="Закрыть комментарии"
            >
              <X className="w-5 h-5 text-[#1C1824]" />
            </button>
          </div>
          <PostComments
            className="flex-1 min-h-0"
            comments={comments}
            hasMore={commentsHasMore}
            onLoadMore={() => loadComments(commentsPage)}
            currentUserId={Number(user.id)}
            postOwnerId={Number(likeSpec?.ownerId || user.id)}
            currentUserAvatar={getAvatarUrl(user.id, user.avatarUrl)}
            canComment={canComment}
            onAdd={async (text, reply) => {
              if (!commentKind || !currentPhotoId) return;
              try {
                const created = await createPhotoComment(commentKind, currentPhotoId, text, reply);
                setComments((prev) => [...prev, mapCommentDto(created)]);
                setCommentsCount((n) => n + 1);
              } catch (error: any) {
                if (error?.response?.status === 403) setCanComment(false);
                showAppInfoToast('Комментарий', error?.response?.data?.detail || 'Не удалось отправить комментарий');
              }
            }}
            onDelete={async (commentId) => {
              try {
                await api.delete(`/api/v1/social/comments/private/${commentId}`);
                setComments((prev) => prev.filter((item) => item.id !== commentId));
                setCommentsCount((n) => Math.max(0, n - 1));
              } catch (error: any) {
                showAppInfoToast('Комментарий', error?.response?.data?.detail || 'Не удалось удалить');
              }
            }}
            onEdit={(commentId, newText) => {
              setComments((prev) => prev.map((item) => item.id === commentId ? { ...item, text: newText } : item));
            }}
            onVote={(commentId, likesCount, dislikesCount, myVote) => {
              setComments((prev) => prev.map((item) => item.id === commentId ? { ...item, likesCount, dislikesCount, myVote } : item));
            }}
            highlightedCommentId={highlightedCommentId}
            onOpenProfile={(authorId) => {
              setCommentsOpen(false);
              onClose();
              openNeighborProfile(authorId);
            }}
          />
        </div>
  ) : null;

  return createPortal(
    <>
    <div
      className={`fixed inset-0 z-[85] bg-[#1A1916]/88 backdrop-blur-md animate-in fade-in duration-200 flex ${desktopComments ? 'flex-row' : 'flex-col'}`}
      data-photo-swipe
      onClick={() => {
        if (commentsScreen || forwardOpen || saveOpen) return;
        if (ignoreClick.current) {
          ignoreClick.current = false;
          return;
        }
        onClose();
      }}
    >
      {compactComments ? commentsPanel : (
        <>
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <div
        className="shrink-0 z-20 flex items-center gap-2 px-3 pb-2"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 flex-1">
          {current?.senderName ? (
            <div className="text-[13px] font-semibold text-white truncate">{current.senderName}</div>
          ) : null}
          <div className="text-[11px] text-white/75">
            {sentAt ? `Добавлено ${sentAt}` : 'Дата добавления неизвестна'}
          </div>
        </div>
        {canJump ? (
          <button
            type="button"
            onClick={() => onGoToMessage?.(current!.messageId!)}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/90 text-[#5C4B7A] text-[12px] font-semibold hover:bg-white"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            К сообщению
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/90 border border-[#1A1916]/10 text-[#1A1916] flex items-center justify-center hover:bg-white transition shrink-0"
          aria-label="Закрыть"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div
        className="relative flex-1 min-h-0 overflow-hidden touch-none"
        onPointerDown={beginSwipe}
        onPointerMove={moveSwipe}
        onPointerUp={endSwipe}
        onPointerCancel={(e) => {
          activePointers.current.delete(e.pointerId);
          dragging.current = false;
          swipeAxis.current = null;
          pointerStartX.current = null;
          pointerStartY.current = null;
          setDragX(0);
          setDragY(0);
        }}
        style={{
          transform: `translateY(${dragY}px)`,
          opacity: dragY ? Math.max(0.35, 1 - Math.abs(dragY) / 380) : 1,
          transition: dragging.current ? 'none' : 'transform 280ms ease, opacity 280ms ease',
        }}
      >
        <div
          className="flex h-full"
          style={{
            transform: `translateX(calc(${-index * 100}% + ${dragX}px))`,
            transition: dragging.current ? 'none' : 'transform 480ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          {urls.map((url, i) => (
            <div key={`${url}-${i}`} className="min-w-full h-full flex items-center justify-center px-4 sm:px-14">
              <PinchZoomImage
                src={url}
                alt=""
                className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl select-none"
              />
            </div>
          ))}
        </div>
        {canNav && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                go(-1);
              }}
              className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-white/90 border border-[#1A1916]/10 text-[#1A1916] flex items-center justify-center hover:bg-white transition z-10"
              aria-label="Предыдущее фото"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                go(1);
              }}
              className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-white/90 border border-[#1A1916]/10 text-[#1A1916] flex items-center justify-center hover:bg-white transition z-10"
              aria-label="Следующее фото"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}
      </div>

      <div
        className="shrink-0 z-20 flex flex-col items-center gap-2 px-3 pb-3"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        {canNav && (
          <div className="flex items-center gap-1.5 max-w-full overflow-x-auto px-1 py-1">
            {urls.map((url, i) => (
              <button
                key={`thumb-${url}-${i}`}
                type="button"
                onClick={() => onIndexChange(i)}
                className={`h-11 w-11 shrink-0 rounded-lg overflow-hidden border-2 transition ${
                  i === index ? 'border-white scale-110 shadow-md' : 'border-transparent opacity-70 hover:opacity-100'
                }`}
              >
                <img src={url} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1.5 max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setForwardOpen(true);
            }}
            className={toolbarBtn}
            aria-label="Переслать"
          >
            <Share2 className="w-4 h-4" />
            <span className="hidden sm:inline text-[12px] font-semibold">Переслать</span>
          </button>
          {photoReport && (
            <ReportIconButton
              onClick={(e) => {
                e.stopPropagation();
                openReport(photoReport);
              }}
              className={toolbarBtn}
              iconClassName="w-4 h-4"
            />
          )}
          {allowLike && (
            <button
              type="button"
              onClick={handleToggleLike}
              className={toolbarBtn}
              aria-label="Лайк"
            >
              <Heart className={`w-4 h-4 ${liked ? 'fill-red-400 text-red-400' : ''}`} />
              <span className="text-[12px] font-semibold">{likesCount}</span>
            </button>
          )}
          {allowComment && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setCommentsOpen(true);
              }}
              className={toolbarBtn}
              aria-label="Комментарии"
            >
              <MessageSquare className="w-4 h-4" />
              <span className="text-[12px] font-semibold">{commentsCount}</span>
            </button>
          )}
          {allowSave && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSaveOpen(true);
              }}
              className={toolbarBtn}
              aria-label="Сохранить"
            >
              <Bookmark className="w-4 h-4" />
              <span className="hidden sm:inline text-[12px] font-semibold">Сохранить</span>
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              disabled={deleting}
              onClick={async (e) => {
                e.stopPropagation();
                const confirmed = await showAppConfirm({
                  title: 'Удалить фото',
                  message: 'Фото будет удалено.',
                  confirmText: 'Удалить',
                  cancelText: 'Отмена',
                  danger: true,
                });
                if (!confirmed) return;
                setDeleting(true);
                try {
                  await onDelete(index);
                } finally {
                  setDeleting(false);
                }
              }}
              className="h-9 sm:h-10 px-2 sm:px-3.5 rounded-full bg-white/90 border border-[#1A1916]/10 text-[#B85C5C] flex items-center gap-1.5 hover:bg-white transition shrink-0 disabled:opacity-50"
              aria-label="Удалить"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline text-[12px] font-semibold">{deleting ? '...' : 'Удалить'}</span>
            </button>
          )}
          {canNav && (
            <span className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-white/90 text-[#1A1916]">
              {index + 1} / {urls.length}
            </span>
          )}
        </div>
      </div>
      </div>
      {desktopComments ? (
        <div className="w-[min(420px,42vw)] shrink-0 h-full border-l border-[#1A1916]/10">
          {commentsPanel}
        </div>
      ) : null}
        </>
      )}
    </div>
    <ForwardModal
      isOpen={forwardOpen}
      onClose={() => setForwardOpen(false)}
      onSelectChats={handleForwardPhoto}
    />
    <SavePhotoModal
      isOpen={saveOpen}
      sourceUrl={urls[index]}
      photoId={currentPhotoId}
      onClose={() => setSaveOpen(false)}
    />
    </>,
    document.body
  );
}

function PostPhotoCollage({
  urls,
  onOpen,
}: {
  urls: string[];
  onOpen: (index: number) => void;
}) {
  if (urls.length === 1) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(0);
        }}
        className="mt-3 w-full overflow-hidden rounded-2xl bg-[#EDE6F5] cursor-zoom-in"
      >
        <img src={urls[0]} alt="" className="w-full max-h-[360px] object-cover" />
      </button>
    );
  }

  if (urls.length === 2) {
    return (
      <div className="mt-3 grid grid-cols-2 gap-1 h-56 rounded-2xl overflow-hidden">
        {urls.map((url, i) => (
          <button
            key={`${url}-${i}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(i);
            }}
            className="h-full overflow-hidden bg-[#EDE6F5] cursor-zoom-in"
          >
            <img src={url} alt="" className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
    );
  }

  const extra = urls.length - 3;
  return (
    <div className="mt-3 grid grid-cols-2 grid-rows-2 gap-1 h-72 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(0);
        }}
        className="row-span-2 overflow-hidden bg-[#EDE6F5] cursor-zoom-in"
      >
        <img src={urls[0]} alt="" className="w-full h-full object-cover" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(1);
        }}
        className="overflow-hidden bg-[#EDE6F5] cursor-zoom-in"
      >
        <img src={urls[1]} alt="" className="w-full h-full object-cover" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(2);
        }}
        className="relative overflow-hidden bg-[#EDE6F5] cursor-zoom-in"
      >
        <img src={urls[2]} alt="" className="w-full h-full object-cover" />
        {extra > 0 && (
          <div className="absolute inset-0 bg-[#1A1916]/50 flex items-center justify-center">
            <span className="text-white text-[22px] font-semibold tracking-wide">+{extra}</span>
          </div>
        )}
      </button>
    </div>
  );
}

export default function ChatPhotoGrid({
  photos,
  layout = 'chat',
  postId,
  authorId,
  addedAt,
  messageReport,
}: {
  photos?: string[] | null;
  layout?: 'chat' | 'post';
  postId?: number;
  authorId?: number;
  addedAt?: string | string[] | null;
  messageReport?: ChatPhotoReport;
}) {
  const urls = (photos || []).map((item) => resolveChatPhotoUrl(item)).filter(Boolean);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  if (!urls.length) return null;

  const cols = urls.length === 1 ? 'grid-cols-1' : urls.length === 2 ? 'grid-cols-2' : 'grid-cols-3';
  const meta = urls.map((_, i) => ({
    timestamp: Array.isArray(addedAt) ? addedAt[i] : (addedAt || undefined),
  }));

  return (
    <>
      {layout === 'post' ? (
        <PostPhotoCollage urls={urls} onOpen={setLightboxIndex} />
      ) : (
        <div className={`grid ${cols} gap-1 mb-1.5 max-w-[260px]`}>
          {urls.map((url, i) => (
            <button
              key={`${url}-${i}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(i);
              }}
              className={`overflow-hidden rounded-xl bg-[#EDE6F5] ${urls.length === 1 ? 'h-48' : 'h-24'} cursor-zoom-in`}
            >
              <img src={url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {lightboxIndex != null && (
        <ChatMediaLightbox
          urls={urls}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
          meta={meta}
          likeSpec={{
            allowSave: true,
            allowLike: layout === 'post' && !!postId,
            kind: layout === 'post' ? 'POST' : undefined,
            postId,
            ownerId: authorId,
          }}
          messageReport={messageReport}
        />
      )}
    </>
  );
}

export { ChatMediaLightbox };
