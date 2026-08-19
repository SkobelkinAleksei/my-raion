import type { Msg } from '@/features/chat/useChatActions';
import { isUnreadMarker } from '@/features/chat/chatUnread';

/**
 * Снимок истории с сервера + то, что уже пришло по сокету.
 * Сообщения с тем же id берём с сервера; id, которых нет в снимке, оставляем из live.
 */
export function mergeChatMessagesById(server: Msg[], live: Msg[]): Msg[] {
    const byId = new Map<string, Msg>();
    for (const m of live) {
        if (isUnreadMarker(m.id)) continue;
        byId.set(String(m.id), m);
    }
    for (const m of server) {
        if (isUnreadMarker(m.id)) continue;
        byId.set(String(m.id), m);
    }
    return [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
}
