import React, { useEffect, useRef, useState } from 'react';
import {
    X,
    Calendar,
    MapPin,
    Users,
    ThumbsUp,
    ThumbsDown,
    Send,
    Pencil,
    Trash2,
    CheckCircle2,
    Clock,
    AlertTriangle,
    Zap,
    Sparkles,
    Copy,
    Share2, Plus, UserPlus, ChevronDown, ChevronLeft, ChevronRight, Maximize2, Bookmark, Lock
} from 'lucide-react';
import { createPortal } from 'react-dom';
import Button from '@/shared/ui/Button';
import StatusMenuButton from '@/shared/ui/StatusMenuButton';
import api from '@/shared/lib/api';
import { runWithTimeoutRetry } from '@/shared/lib/loadWithTimeoutRetry';
import SegmentedRingLoader, { ParticipantsLoadRetry } from '@/shared/ui/SegmentedRingLoader';
import { EventDto } from '@/features/map/DistrictMapSection';
import { useAuth } from "@/shared/context/AuthContext";
import { useAppBackHandler } from '@/shared/hooks/useAppBackHandler';
import { openNeighborProfile, getAvatarUrl, isCompactViewport } from "@/shared/utils/navigation";
import { showAppInfoToast, showAppConfirm } from "@/shared/utils/appToast";
import { eventGalleryUrls } from '@/features/events/eventPhotos';
import { reputationWindow, reputationPendingLabel } from '@/features/events/reputationWindow';
import { toStoredChatPhoto } from '@/features/chat/chatPhotos';
import { publishChatMessages } from '@/shared/utils/shareToChat';
import ForwardModal from '@/features/chat/ForwardModal';
import SavePhotoModal from '@/features/photos/SavePhotoModal';
import { useChat } from '@/features/chat/ChatContext';
import { ReportIconButton, useReport, type ReportTarget } from '@/features/report/ReportModal';

interface EventDetailsModalProps {
    event: EventDto | EventDto[] | null;
    onClose: () => void;
    onJoin: (event: any) => void;
    onApply: (event: any) => void;
    onCancelEvent: (event: any) => void;
    onEditEvent: (event: any) => void;
    onLeave: (eventId: number) => void;
    openParticipantsImmediately?: boolean;
}

interface ParticipantUser {
    userId: number;
    firstName: string;
    lastName: string;
    avatarUrl?: string | null;
}

interface VoteData {
    targetId: number;
    voteType: 'PLUS' | 'MINUS';
}

const CATEGORY_META: Record<string, { icon: any; cls: string }> = {
    SOS: { icon: AlertTriangle, cls: 'bg-[#B85C5C] text-white' },
    'ДВИЖ': { icon: Zap, cls: 'bg-[#5C4B7A] text-white' },
    'СОБЫТИЯ': { icon: Sparkles, cls: 'bg-[#3D6B56] text-white' },
};
const modalOrganizerCache: Record<number, string> = {};

interface OrganizerNameModalProps {
    organizerId: number;
    currentUserId?: number;
}

export function OrganizerNameModal({ organizerId, currentUserId }: OrganizerNameModalProps) {
    const [name, setName] = useState<string>(`Сосед #${organizerId}`);
    useEffect(() => {
        if (!organizerId) return;
        const orgIdNum = Number(organizerId);
        if (isNaN(orgIdNum)) {
            setName('Сосед');
            return;
        }
        if (currentUserId && orgIdNum === Number(currentUserId)) {
            setName('Вы');
            return;
        }
        if (modalOrganizerCache[orgIdNum]) {
            setName(modalOrganizerCache[orgIdNum]);
            return;
        }
        api.get(`/api/v1/social/users/${orgIdNum}`)
            .then((res: any) => {
                const { firstName, lastName } = res.data;
                if (firstName) {
                    const formattedName = `${firstName} ${lastName ? lastName.charAt(0) + '.' : ''}`.trim();
                    modalOrganizerCache[orgIdNum] = formattedName;
                    setName(formattedName);
                }
            })
            .catch(() => {
                setName(`Сосед #${orgIdNum}`);
            });
    }, [organizerId, currentUserId]);
    return <span className="truncate">{name}</span>;
}

function goToOrganizer(organizerId: number | undefined, onClose?: () => void) {
    const id = Number(organizerId || 0);
    if (!id) return;
    onClose?.();
    openNeighborProfile(id);
}

function isEventPhotosHidden(item: any, currentUserId?: number): boolean {
    const isPrivate = !!item?.isPrivate || item?.privacy === 'approval';
    if (!isPrivate) return false;
    const organizerId = Number(item?.organizerId || item?.organizer_id || 0);
    const isOwner = item?.role === 'organizer' || (organizerId > 0 && organizerId === Number(currentUserId));
    if (isOwner) return false;
    const status = String(item?.user_status || item?.userStatus || '').toUpperCase().trim();
    return status !== 'JOINED';
}

function EventPhotosLockedBanner({ className = 'h-44' }: { className?: string }) {
    return (
        <div className={`relative overflow-hidden bg-slate-200/80 flex flex-col items-center justify-center text-slate-400 gap-2 ${className}`}>
            <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-md text-slate-500">
                <Lock className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-bold text-slate-500/90 tracking-wide mt-1">
                Фото откроется после одобрения
            </span>
        </div>
    );
}

function eventReportTarget(item: any, userId?: number): ReportTarget | null {
    if (!item || !userId) return null;
    const organizerId = Number(item.organizerId || item.organizer_id || 0);
    const eventId = Number(item.id);
    if (!organizerId || !eventId || organizerId === Number(userId)) return null;
    return {
        category: 'EVENT',
        accusedId: organizerId,
        targetId: eventId,
        targetTitle: item.title || 'Событие',
        snapshotText: item.description || item.title || 'Событие',
    };
}

function EventPhotoCarousel({ urls, className = 'h-44', report }: { urls: string[]; className?: string; report?: ReportTarget | null }) {
    const [index, setIndex] = useState(0);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [forwardOpen, setForwardOpen] = useState(false);
    const [saveOpen, setSaveOpen] = useState(false);
    const scrollerRef = useRef<HTMLDivElement>(null);
    const ignoreClick = useRef(false);
    const pointerStartX = useRef<number | null>(null);
    const pointerStartY = useRef<number | null>(null);
    const dragging = useRef(false);
    const swipeAxis = useRef<'x' | 'y' | null>(null);
    const [dragX, setDragX] = useState(0);
    const [dragY, setDragY] = useState(0);
    const { stompClient } = useChat();
    const { user } = useAuth();
    const { openReport } = useReport();

    const lightboxOpenRef = useRef(false);
    lightboxOpenRef.current = lightboxOpen;

    const scrollToIndex = (next: number, smooth = true) => {
        const el = scrollerRef.current;
        if (el) el.scrollTo({ left: next * el.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
    };

    const go = (dir: number) => {
        setIndex((i) => {
            const len = urls.length;
            if (!len) return i;
            const next = (i + dir + len) % len;
            if (!lightboxOpenRef.current) scrollToIndex(next);
            return next;
        });
    };

    useEffect(() => {
        setIndex(0);
        setLightboxOpen(false);
        const el = scrollerRef.current;
        if (el) el.scrollTo({ left: 0 });
    }, [urls.join('|')]);

    useEffect(() => {
        if (!lightboxOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (forwardOpen || saveOpen) return;
                setLightboxOpen(false);
            }
            if (e.key === 'ArrowLeft') go(-1);
            if (e.key === 'ArrowRight') go(1);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [lightboxOpen, urls.length, forwardOpen, saveOpen]);

    useEffect(() => {
        setDragX(0);
        setDragY(0);
    }, [index, lightboxOpen]);

    useEffect(() => {
        if (lightboxOpen) return;
        scrollToIndex(index, false);
    }, [lightboxOpen]);

    if (!urls.length) return null;

    const canNav = urls.length > 1;

    const resetSwipe = () => {
        dragging.current = false;
        swipeAxis.current = null;
        pointerStartX.current = null;
        pointerStartY.current = null;
        setDragX(0);
        setDragY(0);
    };

    const beginSwipe = (e: React.PointerEvent) => {
        if (forwardOpen || saveOpen) return;
        if ((e.target as HTMLElement).closest('button')) return;
        pointerStartX.current = e.clientX;
        pointerStartY.current = e.clientY;
        dragging.current = true;
        swipeAxis.current = null;
        ignoreClick.current = false;
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };

    const moveSwipe = (e: React.PointerEvent) => {
        if (!dragging.current || pointerStartX.current == null || pointerStartY.current == null) return;
        const dx = e.clientX - pointerStartX.current;
        const dy = e.clientY - pointerStartY.current;
        if (!swipeAxis.current) {
            if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
            swipeAxis.current = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
        }
        if (swipeAxis.current === 'x' && canNav) setDragX(dx);
        if (swipeAxis.current === 'y' && isCompactViewport()) setDragY(dy);
    };

    const endSwipe = (e: React.PointerEvent) => {
        if (!dragging.current) return;
        const dx = pointerStartX.current == null ? 0 : e.clientX - pointerStartX.current;
        const dy = pointerStartY.current == null ? 0 : e.clientY - pointerStartY.current;
        const axis = swipeAxis.current;
        resetSwipe();
        if (axis === 'x' && canNav && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) {
            ignoreClick.current = true;
            go(dx < 0 ? 1 : -1);
            return;
        }
        if (axis === 'y' && isCompactViewport() && dy < -64) {
            ignoreClick.current = true;
            setLightboxOpen(false);
        }
    };

    const openLightbox = () => {
        if (ignoreClick.current) {
            ignoreClick.current = false;
            return;
        }
        setLightboxOpen(true);
    };

    const navButtons = (size: 'sm' | 'lg') => canNav && (
        <>
            <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                    e.stopPropagation();
                    go(-1);
                }}
                className={`${size === 'lg' ? 'w-11 h-11' : 'w-8 h-8'} absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 border border-[#1A1916]/10 text-[#1A1916] flex items-center justify-center hover:bg-white transition z-10`}
                aria-label="Предыдущее фото"
            >
                <ChevronLeft className={size === 'lg' ? 'w-5 h-5' : 'w-4 h-4'} />
            </button>
            <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                    e.stopPropagation();
                    go(1);
                }}
                className={`${size === 'lg' ? 'w-11 h-11' : 'w-8 h-8'} absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/90 border border-[#1A1916]/10 text-[#1A1916] flex items-center justify-center hover:bg-white transition z-10`}
                aria-label="Следующее фото"
            >
                <ChevronRight className={size === 'lg' ? 'w-5 h-5' : 'w-4 h-4'} />
            </button>
        </>
    );

    return (
        <>
            <div
                data-photo-swipe
                className={`relative ${className} shrink-0 overflow-hidden bg-[#EDE6F5] cursor-zoom-in touch-pan-x`}
                onClick={openLightbox}
            >
                <div
                    ref={scrollerRef}
                    className="w-full h-full flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory touch-pan-x [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                    onScroll={(e) => {
                        if (lightboxOpenRef.current) return;
                        const el = e.currentTarget;
                        if (!el.clientWidth) return;
                        const next = Math.round(el.scrollLeft / el.clientWidth);
                        if (next !== index) {
                            ignoreClick.current = true;
                            setIndex(Math.max(0, Math.min(urls.length - 1, next)));
                            window.setTimeout(() => {
                                ignoreClick.current = false;
                            }, 280);
                        }
                    }}
                >
                    {urls.map((url, i) => (
                        <img
                            key={`${url}-${i}`}
                            src={url}
                            alt=""
                            className="min-w-full w-full h-full object-cover select-none pointer-events-none snap-center shrink-0"
                            draggable={false}
                        />
                    ))}
                </div>
                <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                        e.stopPropagation();
                        setLightboxOpen(true);
                    }}
                    className="absolute bottom-3 right-3 w-8 h-8 rounded-full bg-[#1A1916]/70 text-white flex items-center justify-center hover:bg-[#1A1916] transition z-10"
                    aria-label="Открыть фото"
                    title="Открыть фото"
                >
                    <Maximize2 className="w-3.5 h-3.5" />
                </button>
                {navButtons('sm')}
                {canNav && (
                    <>
                        <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 z-10">
                            {urls.map((_, i) => (
                                <button
                                    key={i}
                                    type="button"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setIndex(i);
                                        scrollToIndex(i);
                                    }}
                                    className={`h-1.5 rounded-full transition ${i === index ? 'w-5 bg-white' : 'w-1.5 bg-white/55'}`}
                                    aria-label={`Фото ${i + 1}`}
                                />
                            ))}
                        </div>
                        <div className="absolute top-3 left-3 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#1A1916]/70 text-white z-10">
                            {index + 1} / {urls.length}
                        </div>
                    </>
                )}
            </div>
            {lightboxOpen && createPortal(
                <>
                <div
                    data-photo-swipe
                    className="fixed inset-0 z-[80] bg-[#1A1916]/85 backdrop-blur-md flex flex-col animate-in fade-in duration-200"
                    onClick={() => {
                        if (forwardOpen || saveOpen) return;
                        if (ignoreClick.current) {
                            ignoreClick.current = false;
                            return;
                        }
                        setLightboxOpen(false);
                    }}
                >
                    <div
                        className="lg:hidden shrink-0 z-20 flex items-center gap-2 px-3 pb-2"
                        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="min-w-0 flex-1 text-[11px] text-white/75">
                            {canNav ? `${index + 1} / ${urls.length}` : null}
                        </div>
                        <button
                            type="button"
                            onClick={() => setLightboxOpen(false)}
                            className="w-10 h-10 rounded-full bg-white/90 border border-[#1A1916]/10 text-[#1A1916] flex items-center justify-center hover:bg-white transition shrink-0"
                            aria-label="Закрыть"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="hidden lg:flex absolute top-5 left-5 items-center gap-2 z-20">
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setForwardOpen(true);
                            }}
                            className="h-10 px-3.5 rounded-full bg-white/90 border border-[#1A1916]/10 text-[#1A1916] flex items-center gap-2 hover:bg-white transition"
                            aria-label="Переслать"
                        >
                            <Share2 className="w-4 h-4" />
                            <span className="text-[12px] font-semibold">Переслать</span>
                        </button>
                        {report && (
                            <ReportIconButton
                                onClick={(e) => {
                                    e.stopPropagation();
                                    openReport({ ...report, snapshotText: urls[index] || report.snapshotText });
                                }}
                                className="h-10 w-10 rounded-full bg-white/90 border border-[#1A1916]/10 text-[#1A1916] flex items-center justify-center hover:bg-white transition"
                                iconClassName="w-4 h-4"
                            />
                        )}
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setSaveOpen(true);
                            }}
                            className="h-10 px-3.5 rounded-full bg-white/90 border border-[#1A1916]/10 text-[#1A1916] flex items-center gap-2 hover:bg-white transition"
                            aria-label="Сохранить"
                        >
                            <Bookmark className="w-4 h-4" />
                            <span className="text-[12px] font-semibold">Сохранить</span>
                        </button>
                    </div>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            setLightboxOpen(false);
                        }}
                        className="hidden lg:flex absolute top-5 right-5 w-10 h-10 rounded-full bg-white/90 border border-[#1A1916]/10 text-[#1A1916] items-center justify-center hover:bg-white transition z-20"
                        aria-label="Закрыть"
                    >
                        <X className="w-4 h-4" />
                    </button>
                    {canNav && (
                        <div className="hidden lg:block absolute top-6 left-1/2 -translate-x-1/2 text-[11px] uppercase tracking-wider px-3 py-1 rounded-full bg-white/90 text-[#1A1916] z-20 pointer-events-none">
                            {index + 1} / {urls.length}
                        </div>
                    )}
                    <div
                        className="relative flex-1 min-h-0 overflow-hidden touch-none"
                        onPointerDown={beginSwipe}
                        onPointerMove={moveSwipe}
                        onPointerUp={endSwipe}
                        onPointerCancel={resetSwipe}
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
                                transition: dragging.current ? 'none' : 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)',
                                willChange: 'transform',
                            }}
                        >
                            {urls.map((url, i) => (
                                <div key={`${url}-lb-${i}`} className="min-w-full h-full shrink-0 flex items-center justify-center px-4 lg:px-14">
                                    <img
                                        src={url}
                                        alt=""
                                        className="max-w-[92vw] max-h-[86vh] object-contain rounded-2xl shadow-2xl select-none"
                                        draggable={false}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                </div>
                            ))}
                        </div>
                        {navButtons('lg')}
                    </div>
                    {canNav && (
                        <div className="hidden lg:flex absolute bottom-6 left-0 right-0 justify-center gap-2 z-20">
                            {urls.map((_, i) => (
                                <button
                                    key={i}
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setIndex(i);
                                    }}
                                    className={`h-2 rounded-full transition ${i === index ? 'w-7 bg-white' : 'w-2 bg-white/50 hover:bg-white/80'}`}
                                    aria-label={`Фото ${i + 1}`}
                                />
                            ))}
                        </div>
                    )}
                    <div
                        className="lg:hidden shrink-0 z-20 flex flex-col items-center gap-2 px-3 pt-2"
                        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {canNav && (
                            <div className="flex justify-center gap-2">
                                {urls.map((_, i) => (
                                    <button
                                        key={i}
                                        type="button"
                                        onClick={() => setIndex(i)}
                                        className={`h-2 rounded-full transition ${i === index ? 'w-7 bg-white' : 'w-2 bg-white/50'}`}
                                        aria-label={`Фото ${i + 1}`}
                                    />
                                ))}
                            </div>
                        )}
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={() => setForwardOpen(true)}
                                className="h-10 px-3.5 rounded-full bg-white/90 border border-[#1A1916]/10 text-[#1A1916] flex items-center gap-1.5 hover:bg-white transition"
                                aria-label="Переслать"
                            >
                                <Share2 className="w-4 h-4" />
                                <span className="text-[12px] font-semibold">Переслать</span>
                            </button>
                            {report && (
                                <ReportIconButton
                                    onClick={() => openReport({ ...report, snapshotText: urls[index] || report.snapshotText })}
                                    className="h-10 w-10 rounded-full bg-white/90 border border-[#1A1916]/10 text-[#1A1916] flex items-center justify-center hover:bg-white transition"
                                    iconClassName="w-4 h-4"
                                />
                            )}
                            <button
                                type="button"
                                onClick={() => setSaveOpen(true)}
                                className="h-10 px-3.5 rounded-full bg-white/90 border border-[#1A1916]/10 text-[#1A1916] flex items-center gap-1.5 hover:bg-white transition"
                                aria-label="Сохранить"
                            >
                                <Bookmark className="w-4 h-4" />
                                <span className="text-[12px] font-semibold">Сохранить</span>
                            </button>
                        </div>
                    </div>
                </div>
                <ForwardModal
                    isOpen={forwardOpen}
                    onClose={() => setForwardOpen(false)}
                    onSelectChats={(targets, comment) => {
                        const photo = toStoredChatPhoto(urls[index]);
                        if (!photo) {
                            showAppInfoToast('Фото', 'Не удалось переслать это изображение');
                            return;
                        }
                        const ok = publishChatMessages(stompClient, user, targets, {
                            content: comment?.trim() || '',
                            photos: [photo],
                        });
                        if (ok) showAppInfoToast('Фото', 'Фото отправлено в выбранные чаты');
                    }}
                />
                <SavePhotoModal
                    isOpen={saveOpen}
                    sourceUrl={urls[index]}
                    onClose={() => setSaveOpen(false)}
                />
                </>,
                document.body
            )}
        </>
    );
}

function eventMoment(item: any) {
    return item?.eventDate || item?.eventDateIso || null;
}

export default function EventDetailsModal({
                                              event,
                                              onClose,
                                              onJoin,
                                              onApply,
                                              onCancelEvent,
                                              onEditEvent,
                                              onLeave,
                                              openParticipantsImmediately
                                          }: EventDetailsModalProps) {
    const { user } = useAuth();
    const { openReport } = useReport();
    const { stompClient } = useChat();
    const [isShareModalOpen, setIsShareModalOpen] = useState(false);
    const [confirmCancel, setConfirmCancel] = useState<number | null>(null);
    const [showParticipantsId, setShowParticipantsId] = useState<number | null>(null);
    const showParticipantsIdRef = useRef<number | null>(null);
    showParticipantsIdRef.current = showParticipantsId;
    const participantsBlockRef = useRef<HTMLDivElement>(null);
    const [participantsList, setParticipantsList] = useState<ParticipantUser[]>([]);
    const [participantsLoading, setParticipantsLoading] = useState(false);
    const [participantsLoadFailed, setParticipantsLoadFailed] = useState(false);
    const participantsLoadingRef = useRef(false);
    const participantsLoadFailedRef = useRef(false);
    const participantsAbortRef = useRef<AbortController | null>(null);
    const lastParticipantsEventIdRef = useRef<number | null>(null);
    const [bannedParticipantsList, setBannedParticipantsList] = useState<ParticipantUser[]>([]);
    const [restoreLoadingId, setRestoreLoadingId] = useState<number | null>(null);
    const [showBannedList, setShowBannedList] = useState(false);
    const [myVotes, setMyVotes] = useState<VoteData[]>([]);
    const [votingLoading, setVotingLoading] = useState<string | null>(null);
    const [participantCountOverrides, setParticipantCountOverrides] = useState<Record<number, number>>({});

    const eventsList: EventDto[] = React.useMemo(() => {
        if (!event) return [];
        return Array.isArray(event) ? event : [event];
    }, [event]);

    useEffect(() => {
        if (event && openParticipantsImmediately) {
            const eventIdNum = Array.isArray(event) ? Number(event[0]?.id) : Number(event?.id);
            if (eventIdNum) {
                const windowState = reputationWindow(
                    eventMoment(event),
                    (event as any).reputationOpensAt,
                    (event as any).reputationClosesAt,
                );
                const isPast = !!(event as any).isPast || (event as any).status === 'past' || windowState.started;
                handleOpenParticipantsList(eventIdNum, isPast || windowState.open);
            }
        }
    }, [event, openParticipantsImmediately]);

    const closeParticipantsPanel = () => {
        participantsAbortRef.current?.abort();
        participantsAbortRef.current = null;
        participantsLoadingRef.current = false;
        participantsLoadFailedRef.current = false;
        setShowParticipantsId(null);
        setParticipantsLoading(false);
        setParticipantsLoadFailed(false);
    };

    const handleOpenParticipantsList = async (eventId: number, isPast: boolean) => {
        if (showParticipantsIdRef.current === eventId) {
            if (participantsLoadingRef.current) return;
            if (!participantsLoadFailedRef.current) {
                closeParticipantsPanel();
                return;
            }
        } else if (participantsLoadingRef.current) {
            return;
        }

        participantsAbortRef.current?.abort();
        const ac = new AbortController();
        participantsAbortRef.current = ac;
        participantsLoadingRef.current = true;
        participantsLoadFailedRef.current = false;

        if (lastParticipantsEventIdRef.current !== eventId) {
            setParticipantsList([]);
            setBannedParticipantsList([]);
            setMyVotes([]);
        }
        setShowParticipantsId(eventId);
        setParticipantsLoading(true);
        setParticipantsLoadFailed(false);
        setShowBannedList(false);

        try {
            await runWithTimeoutRetry(async (signal) => {
                const eventItem = eventsList.find((e) => Number(e.id) === Number(eventId));
                const organizerId = eventItem
                    ? Number(eventItem.organizerId || (eventItem as any).organizer_id || 0)
                    : 0;
                const isOwnerOpen = Boolean(
                    user?.id && (
                        (eventItem as any)?.role === 'organizer'
                        || Number(organizerId) === Number(user.id)
                    )
                );
                const [partRes, bannedRes] = await Promise.all([
                    api.get(`/api/v1/social/events/${eventId}/participants`, { signal }),
                    isOwnerOpen
                        ? api.get(`/api/v1/social/events/${eventId}/participants/banned`, { signal }).catch((err) => {
                            if (signal.aborted) throw err;
                            return { data: [] };
                        })
                        : Promise.resolve({ data: [] })
                ]);
                if (signal.aborted || participantsAbortRef.current !== ac) return;
                setParticipantsList(partRes.data || []);
                setBannedParticipantsList(bannedRes.data || []);
                lastParticipantsEventIdRef.current = eventId;
                const joinedCount = Array.isArray(partRes.data) ? partRes.data.length : 0;
                if (joinedCount > 0) {
                    setParticipantCountOverrides((prev) => ({ ...prev, [eventId]: joinedCount }));
                }
                if (isPast && user?.id) {
                    try {
                        const votesRes = await api.get(`/api/v1/social/events/reputation/my-votes/${eventId}`, { signal });
                        if (signal.aborted || participantsAbortRef.current !== ac) return;
                        setMyVotes(votesRes.data || []);
                    } catch (voteErr) {
                        if (signal.aborted) throw voteErr;
                    }
                }
            }, ac.signal);
        } catch (err) {
            if (participantsAbortRef.current !== ac || ac.signal.aborted) return;
            console.error("Ошибка загрузки списка участников или репутации:", err);
            participantsLoadFailedRef.current = true;
            setParticipantsLoadFailed(true);
        } finally {
            if (participantsAbortRef.current === ac) {
                participantsLoadingRef.current = false;
                setParticipantsLoading(false);
            }
        }
    };

    const handleVote = async (eventId: number, targetId: number, type: 'PLUS' | 'MINUS') => {
        if (votingLoading) return;
        setVotingLoading(`${targetId}-${type}`);
        try {
            await api.post('/api/v1/social/events/reputation/vote', null, {
                params: { eventId, targetId, voteType: type }
            });
            setMyVotes((prev) => {
                const existingIdx = prev.findIndex(v => v && Number(v.targetId) === Number(targetId));
                if (existingIdx > -1) {
                    if (prev[existingIdx].voteType === type) {
                        return prev.filter(v => Number(v.targetId) !== Number(targetId));
                    }
                    const updated = [...prev];
                    updated[existingIdx] = { ...updated[existingIdx], voteType: type };
                    return updated;
                }
                return [...prev, { targetId, voteType: type }];
            });
        } catch (err) {
            console.error("Не удалось зафиксировать оценку репутации:", err);
        } finally {
            setVotingLoading(null);
        }
    };

    const handleKickParticipant = async (eventId: number, kickedUserId: number) => {
        // Защита от повторных случайных кликов (используем уже существующий стейт загрузки)
        if (votingLoading) return;

        const confirmed = await showAppConfirm({
            title: 'Исключить участника',
            message: 'Вы уверены, что хотите принудительно удалить этого участника из события и чата?',
            confirmText: 'Исключить',
            cancelText: 'Отмена',
            danger: true
        });
        if (!confirmed) return;

        setVotingLoading(`kick-${kickedUserId}`);
        try {
            // Вызываем наш новый точечный эндпоинт удаления по userId
            await api.delete(`/api/v1/social/events/${eventId}/participants/kick/${kickedUserId}`);

            const kicked = participantsList.find((p) => Number(p.userId) === Number(kickedUserId));
            setParticipantsList((prev) => {
                const next = prev.filter((p) => Number(p.userId) !== Number(kickedUserId));
                setParticipantCountOverrides((counts) => ({ ...counts, [eventId]: next.length }));
                return next;
            });
            if (kicked) {
                setBannedParticipantsList((prev) => {
                    if (prev.some((b) => Number(b.userId) === Number(kickedUserId))) return prev;
                    return [...prev, kicked];
                });
            }

            console.log(`[Success] Участник ${kickedUserId} успешно исключен из события ${eventId}`);
        } catch (err) {
            console.error("Не удалось исключить участника из события:", err);
            showAppInfoToast('Ошибка', 'Не удалось исключить участника');
        } finally {
            setVotingLoading(null);
        }
    };

    const handleRestoreParticipant = async (eventId: number, restoredUserId: number) => {
        if (restoreLoadingId) return;
        const banned = bannedParticipantsList.find((p) => Number(p.userId) === Number(restoredUserId));
        const confirmed = await showAppConfirm({
            title: 'Вернуть участника',
            message: `Вернуть ${banned?.firstName || 'участника'} во встречу и групповой чат?`,
            confirmText: 'Вернуть',
            cancelText: 'Отмена'
        });
        if (!confirmed) return;
        setRestoreLoadingId(restoredUserId);
        try {
            await api.post(`/api/v1/social/events/${eventId}/participants/restore/${restoredUserId}`);
            setBannedParticipantsList((prev) => {
                const next = prev.filter((p) => Number(p.userId) !== Number(restoredUserId));
                if (next.length === 0) setShowBannedList(false);
                return next;
            });
            if (banned) {
                setParticipantsList((prev) => {
                    if (prev.some((p) => Number(p.userId) === Number(restoredUserId))) return prev;
                    const next = [...prev, banned];
                    setParticipantCountOverrides((counts) => ({ ...counts, [eventId]: next.length }));
                    return next;
                });
            }
        } catch (err) {
            console.error("Не удалось вернуть участника:", err);
            showAppInfoToast('Ошибка', 'Не удалось вернуть участника');
        } finally {
            setRestoreLoadingId(null);
        }
    };


    // ПРОДАКШН-ФИКС: Добавили прием аргумента comment для шэринга карточки встречи
    const handleShareConfirm = (targets: { recipientId?: number; chatId?: number }[], comment?: string) => {
        console.log("[DEBUG SHARING] Метод handleShareConfirm успешно вызван!");
        console.log("[DEBUG SHARING] Строка комментария, пришедшая из инпута:", comment);

        if (!stompClient || !stompClient.connected || !singleEventForHeader) {
            console.warn("[DEBUG SHARING] WebSocket отключен или событие не найдено. stompClient connected:", stompClient?.connected);
            return;
        }

        targets.forEach((target) => {
            // Собираем базовый системный маркер карточки события
            let finalContent = `[SHARE_EVENT:${headerItemIdNum}] Приглашаю на встречу: "${singleEventForHeader.title}"`;

            // Если пользователь написал комментарий в инпуте, склеиваем его через перенос строки
            if (comment && comment.trim() !== '') {
                finalContent = `[SHARE_EVENT:${headerItemIdNum}] Приглашаю на встречу: "${singleEventForHeader.title}"\n${comment.trim()}`;
            }

            console.log("[DEBUG SHARING] Сформирован финальный контент для WebSocket пакета:", JSON.stringify(finalContent));
            const messagePayload = {
                chatId: target.chatId ? Number(target.chatId) : null,
                recipientId: target.recipientId ? Number(target.recipientId) : null,
                content: finalContent, // Отправляем маркер вместе с комментарием
                senderId: user?.id,
                senderFirstName: user?.firstName,
                senderLastName: user?.lastName,
                parentIds: []
            };
            stompClient.publish({ destination: '/app/chat', body: JSON.stringify(messagePayload) });
        });
        console.log("[DEBUG SHARING] Все пакеты расшаривания отправлены!");
    };



    const eventIdentity = Array.isArray(event)
        ? event.map((e) => String(e?.id ?? '')).join(',')
        : String((event as { id?: number } | null)?.id ?? '');

    useEffect(() => {
        participantsAbortRef.current?.abort();
        participantsAbortRef.current = null;
        participantsLoadingRef.current = false;
        participantsLoadFailedRef.current = false;
        setConfirmCancel(null);
        setShowParticipantsId(null);
        setParticipantsLoading(false);
        setParticipantsLoadFailed(false);
    }, [eventIdentity]);

    useEffect(() => {
        if (!showParticipantsId) return;
        const id = window.requestAnimationFrame(() => {
            participantsBlockRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
        return () => window.cancelAnimationFrame(id);
    }, [showParticipantsId]);

    useEffect(() => {
        const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        if (event) document.addEventListener('keydown', onEsc);
        return () => document.removeEventListener('keydown', onEsc);
    }, [event, onClose]);

    useEffect(() => {
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prevOverflow;
        };
    }, []);

    const isCluster = eventsList.length > 1;
    const singleEventForHeader = eventsList[0];
    const headerItemIdNum = singleEventForHeader ? Number(singleEventForHeader.id) : 0;
    const headerOrganizerId = singleEventForHeader ? Number(singleEventForHeader.organizerId || (singleEventForHeader as any).organizer_id || 0) : 0;
    const headerIsPrivate = singleEventForHeader ? !!singleEventForHeader.isPrivate || (singleEventForHeader as any).privacy === 'approval' : false;
    const headerPhotosHidden = singleEventForHeader ? isEventPhotosHidden(singleEventForHeader, user?.id) : false;

    const closeModalSafely = () => {
        closeParticipantsPanel();
        const shield = document.createElement('div');
        shield.setAttribute('aria-hidden', 'true');
        shield.style.cssText = 'position:fixed;inset:0;z-index:2147483647;';
        document.body.appendChild(shield);
        onClose();
        window.setTimeout(() => shield.remove(), 400);
    };

    useAppBackHandler(true, closeModalSafely);
    useAppBackHandler(!!showParticipantsId, closeParticipantsPanel);

    const handleLeaveClick = async (eventId: number) => {
        try {
            await Promise.resolve(onLeave(eventId));
        } catch (err) {
            console.error(err);
        } finally {
            closeModalSafely();
        }
    };

    // Обновление статуса, если организатор отклонил заявку, пока модалка открыта
    useEffect(() => {
        const onStatusRefresh = (e: Event) => {
            const body = (e as CustomEvent).detail;
            if (!body || Number(body.targetId) !== Number(headerItemIdNum)) return;
            if ((window as any).refreshMapAfterDelete) {
                (window as any).refreshMapAfterDelete();
            }
        };
        window.addEventListener('eventStatusRefresh', onStatusRefresh as EventListener);
        return () => window.removeEventListener('eventStatusRefresh', onStatusRefresh as EventListener);
    }, [headerItemIdNum]);

    if (!event || eventsList.length === 0) return null;

    return (
        <>
            <div className="fixed inset-0 z-40 bg-[#1A1916]/45 backdrop-blur-sm animate-in fade-in duration-200" onClick={closeModalSafely} />
            <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4 pointer-events-none">
                <div className="relative pointer-events-auto w-full max-w-2xl h-[100dvh] max-h-[100dvh] md:h-auto md:max-h-[92dvh] bg-[#FAF6F0] rounded-none md:rounded-[28px] shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-bottom-4 md:zoom-in-95 fade-in duration-200 border-0 md:border border-[#1A1916]/10 pt-[env(safe-area-inset-top)] md:pt-0" data-event-modal onClick={(e) => e.stopPropagation()}>
                    <button onClick={closeModalSafely} className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 md:top-4 md:right-4 w-11 h-11 rounded-full bg-white hover:bg-[#F2EBE3] text-[#1A1916] flex items-center justify-center transition z-30 border border-[#1A1916]/10" aria-label="Закрыть">
                        <X className="w-4 h-4" />
                    </button>

                    {!isCluster && singleEventForHeader && (
                        <>
                        {headerPhotosHidden ? (
                            <EventPhotosLockedBanner />
                        ) : (
                            <EventPhotoCarousel urls={eventGalleryUrls(singleEventForHeader as any)} report={eventReportTarget(singleEventForHeader, user?.id)} />
                        )}
                        <div className="flex items-start justify-between border-b border-[#1A1916]/10 px-4 pt-2.5 pb-3 md:px-6 md:pt-3 md:pb-4 gap-3 md:gap-4 shrink-0 pr-14 md:pr-16">
                            <div className="min-w-0 flex-1">
                                <h3 className="myraion-display text-[24px] md:text-[28px] text-[#1A1916] tracking-tight leading-[1.15] break-words">
                                    {singleEventForHeader.title}
                                </h3>
                                <p className="text-sm text-[#6B645C] mt-1.5">
                                    Организатор:{' '}
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            goToOrganizer(headerOrganizerId, onClose);
                                        }}
                                        className="text-[#5C4B7A] hover:underline cursor-pointer font-medium"
                                    >
                                        <OrganizerNameModal organizerId={headerOrganizerId} currentUserId={user?.id} />
                                    </button>
                                </p>
                                <div className="flex flex-wrap items-center gap-2 mt-3 md:hidden">
                                    <button
                                        type="button"
                                        onClick={() => setIsShareModalOpen(true)}
                                        className="w-9 h-9 rounded-full border border-[#1A1916]/12 bg-white text-[#1A1916] flex items-center justify-center active:scale-95"
                                        title="Поделиться событием в чате"
                                        aria-label="Поделиться"
                                    >
                                        <Share2 className="w-3.5 h-3.5" />
                                    </button>
                                    {eventReportTarget(singleEventForHeader, user?.id) && (
                                        <ReportIconButton
                                            onClick={() => openReport(eventReportTarget(singleEventForHeader, user?.id)!)}
                                            className="w-9 h-9 rounded-full border border-[#1A1916]/12 bg-white text-[#1A1916] flex items-center justify-center active:scale-95"
                                            iconClassName="w-3.5 h-3.5"
                                        />
                                    )}
                                    {headerIsPrivate && (
                                        <span className="bg-[#5C4B7A]/80 text-white text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full">
                                            Приватная
                                        </span>
                                    )}
                                    {singleEventForHeader.category && (
                                        <span className={`text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full ${(CATEGORY_META[(singleEventForHeader.category || '').toUpperCase().trim()] || CATEGORY_META['СОБЫТИЯ']).cls}`}>
                                            {singleEventForHeader.category}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="hidden md:flex items-center gap-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setIsShareModalOpen(true)}
                                    className="p-2.5 rounded-full border border-[#1A1916]/12 bg-white text-[#1A1916] hover:border-[#5C4B7A] hover:text-[#5C4B7A] transition active:scale-95 cursor-pointer flex items-center gap-1.5 text-xs"
                                    title="Поделиться событием в чате"
                                >
                                    <Share2 className="w-3.5 h-3.5" />
                                    <span>Поделиться</span>
                                </button>
                                {eventReportTarget(singleEventForHeader, user?.id) && (
                                    <ReportIconButton
                                        onClick={() => openReport(eventReportTarget(singleEventForHeader, user?.id)!)}
                                        className="p-2.5 rounded-full border border-[#1A1916]/12 bg-white text-[#1A1916] hover:border-[#5C4B7A] hover:text-[#5C4B7A] transition active:scale-95 cursor-pointer flex items-center justify-center"
                                        iconClassName="w-3.5 h-3.5"
                                    />
                                )}
                                {headerIsPrivate && (
                                    <span className="bg-[#5C4B7A] text-white text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full">
                                        Приватная
                                    </span>
                                )}
                                {singleEventForHeader.category && (
                                    <span className={`text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full ${(CATEGORY_META[(singleEventForHeader.category || '').toUpperCase().trim()] || CATEGORY_META['СОБЫТИЯ']).cls}`}>
                                        {singleEventForHeader.category}
                                    </span>
                                )}
                            </div>
                        </div>
                        </>
                    )}

                    {isCluster && (
                        <div className="p-4 md:p-5 pr-14 md:pr-5 border-b border-[#1A1916]/10 shrink-0">
                            <h2 className="myraion-display text-xl text-[#1A1916] tracking-tight">События по этому адресу ({eventsList.length})</h2>
                            <p className="text-xs text-[#6B645C] mt-0.5 hidden md:block">Используйте колесико мыши для прокрутки списка</p>
                        </div>
                    )}

                    <div
                        className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 md:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-5 md:space-y-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                    >
                        {eventsList.map((item) => {
                            const itemIdNum = Number(item.id);
                            const catUpper = (item.category || '').toUpperCase().trim();
                            const catMeta = CATEGORY_META[catUpper] || CATEGORY_META['СОБЫТИЯ'];
                            const CatIcon = catMeta.icon;
                            const currentOrganizerId = Number(item.organizerId || (item as any).organizer_id || 0);
                            const isOwner = (item as any).role === 'organizer' || Number(currentOrganizerId) === Number(user?.id);
                            const windowState = reputationWindow(
                                eventMoment(item),
                                (item as any).reputationOpensAt,
                                (item as any).reputationClosesAt,
                            );
                            const isPastEvent = !!item.isPast || (item as any).status === 'past' || (item as any).is_past === true || windowState.started;
                            const canVoteReputation = item.canVoteReputation === true || windowState.open;
                            const currentStatus = String((item as any).user_status || item.userStatus || '').toUpperCase().trim();
                            const isJoined = currentStatus === 'JOINED';
                            const isPending = currentStatus === 'PENDING';
                            const isRePending = currentStatus === 'RE_PENDING';
                            const isRejected = currentStatus === 'REJECTED';
                            const isBanned = currentStatus === 'BANNED';
                            const isKicked = currentStatus === 'KICKED';
                            const isPrivateComputed = !!item.isPrivate || (item as any).privacy === 'approval';
                            const isHidden = isEventPhotosHidden(item, user?.id);
                            const currentDescription = item.description || (item as any).description;

                            const rawEventDate = eventMoment(item);
                            const rawFrontDateStr = (item as any).date || '';
                            let formattedDate = 'Дата не указана';
                            if (rawFrontDateStr && rawFrontDateStr.includes(' в ')) {
                                formattedDate = rawFrontDateStr.trim();
                            } else if (rawEventDate) {
                                const dateObj = new Date(rawEventDate);
                                const dayAndMonth = dateObj.toLocaleDateString('ru-RU', { month: 'long', day: 'numeric' });
                                const hoursAndMins = dateObj.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                                formattedDate = `${dayAndMonth} в ${hoursAndMins}`;
                            }
                            const participantsVal = participantCountOverrides[itemIdNum]
                                ?? item.currentParticipants
                                ?? (item as any).participants
                                ?? 0;
                            const participantsLimit = item.participantLimit || (item as any).limit;
                            return (
                                <div key={itemIdNum} className={`p-5 rounded-2xl border transition relative space-y-4 ${isCluster ? 'bg-white border-[#1A1916]/10 hover:border-[#5C4B7A]/40' : 'border-transparent p-0'}`}>
                                    {isCluster && (isHidden ? (
                                        <EventPhotosLockedBanner className="h-40 rounded-xl" />
                                    ) : (
                                        <EventPhotoCarousel
                                            urls={eventGalleryUrls(item as any)}
                                            className="h-40 rounded-xl"
                                            report={eventReportTarget(item, user?.id)}
                                        />
                                    ))}
                                    {isCluster && (
                                        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2">
                                            <div className="min-w-0 flex-1">
                                                <h3 className="myraion-display text-base text-[#1A1916] tracking-tight leading-[1.15] truncate">{item.title}</h3>
                                                <p className="text-[11px] text-[#6B645C] mt-1.5">
                                                    Организатор:{' '}
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            goToOrganizer(currentOrganizerId, onClose);
                                                        }}
                                                        className="text-[#5C4B7A] hover:underline cursor-pointer font-medium"
                                                    >
                                                        <OrganizerNameModal organizerId={currentOrganizerId} currentUserId={user?.id} />
                                                    </button>
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => setIsShareModalOpen(true)}
                                                    className="p-1.5 rounded-lg border border-[#1A1916]/12 bg-white text-[#1A1916] hover:border-[#5C4B7A] hover:text-[#5C4B7A] transition cursor-pointer"
                                                    title="Поделиться в чате"
                                                >
                                                    <Share2 className="w-3.5 h-3.5" />
                                                </button>
                                                {eventReportTarget(item, user?.id) && (
                                                    <ReportIconButton
                                                        onClick={() => openReport(eventReportTarget(item, user?.id)!)}
                                                        className="p-1.5 rounded-lg border border-[#1A1916]/12 bg-white text-[#1A1916] hover:border-[#5C4B7A] hover:text-[#5C4B7A] transition cursor-pointer"
                                                        iconClassName="w-3.5 h-3.5"
                                                    />
                                                )}
                                                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border ${catMeta.cls}`}>
 <CatIcon className="w-3 h-3" />
                                                    {item.category}
 </span>
                                                {isPrivateComputed && <span className="bg-[#5C4B7A] text-white text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full">Приватная</span>}
                                            </div>
                                        </div>
                                    )}

                                    {(item as any).loadingDetails ? (
                                        <p className="text-sm text-slate-400 italic py-10 text-center">Загрузка встречи…</p>
                                    ) : (
                                    <>
                                    <div className="grid grid-cols-2 gap-2.5 w-full items-stretch">
                                        <InfoBlock icon={Calendar} label="Когда" value={formattedDate} />
                                        {(isOwner || isJoined) && !isHidden ? (
                                            <button
                                                type="button"
                                                onClick={() => handleOpenParticipantsList(itemIdNum, isPastEvent || canVoteReputation)}
                                                className="text-left w-full focus:outline-none flex active:scale-[0.99] transition-transform cursor-pointer"
                                            >
                                                <InfoBlock
                                                    icon={Users}
                                                    label="Участники"
                                                    value={participantsLimit
                                                        ? (
                                                            <span className="tabular-nums">
                                                                <span className="myraion-display text-[22px] text-[#1A1916]">{participantsVal}</span>
                                                                <span className="text-[#6B645C]"> / {participantsLimit}</span>
                                                            </span>
                                                        )
                                                        : <span className="myraion-display text-[22px] text-[#1A1916] tabular-nums">{participantsVal}</span>
                                                    }
                                                />
                                            </button>
                                        ) : (
                                            <InfoBlock icon={Users} label="Участники" value="Доступно участникам" />
                                        )}
                                    </div>

                                    <CopyLocationBlock
                                        hidden={isHidden}
                                        location={item.locationName || (item as any).location}
                                    />
                                    {(isHidden || currentDescription) && (
                                        <div className="space-y-1 w-full max-w-full block min-w-0 overflow-hidden pt-1">
                                            <div className="text-[10px] uppercase tracking-wide text-[#6B645C]">Описание</div>
                                            <p className="text-sm text-[#1A1916] leading-relaxed bg-white border border-[#1A1916]/10 p-3 rounded-xl whitespace-pre-wrap break-all overflow-wrap-break-word max-w-full block min-w-0">
                                                {isHidden ? 'Описание этой встречи доступно только одобренным участникам.' : currentDescription}
                                            </p>
                                        </div>
                                    )}

                                    {item.tags && item.tags.length > 0 && !isHidden && (
                                        <div className="flex flex-wrap gap-1.5 pt-1">
                                            {item.tags.map((t) => ( <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-[#1A1916]/10 text-[#6B645C]">#{t.replace('#', '')}</span> ))}
                                        </div>
                                    )}

                                    {isJoined && !isOwner && !isPastEvent && (
                                        <div className="flex items-center gap-2.5 p-3 rounded-2xl bg-[#E6F7EF] text-sm">
                                            <CheckCircle2 className="w-4 h-4 text-[#4A8B6F] shrink-0" />
                                            <div><div className="font-bold text-[#146B48]">Вы идёте на встречу</div></div>
                                        </div>
                                    )}

                                    {showParticipantsId === itemIdNum && (
                                        <div ref={participantsBlockRef} className="p-3 md:p-5 bg-white border border-[#1A1916]/10 rounded-2xl animate-in fade-in duration-300">
                                            <div className="space-y-3">
                                                <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-200/60">
                                                    <div className="min-w-0">
                                                        <h4 className="text-[13px] md:text-sm font-bold text-[#1A1916] tracking-tight flex items-center gap-2 uppercase leading-snug"><Users className="w-4 h-4 text-[#5C4B7A] shrink-0" /><span className="min-w-0">Участники встречи ({participantsLoading ? '…' : participantsList.length})</span></h4>
                                                        <p className="text-xs text-[#6B645C] mt-0.5 leading-snug">{canVoteReputation ? 'Поставьте оценку соседям за встречу' : windowState.closed || isPastEvent ? reputationPendingLabel(item.reputationOpensAt, windowState) : 'Список одобренных участников'}</p>
                                                    </div>
                                                    <button type="button" onClick={closeParticipantsPanel} className="w-8 h-8 rounded-xl bg-white text-slate-400 hover:text-slate-600 hover:border-slate-300 flex items-center justify-center transition border border-slate-200/60 shadow-sm active:scale-95 shrink-0"><X className="w-4 h-4 stroke-[2.5]" /></button>
                                                </div>
                                                <div className="space-y-2 max-h-[min(52vh,360px)] overflow-y-auto overscroll-contain pr-0.5" style={{ scrollbarWidth: 'none' }}>
                                                    {participantsLoading ? (
                                                        <SegmentedRingLoader />
                                                    ) : participantsLoadFailed && participantsList.length === 0 ? (
                                                        <ParticipantsLoadRetry onRetry={() => { void handleOpenParticipantsList(itemIdNum, isPastEvent || canVoteReputation); }} />
                                                    ) : participantsList.length === 0 ? (
                                                        <p className="text-xs text-slate-400 italic text-center py-5">Пока никого нет</p>
                                                    ) : (
                                                        participantsList.map((p, index) => {
                                                            const isItMe = user?.id && Number(p.userId) === Number(user.id);
                                                            const isOrganizerOfEvent = index === 0;
                                                            const pastVote = myVotes.find(v => v && Number(v.targetId) === Number(p.userId));
                                                            return (
                                                                <div key={`${p.userId}-${index}`} className="relative flex items-start gap-2.5 p-2.5 md:p-3.5 pr-8 bg-[#FAF6F0] border border-slate-100 rounded-xl min-w-0">
                                                                    {isOwner && !isItMe && !isPastEvent && !isOrganizerOfEvent ? (
                                                                        <button
                                                                            type="button"
                                                                            disabled={votingLoading === `kick-${p.userId}`}
                                                                            onClick={() => handleKickParticipant(itemIdNum, Number(p.userId))}
                                                                            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md text-[#B85C5C] hover:bg-[#F3D4D0] flex items-center justify-center transition disabled:opacity-50"
                                                                            title="Исключить участника"
                                                                        >
                                                                            <X className="w-3.5 h-3.5 stroke-[2.5]" />
                                                                        </button>
                                                                    ) : null}
                                                                    <button type="button" onClick={() => openNeighborProfile(p.userId, `${p.firstName} ${p.lastName || ''}`.trim())} className={`w-10 h-10 rounded-xl overflow-hidden border shrink-0 bg-[#B0B0B0] transition-colors focus:outline-none cursor-pointer active:scale-95 ${isOrganizerOfEvent ? 'border-amber-500 ring-2 ring-amber-400/50' : 'border-slate-200 hover:border-slate-300'}`} title="Открыть профиль соседа">
                                                                        <img src={getAvatarUrl(p.userId, p.avatarUrl)} alt="" className="w-full h-full object-cover" />
                                                                    </button>
                                                                    <div className="min-w-0 flex-1">
                                                                        <button type="button" onClick={() => openNeighborProfile(p.userId, `${p.firstName} ${p.lastName || ''}`.trim())} className="w-full text-sm font-bold text-slate-800 tracking-tight text-left break-words focus:outline-none hover:text-[#5C4B7A] cursor-pointer transition" title="Открыть профиль соседа">{p.firstName} {p.lastName || ''}</button>
                                                                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                                                            {isOrganizerOfEvent && <span className="bg-amber-50 text-amber-800 border border-amber-200 text-[9px] font-bold uppercase px-2 py-0.5 rounded-md tracking-wider select-none">Организатор</span>}
                                                                            {isItMe ? (
                                                                                <span className="text-[11px] font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md italic">Это вы</span>
                                                                            ) : isPastEvent && canVoteReputation ? (
                                                                                <>
                                                                                    <button type="button" disabled={votingLoading !== null}
                                                                                            onClick={() => handleVote(itemIdNum, Number(p.userId), 'PLUS')}
                                                                                            className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-all duration-150 active:scale-90 ${pastVote?.voteType === 'PLUS' ? 'bg-[#5C4B7A] border-[#5C4B7A] text-white' : pastVote?.voteType === 'MINUS' ? 'opacity-40 bg-white border-[#1A1916]/10 text-[#1A1916]/30' : 'bg-white border-[#1A1916]/12 text-[#5C4B7A] hover:border-[#5C4B7A]'}`} title={pastVote?.voteType === 'PLUS' ? "Убрать лайк" : "Поставить лайк"}><ThumbsUp className="w-3.5 h-3.5" /></button>
                                                                                    <button type="button" disabled={votingLoading !== null}
                                                                                            onClick={() => handleVote(itemIdNum, Number(p.userId), 'MINUS')}
                                                                                            className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-all duration-150 active:scale-90 ${pastVote?.voteType === 'MINUS' ? 'bg-[#B85C5C] border-[#B85C5C] text-white' : pastVote?.voteType === 'PLUS' ? 'opacity-40 bg-white border-[#1A1916]/10 text-[#1A1916]/30' : 'bg-white border-[#1A1916]/12 text-[#B85C5C] hover:border-[#B85C5C]'}`} title={pastVote?.voteType === 'MINUS' ? "Убрать дизлайк" : "Поставить дизлайк"}><ThumbsDown className="w-3.5 h-3.5" /></button>
                                                                                </>
                                                                            ) : isPastEvent ? (
                                                                                <span className="text-[10px] leading-tight font-medium text-slate-400">
                                                                                    {reputationPendingLabel(item.reputationOpensAt, windowState)}
                                                                                </span>
                                                                            ) : !isOwner && !isOrganizerOfEvent ? (
                                                                                <span className="text-[10px] leading-tight font-medium text-slate-400">Оценка после события</span>
                                                                            ) : null}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })
                                                    )}
                                                </div>
                                                {isOwner && bannedParticipantsList.length > 0 && (
                                                    <div className="pt-3 border-t border-slate-200/60">
                                                        <button
                                                            type="button"
                                                            onClick={() => setShowBannedList((v) => !v)}
                                                            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border border-rose-100 bg-rose-50/50 hover:bg-rose-50 text-left transition"
                                                        >
                                                            <span className="text-[11px] font-bold text-rose-600 uppercase tracking-wide">
                                                                Исключённые ({bannedParticipantsList.length})
                                                            </span>
                                                            <ChevronDown className={`w-4 h-4 text-rose-400 transition-transform ${showBannedList ? 'rotate-180' : ''}`} />
                                                        </button>
                                                        {showBannedList && (
                                                            <div className="mt-2 space-y-2 max-h-[160px] overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                                                                {bannedParticipantsList.map((p) => (
                                                                    <div key={`banned-${p.userId}`} className="flex items-center justify-between gap-2 p-3 bg-rose-50/60 border border-rose-100 rounded-xl min-w-0">
                                                                        <div className="text-sm font-semibold text-slate-700 min-w-0 break-words">
                                                                            {p.firstName} {p.lastName || ''}
                                                                        </div>
                                                                        <button
                                                                            type="button"
                                                                            disabled={restoreLoadingId === Number(p.userId)}
                                                                            onClick={() => handleRestoreParticipant(itemIdNum, Number(p.userId))}
                                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white border border-[#5C4B7A]/30 text-[#5C4B7A] hover:bg-[#EDE6F5] disabled:opacity-50 shrink-0"
                                                                            title="Вернуть во встречу"
                                                                        >
                                                                            <UserPlus className="w-3.5 h-3.5" />
                                                                            Вернуть
                                                                        </button>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    <div className={`pt-2 border-t border-[#1A1916]/10 flex gap-2 ${isCluster ? '' : 'sticky bottom-0 -mx-4 px-4 pb-1 bg-[#FAF6F0] md:static md:mx-0 md:px-0 md:pb-0'}`}>
                                        {isPastEvent ? (
                                            <div className="text-center w-full text-[13px] h-11 flex items-center justify-center text-[#6B645C] bg-white border border-[#1A1916]/10 rounded-full select-none">Событие завершено</div>
                                        ) : confirmCancel === itemIdNum ? (
                                            <div className="flex items-center gap-3 w-full bg-[#FFF1ED] p-2 rounded-2xl border border-[#B85C5C]/20">
                                                <div className="flex-1 text-xs text-[#B85C5C] font-bold">Отменить встречу?</div>
                                                <Button variant="secondary" size="sm" onClick={() => setConfirmCancel(null)}>Нет</Button>
                                                <button onClick={async () => { try { await api.delete(`/api/v1/social/events/${itemIdNum}`); onClose(); } catch (err) { console.error(err); } }} className="text-xs font-bold px-3 py-1.5 rounded-full bg-[#B85C5C] text-white hover:bg-[#e04428] transition">Да</button>
                                            </div>
                                        ) : isOwner ? (
                                            <div className="flex gap-2 w-full pt-1">
                                                <Button variant="secondary" className="flex-1 text-xs h-11 rounded-full" onClick={() => onEditEvent(item)}><Pencil className="w-3.5 h-3.5" /> Редактировать</Button>
                                                <button onClick={() => setConfirmCancel(itemIdNum)} className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-bold px-3 h-11 rounded-full bg-white text-[#B85C5C] border border-[#B85C5C]/30 hover:bg-[#B85C5C] hover:text-white transition"><Trash2 className="w-3.5 h-3.5" /> Отменить</button>
                                            </div>
                                        ) : isJoined ? (
                                            <StatusMenuButton
                                                className="w-full"
                                                variant="success"
                                                label="Вы идёте"
                                                buttonClassName="!h-11 !rounded-full"
                                                items={[{ label: 'Выйти из события', onClick: () => { void handleLeaveClick(itemIdNum); }, tone: 'danger' }]}
                                                desktop={<button type="button" onClick={() => { void handleLeaveClick(itemIdNum); }} className="w-full bg-white hover:bg-[#B85C5C] text-[#B85C5C] hover:text-white border border-[#B85C5C]/35 font-bold h-11 text-xs rounded-full flex items-center justify-center gap-1.5 transition duration-150"><X className="w-3.5 h-3.5" /><span>Выйти из события</span></button>}
                                            />
                                        ) : isPending ? (
                                            <StatusMenuButton
                                                className="w-full"
                                                variant="amber"
                                                label="Заявка отправлена"
                                                buttonClassName="!h-11 !rounded-full"
                                                items={[{ label: 'Отменить заявку', onClick: () => { void handleLeaveClick(itemIdNum); }, tone: 'danger' }]}
                                                desktop={<button type="button" onClick={() => { void handleLeaveClick(itemIdNum); }} className="w-full flex items-center justify-center gap-2.5 p-2.5 rounded-full bg-[#EDE6F5] hover:bg-[#F6E8E6] border border-[#5C4B7A]/20 hover:border-[#B85C5C]/30 text-xs text-[#5C4B7A] hover:text-[#B85C5C] transition-all duration-200 group/modalPending font-bold h-11"><Clock className="w-4 h-4 shrink-0 group-hover/modalPending:hidden animate-pulse" /><span className="group-hover/modalPending:hidden">Заявка отправлена</span><X className="w-4 h-4 hidden group-hover/modalPending:inline" /><span className="hidden group-hover/modalPending:inline">Отменить отправленную заявку</span></button>}
                                            />
                                        ) : isRePending ? (
                                            <StatusMenuButton
                                                className="w-full"
                                                variant="amber"
                                                label="Повторная заявка отправлена"
                                                buttonClassName="!h-11 !rounded-full"
                                                items={[{ label: 'Отменить повторную заявку', onClick: () => { void handleLeaveClick(itemIdNum); }, tone: 'danger' }]}
                                                desktop={
                                                    <button
                                                        onClick={() => { void handleLeaveClick(itemIdNum); }}
                                                        className="w-full flex items-center justify-center gap-2.5 p-2.5 rounded-full bg-[#EDE6F5] hover:bg-[#F6E8E6] border border-[#5C4B7A]/30 hover:border-[#B85C5C]/30 text-xs text-[#1C1824] hover:text-[#B85C5C] transition-all duration-200 group/modalRePending font-bold h-11 cursor-pointer"
                                                    >
                                                        <Clock className="w-3.5 h-3.5 animate-pulse group-hover/modalRePending:hidden" />
                                                        <span className="group-hover/modalRePending:hidden">Повторная заявка отправлена</span>
                                                        <X className="w-4 h-4 hidden group-hover/modalRePending:inline" />
                                                        <span className="hidden group-hover/modalRePending:inline">Отменить повторную заявку</span>
                                                    </button>
                                                }
                                            />
                                        ) : isKicked ? (
                                            <div className="w-full flex items-center justify-center gap-2.5 p-2.5 rounded-full bg-[#FFF1ED] border border-[#B85C5C]/20 text-xs text-[#B85C5C] font-bold select-none h-11">
                                                <X className="w-4 h-4 shrink-0" />
                                                <span>Вас исключили из встречи</span>
                                            </div>
                                        ) : isBanned ? (
                                            <div className="w-full flex items-center justify-center gap-2.5 p-2.5 rounded-full bg-[#FFF1ED] border border-[#B85C5C]/20 text-xs text-[#B85C5C] font-bold select-none h-11">
                                                <X className="w-4 h-4 shrink-0" />
                                                <span>Вам отказано организатором</span>
                                            </div>
                                        ) : isRejected ? (
                                            <button
                                                type="button"
                                                onClick={() => onApply && onApply(item)}
                                                className="w-full bg-[#5C4B7A] hover:bg-[#4A3C66] text-white text-xs font-bold h-11 rounded-full transition flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer"
                                            >
                                                <Plus className="w-4 h-4" />
                                                <span>Подать заявку повторно</span>
                                            </button>) : isPrivateComputed ? (
                                            <button onClick={() => onApply(item)} className="w-full bg-[#5C4B7A] hover:bg-[#4A3C66] text-white text-xs font-bold h-11 rounded-full transition flex items-center justify-center gap-1.5 active:scale-98"><Send className="w-4 h-4" /> <span>Оставить заявку</span></button>
                                        ) : (
                                            <button onClick={() => onJoin(item)} className="w-full bg-[#5C4B7A] hover:bg-[#4A3C66] text-white text-xs font-bold h-11 rounded-full transition flex items-center justify-center gap-1.5 active:scale-98"><ThumbsUp className="w-4 h-4" /> <span>Вступить в событие</span></button>
                                        )}
                                    </div>
                                    </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
            <ForwardModal
                isOpen={isShareModalOpen}
                onClose={() => setIsShareModalOpen(false)}
                // ПРОДАКШН-ФИКС: Явно прокидываем targets и comment через стрелочную функцию, исключая затирание аргументов
                onSelectChats={(targets, comment) => handleShareConfirm(targets, comment)}
            />
        </>
    );
}

function InfoBlock({ icon: Icon, label, value }: { icon: any; label: string; value: React.ReactNode; }) {
    return (
        <div className="bg-white border border-[#1A1916]/10 rounded-2xl px-3 py-2.5 md:px-3.5 md:py-3 flex flex-col justify-center items-start gap-1 w-full min-h-[64px] h-full box-border">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] md:tracking-[0.14em] text-[#6B645C] select-none shrink-0">
                <Icon className="w-3.5 h-3.5 text-[#5C4B7A] shrink-0" />
                <span className="truncate">{label}</span>
            </div>
            <div className="text-sm text-[#1A1916] leading-tight w-full break-words overflow-wrap-break-word">
                {value}
            </div>
        </div>
    );
}

function CopyLocationBlock({ hidden, location }: { hidden: boolean; location?: string }) {
    const [copied, setCopied] = React.useState(false);
    const handleCopyClick = () => {
        if (!hidden && location) {
            navigator.clipboard.writeText(location);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 400);
        }
    };
    return (
        <div onClick={handleCopyClick} className="w-full cursor-pointer active:scale-[0.99] transition-all duration-150 flex rounded-2xl">
            <InfoBlock icon={MapPin} label="Где" value={
                <div className="flex items-center justify-between gap-3 w-full min-h-[16px]">
                    {copied ? (
                        <span className="text-[#4A8B6F] text-xs tracking-wide">Скопировано!</span>
                    ) : (
                        <>
                            <span className="flex-1 text-[#1A1916]">{hidden ? 'Адрес скрыт' : location}</span>
                            {!hidden && <Copy className="w-3.5 h-3.5 text-[#6B645C] shrink-0" />}
                        </>
                    )}
                </div>
            } />
        </div>
    );
}
