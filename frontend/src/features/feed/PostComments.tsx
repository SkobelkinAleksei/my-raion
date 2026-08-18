import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Send, X, Pencil, Check, Reply, ThumbsUp, ThumbsDown } from 'lucide-react';
import { theme } from '@/shared/ui/theme';
import api from '@/shared/lib/api';
import { ReportIconButton, useReport } from '@/features/report/ReportModal';
import SegmentedRingLoader, { ParticipantsLoadRetry } from '@/shared/ui/SegmentedRingLoader';

export interface Comment {
    id: number;
    authorId: number;
    authorName: string;
    avatar: string;
    text: string;
    createdAt: string;
    replyToUserId?: number | null;
    replyToAuthorName?: string | null;
    likesCount?: number;
    dislikesCount?: number;
    myVote?: string | null;
}

export type CommentReplyTarget = {
    userId: number;
    commentId: number;
    name: string;
};

interface PostCommentsProps {
    comments: Comment[];
    hasMore: boolean;
    onLoadMore: () => void;
    currentUserId: number;
    postOwnerId: number;
    currentUserAvatar: string;
    canComment?: boolean;
    onAdd: (text: string, reply?: CommentReplyTarget) => void;
    onDelete: (commentId: number) => void;
    onEdit: (commentId: number, newText: string) => void;
    onOpenProfile: (authorId: number) => void;
    onVote?: (commentId: number, likesCount: number, dislikesCount: number, myVote: string | null) => void;
    highlightedCommentId?: number | null;
    className?: string;
    listScrollRef?: React.Ref<HTMLDivElement>;
    onListScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
    loading?: boolean;
    loadFailed?: boolean;
    onRetryLoad?: () => void;
}

export default function PostComments({
                                         comments,
                                         hasMore,
                                         onLoadMore,
                                         currentUserId,
                                         postOwnerId,
                                         currentUserAvatar,
                                         canComment = true,
                                         onAdd,
                                         onDelete,
                                         onEdit,
                                         onOpenProfile,
                                         onVote,
                                         highlightedCommentId,
                                         className = '',
                                         listScrollRef,
                                         onListScroll,
                                         loading = false,
                                         loadFailed = false,
                                         onRetryLoad,
                                     }: PostCommentsProps) {
    const [draft, setDraft] = useState('');
    const [editingComment, setEditingComment] = useState<Comment | null>(null);
    const [replyTo, setReplyTo] = useState<CommentReplyTarget | null>(null);
    const [flashId, setFlashId] = useState<number | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const voteInFlight = useRef<Set<number>>(new Set());
    const caretToEndRef = useRef(false);
    const { openReport } = useReport();

    useEffect(() => {
        const id = Number(highlightedCommentId);
        if (!Number.isFinite(id) || id <= 0) return;
        setFlashId(id);
        const scrollTimer = window.setTimeout(() => {
            document.getElementById(`comment-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
        const clearTimer = window.setTimeout(() => {
            setFlashId((current) => (current === id ? null : current));
        }, 1000);
        return () => {
            window.clearTimeout(scrollTimer);
            window.clearTimeout(clearTimer);
        };
    }, [highlightedCommentId]);

    useLayoutEffect(() => {
        if (!caretToEndRef.current) return;
        caretToEndRef.current = false;
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        const pos = el.value.length;
        el.setSelectionRange(pos, pos);
    }, [draft, replyTo]);

    const handleSubmit = async () => {
        if (!draft.trim()) return;

        if (editingComment) {
            if (editingComment.id < 0) {
                onEdit(editingComment.id, draft.trim());
                setEditingComment(null);
                setDraft('');
                return;
            }

            try {
                await api.put(`/api/v1/social/comments/private/${editingComment.id}`, {
                    content: draft.trim()
                });
                onEdit(editingComment.id, draft.trim());
                setEditingComment(null);
                setDraft('');
            } catch (error) {
                console.error("Ошибка при обновлении комментария:", error);
            }
        } else {
            onAdd(draft.trim(), replyTo || undefined);
            setDraft('');
            setReplyTo(null);
        }
    };

    const handleCancelEdit = () => {
        setEditingComment(null);
        setDraft('');
    };

    const startReply = (c: Comment) => {
        setEditingComment(null);
        const mention = `@${c.authorName} `;
        caretToEndRef.current = true;
        setReplyTo({
            userId: c.authorId,
            commentId: c.id,
            name: c.authorName,
        });
        setDraft(mention);
    };

    const toggleVote = async (c: Comment, vote: 'LIKE' | 'DISLIKE') => {
        if (c.id < 0 || voteInFlight.current.has(c.id)) return;
        voteInFlight.current.add(c.id);
        const prevLike = Number(c.likesCount) || 0;
        const prevDislike = Number(c.dislikesCount) || 0;
        const prevMine = c.myVote || null;
        let nextMine: string | null = vote;
        let nextLike = prevLike;
        let nextDislike = prevDislike;
        if (prevMine === vote) {
            nextMine = null;
            if (vote === 'LIKE') nextLike = Math.max(0, prevLike - 1);
            else nextDislike = Math.max(0, prevDislike - 1);
        } else if (prevMine === 'LIKE' && vote === 'DISLIKE') {
            nextLike = Math.max(0, prevLike - 1);
            nextDislike = prevDislike + 1;
        } else if (prevMine === 'DISLIKE' && vote === 'LIKE') {
            nextDislike = Math.max(0, prevDislike - 1);
            nextLike = prevLike + 1;
        } else if (vote === 'LIKE') {
            nextLike = prevLike + 1;
        } else {
            nextDislike = prevDislike + 1;
        }
        onVote?.(c.id, nextLike, nextDislike, nextMine);
        try {
            const res = await api.post(`/api/v1/social/comments/public/${c.id}/vote`, { vote });
            onVote?.(c.id, Number(res.data?.likesCount) || 0, Number(res.data?.dislikesCount) || 0, res.data?.myVote ?? null);
        } catch (error) {
            onVote?.(c.id, prevLike, prevDislike, prevMine);
            console.error('Ошибка голоса за комментарий:', error);
        } finally {
            voteInFlight.current.delete(c.id);
        }
    };

    return (
        <div className={`flex flex-col h-full min-h-0 bg-slate-50/50 ${className}`}>
            <div
                ref={listScrollRef}
                onScroll={onListScroll}
                className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3"
            >
            {loading && comments.length === 0 ? (
                <SegmentedRingLoader />
            ) : loadFailed && comments.length === 0 ? (
                <ParticipantsLoadRetry onRetry={() => onRetryLoad?.()} />
            ) : null}
            {hasMore && !loading && (
                <div className="w-full flex justify-center pb-2 pt-0.5">
                    <button
                        type="button"
                        onClick={onLoadMore}
                        className="text-[12px] font-medium text-slate-400 hover:text-[#5C4B7A] bg-white hover:bg-slate-50 border border-slate-200 px-4 py-1.5 rounded-xl transition-all duration-200 cursor-pointer shadow-sm select-none"
                    >
                        Показать другие комментарии
                    </button>
                </div>
            )}
            {comments.length > 0 && (
                <div className="space-y-2.5">
                    {comments.map((c) => {
                        const isCommentAuthor = c.authorId === currentUserId;
                        const canDelete = isCommentAuthor || postOwnerId === currentUserId;
                        const isCurrentEditing = editingComment?.id === c.id;
                        const isHighlighted = flashId != null && Number(flashId) > 0 && Number(flashId) === Number(c.id);
                        const liked = c.myVote === 'LIKE';
                        const disliked = c.myVote === 'DISLIKE';

                        return (
                            <div
                                key={c.id}
                                id={`comment-${c.id}`}
                                className={`group flex items-start gap-2.5 border rounded-xl px-3 py-2.5 transition-all duration-500 ${
                                    isHighlighted
                                        ? 'bg-[#EDE6F5] border-[#5C4B7A]/40 shadow-sm ring-2 ring-[#5C4B7A]/15 scale-[1.01]'
                                        : 'bg-white border-slate-200'
                                }`}
                            >
                                <button
                                    onClick={() => onOpenProfile?.(c.authorId)}
                                    className="shrink-0 cursor-pointer focus:outline-none"
                                    type="button"
                                >
                                    <img src={c.avatar} alt={c.authorName} className="w-8 h-8 rounded-full object-cover" />
                                </button>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <button
                                            onClick={() => onOpenProfile?.(c.authorId)}
                                            className="text-sm font-semibold text-slate-900 cursor-pointer focus:outline-none"
                                            type="button"
                                        >
                                            {c.authorName}
                                        </button>
                                        <span className="text-[11px] text-slate-400">
                                          {c.createdAt ? (
                                              <>
                                                  {new Date(c.createdAt).toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' })}
                                                  {`, ${new Date(c.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`}
                                              </>
                                          ) : (
                                              'только что'
                                          )}
                                        </span>
                                    </div>
                                    {c.replyToAuthorName && (
                                        <div className="text-[11px] text-[#5C4B7A] mt-0.5 font-medium">
                                            ответ {c.replyToAuthorName}
                                        </div>
                                    )}
                                    <p className={`text-sm mt-0.5 leading-relaxed break-words transition-colors ${isCurrentEditing ? 'text-slate-400 italic' : 'text-slate-700'}`}>
                                        {c.text}
                                    </p>
                                    <div className="mt-1.5 flex items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={() => toggleVote(c, 'LIKE')}
                                            className={`inline-flex items-center gap-1 max-lg:min-h-11 max-lg:pr-1 text-[11px] font-semibold transition ${liked ? 'text-[#5C4B7A]' : 'text-slate-400 lg:hover:text-[#5C4B7A]'}`}
                                        >
                                            <ThumbsUp className={`w-3.5 h-3.5 ${liked ? 'fill-[#5C4B7A]' : ''}`} />
                                            <span>{Number(c.likesCount) || 0}</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => toggleVote(c, 'DISLIKE')}
                                            className={`inline-flex items-center gap-1 max-lg:min-h-11 max-lg:pr-1 text-[11px] font-semibold transition ${disliked ? 'text-[#B85C5C]' : 'text-slate-400 lg:hover:text-[#B85C5C]'}`}
                                        >
                                            <ThumbsDown className={`w-3.5 h-3.5 ${disliked ? 'fill-[#B85C5C]' : ''}`} />
                                            <span>{Number(c.dislikesCount) || 0}</span>
                                        </button>
                                        {canComment && !isCurrentEditing && (
                                            <button
                                                type="button"
                                                onClick={() => startReply(c)}
                                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-[#5C4B7A] transition"
                                            >
                                                <Reply className="w-3.5 h-3.5" />
                                                Ответить
                                            </button>
                                        )}
                                        {!isCommentAuthor && c.id > 0 && (
                                            <ReportIconButton
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    openReport({
                                                        category: 'COMMENT',
                                                        accusedId: c.authorId,
                                                        accusedName: c.authorName,
                                                        targetId: c.id,
                                                        targetTitle: 'Комментарий',
                                                        snapshotText: c.text,
                                                    });
                                                }}
                                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-[#5C4B7A] transition"
                                                iconClassName="w-3.5 h-3.5"
                                            />
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    {isCommentAuthor && !isCurrentEditing && (
                                        <button
                                            onClick={() => { setReplyTo(null); setEditingComment(c); setDraft(c.text); }}
                                            className="p-1 rounded-md text-slate-300 lg:hover:text-[#5C4B7A] lg:hover:bg-[#EDE6F5] transition opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                                            type="button"
                                        >
                                            <Pencil className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                    {canDelete && (
                                        <button
                                            onClick={() => onDelete(c.id)}
                                            className="p-1 rounded-md text-slate-300 lg:hover:text-red-500 lg:hover:bg-red-50 transition opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                                            type="button"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            </div>
            {(canComment || editingComment) && (
            <div className="shrink-0 px-4 py-3 border-t border-slate-200 bg-[#FFFCFA] space-y-2" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
                {editingComment && (
                    <div className="flex items-center justify-between bg-slate-50 border-l-2 border-slate-400 px-3 py-1.5 rounded-r-xl text-xs text-slate-600 animate-fadeIn mx-0.5">
                        <div className="flex flex-col min-w-0 pr-4">
                            <span className="font-bold text-slate-400 text-[10px] uppercase tracking-wider">Редактирование</span>
                            <span className="truncate italic text-slate-600 mt-0.5 font-medium">"{editingComment.text}"</span>
                        </div>
                        <button type="button" onClick={handleCancelEdit} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition shrink-0">
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}
                {replyTo && !editingComment && (
                    <div className="flex items-center justify-between bg-[#EDE6F5] border-l-2 border-[#5C4B7A] px-3 py-1.5 rounded-r-xl text-xs text-[#5C4B7A] animate-fadeIn mx-0.5">
                        <div className="flex flex-col min-w-0 pr-4">
                            <span className="font-bold text-[10px] uppercase tracking-wider">Ответ</span>
                            <span className="truncate font-medium mt-0.5">{replyTo.name}</span>
                        </div>
                        <button type="button" onClick={() => setReplyTo(null)} className="p-1 text-[#5C4B7A]/70 hover:text-[#5C4B7A] hover:bg-white/60 rounded-lg transition shrink-0">
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}
                <div className="flex items-center gap-2">
                    <button onClick={() => onOpenProfile?.(currentUserId)} className="shrink-0 cursor-pointer focus:outline-none" type="button">
                        <img src={currentUserAvatar} alt="" className="w-8 h-8 rounded-full object-cover shadow-sm" />
                    </button>
                    <div className="flex-1 relative">
                        <input
                            ref={inputRef}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                            maxLength={1000}
                            placeholder={editingComment ? "Изменить комментарий..." : (replyTo ? `Ответ для ${replyTo.name}…` : "Написать комментарий…")}
                            className={`w-full pl-3 ${editingComment ? 'pr-20' : 'pr-11'} py-2 text-sm bg-white border ${theme.surface.border} rounded-full focus:outline-none focus:ring-2 ${theme.accent.ring} transition text-slate-800`}
                        />
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
                            {editingComment ? (
                                <>
                                    <button onClick={handleSubmit} disabled={!draft.trim()} className="w-7 h-7 rounded-full bg-[#EDE6F5] hover:bg-[#DDD4F0] text-[#5C4B7A] flex items-center justify-center transition disabled:opacity-40" type="button">
                                        <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button onClick={handleCancelEdit} className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition shadow-sm" type="button">
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </>
                            ) : (
                                <button onClick={handleSubmit} disabled={!draft.trim()} className={`w-8 h-8 rounded-full ${theme.accent.bg} ${theme.accent.bgHover} text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition`} type="button">
                                    <Send className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            )}
        </div>
    );
}
