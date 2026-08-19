import React, {useCallback, useEffect, useRef, useState} from 'react';
import api, { uploadChatVoice } from '@/shared/lib/api';
import { theme } from '@/shared/ui/theme';
import { useChat, formatSidebarMessage, mediaHintFromMessage, mapBundledForwardQuotes, isForwardQuoteCaption } from '@/features/chat/ChatContext';
import { useAuth } from '@/shared/context/AuthContext';
import { openNeighborProfile, getAvatarUrl, NAV_EVENT_RELOAD_CHAT_HISTORY } from '@/shared/utils/navigation';
import { presenceLabel } from '@/shared/utils/presence';

import {
    MoreHorizontal,
    Smile,
    Search,
    Send,
    Check,
    CheckCheck,
    Pencil,
    X,
    CornerUpLeft,
    Trash2,
    FolderOpen, Pin, BellOff, Bell, ChevronLeft
} from 'lucide-react';
import { useChatActions, Msg, ReplyRef } from '@/features/chat/useChatActions';
import ForwardModal from "@/features/chat/ForwardModal";
import ChatPhotoGrid from '@/features/chat/ChatPhotoGrid';
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
import { showAppInfoToast } from '@/shared/utils/appToast';
import { useReport } from '@/features/report/ReportModal';
import { mentionQuery, insertMention } from '@/features/chat/chatMentions';
import { clearChatDraft, readChatDraft, writeChatDraft } from '@/features/chat/chatDrafts';

interface Chat {
    id: string;
    name: string;
    avatar: string;
    last_message: string;
    time: string;
    unread: number;
    online: boolean;
    lastSeenAt?: string | null;
}

export default function PersonalChatSection({
    activePersonal,
    pageActive = true,
    onClosePersonal,
    onNavigateToPersonal,
    onNavigateToGroup
}: {
    activePersonal: Chat;
    pageActive?: boolean;
    onClosePersonal: () => void;
    onNavigateToPersonal: (chat: any) => void;
    onNavigateToGroup: (room: any) => void;
}) {
    const { user } = useAuth();
    const { openReport } = useReport();
    const { stompClient, setChats, chats, eventRooms } = useChat();

    const [isForwardModalOpen, setIsForwardModalOpen] = useState(false);
    const [forwardSourceId, setForwardSourceId] = useState<number | null>(null);
    const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
    const [galleryOpen, setGalleryOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [pins, setPins] = useState<any[]>([]);
    const chatMeta = (chats || []).find((c) => Number(c.id) === Number(activePersonal.id));
    const unreadAtOpenRef = useRef(Math.max(
        0,
        Number(chatMeta?.unread ?? activePersonal.unread) || 0
    ));
    const pageActiveRef = useRef(pageActive);
    pageActiveRef.current = pageActive;
    const [emojiOpen, setEmojiOpen] = useState(false);
    const [historyHasMore, setHistoryHasMore] = useState(true);
    const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
    const historyLoadingRef = useRef(false);
    const historyHasMoreRef = useRef(true);
    const historyFetchGenRef = useRef(0);
    const [historyEpoch, setHistoryEpoch] = useState(0);
    const messagesRef = useRef<Msg[]>([]);
    const HISTORY_PAGE_SIZE = 30;
    const skipDraftSave = useRef(true);
    const chatMedia = useChatMediaAttach();
    const sendVoice = useCallback(async (blob: Blob, duration: number) => {
        if (!stompClient?.connected) return;
        const stored = await uploadChatVoice(blob);
        stompClient.publish({
            destination: '/app/chat',
            body: JSON.stringify({
                chatId: null,
                recipientId: Number(activePersonal.id),
                content: '',
                voiceUrl: stored,
                voiceDuration: duration,
                senderId: user?.id,
                senderFirstName: user?.firstName,
                senderLastName: user?.lastName,
                parentIds: [],
            }),
        });
    }, [stompClient, activePersonal.id, user?.id, user?.firstName, user?.lastName]);
    const voice = useChatVoiceRecorder(sendVoice);
    const [partnerTyping, setPartnerTyping] = useState(false);
    const typingIdleRef = useRef<number | null>(null);
    const lastTypingSentRef = useRef(0);

    const sendTyping = useCallback(() => {
        if (!stompClient?.connected || !user?.id) return;
        const now = Date.now();
        if (now - lastTypingSentRef.current < 1500) return;
        lastTypingSentRef.current = now;
        stompClient.publish({
            destination: '/app/chat/typing',
            body: JSON.stringify({
                recipientId: Number(activePersonal.id),
                senderId: user.id,
                senderFirstName: user.firstName,
                content: '[TYPING]',
                chatId: null,
            }),
        });
    }, [stompClient, activePersonal.id, user?.id]);

    // Подключаем наш единый переиспользуемый хук действий над сообщениями
    const actions = useChatActions({
        refreshRooms: undefined
    });
    const voiceQueue = voiceQueueFromMessages(actions.messages);
    useChatPasteImages(chatMedia.addPhotos, !actions.editingId && voice.mode === 'idle');
    messagesRef.current = actions.messages;
    historyHasMoreRef.current = historyHasMore;

    useEffect(() => {
        skipDraftSave.current = true;
        setSearchOpen(false);
        setEmojiOpen(false);
        actions.setDraft(readChatDraft('personal', activePersonal.id));
        const t = window.setTimeout(() => { skipDraftSave.current = false; }, 0);
        return () => window.clearTimeout(t);
    }, [activePersonal.id]);

    useEffect(() => {
        if (skipDraftSave.current) return;
        writeChatDraft('personal', activePersonal.id, actions.draft);
    }, [actions.draft, activePersonal.id]);

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

    useEffect(() => {
        const savedBuffer = localStorage.getItem('pending_forward_messages');
        if (savedBuffer) {
            const parsed = JSON.parse(savedBuffer);
            actions.setForwardBuffer(parsed);
            localStorage.removeItem('pending_forward_messages');
        }
    }, [activePersonal.id]);

    // Загрузка истории личной переписки с разметкой линии новых сообщений
    useEffect(() => {
        const mapRaw = (m: any) => {
            const isDeletedFromDb = m.deleted === true;
            return {
                id: m.id.toString(),
                senderId: m.senderId,
                senderFirstName: m.senderFirstName,
                senderLastName: m.senderLastName,
                from: Number(m.senderId) === Number(user?.id) ? 'me' : 'them',
                text: isDeletedFromDb ? 'Сообщение удалено' : (m.content || ''),
                photos: isDeletedFromDb ? [] : (m.photos || []),
                files: isDeletedFromDb ? [] : (m.files || []),
                voiceUrl: isDeletedFromDb ? undefined : m.voiceUrl,
                voiceDuration: isDeletedFromDb ? undefined : m.voiceDuration,
                time: m.timestamp ? new Date(m.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '',
                timestamp: m.timestamp,
                isSystem: m.isSystem === true || m.system === true,
                edited: m.edited,
                read: m.read,
                isDeleted: isDeletedFromDb,
                reply_to: (m.bundledForwards && m.bundledForwards.length > 0)
                    ? mapBundledForwardQuotes(m.bundledForwards)
                    : undefined,
                forwardedFrom: m.forwardedFrom ? m.forwardedFrom : undefined,
                bundledForwards: m.bundledForwards ? m.bundledForwards : undefined
            };
        };

        const fetchHistory = async () => {
            const gen = ++historyFetchGenRef.current;
            try {
                historyLoadingRef.current = false;
                setHistoryLoadingMore(false);
                historyHasMoreRef.current = true;
                setHistoryHasMore(true);
                const response = await api.get(`/api/v1/social/chats/history/${activePersonal.id}`, {
                    params: { size: HISTORY_PAGE_SIZE },
                });
                const rawMessages = response.data || [];
                historyHasMoreRef.current = rawMessages.length >= HISTORY_PAGE_SIZE;
                setHistoryHasMore(rawMessages.length >= HISTORY_PAGE_SIZE);
                const filtered = rawMessages.filter((m: any) => m.content !== '[CHAT_CREATED]');
                let acc = filtered.map(mapRaw).sort((a: any, b: any) => Number(a.id) - Number(b.id));
                const unreadAtOpen = historyEpoch === 0 ? unreadAtOpenRef.current : 0;
                let hasMore = rawMessages.length >= HISTORY_PAGE_SIZE;
                for (let page = 0; page < 8 && hasMore && unreadAtOpen > realMessageCount(acc); page++) {
                    const beforeId = oldestNumericId(acc);
                    if (!beforeId) break;
                    const olderRes = await api.get(`/api/v1/social/chats/history/${activePersonal.id}`, {
                        params: { size: HISTORY_PAGE_SIZE, beforeId },
                    });
                    const olderRaw = (olderRes.data || []).filter((m: any) => m.content !== '[CHAT_CREATED]');
                    hasMore = (olderRes.data || []).length >= HISTORY_PAGE_SIZE;
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
                api.put(`/api/v1/social/chats/read/${activePersonal.id}`)
                    .then(() => {
                        if (setChats) {
                            setChats((prevChats) => (prevChats || []).map((c) =>
                                c && c.id === activePersonal.id ? { ...c, unread: 0 } : c
                            ));
                        }
                        if (stompClient && stompClient.connected) {
                            stompClient.publish({
                                destination: '/app/chat',
                                body: JSON.stringify({
                                    recipientId: Number(activePersonal.id),
                                    senderId: user?.id,
                                    content: '[MESSAGES_READ]',
                                    chatId: null
                                })
                            });
                        }
                    })
                    .catch((err) => console.error("Ошибка сброса счетчика личного чата:", err));
                }

                actions.scrollOpenThread();
            } catch (err) {
                console.error("Ошибка загрузки истории личного чата:", err);
            }
        };
        fetchHistory();
        setPartnerTyping(false);
        if (typingIdleRef.current) {
            window.clearTimeout(typingIdleRef.current);
            typingIdleRef.current = null;
        }
    }, [activePersonal.id, historyEpoch]);

    useEffect(() => {
        const onReload = (event: Event) => {
            const personalId = (event as CustomEvent<{ personalId?: number | string }>).detail?.personalId;
            if (personalId != null && Number(personalId) === Number(activePersonal.id)) {
                setHistoryEpoch((n) => n + 1);
            }
        };
        window.addEventListener(NAV_EVENT_RELOAD_CHAT_HISTORY, onReload);
        return () => window.removeEventListener(NAV_EVENT_RELOAD_CHAT_HISTORY, onReload);
    }, [activePersonal.id]);

    useEffect(() => {
        api.get(`/api/v1/social/chats/personal/${activePersonal.id}/pins`)
            .then((res) => setPins(res.data || []))
            .catch(() => setPins([]));
    }, [activePersonal.id]);

    useEffect(() => {
        if (!pageActive) return;
        const markIfOnScreen = () => {
            if (document.visibilityState !== 'visible') return;
            api.put(`/api/v1/social/chats/read/${activePersonal.id}`)
                .then(() => {
                    if (setChats) {
                        setChats((prevChats) => (prevChats || []).map((c) =>
                            c && c.id === activePersonal.id ? { ...c, unread: 0 } : c
                        ));
                    }
                    if (stompClient && stompClient.connected) {
                        stompClient.publish({
                            destination: '/app/chat',
                            body: JSON.stringify({
                                recipientId: Number(activePersonal.id),
                                senderId: user?.id,
                                content: '[MESSAGES_READ]',
                                chatId: null
                            })
                        });
                    }
                })
                .catch((err) => console.error("Ошибка сброса счетчика личного чата:", err));
        };
        markIfOnScreen();
        document.addEventListener('visibilitychange', markIfOnScreen);
        return () => document.removeEventListener('visibilitychange', markIfOnScreen);
    }, [pageActive, activePersonal.id, setChats, stompClient, user?.id]);

    const loadOlderPersonalHistory = async (): Promise<boolean> => {
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
            const response = await api.get(`/api/v1/social/chats/history/${activePersonal.id}`, {
                params: { size: HISTORY_PAGE_SIZE, beforeId: Number(oldest.id) },
            });
            const rawMessages = (response.data || []).filter((m: any) => m.content !== '[CHAT_CREATED]');
            if (rawMessages.length === 0) {
                historyHasMoreRef.current = false;
                setHistoryHasMore(false);
                return false;
            }
            const mapped = rawMessages.map((m: any) => {
                const isDeletedFromDb = m.deleted === true;
                return {
                    id: m.id.toString(),
                    senderId: m.senderId,
                    senderFirstName: m.senderFirstName,
                    senderLastName: m.senderLastName,
                    from: Number(m.senderId) === Number(user?.id) ? 'me' : 'them',
                    text: isDeletedFromDb ? 'Сообщение удалено' : (m.content || ''),
                    photos: isDeletedFromDb ? [] : (m.photos || []),
                    files: isDeletedFromDb ? [] : (m.files || []),
                    voiceUrl: isDeletedFromDb ? undefined : m.voiceUrl,
                    voiceDuration: isDeletedFromDb ? undefined : m.voiceDuration,
                    time: m.timestamp ? new Date(m.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '',
                    timestamp: m.timestamp,
                    isSystem: m.isSystem === true || m.system === true,
                    edited: m.edited,
                    read: m.read,
                    isDeleted: isDeletedFromDb,
                    forwardedFrom: m.forwardedFrom ? m.forwardedFrom : undefined,
                    bundledForwards: m.bundledForwards ? m.bundledForwards : undefined
                } as Msg;
            });
            const existing = new Set(messagesRef.current.map((m) => m.id));
            const older = mapped.filter((m: Msg) => !existing.has(m.id));
            const hasMore = (response.data || []).length >= HISTORY_PAGE_SIZE && older.length > 0;
            historyHasMoreRef.current = hasMore;
            setHistoryHasMore(hasMore);
            if (older.length === 0) return false;
            actions.setMessages((prev) => [...older, ...prev]);
            requestAnimationFrame(() => {
                if (container) container.scrollTop = container.scrollHeight - prevHeight;
            });
            return true;
        } catch (err) {
            console.error("Ошибка подгрузки истории личного чата:", err);
            return false;
        } finally {
            historyLoadingRef.current = false;
            setHistoryLoadingMore(false);
        }
    };
    actions.loadOlderMessagesRef.current = () => loadOlderPersonalHistory();

    useEffect(() => {
        const el = actions.messagesContainerRef.current;
        if (!el || !historyHasMore || historyLoadingMore || el.clientHeight === 0) return;
        if (el.scrollHeight <= el.clientHeight + 8) {
            void loadOlderPersonalHistory();
        }
    }, [actions.messages.length, historyHasMore, historyLoadingMore, activePersonal.id]);

    useEffect(() => {
        const onTyping = (event: Event) => {
            const body = (event as CustomEvent).detail || {};
            if (body.chatId) return;
            if (Number(body.senderId) !== Number(activePersonal.id)) return;
            setPartnerTyping(true);
            if (typingIdleRef.current) window.clearTimeout(typingIdleRef.current);
            typingIdleRef.current = window.setTimeout(() => setPartnerTyping(false), 3500);
        };
        window.addEventListener('chatTyping', onTyping);
        return () => window.removeEventListener('chatTyping', onTyping);
    }, [activePersonal.id]);

    // Прослушивание персональной WebSocket-очереди в реальном времени
    useEffect(() => {
        if (!stompClient || !stompClient.connected || !user?.id) return;
        const dynamicTopic = `/user/queue/messages`;
        const subscription = stompClient.subscribe(dynamicTopic, (message: any) => {
            const m = JSON.parse(message.body);

            if (m.pinUpdate) {
                const ids = [Number(m.partnerMin), Number(m.partnerMax)];
                if (ids.includes(Number(user?.id)) && ids.includes(Number(activePersonal.id))) {
                    setPins(m.pins || []);
                }
                return;
            }

            if (m.content === '[TYPING]' && Number(m.senderId) === Number(activePersonal.id)) {
                setPartnerTyping(true);
                if (typingIdleRef.current) window.clearTimeout(typingIdleRef.current);
                typingIdleRef.current = window.setTimeout(() => setPartnerTyping(false), 3000);
                return;
            }

            if (m.content === '[MESSAGES_READ]' && Number(m.senderId) === Number(activePersonal.id)) {
                actions.setMessages((prev) => prev.map((msg) => msg.from === 'me' ? { ...msg, read: true } : msg));
                return;
            }
            if (Number(m.senderId) !== Number(activePersonal.id) && Number(m.recipientId) !== Number(activePersonal.id)) return;

            if (Number(m.senderId) === Number(activePersonal.id)) {
                setPartnerTyping(false);
            }

            if (m.deleted === true || m.isDeleted === true || m.msgDeleted === true) {
                actions.setMessages((prev) => prev.map((msg) => String(msg.id) === String(m.id) ? { ...msg, text: 'Сообщение удалено', isDeleted: true, photos: [], files: [], voiceUrl: undefined, voiceDuration: undefined } : msg));
                return;
            }
            if (m.edited) {
                actions.setMessages((prev) => prev.map((msg) => msg.id === m.id.toString() ? { ...msg, text: m.content, edited: true } : msg));
                return;
            }

            const newMsg: Msg = {
                id: m.id.toString(),
                senderId: m.senderId,
                senderFirstName: m.senderFirstName,
                senderLastName: m.senderLastName,
                from: Number(m.senderId) === Number(user?.id) ? 'me' : 'them',
                text: m.content || '',
                photos: m.photos || [],
                files: m.files || [],
                voiceUrl: m.voiceUrl,
                voiceDuration: m.voiceDuration,
                time: m.timestamp ? new Date(m.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '',
                timestamp: m.timestamp,
                isSystem: m.isSystem === true || m.system === true,
                edited: m.edited,
                read: m.read,
                reply_to: (m.bundledForwards && m.bundledForwards.length > 0)
                    ? mapBundledForwardQuotes(m.bundledForwards)
                    : (m.parentIds && m.parentIds.length > 0)
                        ? m.parentIds.map((parentId: any) => {
                            const originalMsg = actions.messages.find(x => x.id.toString() === parentId.toString());
                            return {
                                id: parentId.toString(),
                                author: originalMsg ? (originalMsg.from === 'me' ? 'Вы' : `${originalMsg.senderFirstName || 'Собеседник'}`) : 'Собеседник',
                                text: originalMsg ? originalMsg.text : 'Пересланное сообщение'
                            };
                        })
                        : (Number(m.senderId) === Number(user?.id) && (actions as any).forwardBuffer && (actions as any).forwardBuffer.length > 0)
                            ? (actions as any).forwardBuffer.map((parent: any) => ({
                                id: parent.id.toString(),
                                author: parent.from === 'me' ? 'Вы' : 'Собеседник',
                                text: parent.text || ''
                            }))
                            : undefined,
                forwardedFrom: m.forwardedFrom ? m.forwardedFrom : undefined,
                bundledForwards: m.bundledForwards ? m.bundledForwards : undefined
            };

            if (newMsg.from === 'them' && !newMsg.isSystem) {
                if (pageActiveRef.current && document.visibilityState === 'visible') {
                api.put(`/api/v1/social/chats/read/${activePersonal.id}`)
                    .then(() => {
                        if (setChats) {
                            setChats((prevChats) => (prevChats || []).map((c) => c && c.id === activePersonal.id ? { ...c, unread: 0 } : c));
                        }
                        stompClient.publish({
                            destination: '/app/chat',
                            body: JSON.stringify({ recipientId: Number(activePersonal.id), senderId: user?.id, content: '[MESSAGES_READ]', chatId: null })
                        });
                    }).catch(err => console.error(err));
                newMsg.read = true;
                }
            }

            actions.setMessages((prev) => {
                // ПРОДАКШН-ФИКС: Собираем reply_to из parentIds для получателя на основе живой истории prev
                if (m.parentIds && m.parentIds.length > 0 && (!newMsg.reply_to || newMsg.reply_to.length === 0)) {
                    newMsg.reply_to = m.parentIds.map((parentId: any) => {
                        const originalMsg = prev.find(x => x.id.toString() === parentId.toString());
                        return {
                            id: parentId.toString(),
                            author: originalMsg ? (originalMsg.from === 'me' ? 'Вы' : `${originalMsg.senderFirstName || 'Собеседник'}`) : 'Собеседник',
                            text: originalMsg ? originalMsg.text : 'Пересланное сообщение'
                        };
                    });
                }

                const messageMap = new Map(prev.map(msg => [msg.id.toString(), msg]));
                const isDuplicate = prev.some(el => el.id === newMsg.id);
                if (isDuplicate) {
                    return prev.map(el => el.id === newMsg.id
                        ? {
                            ...el,
                            forwardedFrom: newMsg.forwardedFrom || el.forwardedFrom,
                            bundledForwards: newMsg.bundledForwards || el.bundledForwards,
                            photos: newMsg.photos?.length ? newMsg.photos : el.photos,
                            files: newMsg.files?.length ? newMsg.files : el.files,
                            voiceUrl: newMsg.voiceUrl || el.voiceUrl,
                            voiceDuration: newMsg.voiceDuration || el.voiceDuration,
                        }
                        : el
                    );
                }
                // 2. ОБРАБОТКА ИСПРАВЛЕНИЯ ОБЫЧНЫХ СООБЩЕНИЙ:
                // Если это наше собственное только что отправленное сообщение (from === 'me'),
                // нам нужно заменить временное оптимистичное сообщение на реальное с бэкенда
                if (newMsg.from === 'me') {
                    // Ищем временное сообщение в стейте (у него текст совпадает и ID не из базы)
                    const hasTemporary = prev.some(el => el.from === 'me' && el.text === newMsg.text && isNaN(Number(el.id)));

                    if (hasTemporary) {
                        // Подменяем временное сообщение на полноценное серверное
                        return prev.map(el => (el.from === 'me' && el.text === newMsg.text && isNaN(Number(el.id)))
                            ? newMsg
                            : el
                        );
                    }
                }

                // 3. Если это абсолютно новое входящее сообщение от собеседника — добавляем в массив
                const updatedArray = [...prev, newMsg];
                return updatedArray.sort((a, b) => {
                    const idA = isUnreadMarker(a.id) ? 0 : Number(a.id);
                    const idB = isUnreadMarker(b.id) ? 0 : Number(b.id);
                    if (isUnreadMarker(a.id) || isUnreadMarker(b.id)) return 0;
                    return idA - idB;
                });
            });



            setTimeout(() => {
                if (actions.messagesContainerRef.current) {
                    actions.messagesContainerRef.current.scrollTo({ top: actions.messagesContainerRef.current.scrollHeight, behavior: 'smooth' });
                }
            }, 50);
        });
        return () => {
            subscription.unsubscribe();
            if (typingIdleRef.current) window.clearTimeout(typingIdleRef.current);
        };
    }, [stompClient, stompClient?.connected, activePersonal.id, user?.id]);

    // Чистый продакшн-фикс: мгновенное мягкое скрытие сообщений у собеседника онлайн
    useEffect(() => {
        const handleInstantClear = (event: Event) => {
            const customEvent = event as CustomEvent;

            // Проверяем, что очистили именно тот личный чат, который сейчас открыт на экране
            if (customEvent.detail && String(customEvent.detail.partnerId) === String(activePersonal.id)) {
                // Гарантированно обнуляем массив сообщений на экране в реальном времени
                actions.setMessages([]);
            }
        };

        window.addEventListener("instantPersonalChatClear", handleInstantClear);
        return () => {
            window.removeEventListener("instantPersonalChatClear", handleInstantClear);
        };
    }, [activePersonal.id, actions]);


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


    // Функция отправки и редактирования сообщений
    const send = async () => {
        // Если нет текста и нет пересылаемых сообщений — выходим
        if (!actions.draft.trim() && actions.forwardBuffer.length === 0 && chatMedia.count === 0) return;
        if (chatMedia.count > 0 && !chatMedia.allReady) return;

        // Логика редактирования (оставляем без изменений)
        if (actions.editingId) {
            try {
                await api.put(`/api/v1/social/chats/message/${actions.editingId}`, actions.draft.trim(), {
                    headers: { 'Content-Type': 'text/plain' }
                });
                actions.setMessages(actions.messages.map((m) => (m.id === actions.editingId ? { ...m, text: actions.draft.trim(), edited: true } : m)));
                actions.setEditingId(null);
                actions.setDraft('');
            } catch (err) { console.error(err); }
            return;
        }

        // Логика отправки нового сообщения / пачки пересылок
        if (stompClient && stompClient.connected) {
            if (actions.forwardBuffer.length > 0) {
                actions.isMySentAction.current = true;
                publishForwardToChats(
                    stompClient,
                    user,
                    [{ recipientId: Number(activePersonal.id) }],
                    actions.forwardBuffer,
                    actions.draft.trim()
                );
                actions.setDraft('');
                actions.resetForwardBuffer();
                actions.resetSelectionMode();
                chatMedia.clear();
                clearChatDraft('personal', activePersonal.id);
                return;
            }

            const parentIdsArray = actions.replyTo.length > 0 ? actions.replyTo.map(r => Number(r.id)) : [];

            const messagePayload = {
                chatId: null,
                recipientId: Number(activePersonal.id),
                // Если текста комментария нет, отправляем пустую строку (бэкенд сам разберется или оставит пустой)
                content: actions.draft.trim(),
                photos: chatMedia.storedPhotoUrls,
                files: chatMedia.storedFiles,
                senderId: user?.id,
                senderFirstName: user?.firstName,
                senderLastName: user?.lastName,
                parentIds: parentIdsArray
            };

            actions.isMySentAction.current = true;
            stompClient.publish({ destination: '/app/chat', body: JSON.stringify(messagePayload) });

            // Сбрасываем стейты ввода и очищаем буфер пересылки
            actions.setDraft('');
            actions.resetForwardBuffer();
            actions.resetSelectionMode();
            chatMedia.clear();
            clearChatDraft('personal', activePersonal.id);
        } else {
            showAppInfoToast('Чат', 'Нет связи с сервером сообщений. Проверьте Wi‑Fi и обновите страницу.');
        }
    };

    return (
        <div
            className="flex-1 flex flex-col h-full min-h-0 overflow-hidden relative"
            data-open-personal-chat={activePersonal.id}
        >
            <div className={`px-3 md:px-6 py-3.5 max-lg:pt-[max(0.75rem,env(safe-area-inset-top))] border-b ${theme.surface.border} ${theme.surface.card} flex items-center justify-between shrink-0`}>
                <div className="flex items-center gap-2 md:gap-3 min-w-0">
                    <button
                        type="button"
                        onClick={onClosePersonal}
                        className="lg:hidden w-11 h-11 -ml-1 rounded-full flex items-center justify-center text-[#1C1824] shrink-0"
                        aria-label="Назад к списку чатов"
                    >
                        <ChevronLeft className="w-6 h-6" />
                    </button>
                    {/* Внедряем аватарку вместо текстового круга */}
                    <img
                        src={getAvatarUrl(activePersonal.id, chats.find(c => c && c.id === activePersonal.id)?.avatar || activePersonal.avatar)}
                        onClick={() => openNeighborProfile(activePersonal.id)}
                        alt=""
                        className="w-10 h-10 rounded-full object-cover border border-slate-100 shadow-sm cursor-pointer"
                    />
                    <div>
                        <div
                            onClick={() => openNeighborProfile(activePersonal.id)}
                            className="font-semibold text-slate-900 text-sm tracking-wide cursor-pointer"
                        >
                            {(() => {
                                const currentDetails = chats.find(c => c && c.id === activePersonal.id);
                                const displayName = currentDetails ? currentDetails.name : activePersonal.name;
                                if (displayName.trim() === `${user?.firstName} ${user?.lastName}`.trim()) {
                                    return "Собеседник";
                                }
                                return displayName;
                            })()}
                        </div>

                        <div className={`text-xs ${partnerTyping || chats.find(c => c && c.id === activePersonal.id)?.online ? 'text-[#3D6B56]' : 'text-slate-500'}`}>
                            {partnerTyping
                                ? 'Печатает…'
                                : presenceLabel(
                                    !!chats.find(c => c && c.id === activePersonal.id)?.online,
                                    chats.find(c => c && c.id === activePersonal.id)?.lastSeenAt
                                )}
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
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setHeaderMenuOpen(!headerMenuOpen); }}
                        className={`p-2 rounded-lg transition ${headerMenuOpen ? 'bg-slate-100 text-[#5C4B7A]' : 'text-slate-500 hover:bg-slate-100'}`}
                        title="Ещё"
                    >
                        <MoreHorizontal className="w-4 h-4" />
                    </button>
                    <button
                        type="button"
                        onClick={onClosePersonal}
                        className="hidden lg:inline-flex p-2 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition ml-1"
                        title="Закрыть чат"
                    >
                        <X className="w-4 h-4 stroke-[2.5]" />
                    </button>
                    {headerMenuOpen && (
                        <>
                            <div className="fixed inset-0 z-40 cursor-default" onClick={() => setHeaderMenuOpen(false)} />
                            <div className="absolute right-9 top-11 bg-white border border-slate-200/80 shadow-xl rounded-xl py-1.5 min-w-[190px] z-50 animate-fadeIn pointer-events-auto">
                                <button
                                    type="button"
                                    onClick={() => { setHeaderMenuOpen(false); setGalleryOpen(true); }}
                                    className="w-full text-left px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition flex items-center gap-2"
                                >
                                    <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
                                    <span>Материалы чата</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        setHeaderMenuOpen(false);
                                        try {
                                            if (chatMeta?.muted) await api.delete(`/api/v1/social/chats/prefs/personal/${activePersonal.id}/mute`);
                                            else await api.put(`/api/v1/social/chats/prefs/personal/${activePersonal.id}/mute`);
                                            setChats((prev) => (prev || []).map((c) => Number(c.id) === Number(activePersonal.id) ? { ...c, muted: !chatMeta?.muted } : c));
                                        } catch (e) {
                                            console.error(e);
                                        }
                                    }}
                                    className="w-full text-left px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition flex items-center gap-2"
                                >
                                    {chatMeta?.muted ? <Bell className="w-3.5 h-3.5 text-slate-400" /> : <BellOff className="w-3.5 h-3.5 text-slate-400" />}
                                    <span>{chatMeta?.muted ? 'Включить уведомления' : 'Выключить уведомления'}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        setHeaderMenuOpen(false);
                                        try {
                                            if (chatMeta?.pinned) await api.delete(`/api/v1/social/chats/prefs/personal/${activePersonal.id}/pin`);
                                            else await api.put(`/api/v1/social/chats/prefs/personal/${activePersonal.id}/pin`);
                                            const personalRes = await api.get('/api/v1/social/chats/users');
                                            setChats(personalRes.data || []);
                                        } catch (err: any) {
                                            showAppInfoToast('Закрепление', err?.response?.data?.details || 'Можно закрепить не больше 5 чатов');
                                        }
                                    }}
                                    className="w-full text-left px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition flex items-center gap-2"
                                >
                                    <Pin className="w-3.5 h-3.5 text-slate-400" />
                                    <span>{chatMeta?.pinned ? 'Открепить чат' : 'Закрепить чат'}</span>
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
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
                canManage
                onJump={(id) => actions.jumpToMessage(id)}
                onUnpin={async (messageId) => {
                    const res = await api.delete(`/api/v1/social/chats/personal/${activePersonal.id}/pins/${messageId}`);
                    setPins(res.data || []);
                }}
            />

            {/* ОКНО СООБЩЕНИЙ */}
            <div className="relative flex-1 min-h-0">
            <div
                ref={actions.messagesContainerRef}
                onScroll={() => {
                    actions.handleChatScroll();
                    const el = actions.messagesContainerRef.current;
                    if (el && el.scrollTop < 80) void loadOlderPersonalHistory();
                }}
                className="myraion-chat-messages absolute inset-0 overflow-y-auto p-4 md:p-6 space-y-3"
            >
                {historyLoadingMore ? <div className="text-center text-[11px] text-slate-400 py-1">Загрузка сообщений…</div> : null}
                {!historyLoadingMore && historyHasMore && actions.messages.length > 0 ? (
                    <button
                        type="button"
                        onClick={() => void loadOlderPersonalHistory()}
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
                        return (
                            <div key={`sys-${m.id}`} className="flex flex-col items-center my-4 w-full animate-fadeIn select-none pointer-events-none">
                                <span className="bg-slate-200/60 backdrop-blur-sm text-slate-500 text-[11px] font-medium px-4 py-1.5 rounded-full border border-slate-300/10 shadow-sm max-w-xs text-center min-w-0 [overflow-wrap:anywhere] break-all">{m.text}</span>
                                {m.time ? <span className="text-[10px] text-slate-400 mt-1.5 tabular-nums">{m.time}</span> : null}
                            </div>
                        );
                    }
                    const isMe = m.from === 'me';
                    const isSelected = actions.selectedParentIds.includes(m.id);
                    const isMsgDeleted = m.isDeleted === true;

                    return (
                        <div
                            key={m.id}
                            id={`msg-container-${m.id.toString().replace(/\s+/g, '')}`}
                            data-msg-id={m.id.toString().replace(/\s+/g, '')}
                            data-deleted={isMsgDeleted ? 'true' : undefined}
                            onClick={(e) => {
                                // Перехватываем клик строки строго тогда, когда включен режим чекбоксов
                                if (actions.isSelectionMode) {
                                    e.stopPropagation();
                                    if (isMsgDeleted) return;
                                    if (actions.isDeleteSelectionType && !isMe) return;
                                    actions.toggleSelectParentId(m.id);
                                }
                            }}
                            className={`flex items-end gap-3 group/msg min-w-0 ${isMe ? 'justify-end' : 'justify-start'} ${
                                actions.isSelectionMode ? (actions.isDeleteSelectionType && !isMe ? 'cursor-default' : 'cursor-pointer hover:bg-slate-100/40 rounded-xl px-2 transition-colors') : ''
                            } transition-all duration-500 pointer-events-none lg:pointer-events-auto`}
                        >
                        {/* КУБИК-ЧЕКБОКС */}
                            {actions.isSelectionMode && (
                                <div
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (actions.isDeleteSelectionType && !isMe) return;
                                        actions.toggleSelectParentId(m.id);
                                    }}
                                    className={`w-4 h-4 rounded border flex items-center justify-center transition-all shrink-0 mb-3 ${isMe ? 'order-3 cursor-pointer' : 'order-1'} ${
                                        actions.isDeleteSelectionType && !isMe ? 'border-slate-100 bg-slate-50 opacity-20 cursor-not-allowed' : (isSelected ? 'border-[#5C4B7A] bg-[#5C4B7A] text-white cursor-pointer' : 'border-slate-300 bg-white cursor-pointer')
                                    }`}
                                >
                                    {isSelected && !(actions.isDeleteSelectionType && !isMe) && <Check className="w-3 h-3 stroke-" />}
                                </div>
                            )}

                            <div className={`max-w-[min(28rem,100%)] min-w-0 overflow-x-clip relative rounded-2xl flex items-end gap-1 pointer-events-auto group/edit ${isMe ? 'order-1' : 'order-2'} ${actions.isSelectionMode && isMe && !isMsgDeleted ? 'bg-[#EDE6F5]/20 rounded-xl px-1' : ''} ${isMsgDeleted ? 'pointer-events-none' : ''}`}>
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
                                            ? 'bg-slate-100 text-slate-400 border-slate-200 rounded-2xl italic shadow-none'
                                            : (actions.highlightId && m.id && m.id.toString().trim().toLowerCase() === actions.highlightId.toString().trim().toLowerCase())
                                                ? 'brightness-90 scale-[0.99] border-slate-300/50 shadow-inner'
                                                : (isMe ? 'bg-[#5C4B7A] text-white border-[#5C4B7A]/30 rounded-br-md shadow-sm' : 'bg-white text-slate-900 border-slate-200 rounded-bl-md shadow-sm')
                                    }`}

                                >

                                    {!isMsgDeleted && !(m.bundledForwards && m.bundledForwards.length > 0) && m.reply_to && m.reply_to.length > 0 && (
                                        <div className="mb-1.5 space-y-1 block w-full relative z-30 pointer-events-auto">
                                            {m.reply_to.map((parent) => (
                                                <button
                                                    key={parent.id}
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation(); // Изолируем клик мыши от родительской строки множественного выбора

                                                        if (parent.id) {
                                                            const targetId = parent.id.toString().replace(/\s+/g, '');
                                                            console.log("[Personal-Chat] Нативный клик цитаты! Ищем ID:", targetId);

                                                            // Выполняем нативный скролл напрямую
                                                            const node = document.getElementById(`msg-container-${targetId}`) || document.querySelector(`[data-msg-id="${targetId}"]`);
                                                            if (node) {
                                                                node.scrollIntoView({ behavior: 'smooth', block: 'center' });

                                                                const bubbleEl = node.querySelector('.message-bubble');
                                                                if (bubbleEl) {
                                                                    bubbleEl.classList.add('brightness-90', 'scale-[0.99]');
                                                                    setTimeout(() => {
                                                                        bubbleEl.classList.remove('brightness-90', 'scale-[0.99]');
                                                                    }, 1000);
                                                                }
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
                                                    <div className="font-semibold text-[10px] opacity-90 pointer-events-none">{parent.author}</div>
                                                    {parent.text && !isForwardQuoteCaption(parent.text) ? (
                                                        <div className="truncate text-[11px] pointer-events-none">{formatSidebarMessage(parent.text)}</div>
                                                    ) : null}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {m.forwardedFrom && (
                                        <div className={`flex items-center gap-1.5 text-[10px] font-medium mb-1.5 pb-1 border-b border-white/10 select-none ${
                                            isMe ? 'text-[#EDE6F5] border-[#5C4B7A]/30' : 'text-slate-400 border-slate-100'
                                        }`}>
                                            <svg xmlns="http://w3.org" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="transform -scale-x-100">
                                                <polyline points="9 14 4 9 9 4"></polyline>
                                                <path d="M20 20v-7a4 4 0 0 0-4-4H4"></path>
                                            </svg>
                                            <span>
                                              Переслано от:{' '}
                                                                                        <span className="font-bold">
                                                {m.forwardedFrom.senderFirstName || m.forwardedFrom.senderLastName
                                                    ? `${m.forwardedFrom.senderFirstName || ''} ${m.forwardedFrom.senderLastName || ''}`.trim()
                                                    : `Пользователь #${m.forwardedFrom.id}`}
                                              </span>
                                            </span>
                                        </div>
                                    )}


                                    {(() => {
                                        if (isMsgDeleted) {
                                            return <div className="text-sm leading-relaxed whitespace-pre-wrap italic text-slate-400 min-w-0 [overflow-wrap:anywhere] break-all">Сообщение удалено</div>;
                                        }

                                        if (m.text && m.text.includes('[SHARE_POST:')) {
                                            return (
                                                <SharedPostCard
                                                    text={m.text}
                                                    coverUrl={m.photos?.[0]}
                                                    mine={isMe}
                                                />
                                            );
                                        }

                                        if (m.text && m.text.includes('[SHARE_EVENT:')) {
                                            return <SharedEventCard text={m.text} mine={isMe} />;
                                        }
                                        const bundled = Array.isArray(m.bundledForwards) && m.bundledForwards.length > 0 ? m.bundledForwards : null;
                                        if (bundled) {
                                            return (
                                                <>
                                                    <ChatForwardedPack forwards={bundled} mine={isMe} />
                                                    {m.text ? <ChatMessageText text={m.text} className="text-sm leading-relaxed whitespace-pre-wrap" mine={isMe} /> : null}
                                                </>
                                            );
                                        }
                                        return (
                                            <>
                                                <ChatVoiceBubble
                                                    url={m.voiceUrl}
                                                    duration={m.voiceDuration}
                                                    mine={isMe}
                                                    trackId={String(m.id)}
                                                    queue={voiceQueue}
                                                    title={isMe ? 'Вы' : `${m.senderFirstName || ''} ${m.senderLastName || ''}`.trim()}
                                                />
                                                <ChatPhotoGrid
                                                    photos={m.photos}
                                                    addedAt={m.timestamp}
                                                    messageReport={
                                                        m.from !== 'me' && Number(m.id) > 0 && Number(m.senderId) > 0
                                                            ? {
                                                                accusedId: Number(m.senderId),
                                                                accusedName: `${m.senderFirstName || ''} ${m.senderLastName || ''}`.trim() || undefined,
                                                                targetId: Number(m.id),
                                                            }
                                                            : undefined
                                                    }
                                                />
                                                <ChatFileBubble files={m.files} mine={isMe} />
                                                {m.text ? <ChatMessageText text={m.text} className="text-sm leading-relaxed whitespace-pre-wrap" mine={isMe} /> : null}
                                            </>
                                        );
                                    })()}

                                    <div className={`text-[10px] mt-1 flex items-center gap-1 justify-end ${isMe ? 'text-[#EDE6F5]' : 'text-slate-400'}`}>
                                        {m.edited && !isMsgDeleted && <span className="italic text-[9px] opacity-70">изменено</span>}
                                        <span>{m.time}</span>
                                        {isMe && !isMsgDeleted && (m.read ? <CheckCheck className="w-3 h-3 text-[#DDD4F0]" /> : <Check className="w-3 h-3" />)}
                                    </div>
                                </div>

                            {/* Карандашик в той же hover-зоне, что и баббл — без разрыва */}
                            {isMe && !actions.isSelectionMode && !isMsgDeleted && (
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
                        </div>
                    );
                })}
            </div>
            <ChatScrollDownButton show={actions.showScrollDown} onClick={actions.scrollToBottom} />
            </div>
            {/* ПАНЕЛЬ ОТВЕТА / МНОЖЕСТВЕННОГО ВЫБОРА */}
            {(actions.selectedParentIds.length > 0 || actions.replyTo.length > 0) && !actions.editingId && (
                <div className={`px-4 py-2 border-t ${theme.surface.border} bg-white flex items-center gap-2 shrink-0 animate-slideUp w-full`}>
                    {!actions.isSelectionMode && <CornerUpLeft className={`w-4 h-4 ${theme.accent.text} shrink-0`} />}
                    <div className="flex-1 min-w-0 border-l-2 border-[#5C4B7A] pl-2">
                        <div className={`text-[11px] font-semibold ${theme.accent.textStrong} truncate`}>
                            {actions.isSelectionMode ? (actions.isDeleteSelectionType ? `Выбрано ${actions.selectedParentIds.length} для удаления` : `Выбрано ${actions.selectedParentIds.length}`) : (actions.selectedParentIds.length > 1 ? `Ответ на ${actions.selectedParentIds.length} сообщения` : `Ответ на сообщение · ${actions.replyTo[0]?.author || 'Участник'}`)}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                            {actions.isSelectionMode ? formatSidebarMessage(actions.messages.find(x => x.id === actions.selectedParentIds[actions.selectedParentIds.length - 1])?.text || '') : (actions.replyTo && actions.replyTo[0] ? formatSidebarMessage(actions.replyTo[0].text) : '')}
                        </div>
                    </div>
                    {actions.isSelectionMode && actions.isDeleteSelectionType && (
                        <button onClick={actions.handleDeleteSelectedMessages} className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition shrink-0 whitespace-nowrap">
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Удалить</span>
                        </button>
                    )}
                    {actions.isSelectionMode && !actions.isDeleteSelectionType && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsForwardModalOpen(true);
                            }}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#5C4B7A] hover:bg-[#EDE6F5] rounded-lg transition shrink-0 whitespace-nowrap"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 9 15 15"></polyline><path d="M3 21v-7a4 4 0 0 1 4-4h14"></path></svg>
                            <span>Переслать</span>
                        </button>
                    )}
                    <button onClick={actions.resetSelectionMode} className="p-1 rounded-md text-slate-400 hover:bg-slate-100 transition shrink-0"><X className="w-3.5 h-3.5" /></button>
                </div>
            )}

            {/* ПАНЕЛЬ РЕДАКТИРОВАНИЯ */}
            {actions.editingId && (() => {
                const msg = actions.messages.find(el => el.id === actions.editingId);
                return (
                    <div className={`px-4 py-2 border-t ${theme.surface.border} bg-white flex items-center gap-3 shrink-0`}>
                        <div className="flex-1 min-w-0 border-l-2 border-[#5C4B7A] pl-2">
                            <div className={`text-[11px] font-semibold ${theme.accent.textStrong}`}>Редактирование</div>
                            <div className="text-xs text-slate-500 truncate">{msg?.text}</div>
                        </div>
                        <button onClick={() => { actions.setEditingId(null); actions.setDraft(''); }} className="p-1 rounded-md text-slate-400 hover:bg-slate-100 transition"><X className="w-3.5 h-3.5" /></button>
                    </div>
                );
            })()}

            {/* ПАНЕЛЬ ПРЕДВЫБОРУ ПЕРЕСЫЛКИ НАД ИНПУТОМ */}
            {actions.forwardBuffer.length > 0 && (
                <div className={`px-4 py-2 border-t ${theme.surface.border} bg-white flex items-center gap-3 shrink-0 animate-slideUp w-full`}>
                    <svg xmlns="http://w3.org" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-[#5C4B7A] transform -scale-x-100 shrink-0">
                        <polyline points="9 14 4 9 9 4"></polyline>
                        <path d="M20 20v-7a4 4 0 0 0-4-4H4"></path>
                    </svg>
                    <div className="flex-1 min-w-0 border-l-2 border-[#5C4B7A] pl-2">
                        <div className={`text-[11px] font-semibold ${theme.accent.textStrong}`}>
                            Пересылка сообщений ({actions.forwardBuffer.length})
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                            {actions.forwardBuffer.map(m => formatSidebarMessage(m.text, mediaHintFromMessage(m))).join(', ')}
                        </div>
                    </div>
                    <button onClick={actions.resetForwardBuffer} className="p-1 rounded-md text-slate-400 hover:bg-slate-100 transition shrink-0">
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            )}
            {/* НИЖНЯЯ ПАНЕЛЬ ВВОДА */}
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
                    <div className="relative flex-1 min-w-0">
                        {(() => {
                            const q = mentionQuery(actions.draft, actions.inputRef.current?.selectionStart || actions.draft.length);
                            if (q == null) return null;
                            if (!String(activePersonal.name || '').toLowerCase().includes(q.toLowerCase())) return null;
                            return (
                            <div className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-slate-200 rounded-xl shadow-lg z-30">
                                <button
                                    type="button"
                                    className="w-full text-left px-3 py-2 text-xs hover:bg-[#EDE6F5]"
                                    onClick={() => {
                                        const caret = actions.inputRef.current?.selectionStart || actions.draft.length;
                                        const next = insertMention(actions.draft, caret, Number(activePersonal.id), activePersonal.name);
                                        actions.setDraft(next.text);
                                    }}
                                >
                                    {activePersonal.name}
                                </button>
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

            {/* КАСТОМНОЕ КОНТЕКСТНОЕ МЕНЮ (СТРОГАЯ КОМПАКТНАЯ ШИРИНА И ФИКС ТЕКСТА) */}
            {actions.contextMenu && actions.contextMenuMsgId && (() => {
                const msg = actions.messages.find(m => String(m.id) === String(actions.contextMenuMsgId));
                const isMsgMe = msg?.from === 'me';
                return (
                    <div
                        style={{ top: actions.contextMenu.y, left: actions.contextMenu.x }}
                        className="fixed bg-white border border-slate-200 shadow-md rounded-xl py-1 w-[200px] max-w-[calc(100vw-16px)] md:w-[160px] md:max-w-[160px] max-h-[min(70dvh,320px)] overflow-y-auto z-50 animate-fadeIn"
                        data-message-menu
                    >
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (msg) {
                                    const ref: ReplyRef = { id: msg.id, author: msg.from === 'me' ? 'Вы' : `${msg.senderFirstName || 'Участник'} ${msg.senderLastName || ''}`.trim(), text: formatSidebarMessage(msg.text, mediaHintFromMessage(msg)) };
                                    actions.setReplyTo([ref]);
                                    actions.setSelectedParentIds([]);
                                    actions.setIsSelectionMode(false);
                                }
                                actions.setEditingId(null);
                                actions.setContextMenu(null);
                            }}
                            className="w-full text-left px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition truncate"
                        >
                            Ответить
                        </button>
                        {!msg?.isSystem && !msg?.isDeleted && (
                            <button
                                onClick={async (e) => {
                                    e.stopPropagation();
                                    actions.setContextMenu(null);
                                    try {
                                        const pinned = pins.some((p) => Number(p.messageId) === Number(msg?.id));
                                        const res = pinned
                                            ? await api.delete(`/api/v1/social/chats/personal/${activePersonal.id}/pins/${msg?.id}`)
                                            : await api.post(`/api/v1/social/chats/personal/${activePersonal.id}/pins/${msg?.id}`, null, { params: { firstName: user?.firstName || '', lastName: user?.lastName || '' } });
                                        setPins(res.data || []);
                                    } catch (err: any) {
                                        showAppInfoToast('Закрепление', err?.response?.data?.details || 'Не удалось закрепить');
                                    }
                                }}
                                className="w-full text-left px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition truncate"
                            >
                                {pins.some((p) => Number(p.messageId) === Number(msg?.id)) ? 'Открепить' : 'Закрепить'}
                            </button>
                        )}

                        {isMsgMe && !msg?.isDeleted && !msg?.isSystem && (
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
                        <button
                            onClick={(e) => { e.stopPropagation(); actions.setIsSelectionMode(true); actions.setIsDeleteSelectionType(false); actions.toggleSelectParentId(actions.contextMenuMsgId!); actions.setContextMenu(null); }}
                            className="w-full text-left px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition border-b border-slate-100/80 truncate"
                        >
                            Выбрать несколько
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                actions.setContextMenu(null);
                                setForwardSourceId(Number(actions.contextMenuMsgId)); // Стейт для запоминания ID сообщения
                                setIsForwardModalOpen(true); // Открываем модалку выборщика
                            }}
                            className="w-full text-left px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition truncate"
                        >
                            Переслать
                        </button>
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
                                        targetTitle: 'Сообщение',
                                        snapshotText: msg?.text || '',
                                    });
                                }}
                                className="w-full text-left px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition truncate"
                            >
                                Жалоба
                            </button>
                        )}
                        {isMsgMe && (
                            <>
                                <button
                                    type="button"
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); actions.setIsSelectionMode(true); actions.setIsDeleteSelectionType(true); actions.toggleSelectParentId(actions.contextMenuMsgId!); actions.setContextMenu(null); }}
                                    className="w-full text-left px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] transition border-b border-slate-100/80 truncate"
                                >
                                    Удалить несколько
                                </button>

                                <button
                                    type="button"
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); const id = String(actions.contextMenuMsgId || msg?.id || ''); actions.setContextMenu(null); if (id) void actions.handleDeleteMessage(id); }}
                                    className="w-full text-left px-3 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 transition truncate"
                                >
                                    Удалить сообщение
                                </button>
                            </>
                        )}
                    </div>
                );
            })()}

            <ForwardModal
                isOpen={isForwardModalOpen}
                onClose={() => setIsForwardModalOpen(false)}
                onSelectChats={handleForwardSubmit}
            />
            <ChatMaterialsGallery
                open={galleryOpen}
                onClose={() => setGalleryOpen(false)}
                source={{ type: 'personal', partnerId: activePersonal.id }}
                onGoToMessage={(messageId) => {
                    setGalleryOpen(false);
                    setTimeout(() => actions.jumpToMessage(messageId), 160);
                }}
            />

        </div>
    );

}