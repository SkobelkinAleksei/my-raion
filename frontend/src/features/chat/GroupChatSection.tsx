import React, { useCallback, useEffect, useRef, useState } from 'react';
import api, { uploadChatPhoto, uploadChatVoice } from '@/shared/lib/api';
import { runWithTimeoutRetry } from '@/shared/lib/loadWithTimeoutRetry';
import SegmentedRingLoader, { ParticipantsLoadRetry } from '@/shared/ui/SegmentedRingLoader';
import { theme } from '@/shared/ui/theme';
import { useChat, formatSidebarMessage, mediaHintFromMessage, resolveMessageMedia, mapBundledForwardQuotes, isForwardQuoteCaption, isPersonalGroupRoom } from '@/features/chat/ChatContext';
import { useAuth } from '@/shared/context/AuthContext';
import { openNeighborProfile, getAvatarUrl, NAV_EVENT_RELOAD_CHAT_HISTORY } from '@/shared/utils/navigation';
import { showAppInfoToast, showAppConfirm } from '@/shared/utils/appToast';
import {
    MoreHorizontal,
    Smile,
    Search,
    BarChart2,
    Send,
    Check,
    CheckCheck,
    Pencil,
    CornerUpLeft,
    X,
    Users,
    Info, ThumbsUp, ThumbsDown,
    Trash2,
    UserPlus,
    ChevronDown,
    ChevronLeft,
    FolderOpen,
    LogOut,
    Camera,
    Settings,
    AlertCircle,
    Pin,
    BellOff,
    Bell,
    Shield
} from 'lucide-react';
import EventDetailsModal from "@/features/events/EventDetailsModal";
import CreateEventDrawer from '@/features/events/CreateEventDrawer';
import { reputationWindow, reputationPendingLabel } from '@/features/events/reputationWindow';
import { useChatActions, Msg, ReplyRef } from '@/features/chat/useChatActions';
import ForwardModal from "@/features/chat/ForwardModal";
import ChatPhotoGrid, { ChatMediaLightbox } from '@/features/chat/ChatPhotoGrid';
import ChatForwardedPack from '@/features/chat/ChatForwardedPack';
import SharedPostCard from '@/features/feed/SharedPostCard';
import SharedEventCard from '@/features/events/SharedEventCard';
import ChatMaterialsGallery from '@/features/chat/ChatMaterialsGallery';
import ChatVoiceBubble from '@/features/chat/ChatVoiceBubble';
import ChatFileBubble from '@/features/chat/ChatFileBubble';
import { voiceQueueFromMessages } from '@/features/chat/chatVoicePlayer';
import { useChatMediaAttach } from '@/features/chat/useChatMediaAttach';
import { useChatPasteImages } from '@/features/chat/useChatPasteImages';
import { ChatPendingStrip, ChatPaperclipButton, COMPOSER_BTN_MUTED, COMPOSER_BTN_SEND, COMPOSER_ICON } from '@/features/chat/ChatComposerExtras';
import ChatVoiceMiniBar from '@/features/chat/ChatVoiceMiniBar';
import { ChatMicButton, ChatVoiceRecordingBar, useChatVoiceRecorder } from '@/features/chat/useChatVoiceRecorder';
import { publishForwardToChats } from '@/shared/utils/shareToChat';
import ChatEmojiPicker, { insertEmojiAtCursor } from '@/features/chat/ChatEmojiPicker';
import ChatSearchBar from '@/features/chat/ChatSearchBar';
import ChatPinnedBar from '@/features/chat/ChatPinnedBar';
import ChatMessageText from '@/features/chat/ChatMessageText';
import ChatComposerInput from '@/features/chat/ChatComposerInput';
import ChatUnreadDivider, { insertUnreadDivider, isUnreadMarker } from '@/features/chat/ChatUnreadDivider';
import { mergeChatMessagesById } from '@/features/chat/mergeChatMessages';
import { ChatScrollDownButton, oldestNumericId, realMessageCount } from '@/features/chat/chatScroll';
import { mentionQuery, insertMention } from '@/features/chat/chatMentions';
import ChatPollCard from '@/features/chat/ChatPollCard';
import CreatePollModal from '@/features/chat/CreatePollModal';
import AddPersonalGroupMembersModal from '@/features/chat/AddPersonalGroupMembersModal';
import { clearChatDraft, readChatDraft, writeChatDraft } from '@/features/chat/chatDrafts';
import { mergeIncomingPoll } from '@/features/chat/chatPoll';
import { useReport } from '@/features/report/ReportModal';

interface ChatRoom {
    id: number;
    eventId?: number | null;
    title: string;
    ownerId: number;
    createdAt: string;
    lastMessage?: string;
    time?: string;
    unread?: number;
    roomType?: 'EVENT' | 'PERSONAL_GROUP';
    addMembersPolicy?: 'OWNER_ONLY' | 'EVERYONE';
    renamePolicy?: 'OWNER_ONLY' | 'EVERYONE';
    avatarPolicy?: 'OWNER_ONLY' | 'EVERYONE';
    avatarUrl?: string | null;
    muted?: boolean;
    pinned?: boolean;
    pinnedAt?: string | null;
    admin?: boolean;
}

const formatMessageTime = (dateInput: any): string => {
    if (!dateInput) return '';
    if (typeof dateInput === 'string') {
        if (dateInput.includes('T')) {
            const parts = dateInput.split('T');
            const timePart = parts[1];
            if (timePart) {
                const segments = timePart.split(':');
                if (segments.length >= 2) {
                    return `${segments[0]}:${segments[1]}`;
                }
            }
        }
        const parsedDate = new Date(dateInput);
        return isNaN(parsedDate.getTime()) ? '' : parsedDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
    if (Array.isArray(dateInput) && dateInput.length >= 5) {
        const hour = String(dateInput[3]).padStart(2, '0');
        const minute = String(dateInput[4]).padStart(2, '0');
        return `${hour}:${minute}`;
    }
    const date = new Date(dateInput);
    return isNaN(date.getTime()) ? '' : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};

/** Разбор системных сообщений с кликабельным ФИ (кик / выход / вход) */
function parseLinkedSystemContent(raw: string): {
    text: string;
    systemLinkUserId?: number;
    systemLinkName?: string;
    systemLinkSuffix?: string;
} | null {
    const idMatch = raw.match(/\[(KICKED|LEFT|JOINED|AVATAR)_ID:(\d+)\]/);
    if (!idMatch) return null;

    const kind = idMatch[1];
    const userId = Number(idMatch[2]);
    const text = raw.replace(/\[(KICKED|LEFT|JOINED|AVATAR)_ID:\d+\]/g, '').trim();
    if (/исключил\(а\)|назначил\(а\)|снял\(а\)|добавил\(а\)|изменил\(а\)|передал\(а\)/.test(text)) {
        return { text };
    }

    const suffixes: Record<string, string> = {
        KICKED: ' был исключен организатором из встречи',
        LEFT: ' покинул(а) событие',
        JOINED: ' присоединился(ась) к событию',
        AVATAR: ' сменил(а) аватарку группы',
    };
    const suffixFromKind = suffixes[kind] || '';

    let name = '';
    let suffix = suffixFromKind;
    if (suffix && text.endsWith(suffix)) {
        name = text.slice(0, -suffix.length).trim();
    } else {
        const m = text.match(/^(.+?)\s+(был исключен организатором из встречи|исключён\(а\) из чата|исключен\(а\) из чата|покинул\(а\) событие|покинул\(а\) чат|присоединился\(ась\) к событию|добавлен\(а\) в чат|сменил\(а\) аватарку группы|убрал\(а\) аватарку группы)$/i);
        if (m) {
            name = m[1].trim();
            suffix = ` ${m[2]}`;
        }
    }
    if (!name) name = 'Участник';

    return {
        text: suffix ? `${name}${suffix}` : text,
        systemLinkUserId: userId,
        systemLinkName: name,
        systemLinkSuffix: suffix || ` ${text.replace(name, '').trim()}`.replace(/^ /, ' '),
    };
}

function SystemLinkedNameLabel({ userId, name, suffix, time }: { userId: number; name: string; suffix: string; time?: string }) {
    const [displayName, setDisplayName] = useState(name);

    useEffect(() => {
        setDisplayName(name);
        if (name && name !== 'Участник') return;
        let cancelled = false;
        api.get(`/api/v1/social/users/${userId}`)
            .then((res) => {
                if (cancelled) return;
                const n = `${res.data?.firstName || ''} ${res.data?.lastName || ''}`.trim();
                if (n) setDisplayName(n);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [userId, name]);

    return (
        <div className="flex flex-col items-center">
            <span className="bg-slate-200/60 backdrop-blur-sm text-slate-500 text-[11px] font-medium px-4 py-1.5 rounded-full border border-slate-300/10 shadow-sm max-w-xs text-center min-w-0 [overflow-wrap:anywhere] break-all">
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        openNeighborProfile(userId, displayName);
                    }}
                    className="font-semibold text-[#5C4B7A] hover:text-[#4A3C66] hover:underline cursor-pointer"
                >
                    {displayName}
                </button>
                {suffix}
            </span>
            {time ? <span className="text-[10px] text-slate-400 mt-1.5 tabular-nums">{time}</span> : null}
        </div>
    );
}

export default function GroupChatSection({
                                             activeRoom,
                                             pageActive = true,
                                             setEventRooms,
                                             onCloseChat,
                                             onNavigateToPersonal,
                                             onNavigateToGroup
                                         }: {
    activeRoom: ChatRoom;
    pageActive?: boolean;
    setEventRooms: any;
    onCloseChat: () => void;
    onNavigateToPersonal: (chat: any) => void;
    onNavigateToGroup: (room: any) => void;
}) {
    const { user } = useAuth();
    const { openReport } = useReport();
    const { eventRooms, personalGroups, refreshEventRooms, stompClient } = useChat();
    const isPersonalGroup = isPersonalGroupRoom(activeRoom);
    const unreadAtOpenRef = useRef(Math.max(
        0,
        Number(
            ((isPersonalGroup ? personalGroups : eventRooms) || []).find((r) => r && Number(r.id) === Number(activeRoom.id))?.unread
            ?? activeRoom.unread
        ) || 0
    ));
    const pageActiveRef = useRef(pageActive);
    pageActiveRef.current = pageActive;

    const actions = useChatActions({
        refreshRooms: refreshEventRooms
    });

    const [showParticipantsId, setShowParticipantsId] = useState<number | null>(null);
    const [participantsList, setParticipantsList] = useState<any[]>([]);
    const [bannedParticipantsList, setBannedParticipantsList] = useState<any[]>([]);
    const [restoreLoadingId, setRestoreLoadingId] = useState<number | null>(null);
    const [showBannedList, setShowBannedList] = useState(false);
    const [chatEventDateStr, setChatEventDateStr] = useState<string>('');
    const [chatRepOpensAt, setChatRepOpensAt] = useState<string>('');
    const [chatRepClosesAt, setChatRepClosesAt] = useState<string>('');
    const [chatCanVoteReputation, setChatCanVoteReputation] = useState(false);
    const [isoEventDate, setIsoEventDate] = useState<string | null>(null);
    const [modalEventData, setModalEventData] = useState<any | null>(null);
    const [editingEvent, setEditingEvent] = useState<any | null>(null);
    const [participantsLoading, setParticipantsLoading] = useState(false);
    const [participantsLoadFailed, setParticipantsLoadFailed] = useState(false);
    const participantsLoadingRef = useRef(false);
    const participantsLoadFailedRef = useRef(false);
    const participantsAbortRef = useRef<AbortController | null>(null);
    const lastParticipantsKeyRef = useRef<number | null>(null);
    const eventDetailsAbortRef = useRef<AbortController | null>(null);
    const eventDetailsLoadingRef = useRef(false);
    const [headerMenuOpen, setHeaderMenuOpen] = useState<boolean>(false);
    const [galleryOpen, setGalleryOpen] = useState(false);
    const [renameOpen, setRenameOpen] = useState(false);
    const [renameValue, setRenameValue] = useState(activeRoom.title);
    const [addMembersOpen, setAddMembersOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [displayTitle, setDisplayTitle] = useState(activeRoom.title);
    const [addPolicy, setAddPolicy] = useState<'OWNER_ONLY' | 'EVERYONE'>(activeRoom.addMembersPolicy || 'OWNER_ONLY');
    const [renamePolicy, setRenamePolicy] = useState<'OWNER_ONLY' | 'EVERYONE'>(activeRoom.renamePolicy || 'OWNER_ONLY');
    const [avatarPolicy, setAvatarPolicy] = useState<'OWNER_ONLY' | 'EVERYONE'>(activeRoom.avatarPolicy || 'OWNER_ONLY');
    const [draftAddPolicy, setDraftAddPolicy] = useState<'OWNER_ONLY' | 'EVERYONE'>(activeRoom.addMembersPolicy || 'OWNER_ONLY');
    const [draftRenamePolicy, setDraftRenamePolicy] = useState<'OWNER_ONLY' | 'EVERYONE'>(activeRoom.renamePolicy || 'OWNER_ONLY');
    const [draftAvatarPolicy, setDraftAvatarPolicy] = useState<'OWNER_ONLY' | 'EVERYONE'>(activeRoom.avatarPolicy || 'OWNER_ONLY');
    const [displayAvatarUrl, setDisplayAvatarUrl] = useState(activeRoom.avatarUrl || '');
    const [avatarPreviewOpen, setAvatarPreviewOpen] = useState(false);
    const [pins, setPins] = useState<any[]>([]);
    const [leaveOwnerOpen, setLeaveOwnerOpen] = useState(false);
    const [transferUserId, setTransferUserId] = useState<number | null>(null);
    const [historyHasMore, setHistoryHasMore] = useState(true);
    const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
    const historyLoadingRef = useRef(false);
    const historyHasMoreRef = useRef(true);
    const historyFetchGenRef = useRef(0);
    const [historyEpoch, setHistoryEpoch] = useState(0);
    const messagesRef = useRef<Msg[]>([]);
    messagesRef.current = actions.messages;
    historyHasMoreRef.current = historyHasMore;
    const HISTORY_PAGE_SIZE = 30;
    const [roomSaving, setRoomSaving] = useState(false);
    const avatarInputRef = useRef<HTMLInputElement>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [emojiOpen, setEmojiOpen] = useState(false);
    const [pollModalOpen, setPollModalOpen] = useState(false);
    const skipDraftSave = useRef(true);
    const [typers, setTypers] = useState<Record<string, string>>({});
    const typingIdleRef = useRef<Record<string, number>>({});
    const lastTypingSentRef = useRef(0);

    useEffect(() => {
        setDisplayTitle(activeRoom.title);
        setAddPolicy(activeRoom.addMembersPolicy || 'OWNER_ONLY');
        setRenamePolicy(activeRoom.renamePolicy || 'OWNER_ONLY');
        setAvatarPolicy(activeRoom.avatarPolicy || 'OWNER_ONLY');
        setDisplayAvatarUrl(activeRoom.avatarUrl || '');
    }, [activeRoom.id, activeRoom.title, activeRoom.addMembersPolicy, activeRoom.renamePolicy, activeRoom.avatarPolicy, activeRoom.avatarUrl]);

    const applyRoomPatch = (dto: any) => {
        if (!dto) return;
        if (dto.title) setDisplayTitle(dto.title);
        if (dto.addMembersPolicy) setAddPolicy(dto.addMembersPolicy);
        if (dto.renamePolicy) setRenamePolicy(dto.renamePolicy);
        if (dto.avatarPolicy) setAvatarPolicy(dto.avatarPolicy);
        if (dto.avatarUrl !== undefined) setDisplayAvatarUrl(dto.avatarUrl || '');
        if (setEventRooms) {
            setEventRooms((prev: any[]) => (prev || []).map((r) => (
                r && Number(r.id) === Number(activeRoom.id)
                    ? {
                        ...r,
                        title: dto.title || r.title,
                        addMembersPolicy: dto.addMembersPolicy || r.addMembersPolicy,
                        renamePolicy: dto.renamePolicy || r.renamePolicy,
                        avatarPolicy: dto.avatarPolicy || r.avatarPolicy,
                        avatarUrl: dto.avatarUrl !== undefined ? dto.avatarUrl : r.avatarUrl,
                        ownerId: dto.ownerId || r.ownerId,
                    }
                    : r
            )));
        }
    };

    const canChangeAvatar = isPersonalGroup && (Number(user?.id) === Number(activeRoom.ownerId) || !!activeRoom.admin || avatarPolicy === 'EVERYONE');
    const isRoomAdmin = Number(user?.id) === Number(activeRoom.ownerId) || !!activeRoom.admin;

    const roomPatchParams = {
        firstName: user?.firstName || '',
        lastName: user?.lastName || '',
    };

    const closeEventDetails = () => {
        eventDetailsAbortRef.current?.abort();
        eventDetailsAbortRef.current = null;
        eventDetailsLoadingRef.current = false;
        setModalEventData(null);
    };

    const loadEventDetails = async () => {
        if (!activeRoom.eventId) return;
        if (eventDetailsLoadingRef.current) return;
        eventDetailsAbortRef.current?.abort();
        const ac = new AbortController();
        eventDetailsAbortRef.current = ac;
        eventDetailsLoadingRef.current = true;
        setModalEventData((prev: any) => (
            prev && Number(prev.id) === Number(activeRoom.eventId)
                ? { ...prev, loadingDetails: true, detailsLoadFailed: false }
                : {
                    id: activeRoom.eventId,
                    title: displayTitle || activeRoom.title,
                    user_status: 'JOINED',
                    loadingDetails: true,
                }
        ));
        try {
            await runWithTimeoutRetry(async (signal) => {
                const res = await api.get(`/api/v1/social/events/${activeRoom.eventId}`, { signal });
                if (signal.aborted || eventDetailsAbortRef.current !== ac) return;
                if (res.data) {
                    setModalEventData({ ...res.data, user_status: 'JOINED' });
                    return;
                }
                throw new Error('empty-event');
            }, ac.signal);
        } catch (err) {
            if (eventDetailsAbortRef.current !== ac || ac.signal.aborted) return;
            console.error("Не удалось открыть детали события:", err);
            setModalEventData((prev: any) => (prev ? { ...prev, loadingDetails: false, detailsLoadFailed: true } : null));
        } finally {
            if (eventDetailsAbortRef.current === ac) {
                eventDetailsLoadingRef.current = false;
            }
        }
    };

    const uploadRoomAvatar = async (file?: File) => {
        if (!file) return;
        try {
            const url = await uploadChatPhoto(file);
            const res = await api.patch(`/api/v1/social/chats/rooms/${activeRoom.id}`, { avatarUrl: url }, { params: roomPatchParams });
            applyRoomPatch(res.data || { avatarUrl: url });
        } catch (e) {
            console.error(e);
            showAppInfoToast('Ошибка', 'Не удалось обновить аватар чата');
        }
    };

    const closeParticipantsPanel = () => {
        participantsAbortRef.current?.abort();
        participantsAbortRef.current = null;
        participantsLoadingRef.current = false;
        participantsLoadFailedRef.current = false;
        setShowParticipantsId(null);
        setParticipantsLoading(false);
        setParticipantsLoadFailed(false);
    };

    const loadParticipantsPanel = async () => {
        const openId = isPersonalGroup ? activeRoom.id : activeRoom.eventId;
        if (!openId) return;
        if (participantsLoadingRef.current) return;

        participantsAbortRef.current?.abort();
        const ac = new AbortController();
        participantsAbortRef.current = ac;
        participantsLoadingRef.current = true;
        participantsLoadFailedRef.current = false;

        if (lastParticipantsKeyRef.current !== Number(openId)) {
            setParticipantsList([]);
            setBannedParticipantsList([]);
        }
        setShowParticipantsId(openId);
        setParticipantsLoading(true);
        setParticipantsLoadFailed(false);
        setShowBannedList(false);

        try {
            await runWithTimeoutRetry(async (signal) => {
                if (isPersonalGroup) {
                    const partRes = await api.get(`/api/v1/social/chats/rooms/${activeRoom.id}/members`, { signal });
                    if (signal.aborted || participantsAbortRef.current !== ac) return;
                    setParticipantsList((partRes.data || []).map((p: any) => ({
                        userId: p.userId,
                        firstName: p.firstName,
                        lastName: p.lastName,
                        avatarUrl: p.avatarUrl,
                        owner: p.owner,
                        admin: p.admin,
                    })));
                    setBannedParticipantsList([]);
                    lastParticipantsKeyRef.current = Number(openId);
                    return;
                }
                if (!activeRoom.eventId) return;
                const isOwner = Number(user?.id) === Number(activeRoom.ownerId);
                const [partRes, eventRes, bannedRes, chatMembersRes] = await Promise.all([
                    api.get(`/api/v1/social/events/${activeRoom.eventId}/participants`, { signal }),
                    api.get(`/api/v1/social/events/${activeRoom.eventId}`, { signal }).catch((err) => {
                        if (signal.aborted) throw err;
                        return { data: null };
                    }),
                    isOwner
                        ? api.get(`/api/v1/social/events/${activeRoom.eventId}/participants/banned`, { signal }).catch((err) => {
                            if (signal.aborted) throw err;
                            return { data: [] };
                        })
                        : Promise.resolve({ data: [] }),
                    api.get(`/api/v1/social/chats/rooms/${activeRoom.id}/members`, { signal }).catch((err) => {
                        if (signal.aborted) throw err;
                        return { data: [] };
                    }),
                ]);
                if (signal.aborted || participantsAbortRef.current !== ac) return;
                const adminIds = new Set((chatMembersRes.data || []).filter((m: any) => m.admin || m.owner).map((m: any) => Number(m.userId)));
                setParticipantsList((partRes.data || []).map((p: any) => ({
                    ...p,
                    owner: Number(p.userId) === Number(activeRoom.ownerId),
                    admin: adminIds.has(Number(p.userId)),
                })));
                setBannedParticipantsList(bannedRes.data || []);
                lastParticipantsKeyRef.current = Number(openId);
                if (eventRes.data && eventRes.data.eventDate) {
                    setChatEventDateStr(eventRes.data.eventDate);
                    setChatRepOpensAt(eventRes.data.reputationOpensAt || '');
                    setChatRepClosesAt(eventRes.data.reputationClosesAt || '');
                    setChatCanVoteReputation(eventRes.data.canVoteReputation === true);
                } else {
                    setChatEventDateStr('');
                    setChatRepOpensAt('');
                    setChatRepClosesAt('');
                    setChatCanVoteReputation(false);
                }
            }, ac.signal);
        } catch (err) {
            if (participantsAbortRef.current !== ac || ac.signal.aborted) return;
            console.error(err);
            participantsLoadFailedRef.current = true;
            setParticipantsLoadFailed(true);
        } finally {
            if (participantsAbortRef.current === ac) {
                participantsLoadingRef.current = false;
                setParticipantsLoading(false);
            }
        }
    };

    const sendTyping = useCallback(() => {
        if (!stompClient?.connected || !user?.id) return;
        const now = Date.now();
        if (now - lastTypingSentRef.current < 1500) return;
        lastTypingSentRef.current = now;
        stompClient.publish({
            destination: '/app/chat/typing',
            body: JSON.stringify({
                chatId: Number(activeRoom.id),
                recipientId: null,
                senderId: user.id,
                senderFirstName: user.firstName,
                content: '[TYPING]',
            }),
        });
    }, [stompClient, activeRoom.id, user?.id, user?.firstName]);
    const chatMedia = useChatMediaAttach();
    const sendVoice = useCallback(async (blob: Blob, duration: number) => {
        if (!stompClient?.connected) return;
        const stored = await uploadChatVoice(blob);
        stompClient.publish({
            destination: '/app/chat',
            body: JSON.stringify({
                chatId: Number(activeRoom.id),
                recipientId: null,
                content: '',
                voiceUrl: stored,
                voiceDuration: duration,
                senderId: user?.id,
                senderFirstName: user?.firstName,
                senderLastName: user?.lastName,
                parentIds: [],
            }),
        });
    }, [stompClient, activeRoom.id, user?.id, user?.firstName, user?.lastName]);
    const voice = useChatVoiceRecorder(sendVoice);
    useChatPasteImages(chatMedia.addPhotos, !actions.editingId && voice.mode === 'idle');
    const [myChatVotes, setMyChatVotes] = useState<any[]>([]);
    const [chatVotingLoading, setChatVotingLoading] = useState<string | null>(null);
    const [isForwardModalOpen, setIsForwardModalOpen] = useState(false);
    const [forwardSourceId, setForwardSourceId] = useState<number | null>(null);
    const [lastLocalReplies, setLastLocalReplies] = useState<any>(null);

    useEffect(() => {
        skipDraftSave.current = true;
        setSearchOpen(false);
        setEmojiOpen(false);
        setPollModalOpen(false);
        actions.setDraft(readChatDraft('group', activeRoom.id));
        const t = window.setTimeout(() => { skipDraftSave.current = false; }, 0);
        return () => window.clearTimeout(t);
    }, [activeRoom.id]);

    useEffect(() => {
        if (skipDraftSave.current) return;
        writeChatDraft('group', activeRoom.id, actions.draft);
    }, [actions.draft, activeRoom.id]);

    useEffect(() => {
        const mapRaw = (m: any): Msg => {
            let textContent = m.content || "";
            const linkMeta = parseLinkedSystemContent(textContent);
            if (linkMeta) textContent = linkMeta.text;
            const hasJoinMarker = /присоедини/i.test(textContent) || textContent.includes("вступил")
                || /покинул/i.test(textContent) || textContent.includes("отказался")
                || /добавлен/i.test(textContent) || /исключ/i.test(textContent)
                || /назначил/i.test(textContent) || /снял\(а\)/i.test(textContent) || /добавил/i.test(textContent)
                || /изменил/i.test(textContent) || /передал/i.test(textContent)
                || textContent.startsWith('Название чата изменено')
                || /аватарк/i.test(textContent)
                || /администратор/i.test(textContent)
                || /создателем чата/i.test(textContent)
                || /закрепил/i.test(textContent)
                || textContent === 'Групповой чат создан';
            const isDeletedFromDb = m.deleted === true || m.isDeleted === true || m.msgDeleted === true;
            return {
                id: m.id.toString(),
                senderId: m.senderId,
                senderFirstName: m.senderFirstName,
                senderLastName: m.senderLastName,
                senderAvatarUrl: m.senderAvatarUrl,
                from: Number(m.senderId) === Number(user?.id) ? 'me' : 'them',
                text: isDeletedFromDb ? 'Сообщение удалено' : textContent,
                photos: isDeletedFromDb ? [] : (m.photos || []),
                files: isDeletedFromDb ? [] : (m.files || []),
                voiceUrl: isDeletedFromDb ? undefined : m.voiceUrl,
                voiceDuration: isDeletedFromDb ? undefined : m.voiceDuration,
                time: formatMessageTime(m.createdAt) || formatMessageTime(m.timestamp),
                timestamp: m.createdAt || m.timestamp,
                isSystem: m.isSystem === true || m.system === true || hasJoinMarker,
                edited: m.edited,
                read: m.read,
                isDeleted: isDeletedFromDb,
                systemLinkUserId: linkMeta?.systemLinkUserId,
                systemLinkName: linkMeta?.systemLinkName,
                systemLinkSuffix: linkMeta?.systemLinkSuffix,
                reply_to: (m.bundledForwards && m.bundledForwards.length > 0) ? mapBundledForwardQuotes(m.bundledForwards) : (m.parentIds && m.parentIds.length > 0) ? m.parentIds.map((parentId: any) => {
                    const originalMsg = actions.messages.find(x => x.id.toString() === parentId.toString());
                    return {
                        id: parentId.toString(),
                        author: originalMsg ? (originalMsg.from === 'me' ? 'Вы' : `${originalMsg.senderFirstName || 'Участник'}`) : 'Участник',
                        text: originalMsg ? originalMsg.text : 'Сообщение'
                    };
                }) : (Number(m.senderId) === Number(user?.id) && lastLocalReplies) ? lastLocalReplies : undefined,
                forwardedFrom: m.forwardedFrom ? m.forwardedFrom : undefined,
                bundledForwards: m.bundledForwards ? m.bundledForwards : undefined,
                poll: m.poll || undefined
            };
        };

        const fetchHistory = async () => {
            const gen = ++historyFetchGenRef.current;
            try {
                historyLoadingRef.current = false;
                setHistoryLoadingMore(false);
                historyHasMoreRef.current = true;
                setHistoryHasMore(true);
                const unreadAtOpen = historyEpoch === 0 ? unreadAtOpenRef.current : 0;
                const response = await api.get(`/api/v1/social/chats/room/${activeRoom.id}/history`, {
                    params: { size: HISTORY_PAGE_SIZE },
                });
                let acc = (response.data || []).map(mapRaw).sort((a: any, b: any) => Number(a.id) - Number(b.id));
                let hasMore = (response.data || []).length >= HISTORY_PAGE_SIZE;
                for (let page = 0; page < 8 && hasMore && unreadAtOpen > realMessageCount(acc); page++) {
                    const beforeId = oldestNumericId(acc);
                    if (!beforeId) break;
                    const olderRes = await api.get(`/api/v1/social/chats/room/${activeRoom.id}/history`, {
                        params: { size: HISTORY_PAGE_SIZE, beforeId },
                    });
                    const olderRaw = olderRes.data || [];
                    hasMore = olderRaw.length >= HISTORY_PAGE_SIZE;
                    const existing = new Set(acc.map((m: Msg) => m.id));
                    const older = olderRaw.map(mapRaw).filter((m: Msg) => !existing.has(m.id));
                    if (!older.length) {
                        hasMore = false;
                        break;
                    }
                    acc = [...older, ...acc].sort((a: any, b: any) => Number(a.id) - Number(b.id));
                }
                if (gen !== historyFetchGenRef.current) return;
                historyHasMoreRef.current = hasMore;
                setHistoryHasMore(hasMore);

                actions.setMessages((prev) => {
                    const merged = mergeChatMessagesById(acc, prev);
                    return insertUnreadDivider(merged, unreadAtOpen);
                });

                if (pageActiveRef.current && document.visibilityState === 'visible') {
                api.post(`/api/v1/social/chats/room/${activeRoom.id}/read`)
                    .then(() => {
                        if (setEventRooms) {
                            setEventRooms((prevRooms: any[]) => (prevRooms || []).map((r) => r && r.id === activeRoom.id ? { ...r, unread: 0 } : r));
                        }
                        if (refreshEventRooms) { refreshEventRooms(); }
                    })
                    .catch((err) => console.error("Ошибка авто-прочтения при входе:", err));
                }

                actions.scrollOpenThread();
            } catch (err) { console.error("Ошибка загрузки истории группы:", err); }
        };
        fetchHistory();
    }, [activeRoom.id, historyEpoch]);

    useEffect(() => {
        const onReload = (event: Event) => {
            const groupId = (event as CustomEvent<{ groupId?: number | string }>).detail?.groupId;
            if (groupId != null && Number(groupId) === Number(activeRoom.id)) {
                setHistoryEpoch((n) => n + 1);
            }
        };
        window.addEventListener(NAV_EVENT_RELOAD_CHAT_HISTORY, onReload);
        return () => window.removeEventListener(NAV_EVENT_RELOAD_CHAT_HISTORY, onReload);
    }, [activeRoom.id]);

    useEffect(() => {
        api.get(`/api/v1/social/chats/rooms/${activeRoom.id}/pins`)
            .then((res) => setPins(res.data || []))
            .catch(() => setPins([]));
        api.get(`/api/v1/social/chats/rooms/${activeRoom.id}/members`)
            .then((res) => {
                if (Array.isArray(res.data) && res.data.length) setParticipantsList(res.data);
            })
            .catch(() => undefined);
    }, [activeRoom.id]);

    useEffect(() => {
        if (!pageActive) return;
        const markIfOnScreen = () => {
            if (document.visibilityState !== 'visible') return;
            api.post(`/api/v1/social/chats/room/${activeRoom.id}/read`)
                .then(() => {
                    if (setEventRooms) {
                        setEventRooms((prevRooms: any[]) => (prevRooms || []).map((r) => r && r.id === activeRoom.id ? { ...r, unread: 0 } : r));
                    }
                    if (refreshEventRooms) { refreshEventRooms(); }
                })
                .catch((err) => console.error("Ошибка авто-прочтения при входе:", err));
        };
        markIfOnScreen();
        document.addEventListener('visibilitychange', markIfOnScreen);
        return () => document.removeEventListener('visibilitychange', markIfOnScreen);
    }, [pageActive, activeRoom.id, setEventRooms, refreshEventRooms]);

    const loadOlderGroupHistory = async (): Promise<boolean> => {
        if (historyLoadingRef.current || !historyHasMoreRef.current) return false;
        const oldest = messagesRef.current.find((m) => !isUnreadMarker(m.id) && /^\d+$/.test(String(m.id)));
        if (!oldest) {
            historyHasMoreRef.current = false;
            setHistoryHasMore(false);
            return false;
        }
        historyLoadingRef.current = true;
        setHistoryLoadingMore(true);
        const container = actions.messagesContainerRef.current;
        const prevHeight = container?.scrollHeight || 0;
        try {
            const response = await api.get(`/api/v1/social/chats/room/${activeRoom.id}/history`, {
                params: { size: HISTORY_PAGE_SIZE, beforeId: Number(oldest.id) },
            });
            const rows = response.data || [];
            if (rows.length === 0) {
                historyHasMoreRef.current = false;
                setHistoryHasMore(false);
                return false;
            }
            const mapped = rows.map((m: any) => {
                let textContent = m.content || "";
                const linkMeta = parseLinkedSystemContent(textContent);
                if (linkMeta) textContent = linkMeta.text;
                const hasJoinMarker = /присоедини/i.test(textContent) || textContent.includes("вступил")
                    || /покинул/i.test(textContent) || textContent.includes("отказался")
                    || /добавлен/i.test(textContent) || /исключ/i.test(textContent)
                    || /назначил/i.test(textContent) || /снял\(а\)/i.test(textContent) || /добавил/i.test(textContent)
                    || /изменил/i.test(textContent) || /передал/i.test(textContent)
                    || textContent.startsWith('Название чата изменено')
                    || /аватарк/i.test(textContent)
                    || /администратор/i.test(textContent)
                    || /создателем чата/i.test(textContent)
                    || /закрепил/i.test(textContent)
                    || textContent === 'Групповой чат создан';
                const isDeletedFromDb = m.deleted === true || m.isDeleted === true || m.msgDeleted === true;
                return {
                    id: m.id.toString(),
                    senderId: m.senderId,
                    senderFirstName: m.senderFirstName,
                    senderLastName: m.senderLastName,
                    senderAvatarUrl: m.senderAvatarUrl,
                    from: Number(m.senderId) === Number(user?.id) ? 'me' : 'them',
                    text: isDeletedFromDb ? 'Сообщение удалено' : textContent,
                    photos: isDeletedFromDb ? [] : (m.photos || []),
                    files: isDeletedFromDb ? [] : (m.files || []),
                    voiceUrl: isDeletedFromDb ? undefined : m.voiceUrl,
                    voiceDuration: isDeletedFromDb ? undefined : m.voiceDuration,
                    time: formatMessageTime(m.createdAt) || formatMessageTime(m.timestamp),
                    timestamp: m.createdAt || m.timestamp,
                    isSystem: m.isSystem === true || m.system === true || hasJoinMarker,
                    edited: m.edited,
                    read: m.read,
                    isDeleted: isDeletedFromDb,
                    systemLinkUserId: linkMeta?.systemLinkUserId,
                    systemLinkName: linkMeta?.systemLinkName,
                    systemLinkSuffix: linkMeta?.systemLinkSuffix,
                    forwardedFrom: m.forwardedFrom ? m.forwardedFrom : undefined,
                    bundledForwards: m.bundledForwards ? m.bundledForwards : undefined,
                    poll: m.poll || undefined
                } as Msg;
            });
            const existing = new Set(messagesRef.current.map((m) => m.id));
            const older = mapped.filter((m: Msg) => !existing.has(m.id));
            const hasMore = rows.length >= HISTORY_PAGE_SIZE && older.length > 0;
            historyHasMoreRef.current = hasMore;
            setHistoryHasMore(hasMore);
            if (older.length === 0) return false;
            actions.setMessages((prev) => [...older, ...prev]);
            requestAnimationFrame(() => {
                if (container) {
                    container.scrollTop = container.scrollHeight - prevHeight;
                }
            });
            return true;
        } catch (err) {
            console.error("Ошибка подгрузки истории группы:", err);
            return false;
        } finally {
            historyLoadingRef.current = false;
            setHistoryLoadingMore(false);
        }
    };
    actions.loadOlderMessagesRef.current = () => loadOlderGroupHistory();

    useEffect(() => {
        const el = actions.messagesContainerRef.current;
        if (!el || !historyHasMore || historyLoadingMore || el.clientHeight === 0) return;
        if (el.scrollHeight <= el.clientHeight + 8) {
            void loadOlderGroupHistory();
        }
    }, [actions.messages.length, historyHasMore, historyLoadingMore, activeRoom.id]);

    useEffect(() => {
        const savedBuffer = localStorage.getItem('pending_forward_messages');
        if (savedBuffer) {
            const parsed = JSON.parse(savedBuffer);
            actions.setForwardBuffer(parsed);
            localStorage.removeItem('pending_forward_messages');
        }
    }, [activeRoom.id]);

    // Чистый продакшн-фикс: мгновенное очищение экрана сообщений группы при мягкой очистке у себя
    useEffect(() => {
        const handleGroupClear = (event: Event) => {
            const customEvent = event as CustomEvent;

            // Проверяем, что очистили именно ту комнату встречи, которая сейчас открыта
            // Используем activeRoom.id (именно так называется проп в вашем Chats.tsx на странице 5)
            if (customEvent.detail && Number(customEvent.detail.chatId) === Number(activeRoom?.id)) {
                if (actions && typeof actions.setMessages === "function") {
                    actions.setMessages([]); // Мгновенно обнуляем массив сообщений на экране
                }
            }
        };

        window.addEventListener("instantGroupChatClear", handleGroupClear);
        return () => {
            window.removeEventListener("instantGroupChatClear", handleGroupClear);
        };
    }, [activeRoom?.id, actions]);


    useEffect(() => {
        if (!stompClient || !stompClient.connected) return;
        setTypers({});
        const subscription = stompClient.subscribe(`/topic/chat.${activeRoom.id}`, (message: any) => {
            const m = JSON.parse(message.body);
            if (m.content === '[TYPING]') {
                if (Number(m.senderId) === Number(user?.id)) return;
                const typerId = String(m.senderId);
                const typerName = String(m.senderFirstName || 'Участник').trim() || 'Участник';
                setTypers((prev) => ({ ...prev, [typerId]: typerName }));
                if (typingIdleRef.current[typerId]) window.clearTimeout(typingIdleRef.current[typerId]);
                typingIdleRef.current[typerId] = window.setTimeout(() => {
                    setTypers((prev) => {
                        const next = { ...prev };
                        delete next[typerId];
                        return next;
                    });
                }, 3500);
                return;
            }
            if (Number(m.chatId) !== Number(activeRoom.id) && !m.pinUpdate) return;
            if (m.pinUpdate) {
                if (Number(m.chatId) === Number(activeRoom.id)) setPins(m.pins || []);
                return;
            }

            if (m.senderId != null) {
                const typerId = String(m.senderId);
                if (typingIdleRef.current[typerId]) window.clearTimeout(typingIdleRef.current[typerId]);
                setTypers((prev) => {
                    if (!prev[typerId]) return prev;
                    const next = { ...prev };
                    delete next[typerId];
                    return next;
                });
            }

            let textContent = m.content || "";

            // ЖИВАЯ ПРОВЕРКА НА КИК ЧЕРЕЗ СОКЕТ
            if ((m.isSystem || m.system) && textContent.includes(`[KICKED_ID:${Number(user?.id)}]`)) {
                if (isPersonalGroup) {
                    showAppInfoToast('Исключение из чата', 'Вас исключили из группового чата.');
                } else {
                    showAppInfoToast('Исключение из встречи', 'Организатор исключил вас из этой встречи. Доступ к чату закрыт.');
                }
                if (setEventRooms) {
                    setEventRooms((prevRooms: any[]) => (prevRooms || []).filter((room) => room && room.id !== activeRoom.id));
                }
                onCloseChat();
                return;
            }
            const linkMetaLive = parseLinkedSystemContent(textContent);
            if (linkMetaLive) {
                textContent = linkMetaLive.text;
                m.content = textContent;
            }

            if (m.deleted === true || m.isDeleted === true || m.msgDeleted === true) {
                actions.setMessages((prev) => prev.map((msg) => String(msg.id) === String(m.id)
                    ? { ...msg, text: 'Сообщение удалено', isDeleted: true, photos: [], files: [], voiceUrl: undefined, voiceDuration: undefined }
                    : msg));
                return;
            }
            if (m.pollUpdate && m.poll) {
                actions.setMessages((prev) => prev.map((msg) => msg.id === m.id.toString()
                    ? { ...msg, poll: mergeIncomingPoll(msg.poll, m.poll) }
                    : msg));
                return;
            }
            if (m.edited) {
                actions.setMessages((prev) => prev.map((msg) => msg.id === m.id.toString() ? { ...msg, text: m.content, edited: true } : msg));
                return;
            }

            const hasJoinMarker = /присоедини/i.test(textContent) || textContent.includes("вступив")
                || /покинул/i.test(textContent) || /добавлен/i.test(textContent) || /исключ/i.test(textContent)
                || /назначил/i.test(textContent) || /снял\(а\)/i.test(textContent) || /добавил/i.test(textContent)
                || /изменил/i.test(textContent) || /передал/i.test(textContent)
                || textContent.startsWith('Название чата изменено')
                || /аватарк/i.test(textContent)
                || /администратор/i.test(textContent)
                || /создателем чата/i.test(textContent)
                || /закрепил/i.test(textContent)
                || textContent === 'Групповой чат создан';

            if (/администратор|создателем чата|передал/i.test(textContent) && refreshEventRooms) {
                refreshEventRooms();
            }

            if (isPersonalGroup && /аватарк/i.test(textContent)) {
                if (Array.isArray(m.photos) && m.photos[0]) {
                    applyRoomPatch({ avatarUrl: m.photos[0] });
                } else if (/убрал/i.test(textContent)) {
                    applyRoomPatch({ avatarUrl: '' });
                }
            }

            const newMsg: Msg = {
                id: m.id.toString(),
                senderId: m.senderId,
                senderFirstName: m.senderFirstName,
                senderLastName: m.senderLastName,
                senderAvatarUrl: m.senderAvatarUrl,
                from: Number(m.senderId) === Number(user?.id) ? 'me' : 'them',
                text: m.content || '',
                photos: m.photos || [],
                files: m.files || [],
                voiceUrl: m.voiceUrl,
                voiceDuration: m.voiceDuration,
                time: formatMessageTime(m.createdAt) || formatMessageTime(m.timestamp),
                timestamp: m.createdAt || m.timestamp,
                isSystem: m.isSystem === true || m.system === true || hasJoinMarker || /покинул/i.test(textContent) || textContent.includes("отказался"),
                edited: m.edited,
                read: m.read,
                isDeleted: m.deleted === true || m.isDeleted === true || m.msgDeleted === true,
                systemLinkUserId: linkMetaLive?.systemLinkUserId,
                systemLinkName: linkMetaLive?.systemLinkName,
                systemLinkSuffix: linkMetaLive?.systemLinkSuffix,
                reply_to: (m.bundledForwards && m.bundledForwards.length > 0)
                    ? mapBundledForwardQuotes(m.bundledForwards)
                    : (m.parentIds && m.parentIds.length > 0)
                        ? m.parentIds.map((parentId: any) => {
                            const originalMsg = actions.messages.find(x => x.id.toString() === parentId.toString());
                            return {
                                id: parentId.toString(),
                                author: originalMsg ? (originalMsg.from === 'me' ? 'Вы' : `${originalMsg.senderFirstName || 'Участник'}`) : 'Участник',
                                text: originalMsg ? originalMsg.text : 'Сообщение'
                            };
                        })
                        : (Number(m.senderId) === Number(user?.id) && lastLocalReplies)
                            ? lastLocalReplies
                            : undefined,
                forwardedFrom: m.forwardedFrom ? m.forwardedFrom : undefined,
                bundledForwards: m.bundledForwards ? m.bundledForwards : undefined,
                poll: m.poll || undefined
            };
            if (newMsg.from === 'them' && !newMsg.isDeleted && !m.edited) {
                // Автопрочтение только если этот чат реально на экране
                if (pageActiveRef.current && document.visibilityState === 'visible') {
                    api.post(`/api/v1/social/chats/room/${activeRoom.id}/read`)
                        .then(() => {
                            if (setEventRooms) {
                                setEventRooms((prevRooms: any[]) => (prevRooms || []).map((r) => r && r.id === activeRoom.id ? { ...r, unread: 0 } : r));
                            }
                            if (refreshEventRooms) { refreshEventRooms(); }
                        })
                        .catch((err) => console.error("Ошибка автопрочтения сообщения «на лету»:", err));
                }
            }

            actions.setMessages((prev) => {
                // Динамически собираем reply_to для получателя на основе живого массива prev
                if (m.parentIds && m.parentIds.length > 0 && (!newMsg.reply_to || newMsg.reply_to.length ===
                    0)) {
                    newMsg.reply_to = m.parentIds.map((parentId: any) => {
                        const originalMsg = prev.find(x => x.id.toString() === parentId.toString());
                        return {
                            id: parentId.toString(),
                            author: originalMsg ? (originalMsg.from === 'me' ? 'Вы' : `${originalMsg.senderFirstName || 'Участник'}`) : 'Участник',
                            text: originalMsg ? originalMsg.text : 'Пересланное сообщение'
                        };
                    });
                }

                // Создаем карту на основе текущего стейта
                const messageMap = new Map(prev.map(msg => [msg.id.toString(), msg]));

                if (messageMap.has(newMsg.id)) {
                    const existing = messageMap.get(newMsg.id)!;
                    if (existing.isDeleted) {
                        // Сокет не должен возвращать уже удалённое сообщение
                    } else {
                        messageMap.set(newMsg.id, {
                            ...existing,
                            text: newMsg.isDeleted ? 'Сообщение удалено' : newMsg.text,
                            edited: newMsg.edited || existing.edited,
                            photos: newMsg.isDeleted ? [] : (newMsg.photos?.length ? newMsg.photos : existing.photos),
                            files: newMsg.isDeleted ? [] : (newMsg.files?.length ? newMsg.files : existing.files),
                            voiceUrl: newMsg.isDeleted ? undefined : (newMsg.voiceUrl || existing.voiceUrl),
                            voiceDuration: newMsg.isDeleted ? undefined : (newMsg.voiceDuration || existing.voiceDuration),
                            reply_to: newMsg.reply_to || existing.reply_to,
                            forwardedFrom: newMsg.forwardedFrom || existing.forwardedFrom,
                            bundledForwards: newMsg.bundledForwards || existing.bundledForwards,
                            poll: newMsg.poll ? mergeIncomingPoll(existing.poll, newMsg.poll) : existing.poll,
                            time: existing.time || newMsg.time,
                            isDeleted: newMsg.isDeleted || existing.isDeleted,
                        });
                    }
                } else {
                    // Фикс исчезновения: если пришло реальное сообщение от нас, мы ищем временную заглушку в истории
                    if (newMsg.from === 'me') {
                        const tempMessage = prev.find(el => el.from === 'me' && el.text === newMsg.text && isNaN(Number(el.id)));
                        if (tempMessage) {
                            // Вместо деструктивного messageMap.delete() мы просто обновляем данные этой ячейки новым серверным ID!
                            messageMap.set(tempMessage.id, { ...newMsg, id: newMsg.id });
                        }
                    }
                    // Железно пишем новое сообщение в карту по его родному ID
                    messageMap.set(newMsg.id, newMsg);
                }

                const updatedArray = Array.from(messageMap.values());
                return updatedArray.sort((a, b) => {
                    if (isUnreadMarker(a.id) || isUnreadMarker(b.id)) return 0;
                    return Number(a.id) - Number(b.id);
                });
            });
        });
        return () => {
            subscription.unsubscribe();
            Object.values(typingIdleRef.current).forEach((id) => window.clearTimeout(id));
            typingIdleRef.current = {};
        };
    }, [stompClient, stompClient?.connected, activeRoom.id, lastLocalReplies]);
    const { chats } = useChat();
    const voiceQueue = voiceQueueFromMessages(actions.messages);

    const handleForwardSubmit = (targets: { recipientId?: number; chatId?: number }[], comment?: string) => {
        const messagesToBuffer = actions.isSelectionMode && actions.selectedParentIds.length > 0
            ? actions.messages.filter(m => actions.selectedParentIds.includes(m.id))
            : forwardSourceId
                ? actions.messages.filter(m => Number(m.id) === forwardSourceId)
                : [];
        if (messagesToBuffer.length === 0) return;

        setIsForwardModalOpen(false);
        setForwardSourceId(null);
        actions.resetSelectionMode();

        if (!stompClient || !stompClient.connected) return;
        publishForwardToChats(stompClient, user, targets, messagesToBuffer, comment);
    };


        // ПРОДАКШН-ФИКС: Ловим событие «Поделиться встречей» и вставляем маркер в инпут
    useEffect(() => {
        const handleShareEvent = (e: Event) => {
            const customEvent = e as CustomEvent;
            const { eventId, title } = customEvent.detail;

            // Безопасно дополняем или вставляем маркер в черновик сообщения
            if (actions && typeof actions.setDraft === 'function') {
                actions.setDraft(`[SHARE_EVENT:${eventId}] Приглашаю на встречу: "${title}"`);
            }
        };

        window.addEventListener('shareEventToChat', handleShareEvent);
        return () => window.removeEventListener('shareEventToChat', handleShareEvent);
    }, [actions]);

    const send = async () => {
        if (!actions.draft.trim() && actions.forwardBuffer.length === 0 && chatMedia.count === 0) return;
        if (chatMedia.count > 0 && !chatMedia.allReady) return;
        if (actions.editingId) {
            try {
                await api.put(`/api/v1/social/chats/message/${actions.editingId}`, actions.draft.trim(), { headers: { 'Content-Type': 'text/plain' } });
                actions.setMessages(actions.messages.map((m) => (m.id === actions.editingId ? { ...m, text: actions.draft.trim(), edited: true } : m)));
                actions.setEditingId(null); actions.setDraft('');
            } catch (err) { console.error(err); }
            return;
        }
        if (stompClient && stompClient.connected) {
            if (actions.forwardBuffer.length > 0) {
                actions.isMySentAction.current = true;
                publishForwardToChats(
                    stompClient,
                    user,
                    [{ chatId: Number(activeRoom.id) }],
                    actions.forwardBuffer,
                    actions.draft.trim()
                );
                actions.setDraft('');
                actions.resetForwardBuffer();
                actions.resetSelectionMode();
                setLastLocalReplies(null);
                chatMedia.clear();
                clearChatDraft('group', activeRoom.id);
                return;
            }

            const idsArray = actions.replyTo.length > 0 ? actions.replyTo.map(r => Number(r.id)) : [];

            // Запоминаем, что именно мы пересылаем, в локальный реф хука для WebSocket-обработчика
            if (idsArray.length > 0) {
                const sourceData = actions.replyTo;
                setLastLocalReplies(sourceData.map((parent: any) => ({
                    id: parent.id.toString().replace(/\s+/g, ''),
                    author: parent.from === 'me' || parent.author === 'Вы' ? 'Вы' : (parent.senderFirstName || 'Участник'),
                    text: parent.text || parent.content || ''
                })));
            }

            const messagePayload = {
                chatId: Number(activeRoom.id),
                recipientId: null,
                content: actions.draft.trim(),
                photos: chatMedia.storedPhotoUrls,
                files: chatMedia.storedFiles,
                senderId: user?.id,
                senderFirstName: user?.firstName,
                senderLastName: user?.lastName,
                parentIds: idsArray
            };

            actions.isMySentAction.current = true;
            stompClient.publish({ destination: '/app/chat', body: JSON.stringify(messagePayload) });

            actions.setDraft('');
            actions.resetForwardBuffer();
            actions.resetSelectionMode();
            setLastLocalReplies(null);
            chatMedia.clear();
            clearChatDraft('group', activeRoom.id);
        } else {
            showAppInfoToast('Чат', 'Нет связи с сервером сообщений. Проверьте Wi‑Fi и обновите страницу.');
        }

    };

    const handleLeaveChat = async () => {
        setHeaderMenuOpen(false);
        if (!activeRoom?.id || !user?.id) return;
        if (!isPersonalGroup && Number(user.id) === Number(activeRoom.ownerId)) return;
        try {
            if (isPersonalGroup) {
                if (Number(user.id) === Number(activeRoom.ownerId)) {
                    const partRes = await api.get(`/api/v1/social/chats/rooms/${activeRoom.id}/members`);
                    setParticipantsList(partRes.data || []);
                    setTransferUserId(null);
                    setLeaveOwnerOpen(true);
                    return;
                }
                const confirmed = await showAppConfirm({
                    title: 'Покинуть чат',
                    message: 'Чат будет удалён из вашего списка.',
                    confirmText: 'Покинуть',
                    cancelText: 'Отмена',
                    danger: true,
                });
                if (!confirmed) return;
                await api.delete(
                    `/api/v1/social/chats/rooms/${activeRoom.id}/members/${user.id}?firstName=${encodeURIComponent(user.firstName || '')}&lastName=${encodeURIComponent(user.lastName || '')}`
                );
                if (setEventRooms) {
                    setEventRooms((prev: any[]) => (prev || []).filter((room) => room && Number(room.id) !== Number(activeRoom.id)));
                }
                onCloseChat();
                return;
            }
            const eventRes = await api.get(`/api/v1/social/events/${activeRoom.eventId}`).catch(() => ({ data: null }));
            const eventDate = eventRes.data?.eventDate;
            const eventStarted = eventDate ? new Date(eventDate).getTime() <= Date.now() : false;

            const confirmed = await showAppConfirm({
                title: 'Покинуть чат',
                message: eventStarted
                    ? 'Чат будет удалён из списка. Вы останетесь в списке участников — будет считаться, что вы были на встрече.'
                    : 'Чат будет удалён из списка, и вы выйдете из встречи.',
                confirmText: 'Покинуть',
                cancelText: 'Отмена',
                danger: true,
            });
            if (!confirmed) return;

            if (eventStarted) {
                const firstName = encodeURIComponent(user.firstName || '');
                const lastName = encodeURIComponent(user.lastName || '');
                await api.delete(
                    `/api/v1/social/chats/room/${activeRoom.eventId}?isLeave=true&firstName=${firstName}&lastName=${lastName}`
                );
            } else {
                await api.post(`/api/v1/social/events/${activeRoom.eventId}/participants/leave`);
            }

            if (setEventRooms) {
                setEventRooms((prev: any[]) => (prev || []).filter((room) => room && Number(room.id) !== Number(activeRoom.id)));
            }
            onCloseChat();
        } catch (err) {
            console.error(err);
            showAppInfoToast('Ошибка', 'Не удалось покинуть чат');
        }
    };

    const handleChatVote = async (eventId: number, targetId: number, type: 'PLUS' | 'MINUS') => {
        if (chatVotingLoading) return;
        setChatVotingLoading(`${targetId}-${type}`);
        try {
            await api.post('/api/v1/social/events/reputation/vote', null, { params: { eventId, targetId,
                    voteType: type } });
            setMyChatVotes((prev) => {
                const existingIdx = prev.findIndex(v => v && Number(v.targetId) === Number(targetId));
                if (existingIdx > -1) {
                    if (prev[existingIdx].voteType === type) { return prev.filter(v => Number(v.targetId) !== Number(targetId)); }
                    const updated = [...prev]; updated[existingIdx] = { ...updated[existingIdx], voteType: type }; return updated;
                }
                return [...prev, { targetId, voteType: type }];
            });
        } catch (err) { console.error("Не удалось зафиксировать оценку репутации в чате:", err); }
        finally { setChatVotingLoading(null); }
    };

    useEffect(() => {
        const activeEventId = showParticipantsId || modalEventData?.id;
        if (activeEventId && user?.id) {
            api.get(`/api/v1/social/events/reputation/my-votes/${activeEventId}`)
                .then(res => setMyChatVotes(res.data || []))
                .catch(err => console.error("Ошибка загрузки оценок репутации:", err));
        }
    }, [showParticipantsId, modalEventData?.id, user?.id]);

    return (
        <div
            className="flex-1 flex flex-col h-full min-h-0 overflow-hidden relative"
            data-open-group-chat={activeRoom.id}
        >
            <div className={`px-3 md:px-6 py-3.5 max-lg:pt-[max(0.75rem,env(safe-area-inset-top))] border-b ${theme.surface.border} ${theme.surface.card} flex items-center justify-between shrink-0`}>
                <div className="flex items-center gap-2 md:gap-3 min-w-0">
                    <button
                        type="button"
                        onClick={onCloseChat}
                        className="lg:hidden w-11 h-11 -ml-1 rounded-full flex items-center justify-center text-[#1C1824] shrink-0"
                        aria-label="Назад к списку чатов"
                    >
                        <ChevronLeft className="w-6 h-6" />
                    </button>
                    <div className="relative shrink-0">
                        <button
                            type="button"
                            onClick={() => {
                                if (displayAvatarUrl) setAvatarPreviewOpen(true);
                                else if (canChangeAvatar) avatarInputRef.current?.click();
                            }}
                            className={`w-10 h-10 rounded-full bg-[#DDD4F0] overflow-hidden flex items-center justify-center text-[#5C4B7A] font-bold text-sm ${displayAvatarUrl || canChangeAvatar ? 'cursor-pointer hover:ring-2 hover:ring-[#5C4B7A]/30' : ''}`}
                            title={displayAvatarUrl ? 'Открыть аватар' : (canChangeAvatar ? 'Поставить аватар' : undefined)}
                        >
                            {displayAvatarUrl ? (
                                <img src={getAvatarUrl(null, displayAvatarUrl)} alt="" className="w-full h-full object-cover" />
                            ) : (
                                (displayTitle || activeRoom.title).substring(0, 2).toUpperCase()
                            )}
                        </button>
                        {canChangeAvatar && (
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); avatarInputRef.current?.click(); }}
                                className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-[#5C4B7A] text-white flex items-center justify-center shadow-sm"
                                title="Сменить аватар"
                            >
                                <Camera className="w-3 h-3" />
                            </button>
                        )}
                    </div>
                    <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => { void uploadRoomAvatar(e.target.files?.[0]); e.target.value = ''; }}
                    />
                    <div>
                        <div className="font-semibold text-slate-900 text-sm tracking-wide">{displayTitle}</div>
                        <div className={`text-xs ${Object.keys(typers).length ? 'text-[#3D6B56]' : 'text-slate-400'}`}>
                            {(() => {
                                const names = Object.values(typers);
                                if (names.length === 1) return `${names[0]} печатает…`;
                                if (names.length === 2) return `${names[0]} и ${names[1]} печатают…`;
                                if (names.length > 2) return 'Несколько человек печатают…';
                                return isPersonalGroup ? 'Групповой чат' : 'Групповой чат встречи';
                            })()}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-1 relative">
                    <button
                        type="button"
                        onClick={() => setSearchOpen((v) => !v)}
                        className={`p-2 rounded-lg transition ${searchOpen ? 'bg-slate-100 text-[#5C4B7A]' : 'text-slate-500 hover:bg-slate-100'}`}
                        title="Поиск"
                    >
                        <Search className="w-4 h-4" />
                    </button>
                    {!isPersonalGroup && (
                    <button type="button" onClick={() => {
                        if (!activeRoom.eventId) return;
                        if (modalEventData?.loadingDetails) return;
                        if (modalEventData && !modalEventData.detailsLoadFailed) return;
                        void loadEventDetails();
                    }} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-[#5C4B7A] transition" title="О встрече">
                        <Info className="w-4 h-4" />
                    </button>
                    )}
                    <button type="button" onClick={(e) => { e.stopPropagation(); setHeaderMenuOpen(!headerMenuOpen); }} className={`p-2 rounded-lg transition ${headerMenuOpen ? 'bg-slate-100 text-[#5C4B7A]' : 'text-slate-500 hover:bg-slate-100'}`} title="Управление">
                        <MoreHorizontal className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={onCloseChat} className="hidden lg:inline-flex p-2 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition ml-1" title="Закрыть"><X className="w-4 h-4 stroke-[2.5]" /></button>
                    {headerMenuOpen && (
                        <>
                            <div className="fixed inset-0 z-40 cursor-default" onClick={() => setHeaderMenuOpen(false)} />
                            <div className="absolute right-9 top-11 bg-white border border-slate-200/80 shadow-xl rounded-xl py-1.5 min-w-[190px] z-50 animate-fadeIn pointer-events-auto">
                                <button type="button" onClick={() => {
                                    setHeaderMenuOpen(false);
                                    const openId = isPersonalGroup ? activeRoom.id : activeRoom.eventId;
                                    if (!openId) return;
                                    if (showParticipantsId === openId && participantsLoadingRef.current) return;
                                    if (showParticipantsId === openId && !participantsLoadFailedRef.current) return;
                                    void loadParticipantsPanel();
                                }} className="w-full text-left px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition flex items-center gap-2">
                                    <Users className="w-3.5 h-3.5 text-slate-400" /><span>Участники чата</span>
                                </button>
                                <button type="button" onClick={() => { setHeaderMenuOpen(false); setGalleryOpen(true); }} className="w-full text-left px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition flex items-center gap-2">
                                    <FolderOpen className="w-3.5 h-3.5 text-slate-400" /><span>Материалы чата</span>
                                </button>
                                {isPersonalGroup && Number(user?.id) !== Number(activeRoom.ownerId) && renamePolicy === 'EVERYONE' && (
                                    <button type="button" onClick={() => { setHeaderMenuOpen(false); setRenameValue(displayTitle); setRenameOpen(true); }} className="w-full text-left px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition flex items-center gap-2">
                                        <Pencil className="w-3.5 h-3.5 text-slate-400" /><span>Название чата</span>
                                    </button>
                                )}
                                {isPersonalGroup && Number(user?.id) !== Number(activeRoom.ownerId) && canChangeAvatar && (
                                    <button type="button" onClick={() => { setHeaderMenuOpen(false); avatarInputRef.current?.click(); }} className="w-full text-left px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition flex items-center gap-2">
                                        <Camera className="w-3.5 h-3.5 text-slate-400" /><span>Сменить аватар</span>
                                    </button>
                                )}
                                {isPersonalGroup && (Number(user?.id) === Number(activeRoom.ownerId) || !!activeRoom.admin || addPolicy === 'EVERYONE') && (
                                    <button type="button" onClick={() => { setHeaderMenuOpen(false); setAddMembersOpen(true); }} className="w-full text-left px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition flex items-center gap-2">
                                        <UserPlus className="w-3.5 h-3.5 text-slate-400" /><span>Добавить друзей</span>
                                    </button>
                                )}
                                {isPersonalGroup && (Number(user?.id) === Number(activeRoom.ownerId) || !!activeRoom.admin) && (
                                    <button type="button" onClick={() => {
                                        setHeaderMenuOpen(false);
                                        setRenameValue(displayTitle);
                                        setDraftAddPolicy(addPolicy);
                                        setDraftRenamePolicy(renamePolicy);
                                        setDraftAvatarPolicy(avatarPolicy);
                                        setSettingsOpen(true);
                                    }} className="w-full text-left px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition flex items-center gap-2">
                                        <Settings className="w-3.5 h-3.5 text-slate-400" /><span>Настройки чата</span>
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={async () => {
                                        setHeaderMenuOpen(false);
                                        try {
                                            if (activeRoom.muted) await api.delete(`/api/v1/social/chats/rooms/${activeRoom.id}/mute`);
                                            else await api.put(`/api/v1/social/chats/rooms/${activeRoom.id}/mute`);
                                            if (setEventRooms) {
                                                setEventRooms((prev: any[]) => (prev || []).map((r) => r && Number(r.id) === Number(activeRoom.id) ? { ...r, muted: !activeRoom.muted } : r));
                                            }
                                        } catch (e) { console.error(e); }
                                    }}
                                    className="w-full text-left px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition flex items-center gap-2"
                                >
                                    {activeRoom.muted ? <Bell className="w-3.5 h-3.5 text-slate-400" /> : <BellOff className="w-3.5 h-3.5 text-slate-400" />}
                                    <span>{activeRoom.muted ? 'Включить уведомления' : 'Выключить уведомления'}</span>
                                </button>
                                {isPersonalGroup && (
                                <button
                                    type="button"
                                    onClick={async () => {
                                        setHeaderMenuOpen(false);
                                        try {
                                            if (activeRoom.pinned) await api.delete(`/api/v1/social/chats/rooms/${activeRoom.id}/pin`);
                                            else await api.put(`/api/v1/social/chats/rooms/${activeRoom.id}/pin`);
                                            if (refreshEventRooms) await refreshEventRooms();
                                        } catch (err: any) {
                                            showAppInfoToast('Закрепление', err?.response?.data?.details || 'Можно закрепить не больше 5 чатов');
                                        }
                                    }}
                                    className="w-full text-left px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition flex items-center gap-2"
                                >
                                    <Pin className="w-3.5 h-3.5 text-slate-400" />
                                    <span>{activeRoom.pinned ? 'Открепить чат' : 'Закрепить чат'}</span>
                                </button>
                                )}
                                {(isPersonalGroup || Number(user?.id) !== Number(activeRoom.ownerId)) && (
                                    <button type="button" onClick={handleLeaveChat} className="w-full text-left px-4 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 transition flex items-center gap-2">
                                        <LogOut className="w-3.5 h-3.5" /><span>Покинуть чат</span>
                                    </button>
                                )}
                                {Number(user?.id) !== Number(activeRoom.ownerId) && Number(activeRoom.ownerId) > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setHeaderMenuOpen(false);
                                            openReport({
                                                category: 'CHAT',
                                                accusedId: Number(activeRoom.ownerId),
                                                targetId: Number(activeRoom.id),
                                                roomId: Number(activeRoom.id),
                                                targetTitle: displayTitle || activeRoom.title || 'Чат',
                                                snapshotText: isPersonalGroup ? 'Групповой чат' : 'Чат встречи',
                                            });
                                        }}
                                        className="w-full text-left px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition flex items-center gap-2"
                                    >
                                        <AlertCircle className="w-3.5 h-3.5 text-slate-400" /><span>Жалоба</span>
                                    </button>
                                )}
                            </div>
                        </>
                    )}
                    {modalEventData && (() => {
                        const isPast = modalEventData.eventDate ? new Date(modalEventData.eventDate).getTime() < Date.now() : false;
                        const enrichedEvent = { ...modalEventData, status: isPast ? 'past' : (modalEventData.status || 'upcoming') };
                        return (
                            <EventDetailsModal event={enrichedEvent} onClose={closeEventDetails} onRetryDetails={() => { void loadEventDetails(); }} onJoin={() => {}} onApply={() => {}} onCancelEvent={closeEventDetails} onEditEvent={(ev) => { closeEventDetails(); setEditingEvent(ev); }} onLeave={async (id) => {
                                try {
                                    await api.post(`/api/v1/social/events/${id}/participants/leave`);
                                    closeEventDetails();
                                    if (setEventRooms) { setEventRooms((prev: any[]) => (prev || []).filter(r => r && r.id !== activeRoom.id)); }
                                    onCloseChat();
                                } catch (e) { console.error(e); }
                            }} />
                        );
                    })()}
                </div>
            </div>

            {showParticipantsId === (isPersonalGroup ? activeRoom.id : activeRoom.eventId) && (
                <>
                    {/* Фиксированный невидимый слой на весь экран для перехвата клика «мимо» */}
                    <div
                        className="fixed inset-0 z-40 cursor-default"
                        onClick={closeParticipantsPanel}
                    />

                    {/* Само окно участников — остается без изменений, но теперь под защитой оверлея */}
                    <div
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="absolute top-16 left-6 right-6 bg-white border border-slate-200 shadow-2xl rounded-2xl p-5 z-50 animate-in slide-in-from-top-4 duration-200 max-h-[70vh] flex flex-col pointer-events-auto"
                    >
                        <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0 select-none">
                            <div>
                                <h4 className="text-sm font-semibold text-slate-900/60 tracking-tight flex items-center gap-2 ">
                                    <Users className="w-4 h-4 text-[#5C4B7A]/60 stroke-[2]" />
                                    Участников чата ({participantsLoading ? '…' : participantsList.length})
                                </h4>
                            </div>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    closeParticipantsPanel();
                                }}
                                className="p-2 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition ml-1 cursor-pointer"
                                title="Закрыть список"
                            >
                                <X className="w-4 h-4 stroke-[2.5]" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto space-y-2.5 pt-4" style={{ scrollbarWidth: 'none' }}>
                            {participantsLoading ? (
                                <SegmentedRingLoader />
                            ) : participantsLoadFailed && participantsList.length === 0 ? (
                                <ParticipantsLoadRetry onRetry={() => { void loadParticipantsPanel(); }} />
                            ) : participantsList.length === 0 ? (
                                <p className="text-xs text-slate-400 italic text-center py-5">Пока никого нет</p>
                            ) : participantsList.map((p, idx) => {
                                const isItMe = user?.id && Number(p.userId) === Number(user.id);
                                const isOrganizerOfEvent = !!p.owner;

                                return (
                                    <div key={`${p.userId}-${idx}`} className="relative flex items-center gap-2.5 p-3.5 pr-8 bg-white border border-slate-100 rounded-xl shadow-sm min-w-0">
                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                            <button
                                                type="button"
                                                onClick={() => openNeighborProfile(p.userId, `${p.firstName} ${p.lastName || ''}`.trim())}
                                                className={`w-9 h-9 rounded-xl overflow-hidden border shrink-0 bg-[#B0B0B0] transition focus:outline-none cursor-pointer active:scale-95 ${isOrganizerOfEvent ? 'border-amber-500 ring-2 ring-amber-400/50' : 'border-slate-200 hover:border-slate-300'}`}
                                            >
                                                <img src={getAvatarUrl(p.userId, p.avatarUrl)} alt="" className="w-full h-full object-cover" />
                                            </button>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                                    <button
                                                        type="button"
                                                        onClick={() => openNeighborProfile(p.userId, `${p.firstName} ${p.lastName || ''}`.trim())}
                                                        className="text-xs font-bold text-slate-800 tracking-tight text-left focus:outline-none hover:text-[#5C4B7A] cursor-pointer transition truncate max-w-[140px]"
                                                        title="Открыть профиль соседа"
                                                    >
                                                        {p.firstName} {p.lastName || ''}
                                                    </button>
                                                    {isOrganizerOfEvent && <span className="bg-amber-50 text-amber-800 border border-amber-200 text-[9px] font-extrabold px-1.5 py-0.5 rounded-md shrink-0">{isPersonalGroup ? 'Владелец' : 'Организатор'}</span>}
                                                    {p.admin && !p.owner && !isOrganizerOfEvent ? <span className="bg-[#EDE6F5] text-[#5C4B7A] border border-[#5C4B7A]/20 text-[9px] font-extrabold px-1.5 py-0.5 rounded-md shrink-0">Админ</span> : null}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center shrink-0 select-none max-w-[46%]">
                                            {isItMe ? (
                                                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-md italic">Это вы</span>
                                            ) : isPersonalGroup ? (
                                                <div className="flex items-center gap-1">
                                                    {Number(user?.id) === Number(activeRoom.ownerId) && !p.owner && (
                                                        <button
                                                            type="button"
                                                            onClick={async () => {
                                                                try {
                                                                    if (p.admin) await api.delete(`/api/v1/social/chats/rooms/${activeRoom.id}/admins/${p.userId}?firstName=${encodeURIComponent(user?.firstName || '')}&lastName=${encodeURIComponent(user?.lastName || '')}`);
                                                                    else await api.post(`/api/v1/social/chats/rooms/${activeRoom.id}/admins/${p.userId}?firstName=${encodeURIComponent(user?.firstName || '')}&lastName=${encodeURIComponent(user?.lastName || '')}`);
                                                                    setParticipantsList((prev) => prev.map((item) => Number(item.userId) === Number(p.userId) ? { ...item, admin: !p.admin } : item));
                                                                } catch (err) {
                                                                    console.error(err);
                                                                    showAppInfoToast('Ошибка', 'Не удалось изменить права');
                                                                }
                                                            }}
                                                            className="w-9 h-9 rounded-xl border border-slate-200 bg-white text-[#5C4B7A] hover:bg-[#EDE6F5] flex items-center justify-center"
                                                            title={p.admin ? 'Снять админа' : 'Назначить админом'}
                                                        >
                                                            <Shield className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                    {(Number(user?.id) === Number(activeRoom.ownerId) || (!!activeRoom.admin && !p.admin && !p.owner)) && (
                                                    <button
                                                        type="button"
                                                        onClick={async () => {
                                                            const confirmed = await showAppConfirm({
                                                                title: 'Исключить из чата',
                                                                message: `${p.firstName} будет исключён(а) из чата.`,
                                                                confirmText: 'Исключить',
                                                                cancelText: 'Отмена',
                                                                danger: true,
                                                            });
                                                            if (!confirmed) return;
                                                            try {
                                                                await api.delete(`/api/v1/social/chats/rooms/${activeRoom.id}/members/${p.userId}?firstName=${encodeURIComponent(user?.firstName || '')}&lastName=${encodeURIComponent(user?.lastName || '')}`);
                                                                setParticipantsList((prev) => prev.filter((item) => Number(item.userId) !== Number(p.userId)));
                                                            } catch (err) {
                                                                console.error(err);
                                                                showAppInfoToast('Ошибка', 'Не удалось исключить участника');
                                                            }
                                                        }}
                                                        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md text-[#B85C5C] hover:bg-[#F3D4D0] flex items-center justify-center transition"
                                                        title="Исключить из чата"
                                                    >
                                                        <X className="w-3.5 h-3.5 stroke-[2.5]" />
                                                    </button>
                                                    )}
                                                </div>
                                            ) : (() => {
                                                const windowState = reputationWindow(chatEventDateStr, chatRepOpensAt, chatRepClosesAt);
                                                const canVoteReputation = chatCanVoteReputation || windowState.open;
                                                if (!windowState.started) {
                                                    const isChatOwner = Number(user?.id) === Number(activeRoom.ownerId);
                                                    const canKickEvent = isChatOwner || (!!activeRoom.admin && !p.owner && !p.admin);

                                                    return (
                                                        <div className="flex items-center gap-1">
                                                            {isChatOwner && !p.owner && (
                                                                <button
                                                                    type="button"
                                                                    onClick={async () => {
                                                                        try {
                                                                            if (p.admin) await api.delete(`/api/v1/social/chats/rooms/${activeRoom.id}/admins/${p.userId}?firstName=${encodeURIComponent(user?.firstName || '')}&lastName=${encodeURIComponent(user?.lastName || '')}`);
                                                                            else await api.post(`/api/v1/social/chats/rooms/${activeRoom.id}/admins/${p.userId}?firstName=${encodeURIComponent(user?.firstName || '')}&lastName=${encodeURIComponent(user?.lastName || '')}`);
                                                                            setParticipantsList((prev) => prev.map((item) => Number(item.userId) === Number(p.userId) ? { ...item, admin: !p.admin } : item));
                                                                        } catch (err) {
                                                                            showAppInfoToast('Ошибка', 'Не удалось изменить права');
                                                                        }
                                                                    }}
                                                                    className="w-9 h-9 rounded-xl border border-slate-200 bg-white text-[#5C4B7A] hover:bg-[#EDE6F5] flex items-center justify-center"
                                                                    title={p.admin ? 'Снять админа' : 'Назначить админом'}
                                                                >
                                                                    <Shield className="w-3.5 h-3.5" />
                                                                </button>
                                                            )}
                                                    {canKickEvent ? (
                                                        <button
                                                            type="button"
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                const confirmed = await showAppConfirm({
                                                                    title: 'Исключить участника',
                                                                    message: `Вы уверены, что хотите исключить ${p.firstName} из встречи и чата?`,
                                                                    confirmText: 'Исключить',
                                                                    cancelText: 'Отмена',
                                                                    danger: true
                                                                });
                                                                if (!confirmed) return;
                                                                try {
                                                                    await api.delete(`/api/v1/social/chats/rooms/${activeRoom.id}/members/${p.userId}?firstName=${encodeURIComponent(user?.firstName || '')}&lastName=${encodeURIComponent(user?.lastName || '')}`);
                                                                    setParticipantsList((prev) => prev.filter((item) => Number(item.userId) !== Number(p.userId)));
                                                                } catch (err) {
                                                                    console.error("Ошибка при исключении из чата:", err);
                                                                    showAppInfoToast('Ошибка', 'Не удалось исключить участника');
                                                                }
                                                            }}
                                                            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md text-[#B85C5C] hover:bg-[#F3D4D0] flex items-center justify-center transition"
                                                            title="Исключить из чата и события"
                                                        >
                                                            <X className="w-3.5 h-3.5 stroke-[2.5]" />
                                                        </button>
                                                    ) : (
                                                        <span className="text-[10px] leading-tight text-slate-400 text-right">Оценка после события</span>
                                                    )}
                                                        </div>
                                                    );
                                                }

                                                if (!canVoteReputation) {
                                                    return (
                                                        <span className="text-[11px] text-slate-400">
                                                            {reputationPendingLabel(chatRepOpensAt, windowState)}
                                                        </span>
                                                    );
                                                }

                                                const pastVote = myChatVotes.find(v => v && Number(v.targetId) === Number(p.userId));

                                                return (
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            disabled={chatVotingLoading !== null}
                                                            onClick={() => {
                                                                if (activeRoom.eventId == null) return;
                                                                handleChatVote(activeRoom.eventId, Number(p.userId), 'PLUS');
                                                            }}
                                                            className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-all active:scale-90 cursor-pointer ${pastVote?.voteType === 'PLUS' ? 'bg-[#5C4B7A] border-[#5C4B7A] text-white shadow-sm' : pastVote?.voteType === 'MINUS' ? 'opacity-40 bg-white border-slate-100 text-slate-300' : 'bg-white text-[#5C4B7A] border-slate-200 hover:bg-[#EDE6F5]'}`}
                                                            title={pastVote?.voteType === 'PLUS' ? "Убрать лайк" : "Поставить лайк"}
                                                        >
                                                            <ThumbsUp className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={chatVotingLoading !== null}
                                                            onClick={() => {
                                                                if (activeRoom.eventId == null) return;
                                                                handleChatVote(activeRoom.eventId, Number(p.userId), 'MINUS');
                                                            }}
                                                            className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-all active:scale-90 cursor-pointer ${pastVote?.voteType === 'MINUS' ? 'bg-rose-500 border-rose-500 text-white shadow-sm' : pastVote?.voteType === 'PLUS' ? 'opacity-40 bg-white border-slate-100 text-slate-300' : 'bg-white text-rose-500 border-slate-200 hover:bg-rose-50'}`}
                                                            title={pastVote?.voteType === 'MINUS' ? "Убрать дизлайк" : "Поставить дизлайк"}
                                                        >
                                                            <ThumbsDown className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {!isPersonalGroup && Number(user?.id) === Number(activeRoom.ownerId) && bannedParticipantsList.length > 0 && (
                            <div className="mt-4 pt-3 border-t border-slate-100 shrink-0">
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowBannedList((v) => !v);
                                    }}
                                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border border-rose-100 bg-rose-50/40 hover:bg-rose-50 text-left transition"
                                >
                                    <span className="text-[11px] font-bold text-rose-600 uppercase tracking-wide">
                                        Исключённые ({bannedParticipantsList.length})
                                    </span>
                                    <ChevronDown className={`w-4 h-4 text-rose-400 transition-transform ${showBannedList ? 'rotate-180' : ''}`} />
                                </button>
                                {showBannedList && (
                                    <div className="mt-2 space-y-2 max-h-[160px] overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
                                        {bannedParticipantsList.map((p) => (
                                            <div key={`banned-${p.userId}`} className="flex items-center justify-between p-3 bg-rose-50/50 border border-rose-100 rounded-xl">
                                                <div className="text-xs font-semibold text-slate-700 truncate">
                                                    {p.firstName} {p.lastName || ''}
                                                </div>
                                                <button
                                                    type="button"
                                                    disabled={restoreLoadingId === Number(p.userId)}
                                                    onClick={async (e) => {
                                                        e.stopPropagation();
                                                        const confirmed = await showAppConfirm({
                                                            title: 'Вернуть участника',
                                                            message: `Вернуть ${p.firstName} во встречу и групповой чат?`,
                                                            confirmText: 'Вернуть',
                                                            cancelText: 'Отмена'
                                                        });
                                                        if (!confirmed) return;
                                                        setRestoreLoadingId(Number(p.userId));
                                                        try {
                                                            await api.post(`/api/v1/social/events/${activeRoom.eventId}/participants/restore/${p.userId}`);
                                                            setBannedParticipantsList(prev => {
                                                                const next = prev.filter(b => Number(b.userId) !== Number(p.userId));
                                                                if (next.length === 0) setShowBannedList(false);
                                                                return next;
                                                            });
                                                            setParticipantsList(prev => [...prev, p]);
                                                        } catch (err) {
                                                            console.error(err);
                                                            showAppInfoToast('Ошибка', 'Не удалось вернуть участника');
                                                        } finally {
                                                            setRestoreLoadingId(null);
                                                        }
                                                    }}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-white border border-[#5C4B7A]/20 text-[#5C4B7A] hover:bg-[#EDE6F5] disabled:opacity-50"
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
                </>
            )}

            <ChatVoiceMiniBar className="md:hidden px-3 pt-2 pb-1 shrink-0" />
            {searchOpen && (
                <ChatSearchBar
                    messages={actions.messages}
                    onJump={actions.jumpToMessage}
                    onClose={() => setSearchOpen(false)}
                />
            )}
            <ChatPinnedBar
                pins={pins}
                canManage={isRoomAdmin}
                onJump={(id) => actions.jumpToMessage(id)}
                onUnpin={async (messageId) => {
                    const res = await api.delete(`/api/v1/social/chats/rooms/${activeRoom.id}/pins/${messageId}`);
                    setPins(res.data || []);
                }}
            />

            <div className="relative flex-1 min-h-0">
            <div
                ref={actions.messagesContainerRef}
                onScroll={() => {
                    actions.handleChatScroll();
                    const el = actions.messagesContainerRef.current;
                    if (el && el.scrollTop < 80) void loadOlderGroupHistory();
                }}
                className="myraion-chat-messages absolute inset-0 overflow-y-auto p-4 md:p-6 space-y-3"
            >
                {historyLoadingMore ? <div className="text-center text-[11px] text-slate-400 py-1">Загрузка сообщений…</div> : null}
                {!historyLoadingMore && historyHasMore && actions.messages.length > 0 ? (
                    <button
                        type="button"
                        onClick={() => void loadOlderGroupHistory()}
                        className="w-full text-center text-[11px] text-[#5C4B7A] hover:underline py-1"
                    >
                        Загрузить предыдущие
                    </button>
                ) : null}
                {actions.messages.map((m) => {
                    if (isUnreadMarker(m.id)) {
                        return <ChatUnreadDivider key={m.id} text={m.text} />;
                    }
                    if (m.isSystem) {
                        if (m.poll) {
                            return (
                                <div key={`sys-poll-${m.id}`} className="flex flex-col items-center my-4 w-full animate-fadeIn">
                                    <div className="w-full max-w-sm pointer-events-auto">
                                        <ChatPollCard
                                            poll={m.poll}
                                            mine={false}
                                            onUpdated={(next) => actions.setMessages((prev) => prev.map((msg) => msg.id === m.id ? { ...msg, poll: next } : msg))}
                                        />
                                    </div>
                                    {m.time ? <span className="text-[10px] text-slate-400 mt-1.5 tabular-nums">{m.time}</span> : null}
                                </div>
                            );
                        }
                        return (
                            <div key={`sys-${m.id}`} className={`flex flex-col items-center my-4 w-full animate-fadeIn ${m.systemLinkUserId || (m.photos && m.photos.length) ? 'select-none' : 'select-none pointer-events-none'}`}>
                                {m.systemLinkUserId && m.systemLinkName && m.systemLinkSuffix ? (
                                    <SystemLinkedNameLabel
                                        userId={m.systemLinkUserId}
                                        name={m.systemLinkName}
                                        suffix={m.systemLinkSuffix}
                                        time={m.time}
                                    />
                                ) : (
                                    <>
                                        <span className="bg-slate-200/60 backdrop-blur-sm text-slate-500 text-[11px] font-medium px-4 py-1.5 rounded-full border border-slate-300/10 shadow-sm max-w-xs text-center min-w-0 [overflow-wrap:anywhere] break-all">{m.text}</span>
                                        {m.time ? <span className="text-[10px] text-slate-400 mt-1.5 tabular-nums">{m.time}</span> : null}
                                    </>
                                )}
                                {m.photos && m.photos.length > 0 ? (
                                    <div className="mt-2 pointer-events-auto">
                                        <ChatPhotoGrid
                                            photos={m.photos}
                                            addedAt={m.timestamp}
                                            messageReport={
                                                Number(m.senderId) > 0 && Number(m.senderId) !== Number(user?.id) && Number(m.id) > 0
                                                    ? {
                                                        accusedId: Number(m.senderId),
                                                        accusedName: `${m.senderFirstName || ''} ${m.senderLastName || ''}`.trim() || undefined,
                                                        targetId: Number(m.id),
                                                        roomId: Number(activeRoom.id),
                                                    }
                                                    : undefined
                                            }
                                        />
                                    </div>
                                ) : null}
                            </div>
                        );
                    }
                    const isMe = m.from === 'me';
                    const isSelected = actions.selectedParentIds.includes(m.id);
                    const isMsgDeleted = m.isDeleted === true;
                    const participantAvatar = participantsList.find((p) => Number(p.userId) === Number(m.senderId))?.avatarUrl;
                    const senderAvatarSrc = getAvatarUrl(m.senderId, m.senderAvatarUrl || participantAvatar);

                    // Чистим ID от любых пробелов
                    const cleanStringId = m.id.toString().replace(/\s+/g, '');

                    return (
                        <div
                            key={m.id}
                            id={`msg-container-${cleanStringId}`}
                            data-msg-id={cleanStringId}
                            data-deleted={isMsgDeleted ? 'true' : undefined}
                            onClick={(e) => {
                                if (actions.isSelectionMode) {
                                    e.stopPropagation();
                                    if (isMsgDeleted) return;
                                    if (actions.isDeleteSelectionType && !isMe) return;
                                    actions.toggleSelectParentId(m.id);
                                }
                            }}
                            className={`flex items-end gap-3 group/msg min-w-0 ${isMe ? 'justify-end' : 'justify-start'} ${actions.isSelectionMode ? (actions.isDeleteSelectionType && !isMe ? 'cursor-default' : 'cursor-pointer hover:bg-slate-100/40 rounded-xl px-2 transition-colors') : ''} transition-all duration-500 ${actions.isSelectionMode ? 'pointer-events-auto' : 'pointer-events-none lg:pointer-events-auto'}`}
                        >

                        {actions.isSelectionMode && !isMe && !actions.isDeleteSelectionType && !isMsgDeleted && (
                                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all shrink-0 mb-3 order-1 ${isSelected ? 'border-[#5C4B7A] bg-[#5C4B7A] text-white' : 'border-slate-300 bg-white'}`}>{isSelected && <Check className="w-3 h-3" />}</div>
                            )}
                            {!isMe && !isMsgDeleted && (
                                <button
                                    type="button"
                                    onClick={() => openNeighborProfile(m.senderId)}
                                    className="w-8 h-8 rounded-full overflow-hidden border border-slate-200 shrink-0 mb-1 order-2 pointer-events-auto"
                                    title="Открыть профиль"
                                >
                                    <img src={senderAvatarSrc} alt="" className="w-full h-full object-cover" />
                                </button>
                            )}
                            <div className={`max-w-[min(28rem,100%)] min-w-0 overflow-x-clip relative rounded-2xl flex items-end gap-1 pointer-events-auto group/edit ${isMe ? 'order-1' : 'order-3'} ${isSelected && isMe && !isMsgDeleted ? 'bg-[#EDE6F5]/20 rounded-xl px-1' : ''} ${isMsgDeleted ? 'pointer-events-none' : ''}`}>
                                <div
                                    onContextMenu={(e) => {
                                        if (isMsgDeleted) { e.preventDefault(); return; }
                                        actions.handleContextMenu(e, m.id);
                                    }}
                                    onTouchStart={(e) => { if (!isMsgDeleted) actions.startMessageLongPress(e, m.id); }}
                                    onTouchMove={actions.moveMessageLongPress}
                                    onTouchEnd={actions.endMessageLongPress}
                                    onTouchCancel={actions.endMessageLongPress}
                                    className={`message-bubble text-left px-4 py-2.5 rounded-2xl border select-none transition-all duration-300 pointer-events-auto min-w-0 ${
                                        isMsgDeleted
                                            ? 'bg-slate-100 text-slate-400 border-slate-200 rounded-2xl italic select-none shadow-none'
                                            : (actions.highlightId && m.id && m.id.toString().trim().toLowerCase() === actions.highlightId.toString().trim().toLowerCase())
                                                ? 'brightness-90 scale-[0.99] border-slate-300/50 shadow-inner'
                                                : (isMe ? 'bg-[#5C4B7A] text-white border-[#5C4B7A]/30 rounded-br-md shadow-sm' : 'bg-white text-slate-900 border-slate-200 rounded-bl-md shadow-sm')
                                    }`}>
                                    {!isMsgDeleted && (
                                        <>
                                            {!isMe && (m.senderFirstName || m.senderLastName) && (
                                                <div onClick={() => openNeighborProfile(m.senderId)} className="text-[11px] font-bold text-[#5C4B7A] mb-1 tracking-wide cursor-default select-none">
                                                    {m.senderFirstName || ''} {m.senderLastName || ''}
                                                </div>
                                            )}
                                            {!(m.bundledForwards && m.bundledForwards.length > 0) && m.reply_to && m.reply_to.length > 0 && (
                                                <div className="mb-1.5 space-y-1 block w-full relative z-30 pointer-events-auto">
                                                    {m.reply_to.map((r) => (
                                                        <button
                                                            key={r.id}
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                e.stopPropagation(); // Изолируем клик от родительской строки выбора

                                                                if (r.id) {
                                                                    const targetId = r.id.toString().replace(/\s+/g, '');
                                                                    console.log("=== [SUCCESS_CLICK] Клик долетел! Ищем в DOM ID:", targetId);

                                                                    // Находим оригинальное сообщение на экране
                                                                    const node = document.getElementById(`msg-container-${targetId}`) || document.querySelector(`[data-msg-id="${targetId}"]`);
                                                                    if (node) {
                                                                        node.scrollIntoView({ behavior: 'smooth', block: 'center' });

                                                                        // Мягкая вспышка подсветки
                                                                        const bubbleEl = node.querySelector('.message-bubble');
                                                                        if (bubbleEl) {
                                                                            // Аккуратно приглушаем яркость баббла на 1 секунду при прыжке, создавая эффект нажатия
                                                                            bubbleEl.classList.add('brightness-90', 'scale-[0.99]');
                                                                            setTimeout(() => {
                                                                                bubbleEl.classList.remove('brightness-90', 'scale-[0.99]');
                                                                            }, 1000);
                                                                        }
                                                                    } else {
                                                                        console.warn("=== [SCROLL_WARN] Элемент не найден в текущем DOM-дереве:", targetId);
                                                                    }
                                                                }
                                                            }}
                                                            className="px-2 py-1 rounded-lg border-l-2 text-xs transition duration-200 block w-full text-left focus:outline-none hover:opacity-85 select-none"
                                                            style={{
                                                                cursor: 'pointer',
                                                                display: 'block',
                                                                width: '100%',
                                                                backgroundColor: isMe ? 'rgba(255,255,255,0.15)' : 'rgba(241,245,249,1)',
                                                                borderColor: isMe ? 'rgba(255,255,255,0.6)' : 'rgba(34,211,238,1)',
                                                                color: isMe ? 'rgba(236,254,255,1)' : 'rgba(71,85,105,1)'
                                                            }}
                                                        >
                                                            <div className="font-semibold text-[11px] opacity-80 pointer-events-none">{r.author}</div>
                                                            {r.text && !isForwardQuoteCaption(r.text) ? (
                                                                <div className="truncate pointer-events-none">{formatSidebarMessage(r.text)}</div>
                                                            ) : null}
                                                        </button>
                                                    ))}

                                                </div>
                                            )}
                                        </>
                                    )}
                                    {m.forwardedFrom && (
                                        <div className={`flex items-center gap-1.5 text-[10px] font-medium mb-1.5 pb-1 border-b border-white/10 select-none ${isMe ? 'text-[#EDE6F5] border-[#5C4B7A]/30' : 'text-slate-400 border-slate-100'}`}>
                                            <svg xmlns="http://w3.org" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="transform -scale-x-100"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>
                                            <span>Переслано от:{' '}<span className="font-bold">{m.forwardedFrom.senderFirstName || m.forwardedFrom.senderLastName ? `${m.forwardedFrom.senderFirstName || ''} ${m.forwardedFrom.senderLastName || ''}`.trim() : `Пользователь #${m.forwardedFrom.id}`}</span></span>
                                        </div>
                                    )}

                                    {(() => {
                                        if (isMsgDeleted) {
                                            return <div className="text-sm leading-relaxed whitespace-pre-wrap mb-1.5 italic text-slate-400 min-w-0 [overflow-wrap:anywhere] break-all">Сообщение удалено</div>;
                                        }

                                        if (m.poll) {
                                            return (
                                                <ChatPollCard
                                                    poll={m.poll}
                                                    mine={isMe}
                                                    onUpdated={(next) => actions.setMessages((prev) => prev.map((msg) => msg.id === m.id ? { ...msg, poll: next } : msg))}
                                                />
                                            );
                                        }

                                        if (m.text && m.text.includes('[SHARE_POST:')) {
                                            return (
                                                <SharedPostCard
                                                    text={m.text}
                                                    coverUrl={Array.isArray(m.photos) ? m.photos[0] : undefined}
                                                    mine={isMe}
                                                />
                                            );
                                        }

                                        if (m.text && m.text.includes('[SHARE_EVENT:')) {
                                            return <SharedEventCard text={m.text} mine={isMe} />;
                                        }

                                        const bundled = Array.isArray(m.bundledForwards) && m.bundledForwards.length > 0 ? m.bundledForwards : null;
                                        if (bundled) {
                                            const hasOwnText = Boolean(m.text && m.text.trim());
                                            return (
                                                <>
                                                    <ChatForwardedPack forwards={bundled} mine={isMe} />
                                                    {hasOwnText ? <ChatMessageText text={m.text} className="text-sm leading-relaxed whitespace-pre-wrap mb-1.5" mine={isMe} /> : null}
                                                </>
                                            );
                                        }
                                        const media = resolveMessageMedia(m);
                                        const hasPhotos = Array.isArray(media.photos) && media.photos.length > 0;
                                        const hasFiles = Array.isArray(media.files) && media.files.length > 0;
                                        const hasVoice = Boolean(media.voiceUrl);
                                        const hasText = Boolean(m.text && m.text.trim());
                                        if (!hasPhotos && !hasFiles && !hasVoice && !hasText) return null;

                                        return (
                                            <>
                                                <ChatVoiceBubble
                                                    url={media.voiceUrl}
                                                    duration={media.voiceDuration}
                                                    mine={isMe}
                                                    trackId={String(m.id)}
                                                    queue={voiceQueue}
                                                    title={isMe ? 'Вы' : `${m.senderFirstName || ''} ${m.senderLastName || ''}`.trim()}
                                                />
                                                <ChatPhotoGrid
                                                    photos={media.photos}
                                                    addedAt={m.timestamp}
                                                    messageReport={
                                                        m.from !== 'me' && Number(m.id) > 0 && Number(m.senderId) > 0
                                                            ? {
                                                                accusedId: Number(m.senderId),
                                                                accusedName: `${m.senderFirstName || ''} ${m.senderLastName || ''}`.trim() || undefined,
                                                                targetId: Number(m.id),
                                                                roomId: Number(activeRoom.id),
                                                            }
                                                            : undefined
                                                    }
                                                />
                                                <ChatFileBubble files={media.files} mine={isMe} />
                                                {hasText ? <ChatMessageText text={m.text} className="text-sm leading-relaxed whitespace-pre-wrap mb-1.5" mine={isMe} /> : null}
                                            </>
                                        );
                                    })()}

                                    <div className={`text-[10px] mt-1 flex items-center gap-1 justify-end ${isMe ? 'text-[#EDE6F5]' : 'text-slate-400'}`}>
                                        {m.edited && !isMsgDeleted && <span className="italic text-[9px] opacity-70">изменено</span>}
                                        <span>{m.time}</span>
                                    </div>
                                </div>
                            {isMe && !actions.isSelectionMode && !isMsgDeleted && !m.poll && (
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); actions.setEditingId(m.id); actions.setDraft(m.text); actions.setReplyTo([]); actions.setSelectedParentIds([]); }}
                                    className="hidden lg:flex opacity-0 group-hover/edit:opacity-100 p-1.5 mb-0.5 bg-white text-slate-400 hover:text-amber-500 rounded-lg shadow-sm border border-slate-100 transition shrink-0"
                                    title="Редактировать"
                                >
                                    <Pencil className="w-3.5 h-3.5" />
                                </button>
                            )}
                            </div>
                            {actions.isSelectionMode && isMe && !isMsgDeleted && (
                                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all shrink-0 mb-3 order-2 cursor-pointer ${isSelected ? 'border-[#5C4B7A] bg-[#5C4B7A] text-white' : 'border-slate-300 bg-white hover:border-[#5C4B7A]'}`}>{isSelected && <Check className="w-3 h-3" />}</div>
                            )}
                        </div>
                    );
                })}
            </div>
            <ChatScrollDownButton show={actions.showScrollDown} onClick={actions.scrollToBottom} />
            </div>
            {(actions.selectedParentIds.length > 0 || actions.replyTo.length > 0) && !actions.editingId && (
                <div className={`px-4 py-2 border-t ${theme.surface.border} bg-white flex items-center gap-2 shrink-0 animate-slideUp w-full`}>
                    {!actions.isSelectionMode && <CornerUpLeft className={`w-4 h-4 ${theme.accent.text} shrink-0`} />}
                    <div className="flex-1 min-w-0 border-l-2 border-[#5C4B7A] pl-2">
                        <div className={`text-[11px] font-semibold ${theme.accent.textStrong} truncate`}>
                            {actions.isSelectionMode ? (actions.isDeleteSelectionType ? `Выбрано ${actions.selectedParentIds.length} для удаления` : `Выбрано ${actions.selectedParentIds.length}`) : (actions.selectedParentIds.length > 1 ? `Ответ на ${actions.selectedParentIds.length} сообщения` : `Ответ на сообщение · ${actions.replyTo[0]?.author || 'Участник'}`)}
                        </div>
                        <div className="text-xs text-slate-500 truncate flex items-center gap-1.5">
                            <span className="truncate flex-1">{actions.isSelectionMode ? formatSidebarMessage(actions.messages.find(x => x.id === actions.selectedParentIds[actions.selectedParentIds.length - 1])?.text || '') : (actions.replyTo && actions.replyTo[0] ? formatSidebarMessage(actions.replyTo[0].text) : '')}</span>
                            {!actions.isSelectionMode && actions.selectedParentIds.length > 1 && (<span className="shrink-0 bg-[#EDE6F5] text-[#5C4B7A] text-[10px] font-bold px-1.5 py-0.5 rounded-md border border-[#5C4B7A]/15">+{actions.selectedParentIds.length - 1}</span>)}
                        </div>
                    </div>
                    {actions.isSelectionMode && actions.isDeleteSelectionType && (
                        <button type="button" onClick={actions.handleDeleteSelectedMessages} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition shrink-0 whitespace-nowrap"><Trash2 className="w-3.5 h-3.5" /><span>Удалить</span></button>
                    )}
                    {actions.isSelectionMode && !actions.isDeleteSelectionType && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setIsForwardModalOpen(true); }} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#5C4B7A] hover:bg-[#EDE6F5] rounded-lg transition shrink-0 whitespace-nowrap"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 9 15 15"></polyline><path d="M3 21v-7a4 4 0 0 1 4-4h14"></path></svg><span>Переслать</span></button>
                    )}
                    <button onClick={actions.resetSelectionMode} className="p-1 rounded-md text-slate-400 hover:bg-slate-100 transition shrink-0"><X className="w-3.5 h-3.5" /></button>
                </div>
            )}

            {actions.editingId && (() => {
                const msg = actions.messages.find(el => el.id === actions.editingId);
                return (
                    <div className={`px-4 py-2 border-t ${theme.surface.border} bg-white flex items-center gap-3 shrink-0`}><div className="flex-1 min-w-0 border-l-2 border-[#5C4B7A] pl-2"><div className={`text-[11px] font-semibold ${theme.accent.textStrong}`}>Редактирование</div><div className="text-xs text-slate-500 truncate">{msg?.text}</div></div><button onClick={() => { actions.setEditingId(null); actions.setDraft(''); }} className="p-1 rounded-md text-slate-400 hover:bg-slate-100 transition"><X className="w-3.5 h-3.5" /></button></div>
                );
            })()}

            {actions.forwardBuffer.length > 0 && (
                <div className={`px-4 py-2 border-t ${theme.surface.border} bg-white flex items-center gap-3 shrink-0 animate-slideUp w-full`}>
                    <svg xmlns="http://w3.org" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#5C4B7A] transform -scale-x-100 shrink-0"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>
                    <div className="flex-1 min-w-0 border-l-2 border-[#5C4B7A] pl-2">
                        <div className={`text-[11px] font-semibold ${theme.accent.textStrong}`}>Пересылка сообщений ({actions.forwardBuffer.length})</div>
                        <div className="text-xs text-slate-500 truncate">{actions.forwardBuffer.map(m => formatSidebarMessage(m.text, mediaHintFromMessage(m))).join(', ')}</div>
                    </div>
                    <button onClick={actions.resetForwardBuffer} className="p-1 rounded-md text-slate-400 hover:bg-slate-100 transition shrink-0"><X className="w-3.5 h-3.5" /></button>
                </div>
            )}

            <div className={`myraion-chat-composer px-2.5 py-2 md:px-4 md:py-2.5 border-t ${theme.surface.border} ${theme.surface.card} shrink-0`}>
                <ChatPendingStrip media={chatMedia} />
                {voice.mode !== 'idle' ? (
                    <ChatVoiceRecordingBar
                        mode={voice.mode}
                        elapsedMs={voice.elapsedMs}
                        peaks={voice.peaks}
                        previewDuration={voice.previewDuration}
                        previewPlaying={voice.previewPlaying}
                        previewProgress={voice.previewProgress}
                        trimStart={voice.trimStart}
                        trimEnd={voice.trimEnd}
                        busy={voice.busy}
                        onCancel={voice.cancel}
                        onStop={voice.stopToPreview}
                        onSend={voice.send}
                        onTogglePreview={voice.togglePreview}
                        onSeekPreview={voice.seekPreview}
                        onTrim={voice.changeTrim}
                    />
                ) : (
                    <div className="flex items-end gap-0.5 md:gap-1">
                        <ChatPaperclipButton media={chatMedia} disabled={actions.editingId !== null} />
                        <button
                            type="button"
                            className={COMPOSER_BTN_MUTED}
                            title="Голосование"
                            disabled={actions.editingId !== null}
                            onClick={() => setPollModalOpen(true)}
                        >
                            <BarChart2 className={COMPOSER_ICON} />
                        </button>
                        <div className="relative flex-1 min-w-0">
                        {(() => {
                            const q = mentionQuery(actions.draft, actions.inputRef.current?.selectionStart || actions.draft.length);
                            if (q == null) return null;
                            const matches = participantsList.filter((p) => {
                                const name = `${p.firstName || ''} ${p.lastName || ''}`.trim().toLowerCase();
                                return Number(p.userId) !== Number(user?.id) && name.includes(q.toLowerCase());
                            }).slice(0, 6);
                            if (!matches.length) return null;
                            return (
                            <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-40 overflow-y-auto z-30">
                                {matches.map((p) => (
                                        <button
                                            key={p.userId}
                                            type="button"
                                            className="w-full text-left px-3 py-2 text-xs hover:bg-[#EDE6F5]"
                                            onClick={() => {
                                                const caret = actions.inputRef.current?.selectionStart || actions.draft.length;
                                                const next = insertMention(actions.draft, caret, Number(p.userId), `${p.firstName || ''} ${p.lastName || ''}`.trim());
                                                actions.setDraft(next.text);
                                            }}
                                        >
                                            {p.firstName} {p.lastName || ''}
                                        </button>
                                    ))}
                            </div>
                            );
                        })()}
                        <ChatComposerInput
                            inputRef={actions.inputRef}
                            value={actions.draft}
                            onChange={(next) => {
                                actions.setDraft(next);
                                if (next.trim() && !actions.editingId) sendTyping();
                            }}
                            onSend={send}
                            onFocus={actions.handleComposerFocus}
                            onHeightChange={actions.revealLatest}
                            placeholder={actions.editingId ? 'Отредактируйте сообщение…' : 'Напишите сообщение…'}
                        />
                        </div>
                        <div className="relative">
                            <button
                                type="button"
                                className={`${COMPOSER_BTN_MUTED} ${emojiOpen ? 'bg-slate-100 text-[#5C4B7A]' : ''}`}
                                onClick={() => setEmojiOpen((v) => !v)}
                            >
                                <Smile className={COMPOSER_ICON} />
                            </button>
                            {emojiOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setEmojiOpen(false)} />
                                    <ChatEmojiPicker
                                        onPick={(emoji) => insertEmojiAtCursor(actions.inputRef.current, emoji, actions.draft, actions.setDraft)}
                                        onClose={() => setEmojiOpen(false)}
                                    />
                                </>
                            )}
                        </div>
                        {actions.draft.trim() || chatMedia.count > 0 || actions.forwardBuffer.length > 0 || actions.editingId ? (
                            <button
                                type="button"
                                onClick={send}
                                disabled={actions.editingId ? false : ((!actions.draft.trim() && chatMedia.count === 0 && actions.forwardBuffer.length === 0) || (chatMedia.count > 0 && !chatMedia.allReady))}
                                className={COMPOSER_BTN_SEND}
                            >
                                {actions.editingId ? <Check className={COMPOSER_ICON} /> : <Send className={COMPOSER_ICON} />}
                            </button>
                        ) : (
                            <ChatMicButton
                                disabled={actions.editingId !== null || voice.busy}
                                onClick={voice.start}
                            />
                        )}
                    </div>
                )}
            </div>

            {renameOpen && (
                <div className="fixed inset-0 z-[80] bg-slate-900/40 flex items-center justify-center p-4" onClick={() => setRenameOpen(false)}>
                    <div className="w-full max-w-sm bg-[#FFFCFA] rounded-[28px] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="myraion-display text-xl mb-3">Название чата</div>
                        <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={80} className="w-full h-11 px-4 rounded-full border border-[#1C1824]/10 text-sm mb-4" />
                        <button type="button" disabled={roomSaving} onClick={async () => {
                            if (!renameValue.trim()) {
                                showAppInfoToast('Название', 'Укажите название чата');
                                return;
                            }
                            setRoomSaving(true);
                            try {
                                const res = await api.patch(`/api/v1/social/chats/rooms/${activeRoom.id}`, { title: renameValue.trim() }, { params: roomPatchParams });
                                applyRoomPatch(res.data || { title: renameValue.trim() });
                                setRenameOpen(false);
                            } catch (e) {
                                console.error(e);
                                showAppInfoToast('Ошибка', 'Не удалось изменить название');
                            } finally {
                                setRoomSaving(false);
                            }
                        }} className="w-full h-11 rounded-full bg-[#5C4B7A] text-white text-sm disabled:opacity-50">{roomSaving ? 'Сохраняем…' : 'Сохранить'}</button>
                    </div>
                </div>
            )}
            {settingsOpen && (
                <div className="fixed inset-0 z-[80] bg-slate-900/40 flex items-center justify-center p-4" onClick={() => setSettingsOpen(false)}>
                    <div className="w-full max-w-sm bg-[#FFFCFA] rounded-[28px] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="myraion-display text-xl mb-4">Настройки чата</div>
                        <button
                            type="button"
                            onClick={() => avatarInputRef.current?.click()}
                            className="relative w-16 h-16 rounded-full bg-[#EDE6F5] overflow-hidden mb-4"
                            title="Сменить аватар"
                        >
                            {displayAvatarUrl ? (
                                <img src={getAvatarUrl(null, displayAvatarUrl)} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <span className="w-full h-full flex items-center justify-center text-[#5C4B7A]"><Camera className="w-6 h-6" /></span>
                            )}
                        </button>
                        <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={80} placeholder="Название чата" className="w-full h-11 px-4 rounded-full border border-[#1C1824]/10 text-sm mb-4" />
                        <p className="text-xs text-[#6B645C] mb-2">Добавлять участников</p>
                        <div className="flex gap-2 mb-4">
                            <button type="button" onClick={() => setDraftAddPolicy('OWNER_ONLY')} className={`flex-1 h-9 rounded-full text-xs ${draftAddPolicy !== 'EVERYONE' ? 'bg-[#5C4B7A] text-white' : 'bg-white border'}`}>Только я</button>
                            <button type="button" onClick={() => setDraftAddPolicy('EVERYONE')} className={`flex-1 h-9 rounded-full text-xs ${draftAddPolicy === 'EVERYONE' ? 'bg-[#5C4B7A] text-white' : 'bg-white border'}`}>Все</button>
                        </div>
                        <p className="text-xs text-[#6B645C] mb-2">Менять название</p>
                        <div className="flex gap-2 mb-4">
                            <button type="button" onClick={() => setDraftRenamePolicy('OWNER_ONLY')} className={`flex-1 h-9 rounded-full text-xs ${draftRenamePolicy !== 'EVERYONE' ? 'bg-[#5C4B7A] text-white' : 'bg-white border'}`}>Только я</button>
                            <button type="button" onClick={() => setDraftRenamePolicy('EVERYONE')} className={`flex-1 h-9 rounded-full text-xs ${draftRenamePolicy === 'EVERYONE' ? 'bg-[#5C4B7A] text-white' : 'bg-white border'}`}>Все</button>
                        </div>
                        <p className="text-xs text-[#6B645C] mb-2">Менять аватарку</p>
                        <div className="flex gap-2 mb-4">
                            <button type="button" onClick={() => setDraftAvatarPolicy('OWNER_ONLY')} className={`flex-1 h-9 rounded-full text-xs ${draftAvatarPolicy !== 'EVERYONE' ? 'bg-[#5C4B7A] text-white' : 'bg-white border'}`}>Только я</button>
                            <button type="button" onClick={() => setDraftAvatarPolicy('EVERYONE')} className={`flex-1 h-9 rounded-full text-xs ${draftAvatarPolicy === 'EVERYONE' ? 'bg-[#5C4B7A] text-white' : 'bg-white border'}`}>Все</button>
                        </div>
                        <button type="button" disabled={roomSaving} onClick={async () => {
                            if (!renameValue.trim()) {
                                showAppInfoToast('Название', 'Укажите название чата');
                                return;
                            }
                            setRoomSaving(true);
                            try {
                                const res = await api.patch(`/api/v1/social/chats/rooms/${activeRoom.id}`, {
                                    title: renameValue.trim(),
                                    addMembersPolicy: draftAddPolicy,
                                    renamePolicy: draftRenamePolicy,
                                    avatarPolicy: draftAvatarPolicy,
                                }, { params: roomPatchParams });
                                applyRoomPatch(res.data || {
                                    title: renameValue.trim(),
                                    addMembersPolicy: draftAddPolicy,
                                    renamePolicy: draftRenamePolicy,
                                    avatarPolicy: draftAvatarPolicy,
                                });
                                setSettingsOpen(false);
                            } catch (e) {
                                console.error(e);
                                showAppInfoToast('Ошибка', 'Не удалось сохранить настройки');
                            } finally {
                                setRoomSaving(false);
                            }
                        }} className="w-full h-11 rounded-full bg-[#5C4B7A] text-white text-sm disabled:opacity-50">{roomSaving ? 'Сохраняем…' : 'Сохранить'}</button>
                    </div>
                </div>
            )}
            {addMembersOpen && (
                <AddPersonalGroupMembersModal
                    chatId={activeRoom.id}
                    excludeUserIds={[Number(user?.id), ...participantsList.map((p) => Number(p.userId)).filter(Boolean)]}
                    onClose={() => setAddMembersOpen(false)}
                    onAdded={async () => {
                        setAddMembersOpen(false);
                        try {
                            const partRes = await api.get(`/api/v1/social/chats/rooms/${activeRoom.id}/members`);
                            setParticipantsList((partRes.data || []).map((p: any) => ({
                                userId: p.userId,
                                firstName: p.firstName,
                                lastName: p.lastName,
                                avatarUrl: p.avatarUrl,
                                owner: p.owner,
                                admin: p.admin,
                            })));
                        } catch (e) {
                            console.error(e);
                        }
                    }}
                />
            )}

            {actions.contextMenu && actions.contextMenuMsgId && (() => {
                const msg = actions.messages.find(m => String(m.id) === String(actions.contextMenuMsgId));
                const isMsgMe = msg?.from === 'me';
                return (
                    <div data-message-menu style={{ top: actions.contextMenu.y, left: actions.contextMenu.x }} className="fixed bg-white border border-slate-200 shadow-md rounded-xl py-1 w-[200px] max-w-[calc(100vw-16px)] md:w-[160px] md:max-w-[160px] max-h-[min(70dvh,320px)] overflow-y-auto z-50 animate-fadeIn">
                        <button onClick={(e) => { e.stopPropagation(); if (msg) { const ref: ReplyRef = { id: msg.id, author: msg.from === 'me' ? 'Вы' : `${msg.senderFirstName || 'Участник'} ${msg.senderLastName || ''}`.trim(), text: msg.poll ? `Голосование: ${msg.poll.question}` : formatSidebarMessage(msg.text, mediaHintFromMessage(msg)) }; actions.setReplyTo([ref]); actions.setSelectedParentIds([]); actions.setIsSelectionMode(false); } actions.setEditingId(null); actions.setContextMenu(null); }} className="w-full text-left px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition truncate">Ответить</button>
                        {isRoomAdmin && !msg?.isSystem && !msg?.isDeleted && !msg?.poll && (
                            <button onClick={async (e) => {
                                e.stopPropagation();
                                actions.setContextMenu(null);
                                try {
                                    const pinned = pins.some((p) => Number(p.messageId) === Number(msg?.id));
                                    const res = pinned
                                        ? await api.delete(`/api/v1/social/chats/rooms/${activeRoom.id}/pins/${msg?.id}`)
                                        : await api.post(`/api/v1/social/chats/rooms/${activeRoom.id}/pins/${msg?.id}`, null, { params: { firstName: user?.firstName || '', lastName: user?.lastName || '', notify: true } });
                                    setPins(res.data || []);
                                } catch (err: any) {
                                    showAppInfoToast('Закрепление', err?.response?.data?.details || 'Не удалось закрепить');
                                }
                            }} className="w-full text-left px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition truncate">
                                {pins.some((p) => Number(p.messageId) === Number(msg?.id)) ? 'Открепить' : 'Закрепить'}
                            </button>
                        )}
                        {isMsgMe && !msg?.isDeleted && !msg?.isSystem && !msg?.poll && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (!msg) return;
                                    actions.setEditingId(msg.id);
                                    actions.setDraft(msg.text || '');
                                    actions.setReplyTo([]);
                                    actions.setSelectedParentIds([]);
                                    actions.setIsSelectionMode(false);
                                    actions.setContextMenu(null);
                                }}
                                className="lg:hidden w-full text-left px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition truncate"
                            >
                                Редактировать
                            </button>
                        )}
                        {!msg?.poll && (
                            <>
                                <button onClick={(e) => { e.stopPropagation(); actions.setIsSelectionMode(true); actions.setIsDeleteSelectionType(false); actions.toggleSelectParentId(actions.contextMenuMsgId!); actions.setContextMenu(null); }} className="w-full text-left px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition border-b border-slate-100/80 truncate">Выбрать несколько</button>
                                <button onClick={(e) => { e.stopPropagation(); actions.setContextMenu(null); setForwardSourceId(Number(actions.contextMenuMsgId)); setIsForwardModalOpen(true); }} className="w-full text-left px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition truncate">Переслать</button>
                            </>
                        )}
                        {!isMsgMe && !msg?.isSystem && !msg?.isDeleted && Number(msg?.id) > 0 && Number(msg?.senderId) > 0 && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    actions.setContextMenu(null);
                                    openReport({
                                        category: 'MESSAGE',
                                        accusedId: Number(msg?.senderId),
                                        accusedName: `${msg?.senderFirstName || ''} ${msg?.senderLastName || ''}`.trim() || undefined,
                                        targetId: Number(msg?.id),
                                        roomId: Number(activeRoom.id),
                                        targetTitle: msg?.poll ? 'Голосование' : 'Сообщение',
                                        snapshotText: msg?.poll ? `Голосование: ${msg.poll.question}` : (msg?.text || ''),
                                    });
                                }}
                                className="w-full text-left px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition truncate"
                            >
                                Жалоба
                            </button>
                        )}
                        {isMsgMe && (
                            <>
                                <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); actions.setIsSelectionMode(true); actions.setIsDeleteSelectionType(true); actions.toggleSelectParentId(actions.contextMenuMsgId!); actions.setContextMenu(null); }} className="w-full text-left px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition border-b border-slate-100/80 truncate">Удалить несколько</button>
                                <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); const id = String(actions.contextMenuMsgId || msg?.id || ''); actions.setContextMenu(null); if (id) void actions.handleDeleteMessage(id); }} className="w-full text-left px-3 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 transition truncate">Удалить сообщение</button>
                            </>
                        )}
                    </div>
                );
            })()}

            <ForwardModal isOpen={isForwardModalOpen} onClose={() => setIsForwardModalOpen(false)}
                          onSelectChats={handleForwardSubmit} // Изменили с onSelectChat на onSelectChats
            />
            <ChatMaterialsGallery
                open={galleryOpen}
                onClose={() => setGalleryOpen(false)}
                source={{ type: 'group', chatId: activeRoom.id }}
                onGoToMessage={(messageId) => {
                    setGalleryOpen(false);
                    setTimeout(() => actions.jumpToMessage(messageId), 160);
                }}
            />
            {pollModalOpen && (
                <CreatePollModal
                    chatId={Number(activeRoom.id)}
                    firstName={user?.firstName}
                    lastName={user?.lastName}
                    onClose={() => setPollModalOpen(false)}
                    onCreated={(message) => {
                        if (!message?.id) return;
                        const id = String(message.id);
                        const mapped: Msg = {
                            id,
                            senderId: message.senderId,
                            senderFirstName: message.senderFirstName,
                            senderLastName: message.senderLastName,
                            senderAvatarUrl: message.senderAvatarUrl,
                            from: Number(message.senderId) === Number(user?.id) ? 'me' : 'them',
                            text: message.content || '',
                            time: formatMessageTime(message.timestamp),
                            timestamp: message.timestamp,
                            poll: message.poll,
                        };
                        actions.setMessages((prev) => prev.some((x) => x.id === id)
                            ? prev.map((x) => x.id === id ? { ...x, poll: message.poll || x.poll } : x)
                            : [...prev, mapped]);
                    }}
                />
            )}

            {avatarPreviewOpen && displayAvatarUrl && (
                <ChatMediaLightbox
                    urls={[getAvatarUrl(null, displayAvatarUrl)]}
                    index={0}
                    onClose={() => setAvatarPreviewOpen(false)}
                    onIndexChange={() => {}}
                    meta={[{
                        timestamp: [...actions.messages].reverse().find((msg) => (
                            msg.isSystem && /аватарк/i.test(msg.text || '') && msg.photos?.length
                        ))?.timestamp || undefined,
                    }]}
                />
            )}

            {leaveOwnerOpen && (
                <div className="fixed inset-0 z-[80] bg-slate-900/40 flex items-center justify-center p-4" onClick={() => setLeaveOwnerOpen(false)}>
                    <div className="w-full max-w-sm bg-[#FFFCFA] rounded-[28px] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="myraion-display text-xl mb-2">Покинуть чат</div>
                        <p className="text-sm text-slate-500 mb-4">Передайте чат другому участнику или удалите его у всех.</p>
                        <select
                            value={transferUserId || ''}
                            onChange={(e) => setTransferUserId(e.target.value ? Number(e.target.value) : null)}
                            className="w-full h-11 px-3 rounded-full border border-[#1C1824]/10 text-sm mb-3 bg-white"
                        >
                            <option value="">Новый создатель…</option>
                            {participantsList.filter((p) => Number(p.userId) !== Number(user?.id)).map((p) => (
                                <option key={p.userId} value={p.userId}>{p.firstName} {p.lastName || ''}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            disabled={!transferUserId}
                            onClick={async () => {
                                if (!transferUserId) return;
                                try {
                                    await api.post(`/api/v1/social/chats/rooms/${activeRoom.id}/transfer/${transferUserId}?firstName=${encodeURIComponent(user?.firstName || '')}&lastName=${encodeURIComponent(user?.lastName || '')}`);
                                    await api.delete(`/api/v1/social/chats/rooms/${activeRoom.id}/members/${user?.id}?firstName=${encodeURIComponent(user?.firstName || '')}&lastName=${encodeURIComponent(user?.lastName || '')}`);
                                    if (setEventRooms) setEventRooms((prev: any[]) => (prev || []).filter((r) => r && Number(r.id) !== Number(activeRoom.id)));
                                    setLeaveOwnerOpen(false);
                                    onCloseChat();
                                } catch (e) {
                                    showAppInfoToast('Ошибка', 'Не удалось передать чат');
                                }
                            }}
                            className="w-full h-11 rounded-full bg-[#5C4B7A] text-white text-sm mb-2 disabled:opacity-50"
                        >
                            Передать и выйти
                        </button>
                        <button
                            type="button"
                            onClick={async () => {
                                const confirmed = await showAppConfirm({
                                    title: 'Удалить чат',
                                    message: 'Чат будет удалён у всех участников.',
                                    confirmText: 'Удалить',
                                    cancelText: 'Отмена',
                                    danger: true,
                                });
                                if (!confirmed) return;
                                try {
                                    await api.delete(`/api/v1/social/chats/rooms/${activeRoom.id}`);
                                    if (setEventRooms) setEventRooms((prev: any[]) => (prev || []).filter((r) => r && Number(r.id) !== Number(activeRoom.id)));
                                    setLeaveOwnerOpen(false);
                                    onCloseChat();
                                } catch (e) {
                                    showAppInfoToast('Ошибка', 'Не удалось удалить чат');
                                }
                            }}
                            className="w-full h-11 rounded-full bg-rose-500 text-white text-sm"
                        >
                            Удалить чат у всех
                        </button>
                        <button
                            type="button"
                            onClick={() => setLeaveOwnerOpen(false)}
                            className="w-full h-11 rounded-full text-sm text-slate-500 mt-2"
                        >
                            Отмена
                        </button>
                    </div>
                </div>
            )}

            <CreateEventDrawer
                open={!!editingEvent}
                mode="edit"
                initialDraft={editingEvent}
                onClose={() => setEditingEvent(null)}
                onSuccess={() => {
                    setEditingEvent(null);
                    void refreshEventRooms();
                    if (activeRoom.eventId) {
                        api.get(`/api/v1/social/events/${activeRoom.eventId}`)
                            .then((res) => {
                                if (res.data?.title) setDisplayTitle(res.data.title);
                            })
                            .catch(() => {});
                    }
                }}
            />

        </div>
    );
}