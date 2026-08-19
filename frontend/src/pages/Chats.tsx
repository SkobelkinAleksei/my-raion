import React, { useEffect, useRef, useState } from 'react';
import api from '@/shared/lib/api';
import { theme } from '@/shared/ui/theme';
import { useChat, formatSidebarMessage, isPersonalGroupRoom } from '@/features/chat/ChatContext';
import { useAuth } from '@/shared/context/AuthContext';
import {
  Search,
  X,
  MessageCircle,
  Users,
  ChevronRight,
  UserPlus,
  Pin,
  BellOff,
  Bell,
} from 'lucide-react';
// Подключаем наши изолированные секции правого окна
import GroupChatSection from '@/features/chat/GroupChatSection';
import PersonalChatSection from '@/features/chat/PersonalChatSection';
import CreatePersonalGroupModal from '@/features/chat/CreatePersonalGroupModal';
import ChatListSwipeRow from '@/features/chat/ChatListSwipeRow';
import ChatVoiceMiniBar from '@/features/chat/ChatVoiceMiniBar';
import { getAvatarUrl, persistOpenChat, clearPersistedOpenChat, readPersistedOpenChat, scheduleClearPersistedOpenChatIfVisible, cancelScheduledClearPersistedOpenChat, persistChatsSidebarTab, readPersistedChatsSidebarTab, NAV_EVENT_OPEN_CHAT, NAV_EVENT_RELOAD_CHAT_HISTORY, readHistoryState, isCompactViewport } from '@/shared/utils/navigation';
import { useAppBackHandler } from '@/shared/hooks/useAppBackHandler';
import { readChatDraft, subscribeChatDrafts } from '@/features/chat/chatDrafts';
import { showAppInfoToast } from '@/shared/utils/appToast';
import { clearViewingChat, setViewingChat } from '@/shared/lib/viewingChat';
import { useMobileChatViewport } from '@/features/chat/useMobileChatViewport';

interface Chat {
  id: string;
  name: string;
  avatar: string;
  last_message: string;
  time: string;
  unread: number;
  muted?: boolean;
  pinned?: boolean;
  pinnedAt?: string | null;
  online: boolean;
  isDeleted?: boolean;
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

type SidebarTab = 'personal' | 'events';

export default function Chats({ pageActive = true }: { pageActive?: boolean }) {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>(() => readPersistedChatsSidebarTab() ?? 'personal');
  const { user } = useAuth();
  const { eventRooms, chats, setChats, setEventRooms, personalGroups, setPersonalGroups, refreshEventRooms } = useChat();
  const [active, setActive] = useState<Chat | null>(null);
  const [activeRoom, setActiveRoom] = useState<ChatRoom | null>(null);
  const pageActiveRef = useRef(pageActive);
  pageActiveRef.current = pageActive;
  const [query, setQuery] = useState('');
  const [chatToDelete, setChatToDelete] = useState<Chat | null>(null);
  const [deleteCompletely, setDeleteCompletely] = useState(false);
  const [roomToDelete, setRoomToDelete] = useState<any | null>(null);
  const [leaveCompletely, setLeaveCompletely] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [draftTick, setDraftTick] = useState(0);

  const chatIsOpen = Boolean(active || activeRoom);

  useEffect(() => {
    if (!pageActive) {
      clearViewingChat();
      return;
    }
    if (active) setViewingChat('personal', active.id);
    else if (activeRoom) setViewingChat('group', activeRoom.id);
    else clearViewingChat();
    return () => clearViewingChat();
  }, [pageActive, active, activeRoom]);

  useAppBackHandler(chatIsOpen, () => {
    setActive(null);
    setActiveRoom(null);
    clearPersistedOpenChat();
  });

  useEffect(() => {
    if (!chatIsOpen || !isCompactViewport()) return;

    if (!readHistoryState().chatOpen) {
      window.history.pushState({ ...readHistoryState(), chatOpen: true }, '', window.location.href);
    }

    let armed = false;
    const arm = window.setTimeout(() => {
      armed = true;
    }, 0);

    const onPop = () => {
      if (!armed) return;
      setActive(null);
      setActiveRoom(null);
      clearPersistedOpenChat();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.clearTimeout(arm);
      window.removeEventListener('popstate', onPop);
      if (readHistoryState().chatOpen) {
        window.history.back();
      }
    };
  }, [chatIsOpen]);

  useEffect(() => subscribeChatDrafts(() => setDraftTick((n) => n + 1)), []);

  useEffect(() => {
    persistChatsSidebarTab(sidebarTab);
  }, [sidebarTab]);

  // Продакшн-фикс: Незаметная зачистка чата отмененного события на бэкенде и фронтенде при выходе из него
  const checkAndClearCanceledRoom = async (roomToClear: ChatRoom | null) => {
    if (!roomToClear) return;

    // Железно проверяем текст отмены прямо в объекте комнаты
    if (roomToClear.lastMessage === "Встреча отменена, чат будет удален") {
      try {
        // 1. Мгновенно (синхронно) стираем карточку из сайдбара на экране, чтобы пользователь сразу увидел результат
        if (setEventRooms) {
          setEventRooms(prev => (prev || []).filter(r => r && r.id !== roomToClear.id));
        }

        // 2. Параллельно отправляем тихий запрос на бэкенд для отмены регистрации в БД
        // Событие уже отменено — только выход из чата (без event leave)
        await api.delete(`/api/v1/social/chats/room/${roomToClear.eventId}?isLeave=true&firstName=${user?.firstName || ''}&lastName=${user?.lastName || ''}`);

      } catch (err) {
        console.error("Ошибка при автоудалении отмененного чата:", err);
      }
    }
  };


  // Переключение комнат
  const handleOpenPersonal = async (c: Chat) => {
    await checkAndClearCanceledRoom(activeRoom);
    setActiveRoom(null);
    setActive(c);
    persistOpenChat('personal', c.id);
  };

  const handleOpenEvent = async (room: ChatRoom) => {
    if (activeRoom && activeRoom.id !== room.id) {
      await checkAndClearCanceledRoom(activeRoom);
    }
    setActive(null);
    setActiveRoom(room);
    persistOpenChat('group', room.id);
  };

  const closeOpenChat = () => {
    setActive(null);
    setActiveRoom(null);
    clearPersistedOpenChat();
  };

  const tryOpenFromNotification = async () => {
    if (!pageActiveRef.current) return;
    const notifyPersonal = localStorage.getItem('activePersonalId') || localStorage.getItem('openDirectChatWith');
    const notifyGroup = localStorage.getItem('activeGroupId');
    let personalId = notifyPersonal;
    let groupId = notifyGroup;
    if (!personalId && !groupId) {
      const saved = readPersistedOpenChat();
      if (saved?.kind === 'personal') personalId = saved.id;
      if (saved?.kind === 'group') groupId = saved.id;
    }
    if (!personalId && !groupId) return;
    const reloadIfAlreadyOpen = Boolean(notifyPersonal || notifyGroup);

    if (personalId) {
      if (active && !activeRoom && Number(active.id) === Number(personalId)) {
        localStorage.removeItem('activePersonalId');
        localStorage.removeItem('openDirectChatWith');
        persistOpenChat('personal', personalId);
        if (reloadIfAlreadyOpen) {
          window.dispatchEvent(new CustomEvent(NAV_EVENT_RELOAD_CHAT_HISTORY, { detail: { personalId } }));
        }
        return;
      }
      const match = (list: Chat[] | undefined) => (list || []).find((c) => c && Number(c.id) === Number(personalId));
      let target = match(chats);
      if (!target) {
        try {
          const response = await api.get('/api/v1/social/chats/users');
          const updated = response.data || [];
          if (setChats) setChats(updated);
          target = match(updated);
        } catch (err) {
          console.error('Ошибка при открытии личного чата:', err);
        }
      }
      if (target) {
        setSidebarTab('personal');
        setActiveRoom(null);
        setActive(target);
        persistOpenChat('personal', target.id);
        localStorage.removeItem('activePersonalId');
        localStorage.removeItem('openDirectChatWith');
      }
      return;
    }

    const matchRoom = (rooms: ChatRoom[] | undefined) =>
      (rooms || []).find((r) => r && (Number(r.id) === Number(groupId) || Number(r.eventId) === Number(groupId)));

    if (activeRoom && matchRoom([activeRoom])) {
      localStorage.removeItem('activeGroupId');
      persistOpenChat('group', activeRoom.id);
      if (reloadIfAlreadyOpen) {
        window.dispatchEvent(new CustomEvent(NAV_EVENT_RELOAD_CHAT_HISTORY, { detail: { groupId: activeRoom.id } }));
      }
      return;
    }

    let room = matchRoom(personalGroups) || matchRoom(eventRooms);
    if (!room && refreshEventRooms) {
      try {
        await refreshEventRooms();
      } catch (err) {
        console.error('Ошибка при обновлении списка комнат:', err);
      }
    }
    room = matchRoom(personalGroups) || matchRoom(eventRooms);
    if (room) {
      setActive(null);
      setActiveRoom(room);
      setSidebarTab(isPersonalGroupRoom(room) ? 'personal' : 'events');
      persistOpenChat('group', room.id);
      localStorage.removeItem('activeGroupId');
    }
  };

  const tryOpenRef = useRef(tryOpenFromNotification);
  tryOpenRef.current = tryOpenFromNotification;

  useEffect(() => {
    void tryOpenRef.current();
  }, [chats, eventRooms, personalGroups, pageActive]);

  useEffect(() => {
    const onOpen = () => { void tryOpenRef.current(); };
    window.addEventListener(NAV_EVENT_OPEN_CHAT, onOpen);
    return () => window.removeEventListener(NAV_EVENT_OPEN_CHAT, onOpen);
  }, []);

  useEffect(() => {
    const persistNow = () => {
      if (active) persistOpenChat('personal', active.id);
      else if (activeRoom) persistOpenChat('group', activeRoom.id);
    };
    persistNow();
    window.addEventListener('pagehide', persistNow);
    return () => window.removeEventListener('pagehide', persistNow);
  }, [active, activeRoom]);

  useEffect(() => {
    cancelScheduledClearPersistedOpenChat();
    return () => scheduleClearPersistedOpenChatIfVisible();
  }, []);


  // ЖИВОЙ ПЕРЕХВАТ: обновление списка комнат (join / kick)
  useEffect(() => {
    const handleRoomsRefresh = (e: Event) => {
      const reason = (e as CustomEvent)?.detail?.reason;
      console.log("[Chats] refreshChatRoomsList, reason=", reason);

      if (refreshEventRooms) {
        refreshEventRooms();
      }

      // Закрываем окно только при кике, не при добавлении в чат
      if (reason === 'kick' && activeRoom) {
        setActiveRoom(null);
        clearPersistedOpenChat();
      }
    };

    window.addEventListener('refreshChatRoomsList', handleRoomsRefresh);
    return () => {
      window.removeEventListener('refreshChatRoomsList', handleRoomsRefresh);
    };
  }, [refreshEventRooms, activeRoom]);

  useEffect(() => {
    const handleDeleted = (e: Event) => {
      const chatId = (e as CustomEvent)?.detail?.chatId;
      if (chatId != null && activeRoom && Number(activeRoom.id) === Number(chatId)) {
        setActiveRoom(null);
      }
    };
    window.addEventListener('groupChatRoomDeleted', handleDeleted);
    return () => window.removeEventListener('groupChatRoomDeleted', handleDeleted);
  }, [activeRoom]);

  useEffect(() => {
    if (!activeRoom) return;
    const source = isPersonalGroupRoom(activeRoom) ? personalGroups : eventRooms;
    const next = (source || []).find((r) => r && Number(r.id) === Number(activeRoom.id));
    if (!next) return;
    if (
      next.title !== activeRoom.title
      || next.addMembersPolicy !== activeRoom.addMembersPolicy
      ||       next.renamePolicy !== activeRoom.renamePolicy
      || next.avatarPolicy !== activeRoom.avatarPolicy
      ||       next.avatarUrl !== activeRoom.avatarUrl
      || Number(next.ownerId) !== Number(activeRoom.ownerId)
      || !!next.muted !== !!activeRoom.muted
      || !!next.pinned !== !!activeRoom.pinned
      || !!next.admin !== !!activeRoom.admin
      || String(next.pinnedAt || '') !== String(activeRoom.pinnedAt || '')
    ) {
      setActiveRoom((prev) => (prev && Number(prev.id) === Number(next.id) ? { ...prev, ...next } : prev));
    }
  }, [personalGroups, eventRooms, activeRoom]);

  const togglePersonalMute = async (chat: Chat) => {
    try {
      if (chat.muted) await api.delete(`/api/v1/social/chats/prefs/personal/${chat.id}/mute`);
      else await api.put(`/api/v1/social/chats/prefs/personal/${chat.id}/mute`);
      setChats((prev) => (prev || []).map((item) => Number(item.id) === Number(chat.id) ? { ...item, muted: !chat.muted } : item));
    } catch (err: any) {
      showAppInfoToast('Уведомления', err?.response?.data?.details || 'Не удалось изменить уведомления');
    }
  };

  const togglePersonalPin = async (chat: Chat) => {
    try {
      if (chat.pinned) await api.delete(`/api/v1/social/chats/prefs/personal/${chat.id}/pin`);
      else await api.put(`/api/v1/social/chats/prefs/personal/${chat.id}/pin`);
      const personalRes = await api.get('/api/v1/social/chats/users');
      setChats(personalRes.data || []);
    } catch (err: any) {
      showAppInfoToast('Закрепление', err?.response?.data?.details || 'Можно закрепить не больше 5 чатов');
    }
  };

  const toggleRoomMute = async (room: ChatRoom) => {
    try {
      if (room.muted) await api.delete(`/api/v1/social/chats/rooms/${room.id}/mute`);
      else await api.put(`/api/v1/social/chats/rooms/${room.id}/mute`);
      if (isPersonalGroupRoom(room)) {
        setPersonalGroups((prev) => (prev || []).map((item) => item && Number(item.id) === Number(room.id) ? { ...item, muted: !room.muted } : item));
      } else {
        setEventRooms((prev) => (prev || []).map((item) => item && Number(item.id) === Number(room.id) ? { ...item, muted: !room.muted } : item));
      }
    } catch (err: any) {
      showAppInfoToast('Уведомления', err?.response?.data?.details || 'Не удалось изменить уведомления');
    }
  };

  const toggleRoomPin = async (room: ChatRoom) => {
    try {
      if (room.pinned) await api.delete(`/api/v1/social/chats/rooms/${room.id}/pin`);
      else await api.put(`/api/v1/social/chats/rooms/${room.id}/pin`);
      await refreshEventRooms();
    } catch (err: any) {
      showAppInfoToast('Закрепление', err?.response?.data?.details || 'Можно закрепить не больше 5 чатов');
    }
  };



  const confirmDeleteChat = async () => {
    if (!chatToDelete) return;
    try {
      // Дергаем эндпоинт clear, передавая флаг deleteCompletely в query-параметрах
      await api.delete(`/api/v1/social/chats/clear/${chatToDelete.id}?isDelete=${deleteCompletely}`);

      // Точечный фикс: мгновенное обновление UI для себя без перезагрузки
      if (setChats) {
        if (deleteCompletely) {
          // Если был чекбокс — полностью выкидываем чат из сайдбара
          setChats(chats.filter((c) => c.id !== chatToDelete.id));
          if (active?.id === chatToDelete.id) {
            setActive(null);
            clearPersistedOpenChat();
          }
        } else {
          // Если просто очистка истории — обновляем карточку в сайдбаре на "Переписка создана"
          setChats(chats.map((c) =>
              c.id === chatToDelete.id
                  ? { ...c, last_message: "Переписка создана", time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) }
                  : c
          ));
          // Если этот чат сейчас открыт — мгновенно очищаем экран переписки
          if (active?.id === chatToDelete.id && (window as any).setMessages) {
            (window as any).setMessages([]);
          }
        }
      }

      if (active?.id === chatToDelete.id) setActive(null);
      setChatToDelete(null);
      setDeleteCompletely(false); // Сбрасываем стейт
    } catch (err) {
      console.error("Ошибка удаления чата:", err);
    }
  };

  const confirmDeleteRoom = async () => {
    if (!roomToDelete) return;
    try {
      if (isPersonalGroupRoom(roomToDelete)) {
        await api.delete(
            `/api/v1/social/chats/rooms/${roomToDelete.id}/members/${user?.id}?firstName=${user?.firstName || ''}&lastName=${user?.lastName || ''}`
        );
        setPersonalGroups((prev) => (prev || []).filter((r) => r && r.id !== roomToDelete.id));
        if (activeRoom && Number(activeRoom.id) === Number(roomToDelete.id)) {
          setActiveRoom(null);
        }
      } else if (leaveCompletely) {
        await api.post(`/api/v1/social/events/${roomToDelete.eventId}/participants/leave`);
        if (setEventRooms) {
          setEventRooms((eventRooms || []).filter((r: ChatRoom) => r && r.id !== roomToDelete.id));
        }
        if (activeRoom && Number(activeRoom.id) === Number(roomToDelete.id)) {
          setActiveRoom(null);
        }
      } else {
        await api.delete(
            `/api/v1/social/chats/room/${roomToDelete.eventId}?isLeave=false&firstName=${user?.firstName || ''}&lastName=${user?.lastName || ''}`
        );
        if (setEventRooms) {
          setEventRooms(eventRooms.map((r) =>
              r.id === roomToDelete.id
                  ? { ...r, lastMessage: "Переписка создана", time: "" }
                  : r
          ));
        }
        window.dispatchEvent(new CustomEvent("instantGroupChatClear", { detail: { chatId: roomToDelete.id } }));
      }

      setRoomToDelete(null);
      setLeaveCompletely(false);
    } catch (err) {
      console.error("Ошибка при обработке удаления/выхода из группы:", err);
    }
  };

  const filtered = (chats || []).filter((c) => c && c.name &&
      c.name.toLowerCase().includes(query.toLowerCase()));

  // Вычисляем наличие и количество непрочитанных для кнопок-табов
  const hasUnreadEvents = (eventRooms || []).some((room) => room && room.unread !== undefined && room.unread > 0);
  const personalUnread = (chats || []).reduce((s, c) => s + ((c && c.unread) || 0), 0)
      + (personalGroups || []).reduce((s, r) => s + ((r && r.unread) || 0), 0);
  const eventsUnread = (eventRooms || []).reduce((s, r) => s + ((r && r.unread) || 0), 0);
  const totalUnread = personalUnread + eventsUnread;

  const chatOpen = !!(active || activeRoom);
  useMobileChatViewport(pageActive && chatOpen);

  return (
      <div className={`h-full flex w-full overflow-hidden bg-[#FFFCFA] md:bg-transparent ${chatOpen ? 'pb-0' : 'pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0'}`}>
        {/* ЛЕВАЯ ПАНЕЛЬ СПИСКА ЧАТОВ */}
        <div className={`${chatOpen ? 'hidden lg:flex' : 'flex'} w-full lg:w-80 border-r ${theme.surface.border} ${theme.surface.card} flex-col shrink-0 h-full min-h-0`}>
          <div className="p-4 border-b border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h1 className="myraion-display text-2xl md:text-3xl text-[#1C1824]">Чаты</h1>
              {sidebarTab === 'personal' && (
                <button
                  type="button"
                  onClick={() => setCreateGroupOpen(true)}
                  className="w-11 h-11 rounded-full bg-[#EDE6F5] text-[#5C4B7A] hover:bg-[#5C4B7A] hover:text-white flex items-center justify-center transition"
                  title="Создать групповой чат"
                >
                  <UserPlus className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* ТАБЫ ПЕРЕКЛЮЧЕНИЯ (ЛИЧНЫЕ / СОБЫТИЯ) */}
            <div className="flex items-center gap-1 p-1 bg-[#EDE6F5] rounded-full mb-3">
              {/* ТАБ ЛИЧНЫЕ — ТЕПЕРЬ ТОЧКА ГОРИТ ВСЕГДА, ЕСЛИ ЕСТЬ НЕПРОЧИТАННЫЕ */}
              <button
                  type="button"
                  onClick={async () => {
                    if (activeRoom && !isPersonalGroupRoom(activeRoom)) {
                      await checkAndClearCanceledRoom(activeRoom);
                      setActiveRoom(null);
                      clearPersistedOpenChat();
                    }
                    setSidebarTab('personal');
                  }}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-full text-xs font-medium transition relative ${sidebarTab === 'personal' ? `bg-[#FFFCFA] ${theme.accent.textStrong}` : 'text-[#8A8494] hover:text-[#1C1824]'}`}
              >
                <MessageCircle className="w-3.5 h-3.5" />
                <span>Личные</span>
                {personalUnread > 0 && (
                    <span className="absolute top-1 right-2 w-2 h-2 bg-[#5C4B7A] rounded-full animate-pulse" />
                )}
              </button>

              {/* ТАБ СОБЫТИЯ — ТОЧКА ТАКЖЕ ГОРИТ ВСЕГДА */}
              <button
                  type="button"
                  onClick={() => {
                    setSidebarTab('events');
                    if (active) {
                      setActive(null);
                      clearPersistedOpenChat();
                    }
                    if (activeRoom && isPersonalGroupRoom(activeRoom)) {
                      setActiveRoom(null);
                      clearPersistedOpenChat();
                    }
                  }}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-full text-xs font-medium transition relative ${sidebarTab === 'events' ? `bg-[#FFFCFA] ${theme.accent.textStrong}` : 'text-[#8A8494] hover:text-[#1C1824]'}`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>События</span>
                {eventsUnread > 0 && (
                    <span className="absolute top-1 right-2 w-2 h-2 bg-[#5C4B7A] rounded-full animate-pulse" />
                )}
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск чата…" className={`w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border ${theme.surface.border} rounded-xl focus:outline-none focus:ring-2 ${theme.accent.ring} focus:bg-white transition`} />
            </div>
          </div>
          <ChatVoiceMiniBar className="md:hidden px-3 pt-2 pb-1 shrink-0" />
          <div className="flex-1 overflow-y-auto">
            {sidebarTab === 'events' ? (
                eventRooms.length === 0 ? (
                    <div className="p-6 text-center text-slate-400 text-sm">
                      <div className={`w-14 h-14 mx-auto mb-3 rounded-2xl ${theme.accent.bgSoft} flex items-center justify-center`}><Users className={`w-7 h-7 ${theme.accent.text}`} /></div>
                      <div className="font-medium text-slate-700">Чаты событий пусты</div>
                    </div>
                ) : (
                    eventRooms.filter(r => r.title.toLowerCase().includes(query.toLowerCase())).map((room) => {
                      const isRoomActive = activeRoom?.id === room.id;
                      return (
                          <ChatListSwipeRow
                            key={`room-${room.id}`}
                            className={`group border-b border-slate-100 transition ${isRoomActive ? theme.accent.bgSoft : (room.unread && room.unread > 0 ? 'bg-[#F3F0F6] hover:bg-[#EDE8F2]' : 'hover:bg-slate-50')}`}
                            actions={[
                              { id: 'mute', label: room.muted ? 'Звук' : 'Заглушить', icon: room.muted ? Bell : BellOff, onSelect: () => toggleRoomMute(room) },
                              { id: 'pin', label: room.pinned ? 'Открепить' : 'Закрепить', icon: Pin, onSelect: () => toggleRoomPin(room) },
                              { id: 'delete', label: 'Удалить', icon: X, danger: true, onSelect: () => setRoomToDelete(room) },
                            ]}
                            desktopButtons={(
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRoomToDelete(room);
                                }}
                                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-sm"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          >
                            <button onClick={() => handleOpenEvent(room)} className="w-full text-left px-4 py-3 flex items-start gap-3">
                              <div className="w-11 h-11 rounded-full bg-[#EDE6F5] flex items-center justify-center text-[#5C4B7A]">{room.title.substring(0, 2).toUpperCase()}</div>
                              <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-center gap-2">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <div className="font-semibold text-slate-900 truncate text-sm">{room.title}</div>
                                    {room.muted ? <BellOff className="w-3 h-3 text-slate-400 shrink-0" /> : null}
                                    {room.pinned ? <Pin className="w-3 h-3 text-[#5C4B7A] shrink-0 fill-[#5C4B7A]" /> : null}
                                  </div>
                                  <div className="text-xs text-slate-400 shrink-0">{room.time || 'Недавно'}</div>
                                </div>
                                <div className="flex justify-between items-center gap-2 mt-0.5">
                                  {(() => {
                                    void draftTick;
                                    const draft = readChatDraft('group', room.id).trim();
                                    if (draft && !isRoomActive) {
                                      return (
                                        <div className="text-xs truncate flex-1 italic text-[#5C4B7A]">
                                          Черновик: {draft}
                                        </div>
                                      );
                                    }
                                    const preview = formatSidebarMessage(room.lastMessage || 'Групповой чат встречи') || 'Групповой чат встречи';
                                    return (
                                      <div className={`text-xs truncate flex-1 ${room.unread && room.unread > 0
                                          ? 'text-slate-800 font-medium' : 'text-slate-500'}`}>
                                        {preview}
                                      </div>
                                    );
                                  })()}
                                  {room.unread !== undefined && room.unread > 0 && (
                                      <span className={`${theme.accent.bg} text-white text-[10px] font-bold min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center shrink-0 shadow-sm animate-scaleIn`}>
{room.unread}
</span>
                                  )}
                                </div>
                              </div>
                            </button>
                          </ChatListSwipeRow>
                      );
                    })
                )
            ) : (() => {
                const q = query.toLowerCase();
                const groupItems = (personalGroups || [])
                    .filter((r) => r && (r.title || '').toLowerCase().includes(q))
                    .map((room) => ({ kind: 'group' as const, room }));
                const dmItems = filtered.map((chat) => ({ kind: 'dm' as const, chat }));
                const personalItems = [...groupItems, ...dmItems].sort((a, b) => {
                  const ap = a.kind === 'group' ? a.room.pinnedAt : a.chat.pinnedAt;
                  const bp = b.kind === 'group' ? b.room.pinnedAt : b.chat.pinnedAt;
                  if (ap && bp) return new Date(ap).getTime() - new Date(bp).getTime();
                  if (ap) return -1;
                  if (bp) return 1;
                  return 0;
                });
                if (personalItems.length === 0) {
                    return (
                      <div className="p-6 text-center text-sm text-slate-400">
                        {query ? 'Ничего не найдено' : 'Личные переписки и групповые чаты появятся здесь'}
                      </div>
                    );
                }
                return personalItems.map((item) => {
                  if (item.kind === 'group') {
                    const room = item.room;
                    const isRoomActive = activeRoom?.id === room.id;
                    return (
                          <ChatListSwipeRow
                            key={`pgroup-${room.id}`}
                            className={`group border-b border-slate-100 transition ${isRoomActive ? theme.accent.bgSoft : (room.unread && room.unread > 0 ? 'bg-[#F3F0F6] hover:bg-[#EDE8F2]' : 'hover:bg-slate-50')}`}
                            actions={[
                              { id: 'mute', label: room.muted ? 'Звук' : 'Заглушить', icon: room.muted ? Bell : BellOff, onSelect: () => toggleRoomMute(room) },
                              { id: 'pin', label: room.pinned ? 'Открепить' : 'Закрепить', icon: Pin, onSelect: () => toggleRoomPin(room) },
                              { id: 'delete', label: 'Удалить', icon: X, danger: true, onSelect: () => setRoomToDelete(room) },
                            ]}
                            desktopButtons={(
                              <>
                                <button
                                  onClick={(e) => { e.stopPropagation(); void toggleRoomPin(room); }}
                                  className="absolute top-2 right-9 w-7 h-7 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-[#5C4B7A] flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-sm"
                                  title={room.pinned ? 'Открепить' : 'Закрепить'}
                                >
                                  <Pin className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setRoomToDelete(room); }}
                                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-sm"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </>
                            )}
                          >
                            <button onClick={() => handleOpenEvent(room)} className="w-full text-left px-4 py-3 lg:pr-9 flex items-start gap-3">
                              {room.avatarUrl ? (
                                <div className="relative shrink-0">
                                  <img src={getAvatarUrl(null, room.avatarUrl)} alt="" className="w-11 h-11 rounded-full object-cover bg-[#EDE6F5]" />
                                  <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#5C4B7A] text-white flex items-center justify-center"><Users className="w-2.5 h-2.5" /></span>
                                </div>
                              ) : (
                                <div className="relative w-11 h-11 rounded-full bg-[#EDE6F5] flex items-center justify-center text-[#5C4B7A] shrink-0">
                                  <Users className="w-5 h-5" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-center gap-2">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <div className="font-semibold text-slate-900 truncate text-sm">{room.title}</div>
                                    {room.muted ? <BellOff className="w-3 h-3 text-slate-400 shrink-0" /> : null}
                                    {room.pinned ? <Pin className="w-3 h-3 text-[#5C4B7A] shrink-0 fill-[#5C4B7A]" /> : null}
                                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-[#5C4B7A] bg-[#EDE6F5] px-1.5 py-0.5 rounded-md">Группа</span>
                                  </div>
                                  <div className="text-xs text-slate-400 shrink-0">{room.time || ''}</div>
                                </div>
                                <div className="flex justify-between items-center gap-2 mt-0.5">
                                  {(() => {
                                    void draftTick;
                                    const draft = readChatDraft('group', room.id).trim();
                                    if (draft && !isRoomActive) {
                                      return <div className="text-xs truncate flex-1 italic text-[#5C4B7A]">Черновик: {draft}</div>;
                                    }
                                    const preview = formatSidebarMessage(room.lastMessage || 'Групповой чат') || 'Групповой чат';
                                    return (
                                      <div className={`text-xs truncate flex-1 ${room.unread && room.unread > 0 ? 'text-slate-800 font-medium' : 'text-slate-500'}`}>
                                        {preview}
                                      </div>
                                    );
                                  })()}
                                  {room.unread !== undefined && room.unread > 0 && (
                                      <span className={`${theme.accent.bg} text-white text-[10px] font-bold min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center shrink-0 shadow-sm`}>{room.unread}</span>
                                  )}
                                </div>
                              </div>
                            </button>
                          </ChatListSwipeRow>
                    );
                  }
                  const c = item.chat;
                  const isActive = active?.id === c.id && !activeRoom;
                  return (
                      <ChatListSwipeRow
                        key={c.id}
                        className={`group border-b border-slate-100 transition ${isActive ? theme.accent.bgSoft : (c.unread && c.unread > 0 ? 'bg-[#F3F0F6] hover:bg-[#EDE8F2]' : 'hover:bg-slate-50')}`}
                        actions={[
                          { id: 'mute', label: c.muted ? 'Звук' : 'Заглушить', icon: c.muted ? Bell : BellOff, onSelect: () => togglePersonalMute(c) },
                          { id: 'pin', label: c.pinned ? 'Открепить' : 'Закрепить', icon: Pin, onSelect: () => togglePersonalPin(c) },
                          { id: 'delete', label: 'Удалить', icon: X, danger: true, onSelect: () => setChatToDelete(c) },
                        ]}
                        desktopButtons={(
                          <>
                            <button
                              onClick={(e) => { e.stopPropagation(); void togglePersonalPin(c); }}
                              className="absolute top-2 right-9 w-7 h-7 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-[#5C4B7A] flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-sm"
                              title={c.pinned ? 'Открепить' : 'Закрепить'}
                            >
                              <Pin className="w-3 h-3" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setChatToDelete(c); }}
                              className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-sm"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </>
                        )}
                      >
                        <button onClick={() => handleOpenPersonal(c)} className="w-full text-left px-4 py-3 lg:pr-9 flex items-start gap-3">
                          <div className="relative shrink-0">
                            <img src={getAvatarUrl(c.id, c.avatar)} alt="" className="w-11 h-11 rounded-full object-cover bg-slate-200 border border-slate-100" />
                            <span className={`absolute bottom-0 right-0 w-3 h-3 border-2 border-white rounded-full ${c.online ? 'bg-[#4A8B6F]' : 'bg-slate-300'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-center gap-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <div className="font-medium text-slate-900 truncate text-sm">{c.name}</div>
                                {c.muted ? <BellOff className="w-3 h-3 text-slate-400 shrink-0" /> : null}
                                {c.pinned ? <Pin className="w-3 h-3 text-[#5C4B7A] shrink-0 fill-[#5C4B7A]" /> : null}
                              </div>
                              <div className="text-xs text-slate-400 shrink-0">{c.time}</div>
                            </div>
                            <div className="flex justify-between items-center gap-2 mt-0.5">
                              {(() => {
                                void draftTick;
                                const draft = readChatDraft('personal', c.id).trim();
                                if (draft && !isActive) {
                                  return (
                                    <div className="text-xs truncate flex-1 italic text-[#5C4B7A]">
                                      Черновик: {draft}
                                    </div>
                                  );
                                }
                                const preview = formatSidebarMessage(c.last_message);
                                return (
                                  <div className={`text-xs truncate flex-1 ${
                                      c.unread && c.unread > 0
                                          ? 'text-slate-800 font-medium'
                                          : c.isDeleted
                                              ? 'text-slate-400 italic'
                                              : 'text-slate-500'
                                  }`}>
                                    {preview}
                                  </div>
                                );
                              })()}
                              {c.unread !== undefined && c.unread > 0 && (
                                  <span className={`${theme.accent.bg} text-white text-[10px] font-bold min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center shrink-0 shadow-sm animate-scaleIn`}>
     {c.unread}
   </span>
                              )}
                            </div>
                          </div>
                        </button>
                      </ChatListSwipeRow>
                  );
                });
            })()}
          </div>
        </div>
        {/* ПРАВАЯ ЧАСТЬ — ДИСПЕТЧЕР ИЗОЛИРОВАННЫХ ОКР ПЕРЕПИСКИ */}
        <div className={`${chatOpen ? 'flex max-lg:fixed max-lg:left-0 max-lg:right-0 max-lg:z-40 max-lg:top-[var(--myraion-chat-vv-top,0px)] max-lg:h-[var(--myraion-chat-vv-height,100dvh)]' : 'hidden lg:flex'} flex-1 flex-col h-full min-h-0 overflow-hidden relative bg-[#FFFCFA] md:bg-transparent`}>
          {activeRoom ? (
              <GroupChatSection
                  key={`group-${activeRoom.id}`}
                  activeRoom={activeRoom}
                  pageActive={pageActive}
                  setEventRooms={isPersonalGroupRoom(activeRoom) ? setPersonalGroups : setEventRooms}
                  onCloseChat={closeOpenChat}
                  onNavigateToPersonal={(chatDto) => { setActiveRoom(null); setActive(chatDto); persistOpenChat('personal', chatDto.id); }}
                  onNavigateToGroup={(roomDto) => { setActive(null); setActiveRoom(roomDto); persistOpenChat('group', roomDto.id); }}
              />
          ) : active ? (
              <PersonalChatSection
                  key={`personal-${active.id}`}
                  activePersonal={active}
                  pageActive={pageActive}
                  onClosePersonal={closeOpenChat}
                  onNavigateToPersonal={(chatDto) => { setActiveRoom(null); setActive(chatDto); persistOpenChat('personal', chatDto.id); }}
                  onNavigateToGroup={(roomDto) => { setActive(null); setActiveRoom(roomDto); persistOpenChat('group', roomDto.id); }}
              />
          ) : (
              <div className="hidden lg:flex flex-1 items-center justify-center p-8">
                <div className="text-center max-w-sm">
                  <div className={`w-20 h-20 mx-auto mb-5 rounded-3xl ${theme.accent.bgSoft} flex items-center justify-center`}>
                    <MessageCircle className={`w-10 h-10 ${theme.accent.text}`} strokeWidth={1.75} />
                  </div>
                  <div className="text-lg myraion-display text-[#1C1824]">Выберите чат, чтобы начать общение</div>
                </div>
              </div>
          )}
        </div>
        {chatToDelete && (
            <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setChatToDelete(null); setDeleteCompletely(false); }}>
              <div className={`w-full max-w-md ${theme.surface.card} rounded-2xl shadow-xl p-6`} onClick={(e) => e.stopPropagation()}>
                <p className="text-sm text-slate-500 mb-4">Очистить переписку с {chatToDelete.name}?</p>

                {/* ТОЧЕЧНЫЙ ФИКС: Красивый чекбокс полного удаления */}
                <label className="flex items-center gap-2 mb-5 cursor-pointer select-none">
                  <input
                      type="checkbox"
                      checked={deleteCompletely}
                      onChange={(e) => setDeleteCompletely(e.target.checked)}
                      className="w-4 h-4 rounded text-red-500 border-slate-300 focus:ring-red-500"
                  />
                  <span className="text-sm font-medium text-slate-700">Удалить чат полностью из списка</span>
                </label>

                <div className="flex gap-2 justify-end">
                  <button onClick={() => { setChatToDelete(null); setDeleteCompletely(false); }} className="px-4 py-2 text-sm bg-slate-100 text-slate-700 rounded-xl">Отмена</button>
                  <button onClick={confirmDeleteChat} className="px-4 py-2 text-sm bg-red-500 text-white rounded-xl">Подтвердить</button>
                </div>
              </div>
            </div>
        )}
        {/* Групповой чат встречи */}
        {roomToDelete && (
            <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setRoomToDelete(null); setLeaveCompletely(false); }}>
              <div className={`w-full max-w-md ${theme.surface.card} rounded-2xl shadow-xl p-6`} onClick={(e) => e.stopPropagation()}>
                <div className="font-semibold text-slate-900 text-lg mb-1">{isPersonalGroupRoom(roomToDelete) ? 'Групповой чат' : 'Групповой чат встречи'}</div>
                <p className="text-sm text-slate-500 mb-4">
                  {isPersonalGroupRoom(roomToDelete) ? 'Покинуть этот групповой чат?' : 'Очистить историю сообщений в чате?'}
                </p>

                {!isPersonalGroupRoom(roomToDelete) && roomToDelete.ownerId !== user?.id && (
                    <label className="flex items-center gap-2 mb-5 cursor-pointer select-none animate-fadeIn">
                      <input
                          type="checkbox"
                          checked={leaveCompletely}
                          onChange={(e) => setLeaveCompletely(e.target.checked)}
                          className="w-4 h-4 rounded text-red-500 border-slate-300 focus:ring-red-500"
                      />
                      <span className="text-sm font-medium text-slate-700">Покинуть событие и удалить чат полностью</span>
                    </label>
                )}

                <div className="flex gap-2 justify-end">
                  <button onClick={() => { setRoomToDelete(null); setLeaveCompletely(false); }} className="px-4 py-2 text-sm bg-slate-100 text-slate-700 rounded-xl">Отмена</button>
                  <button onClick={confirmDeleteRoom} className="px-4 py-2 text-sm bg-red-500 text-white rounded-xl">Подтвердить</button>
                </div>
              </div>
            </div>
        )}
        {createGroupOpen && (
            <CreatePersonalGroupModal
                onClose={() => setCreateGroupOpen(false)}
                onCreated={(room) => {
                    setCreateGroupOpen(false);
                    void refreshEventRooms();
                    setSidebarTab('personal');
                    setActive(null);
                    setActiveRoom(room);
                }}
            />
        )}

      </div>
  );
}