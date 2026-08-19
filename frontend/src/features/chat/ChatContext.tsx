import React, { createContext, useContext, useEffect, useState } from 'react';
import { Client } from '@stomp/stompjs';
import api from '@/shared/lib/api';
import { wsAuthUrl } from '@/shared/lib/runtime';
import { showAppInfoToast } from '@/shared/utils/appToast';
import { useAuth } from '@/shared/context/AuthContext';
import { fetchPresence, PRESENCE_INTERVAL_MS } from '@/shared/utils/presence';
import { isGroupChatNotificationLabel } from '@/shared/utils/navigation';
import { getViewingChat } from '@/shared/lib/viewingChat';
// ИМПОРТ ДЛЯ ПРОДАКШНА: Нативно подключаем модалку деталей в глобальный слой
import EventDetailsModal from '@/features/events/EventDetailsModal';
import CreateEventDrawer from '@/features/events/CreateEventDrawer';
function parseStompJson(raw: string): any | null {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

interface ChatRoom {
    id: number;
    eventId?: number | null;
    title: string;
    ownerId: number;
    createdAt: string;
    lastMessage?: string;
    time?: string;
    unread?: number;
    timestamp?: string;
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

export function isPersonalGroupRoom(room?: { roomType?: string; eventId?: number | null } | null): boolean {
    if (!room) return false;
    if (room.roomType === 'PERSONAL_GROUP') return true;
    if (room.roomType === 'EVENT') return false;
    return room.eventId == null;
}

interface Chat {
    id: string;
    name: string;
    avatar: string;
    last_message: string;
    time: string;
    unread: number;
    online: boolean;
    lastSeenAt?: string | null;
    isDeleted?: boolean;
    lastMessageId?: number;
    actualTimestamp?: string;
    muted?: boolean;
    pinned?: boolean;
    pinnedAt?: string | null;
}

interface ChatContextType {
    eventRooms: ChatRoom[];
    setEventRooms: React.Dispatch<React.SetStateAction<ChatRoom[]>>;
    personalGroups: ChatRoom[];
    setPersonalGroups: React.Dispatch<React.SetStateAction<ChatRoom[]>>;
    chats: Chat[];
    setChats: React.Dispatch<React.SetStateAction<Chat[]>>;
    chatsCount: number;
    setChatsCount: React.Dispatch<React.SetStateAction<number>>;
    stompClient: Client | null;
    refreshEventRooms: () => Promise<void>;
}

// ПРОДАКШН-ФИКС: Глобальная утилита очистки технических маркеров для сайдбара
export type SidebarMediaHint = {
    photos?: string[] | null;
    files?: Array<{ name?: string } | string> | null;
    voiceUrl?: string | null;
};

function asMediaHint(photosOrHint?: string[] | SidebarMediaHint | null): SidebarMediaHint {
    if (!photosOrHint) return {};
    if (Array.isArray(photosOrHint)) return { photos: photosOrHint };
    return photosOrHint;
}

export function mediaHintFromMessage(m: any): SidebarMediaHint {
    const media = resolveMessageMedia(m);
    return {
        photos: media.photos,
        files: media.files,
        voiceUrl: media.voiceUrl,
    };
}

export function resolveMessageMedia(m: any) {
    const bundled = Array.isArray(m?.bundledForwards) ? m.bundledForwards : [];
    const from = m?.forwardedFrom;
    const photos = (Array.isArray(m?.photos) && m.photos.length)
        ? m.photos
        : (Array.isArray(from?.photos) && from.photos.length)
            ? from.photos
            : bundled.flatMap((item: any) => item?.photos || []);
    const files = (Array.isArray(m?.files) && m.files.length)
        ? m.files
        : (Array.isArray(from?.files) && from.files.length)
            ? from.files
            : bundled.flatMap((item: any) => item?.files || []);
    const voiceSrc = m?.voiceUrl
        ? m
        : (from?.voiceUrl ? from : bundled.find((item: any) => item?.voiceUrl));
    return {
        photos,
        files,
        voiceUrl: voiceSrc?.voiceUrl,
        voiceDuration: voiceSrc?.voiceDuration,
    };
}

export const formatSidebarMessage = (
    text: string | null | undefined,
    photosOrHint?: string[] | SidebarMediaHint | null
): string => {
    const hint = asMediaHint(photosOrHint);
    const hasPhotos = Array.isArray(hint.photos) && hint.photos.length > 0;
    const files = Array.isArray(hint.files) ? hint.files : [];
    const hasVoice = Boolean(hint.voiceUrl);
    if (!text || !String(text).trim()) {
        if (hasVoice) return 'Голосовое сообщение';
        if (files.length > 1) return `Файл (${files.length})`;
        if (files.length === 1) {
            const first = files[0];
            const name = typeof first === 'string' ? first : first?.name;
            return name || 'Файл';
        }
        if (hasPhotos) return hint.photos!.length > 1 ? `Фото (${hint.photos!.length})` : 'Фото';
        return 'Пересланное сообщение';
    }
    if (text.includes("[SHARE_POST:")) {
        const lines = text.split('\n');
        const userComment = lines.length > 1 ? lines.slice(1).join('\n').trim() : '';
        if (userComment) return userComment;
        return "Поделился постом";
    }
    if (text.startsWith("Голосование:")) {
        return text;
    }
    if (text.includes("[SHARE_EVENT:")) {
        const lines = text.split('\n');
        const userComment = lines.length > 1 ? lines.slice(1).join('\n').trim() : '';
        if (userComment) return userComment;
        const titleMatch = text.match(/Приглашаю на встречу:\s*["']?([^"']+)["']?/);
        return titleMatch ? `Событие: ${titleMatch[1]}` : "Поделился встречей";
    }
    if (text.trim() === '[TYPING]') {
        return '';
    }
    if (text.trim() === "" || text === "[FORWARDED_MESSAGES]") {
        return "Пересланные сообщения";
    }
    return String(text).replace(/\[(KICKED|LEFT|JOINED|AVATAR)_ID:\d+\]/g, '').replace(/\[MENTION:\d+\]/g, '').trim();
};

export function isForwardQuoteCaption(text?: string | null): boolean {
    const t = String(text || '').trim();
    if (!t) return true;
    return t === 'Голосовое сообщение'
        || t === 'Фото'
        || /^Фото \(\d+\)$/.test(t)
        || t === 'Файл'
        || /^Файл \(\d+\)$/.test(t)
        || t === 'Пересланное сообщение'
        || t === 'Пересланные сообщения';
}

export function mapBundledForwardQuotes(forwards: any[] | null | undefined) {
    if (!Array.isArray(forwards) || forwards.length === 0) return undefined;
    return forwards.map((fw: any) => {
        const hint = mediaHintFromMessage(fw);
        const raw = String(fw.content || fw.text || '').trim();
        const hasMedia = Boolean(hint.voiceUrl)
            || (Array.isArray(hint.photos) && hint.photos.length > 0)
            || (Array.isArray(hint.files) && hint.files.length > 0);
        return {
            id: String(fw?.id ?? ''),
            author: (fw.senderFirstName || fw.senderLastName)
                ? `${fw.senderFirstName || ''} ${fw.senderLastName || ''}`.trim()
                : `Пользователь #${fw.senderId}`,
            text: raw && raw !== '[FORWARDED_MESSAGES]'
                ? formatSidebarMessage(raw, hint)
                : (hasMedia ? '' : formatSidebarMessage(raw, hint)),
        };
    });
}
export const parseSidebarTime = (dateInput: any, backupTimeStr?: string): string => {
    if (!dateInput) {
        return backupTimeStr && backupTimeStr.includes(':') ? backupTimeStr : '';
    }
    try {
        let date: Date;
        // 1. Если бэкенд передал дату в виде массива чисел [ГГГГ, ММ, ДД, ЧЧ, ММ]
        if (Array.isArray(dateInput) && dateInput.length >= 5) {
            date = new Date(
                dateInput[0],
                dateInput[1] - 1, // Месяцы в JS идут от 0 до 11
                dateInput[2],
                dateInput[3],
                dateInput[4]
            );
        } else {
            // 2. Если пришла стандартная ISO строка или Long-таймстамп
            date = new Date(dateInput);
        }
        if (isNaN(date.getTime())) {
            return backupTimeStr && backupTimeStr.includes(':') ? backupTimeStr : '';
        }
        const now = new Date();
        // Сбрасываем часы для точного сравнения календарных дней (Сегодня / Вчера)
        const todayZero = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const eventZero = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const diffTime = todayZero.getTime() - eventZero.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
        // Извлекаем время ЧЧ:ММ
        const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        const finalTime = timeStr && !timeStr.includes('Invalid') ? timeStr : (backupTimeStr || '');
        // Сценарий А: Сегодня
        if (diffDays === 0) return finalTime;
        // Сценарий Б: Вчера
        if (diffDays === 1) return `Вчера, ${finalTime}`;
        // Сценарий В: Более суток назад (День.Месяц.Год, Время)
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}.${month}.${year}, ${finalTime}`;
    } catch (e) {
        return backupTimeStr && backupTimeStr.includes(':') ? backupTimeStr : '';
    }
};

const getSafeTime = (dateInput: any, backupTimeStr?: string): number => {
    if (!dateInput) {
        if (backupTimeStr && backupTimeStr.includes(':')) {
            const [hours, minutes] = backupTimeStr.split(':').map(Number);
            const today = new Date();
            today.setHours(hours, minutes, 0, 0);
            return today.getTime();
        }
        return 0;
    }

    if (Array.isArray(dateInput) && dateInput.length >= 5) {
        return new Date(
            dateInput[0],
            dateInput[1] - 1,
            dateInput[2],
            dateInput[3],
            dateInput[4]
        ).getTime();
    }

    const parsed = new Date(dateInput).getTime();
    return isNaN(parsed) ? 0 : parsed;
};


const ChatContext = createContext<ChatContextType | undefined>(undefined);
export function ChatProvider({ children }: { children: React.ReactNode }) {
    const { user: currentUser } = useAuth();
    const [eventRooms, setEventRooms] = useState<ChatRoom[]>([]);
    const [personalGroups, setPersonalGroups] = useState<ChatRoom[]>([]);
    const [chats, setChats] = useState<Chat[]>([]);
    const [chatsCount, setChatsCount] = useState(0);
    const [stompClient, setStompClient] = useState<Client | null>(null);
    const [chatWsConnected, setChatWsConnected] = useState(false);
    // ГЛОБАЛЬНЫЙ СТЕЙТ: Хранит данные для отображения карточки из любого окна приложения
    const [sharedEventData, setSharedEventData] = useState<any | null>(null);
    const [editingSharedEvent, setEditingSharedEvent] = useState<any | null>(null);

    // Вспомогательная функция для обработки действий участников внутри глобальной модалки
    const handleGlobalParticipantAction = async (event: any, action: 'JOIN' | 'APPLY' | 'LEAVE') => {
        try {
            let endpoint = `/api/v1/social/events/${event.id}/participants/leave`;
            if (action === 'JOIN') endpoint = `/api/v1/social/events/${event.id}/participants/join`;
            if (action === 'APPLY') endpoint = `/api/v1/social/events/${event.id}/participants/apply`;
            const response = await api.post(endpoint);
            const nextStatus = (action === 'JOIN' ? 'JOINED' : action === 'APPLY' ? 'PENDING' : 'NONE').toUpperCase();
            setSharedEventData({
                ...event,
                ...(response.data || {}),
                userStatus: nextStatus,
                user_status: nextStatus,
            });
            if (action === 'LEAVE') {
                window.dispatchEvent(new CustomEvent('refreshNeighborStatuses'));
            }
            if (action === 'APPLY') {
                const wasRejected = String(event.userStatus || event.user_status || '').toUpperCase() === 'REJECTED';
                const title = event.title || 'встречу';
                showAppInfoToast(
                    wasRejected ? 'Повторная заявка' : 'Заявка отправлена',
                    wasRejected
                        ? `Повторная заявка на «${title}» отправлена организатору`
                        : `Заявка на приватную встречу «${title}» отправлена организатору`
                );
            }
        } catch (error) {
            console.error(`Ошибка действия ${action} в глобальном контексте:`, error);
        }
    };

    // СЛУШАТЕЛЯ СОБЫТИЙ: Ловит сигналы клика из чатов, качает данные с Spring Boot и открывает окно
    useEffect(() => {
        const handleOpenSharedModal = async (e: Event) => {
            const customEvent = e as CustomEvent;
            const { eventId } = customEvent.detail;
            if (!eventId || isNaN(Number(eventId))) return;
            try {
                // X-User-Id выставляет gateway из JWT
                const [eventRes, statusesRes] = await Promise.all([
                    api.get(`/api/v1/social/events/${Number(eventId)}`),
                    currentUser?.id
                        ? api.get('/api/v1/social/events/anyEventId/participants/statuses').catch(() => ({ data: {} }))
                        : Promise.resolve({ data: {} })
                ]);
                if (eventRes.data) {
                    const rawEvent = eventRes.data;
                    const userStatusesMap = statusesRes.data || {};
                    const isPastComputed = rawEvent.eventDate ? new Date(rawEvent.eventDate).getTime() < Date.now() : false;
                    const serverStatus = userStatusesMap[String(rawEvent.id)] || userStatusesMap[Number(rawEvent.id)];
                    const finalStatus = serverStatus ? serverStatus.toUpperCase() : 'NOT_PARTICIPATING';
                    const enrichedEvent = { ...rawEvent, isPast: isPastComputed, userStatus: finalStatus };
                    setSharedEventData(enrichedEvent);
                }
            } catch (err) {
                console.error("Глобальный контекст не смог стянуть данные встречи:", err);
            }
        };
        window.addEventListener('openSharedEventModal', handleOpenSharedModal);
        return () => { window.removeEventListener('openSharedEventModal', handleOpenSharedModal); };
    }, [currentUser?.id]);

    const refreshEventRooms = async () => {
        if (!localStorage.getItem('token')) return;
        try {
            const roomsRes = await api.get('/api/v1/social/chats/rooms');
            const rawRooms = roomsRes.data || [];
            const cleanedRooms = rawRooms.map((room: any) => {
                if (!room) return room;
                return {
                    ...room,
                    lastMessage: formatSidebarMessage(room.lastMessage),
                    time: parseSidebarTime(room.createdAt, room.time)
                };
            });

            setEventRooms(cleanedRooms.filter((room: any) => !isPersonalGroupRoom(room)));
            setPersonalGroups(cleanedRooms.filter((room: any) => isPersonalGroupRoom(room)));
        } catch (e) { console.error("Ошибка принудительного обновления комнат:", e); }
    };
    useEffect(() => {
        const unreadPersonal = (chats || []).filter((c) => c && (c.unread || 0) > 0).length;
        const unreadGroups = [...(eventRooms || []), ...(personalGroups || [])]
            .filter((r) => r && (r.unread || 0) > 0).length;
        setChatsCount(unreadPersonal + unreadGroups);
    }, [eventRooms, personalGroups, chats]);

    useEffect(() => {
        if (!localStorage.getItem('token')) {
            setEventRooms([]);
            setPersonalGroups([]);
            setChats([]);
            setChatsCount(0);
            return;
        }
        const loadData = async () => {
            await refreshEventRooms();
            try {
                const personalRes = await api.get('/api/v1/social/chats/users');
                const rawPersonal = personalRes.data || [];
                const cleanedPersonal = rawPersonal.map((c: any) => {
                    if (!c) return c;
                    return {
                        ...c,
                        last_message: formatSidebarMessage(c.last_message),
                        time: parseSidebarTime(c.actualTimestamp, c.time),
                        actualTimestamp: c.actualTimestamp
                    };
                });

                cleanedPersonal.sort((a: any, b: any) => {
                    const timeA = getSafeTime(a.actualTimestamp);
                    const timeB = getSafeTime(b.actualTimestamp);
                    return timeB - timeA;
                });

                setChats(cleanedPersonal);
            } catch (e) { console.error("Ошибка загрузки личных чатов:", e); }
        };
        loadData();
    }, [currentUser?.id]);

    useEffect(() => {
        if (!localStorage.getItem('token') || !currentUser?.id) {
            if (stompClient) { stompClient.deactivate(); setStompClient(null); }
            setChatWsConnected(false);
            return;
        }
        const client = new Client({
            brokerURL: wsAuthUrl('/ws/chat'),
            reconnectDelay: 5000,
            heartbeatIncoming: 4000,
            heartbeatOutgoing: 4000,
            debug: () => {},
        });
        client.beforeConnect = () => {
            client.brokerURL = wsAuthUrl('/ws/chat');
        };
        client.onConnect = () => {
            setChatWsConnected(true);
            client.subscribe('/user/queue/messages', (message: any) => {
                const body = parseStompJson(message.body);
                if (!body) return;

                if (body.content === '[TYPING]') {
                    if (Number(body.senderId) !== Number(currentUser?.id)) {
                        window.dispatchEvent(new CustomEvent('chatTyping', { detail: body }));
                    }
                    return;
                }

                // Новый участник группового чата — подтягиваем комнаты live
                if (body.content === '[GROUP_CHAT_JOINED]') {
                    void refreshEventRooms();
                    return;
                }

                if (body.content === '[ROOM_DELETED]' || body.roomDeleted === true) {
                    setEventRooms((prevRooms) => (prevRooms || []).filter(r => r && r.id !== body.chatId));
                    setPersonalGroups((prevRooms) => (prevRooms || []).filter(r => r && r.id !== body.chatId));
                    window.dispatchEvent(new CustomEvent('groupChatRoomDeleted', { detail: { chatId: body.chatId } }));
                    return;
                }

                // 1. Вычисляем универсальный ID собеседника для текущего сообщения/сигнала
                const partnerId = Number(body.senderId) === Number(currentUser?.id)
                    ? body.recipientId?.toString()
                    : body.senderId?.toString();

                if (!partnerId) return;

                // 2. ТОЧЕЧНЫЙ ВЕБСОКЕТ-ФИКС: Перехватываем сигнал полного удаления чата из списков
                if (body.content === "[CHAT_DELETED]") {
                    setChats((prevChats: Chat[]) => (prevChats || []).filter((c) => c && c.id !== partnerId));
                    window.dispatchEvent(new CustomEvent("instantPersonalChatDelete", { detail: { partnerId } }));
                    return;
                }

                // 3. ТОЧЕЧНЫЙ ВЕБСОКЕТ-ФИКС: Перехватываем сигнал мягкой очистки истории переписки
                if (body.content === "[CLEAR_CHAT]") {
                    setChats((prevChats: Chat[]) => (prevChats || []).map((c) =>
                        c && c.id === partnerId
                            ? {
                                ...c,
                                last_message: "Переписка создана",
                                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            }
                            : c
                    ));
                    window.dispatchEvent(new CustomEvent("instantPersonalChatClear", { detail: { partnerId } }));
                    return;
                }

                // 4. Ваша стандартная проверка прочтения, которая идет дальше по коду:
                if (body.content === '[MESSAGES_READ]') return;
                setChats((prevChats) => {
                    const chatsList = prevChats || [];
                    const isChatExists = chatsList.some((c) => c && c.id === partnerId);
                    const messageIsDeleted = body.deleted === true || body.isDeleted === true || body.msgDeleted === true;
                    if (!isChatExists) {
                        const newChatCard = {
                            id: partnerId,
                            name: `${body.senderFirstName || 'Пользователь'} ${body.senderLastName || ''}`.trim(),
                            avatar: Number(body.senderId) === Number(currentUser?.id) ? '' : (body.senderAvatarUrl || ''),
                            last_message: messageIsDeleted ? 'Сообщение удалено' : (body.content === '[CHAT_CREATED]' ? 'Переписка создана' : formatSidebarMessage(body.content, mediaHintFromMessage(body))),
                            time: parseSidebarTime(body.timestamp),
                            unread: Number(body.senderId) === Number(currentUser?.id) ? 0 : 1,
                            online: false,
                            isDeleted: messageIsDeleted
                        };
                        return [newChatCard, ...chatsList];
                    }
                    let targetChat = chatsList.find(c => c && c.id === partnerId);
                    if (!targetChat) return chatsList;
                    const isFromMe = Number(body.senderId) === Number(currentUser?.id);
                    const isEditAction = body.edited === true;
                    const viewing = getViewingChat();
                    const isChatWindowOpen = viewing?.kind === 'personal' && viewing.id === String(partnerId);
                    const shouldIncrement = !isFromMe && !messageIsDeleted && !isEditAction && !isChatWindowOpen;
                    let targetLastMessage = targetChat.last_message;
                    let targetLastMessageId = targetChat.lastMessageId;
                    if (messageIsDeleted) { if (targetChat.lastMessageId && Number(targetChat.lastMessageId) === Number(body.id)) { targetLastMessage = 'Сообщение удалено'; } }
                    else if (isEditAction) { if (targetChat.lastMessageId && Number(targetChat.lastMessageId) === Number(body.id)) { targetLastMessage = formatSidebarMessage(body.content, mediaHintFromMessage(body)); } }
                    else { targetLastMessage = body.content === '[CHAT_CREATED]' ? 'Переписка создана' : formatSidebarMessage(body.content, mediaHintFromMessage(body)); targetLastMessageId = Number(body.id); }
                    const updatedChat = { ...targetChat, last_message: targetLastMessage, lastMessageId: targetLastMessageId, time: isEditAction || messageIsDeleted ? targetChat.time : parseSidebarTime(body.timestamp), unread: shouldIncrement ? (targetChat.unread || 0) + 1 : (targetChat.unread || 0), isDeleted: messageIsDeleted && targetLastMessage === 'Сообщение удалено' };
                    const remainingChats = chatsList.filter(c => c && c.id !== partnerId);
                    const currentUpdatedChat = {
                        ...updatedChat,
                        actualTimestamp: body.timestamp || new Date().toISOString()
                    };

                    return [currentUpdatedChat, ...remainingChats].sort((a: any, b: any) => {
                        const timeA = new Date(a.actualTimestamp || 0).getTime();
                        const timeB = new Date(b.actualTimestamp || 0).getTime();
                        return timeB - timeA;
                    });
                });
            });
        };
        client.onDisconnect = () => setChatWsConnected(false);
        client.onWebSocketClose = () => setChatWsConnected(false);
        client.onStompError = (frame) => {
            console.error('[Chat WS] STOMP error', frame.headers['message'], frame.body);
            setChatWsConnected(false);
        };
        client.activate();
        setStompClient(client);
        return () => { setChatWsConnected(false); client.deactivate(); };
    }, [currentUser?.id]);

    const roomIdsKey = [...(eventRooms || []), ...(personalGroups || [])].map(r => r?.id).filter(Boolean).sort((a: any, b: any) => a - b).join(',');

    // Подписки на топики групповых комнат (только свои чаты)
    useEffect(() => {
        if (!stompClient || !chatWsConnected || !stompClient.connected || !stompClient.active || !roomIdsKey) return;

        const handleGroupMessage = (message: any) => {
            const body = parseStompJson(message.body);
            if (!body) return;
            if (body.content === '[TYPING]') return;
            if (body.content === '[ROOM_DELETED]' || body.roomDeleted === true) {
                setEventRooms((prevRooms) => (prevRooms || []).filter(r => r && r.id !== body.chatId));
                setPersonalGroups((prevRooms) => (prevRooms || []).filter(r => r && r.id !== body.chatId));
                window.dispatchEvent(new CustomEvent('groupChatRoomDeleted', { detail: { chatId: body.chatId } }));
                return;
            }
            if (body.content === "Встреча отменена, чат будет удален") {
                setEventRooms((prevRooms) =>
                    (prevRooms || []).map(r => r && r.id === body.chatId ? { ...r, isCanceled: true } : r)
                );
            }
            if (body.content && body.content.startsWith("[GROUP_CHAT_HISTORY_CLEARED:")) {
                return;
            }
            if (body.content && /покинул/i.test(body.content)) {
                const myFullName = `${currentUser?.firstName} ${currentUser?.lastName}`.trim();
                const systemMessageText = body.content.trim();
                if (systemMessageText.startsWith(myFullName) || systemMessageText.includes(currentUser?.firstName || '')) {
                    setEventRooms((prevRooms) => (prevRooms || []).filter(room => room && room.id !== body.chatId));
                    setPersonalGroups((prevRooms) => (prevRooms || []).filter(room => room && room.id !== body.chatId));
                    return;
                }
            }
            if (body.isNewRoom) return;
            const isMessageFromMe = body.senderId && currentUser?.id && (Number(body.senderId) === Number(currentUser.id));
            const media = resolveMessageMedia(body);
            const hasPhotos = Array.isArray(media.photos) && media.photos.length > 0;
            const hasFiles = Array.isArray(media.files) && media.files.length > 0;
            const hasVoice = Boolean(media.voiceUrl);
            const messageIsDeleted = body.deleted === true || body.isDeleted === true || body.msgDeleted === true;
            const isTechnicalDeleteAction = body.content === '[DELETED]' || body.isDeleteAction || (!body.content && !hasPhotos && !hasFiles && !hasVoice);
            if (isTechnicalDeleteAction) { setTimeout(() => { refreshEventRooms(); }, 50); }
            let foundRoom = false;
            const applyLastMessage = (prevRooms: ChatRoom[]) => {
                const roomsList = prevRooms || [];
                const targetRoom = roomsList.find(r => r && r.id === body.chatId);
                if (!targetRoom) return roomsList;
                foundRoom = true;
                const isEditAction = body.edited === true;
                const isPollUpdate = body.pollUpdate === true;
                const rawLastMessage = messageIsDeleted
                    ? 'Сообщение удалено'
                    : isTechnicalDeleteAction
                    ? (targetRoom.lastMessage || 'Групповой чат')
                    : (isEditAction || isPollUpdate)
                        ? (targetRoom.lastMessage === body.oldContent ? body.content : targetRoom.lastMessage)
                        : (body.poll?.question ? `Голосование: ${body.poll.question}` : body.content);
                const finalLastMessage = formatSidebarMessage(rawLastMessage, mediaHintFromMessage({ ...body, ...media }));
                const finalTime = isTechnicalDeleteAction || isPollUpdate ? targetRoom.time : parseSidebarTime(body.timestamp);
                const viewing = getViewingChat();
                const isGroupOpen = viewing?.kind === 'group' && viewing.id === String(body.chatId);
                const finalUnread = (isMessageFromMe || isTechnicalDeleteAction || messageIsDeleted || isEditAction || isPollUpdate || isGroupOpen)
                    ? (targetRoom.unread || 0)
                    : ((targetRoom.unread || 0) + 1);
                const rawContent = String(body.content || '');
                let nextAvatarUrl = targetRoom.avatarUrl;
                if (/аватарк/i.test(rawContent) || /\[AVATAR_ID:/.test(rawContent)) {
                    if (Array.isArray(body.photos) && body.photos[0]) {
                        nextAvatarUrl = body.photos[0];
                    } else if (/убрал/i.test(rawContent)) {
                        nextAvatarUrl = null;
                    }
                }
                const updatedRoom = {
                    ...targetRoom,
                    lastMessage: finalLastMessage || targetRoom.lastMessage,
                    time: isEditAction || isPollUpdate ? targetRoom.time : finalTime,
                    unread: finalUnread,
                    avatarUrl: nextAvatarUrl,
                };
                const remainingRooms = roomsList.filter(r => r && r.id !== body.chatId);
                return [updatedRoom, ...remainingRooms];
            };
            setEventRooms((prev) => applyLastMessage(prev || []));
            setPersonalGroups((prev) => applyLastMessage(prev || []));
            if (!foundRoom && !isTechnicalDeleteAction) {
                setTimeout(() => { refreshEventRooms(); }, 350);
            }
        };

        const ids = roomIdsKey.split(',').filter(Boolean);
        const subs: { unsubscribe: () => void }[] = [];
        try {
            ids.forEach((id) => {
                subs.push(stompClient.subscribe(`/topic/chat.${id}`, handleGroupMessage));
            });
        } catch (err) {
            console.warn('[Chat WS] subscribe skipped:', err);
            subs.forEach((s) => {
                try { s.unsubscribe(); } catch { /* ignore */ }
            });
            setChatWsConnected(false);
            return;
        }

        return () => {
            subs.forEach((s) => {
                try { s.unsubscribe(); } catch { /* ignore */ }
            });
        };
    }, [stompClient, chatWsConnected, roomIdsKey, currentUser?.id]);

    // Надёжный live-счётчик «Чаты» из notification WS (даже если chat WS отстал)
    useEffect(() => {
        const refreshPersonalChats = async () => {
            try {
                const personalRes = await api.get('/api/v1/social/chats/users');
                const rawPersonal = personalRes.data || [];
                const cleanedPersonal = rawPersonal.map((c: any) => {
                    if (!c) return c;
                    return {
                        ...c,
                        last_message: formatSidebarMessage(c.last_message),
                        time: parseSidebarTime(c.actualTimestamp, c.time),
                        actualTimestamp: c.actualTimestamp
                    };
                });
                cleanedPersonal.sort((a: any, b: any) => getSafeTime(b.actualTimestamp) - getSafeTime(a.actualTimestamp));
                setChats(cleanedPersonal);
            } catch (e) {
                console.error('Ошибка обновления личных чатов:', e);
            }
        };

        const onLiveChatNotify = (e: Event) => {
            const body = (e as CustomEvent).detail;
            if (!body || body.type !== 'NEW_CHAT_MESSAGE') return;

            const label = String(body.contextLabel || '');
            const isGroup = isGroupChatNotificationLabel(label);
            const viewing = getViewingChat();

            if (isGroup) {
                if (viewing?.kind === 'group' && viewing.id === String(body.targetId)) return;
                void refreshEventRooms();
            } else {
                if (viewing?.kind === 'personal' && viewing.id === String(body.senderId)) return;
                void refreshPersonalChats();
            }
        };

        window.addEventListener('liveChatMessageNotify', onLiveChatNotify as EventListener);
        return () => window.removeEventListener('liveChatMessageNotify', onLiveChatNotify as EventListener);
    }, [currentUser?.id]);

    // Глобально (даже вне страницы Чаты): join/kick → обновить комнаты и бейдж
    useEffect(() => {
        const onRoomsRefresh = () => { void refreshEventRooms(); };
        window.addEventListener('refreshChatRoomsList', onRoomsRefresh);
        return () => window.removeEventListener('refreshChatRoomsList', onRoomsRefresh);
    }, [currentUser?.id]);

    const chatPartnerIdsKey = (chats || []).map((c) => c?.id).filter(Boolean).join(',');

    useEffect(() => {
        if (!currentUser?.id || !chatPartnerIdsKey) return;
        let cancelled = false;
        const ids = chatPartnerIdsKey.split(',').filter(Boolean);
        const tick = async () => {
            try {
                const map = await fetchPresence(ids);
                if (cancelled) return;
                setChats((prev) => (prev || []).map((c) => {
                    if (!c) return c;
                    const info = map[String(c.id)];
                    return {
                        ...c,
                        online: info?.online ?? false,
                        lastSeenAt: info?.lastSeenAt ?? null,
                    };
                }));
            } catch {
                // статус подтянется на следующем тике
            }
        };
        tick();
        const intervalId = window.setInterval(tick, PRESENCE_INTERVAL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [currentUser?.id, chatPartnerIdsKey]);

    return (
        <ChatContext.Provider value={{ eventRooms, setEventRooms, personalGroups, setPersonalGroups, chats, setChats, chatsCount, setChatsCount, stompClient, refreshEventRooms }}>
            {children}
            {sharedEventData && (
                <EventDetailsModal
                    event={sharedEventData}
                    onClose={() => setSharedEventData(null)}
                    onJoin={(ev) => handleGlobalParticipantAction(ev, 'JOIN')}
                    onApply={(ev) => handleGlobalParticipantAction(ev, 'APPLY')}
                    onLeave={(id) => handleGlobalParticipantAction(sharedEventData || { id }, 'LEAVE')}
                    onCancelEvent={() => setSharedEventData(null)}
                    onEditEvent={(ev) => {
                        setSharedEventData(null);
                        setEditingSharedEvent(ev);
                    }}
                />
            )}
            <CreateEventDrawer
                open={!!editingSharedEvent}
                mode="edit"
                initialDraft={editingSharedEvent}
                onClose={() => setEditingSharedEvent(null)}
                onSuccess={() => setEditingSharedEvent(null)}
            />
        </ChatContext.Provider>
    );
}

export function useChat() {
    const context = useContext(ChatContext);
    if (!context) throw new Error('useChat must be used within a ChatProvider');
    return context;
}
