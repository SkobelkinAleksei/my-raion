import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import api from '@/shared/lib/api';
import { showAppInfoToast } from '@/shared/utils/appToast';
import { maybeAskGeo, whenDevicePromptsDone } from '@/shared/lib/geoPrompt';
import { useAuth } from '@/shared/context/AuthContext';
import Card from '@/shared/ui/Card';
import Button from '@/shared/ui/Button';
import EventDetailsModal from '@/features/events/EventDetailsModal';

// Импортируем пути к вашим исправленным SVG-файлам
import sosIconUrl from '@/assets/map/sos.svg';
import dvizhIconUrl from '@/assets/map/dvizh.svg';
import eventsIconUrl from '@/assets/map/events.svg';
import homeIconUrl from '@/assets/map/home.svg';

import {
    MapPin,
    Users,
    Calendar,
    Plus,
    Minus,
    X,
    Clock,
    Tag,
    LogOut,
    ShieldAlert,
    Flame,
    Sparkles,
    Home,
    LocateFixed
} from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import CreateEventDrawer from "@/features/events/CreateEventDrawer";

export type EventCategory = 'SOS' | 'ДВИЖ' | 'СОБЫТИЯ';

// Объявляем справочник иконок (размер 32x32, точка привязки ровно по центру круга — 16, 16)
const MAP_ICONS: Record<EventCategory, L.Icon> = {
    SOS: L.icon({
        iconUrl: sosIconUrl,
        iconSize:[32, 32],
        iconAnchor:[16, 16],
        popupAnchor: [0, -16]
    }),
    ДВИЖ: L.icon({
        iconUrl: dvizhIconUrl,
        iconSize:[32, 32],
        iconAnchor:[16, 16],
        popupAnchor: [0, -16]
    }),
    СОБЫТИЯ: L.icon({
        iconUrl: eventsIconUrl,
        iconSize:[32, 32],
        iconAnchor:[16, 16],
        popupAnchor: [0, -16]
    })
};

const HOME_MAP_ICON = L.icon({
    iconUrl: homeIconUrl,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
});

const GPS_MAP_ICON = L.divIcon({
    className: 'district-gps-marker',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: '<div class="district-gps-marker__dot"></div>',
});

const FALLBACK_CENTER: [number, number] = [55.7558, 37.6173];
const MAP_DEFAULT_ZOOM = 14;

function readLatLng(lat?: number | null, lng?: number | null): [number, number] | null {
    const nextLat = Number(lat);
    const nextLng = Number(lng);
    if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return null;
    return [nextLat, nextLng];
}

function BindMapRef({
    mapRef,
    onReady,
}: {
    mapRef: React.MutableRefObject<L.Map | null>;
    onReady?: () => void;
}) {
    const map = useMap();
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;
    useEffect(() => {
        mapRef.current = map;
        onReadyRef.current?.();
        return () => {
            mapRef.current = null;
        };
    }, [map, mapRef]);
    return null;
}

const clusterIconCache = new Map<number, L.DivIcon>();

const createGroupedMarkerIcon = (eventsInLocation: EventDto[]) => {
    const count = eventsInLocation.length;
    if (count === 1) {
        const ev = eventsInLocation[0];
        const category = (ev.category || 'СОБЫТИЯ').toUpperCase().trim() as EventCategory;
        return MAP_ICONS[category] || MAP_ICONS['СОБЫТИЯ'];
    }
    const cached = clusterIconCache.get(count);
    if (cached) return cached;
    const icon = L.divIcon({
        className: 'district-cluster-marker',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14],
        html: `<div class="district-cluster-marker__stack" title="${count} событий">
            <span class="district-cluster-marker__dot district-cluster-marker__dot--events"></span>
            <span class="district-cluster-marker__dot district-cluster-marker__dot--dvizh"></span>
            <span class="district-cluster-marker__front">${count > 9 ? '9+' : count}</span>
        </div>`
    });
    clusterIconCache.set(count, icon);
    return icon;
};

const locationGroupKey = (event: EventDto) =>
    `${Number(event.latitude).toFixed(4)}_${Number(event.longitude).toFixed(4)}`;

type MapBounds = { minLat: number; maxLat: number; minLng: number; maxLng: number };

const readMapBounds = (map: L.Map): MapBounds | null => {
    const b = map.getBounds();
    if (!b.isValid()) return null;
    return {
        minLat: b.getSouth(),
        maxLat: b.getNorth(),
        minLng: b.getWest(),
        maxLng: b.getEast(),
    };
};

function MapViewportSync({
    onBoundsChange,
    onMapClick,
}: {
    onBoundsChange: (bounds: MapBounds) => void;
    onMapClick: (lat: number, lng: number) => void;
}) {
    const onBoundsChangeRef = useRef(onBoundsChange);
    onBoundsChangeRef.current = onBoundsChange;
    const onMapClickRef = useRef(onMapClick);
    onMapClickRef.current = onMapClick;

    const emit = (map: L.Map) => {
        const next = readMapBounds(map);
        if (next) onBoundsChangeRef.current(next);
    };

    const map = useMapEvents({
        moveend() {
            emit(map);
        },
        click(e) {
            onMapClickRef.current(e.latlng.lat, e.latlng.lng);
        },
    });

    useEffect(() => {
        const firstLoadTimer = setTimeout(() => {
            map.invalidateSize();
            emit(map);
        }, 150);
        return () => clearTimeout(firstLoadTimer);
    }, [map]);

    return null;
}

export interface EventDto {
    id: number;
    title: string;
    description: string;
    category: EventCategory;
    isPrivate: boolean;
    latitude: number;
    longitude: number;
    locationName: string;
    organizerId: number;
    isPast?: boolean;
    canVoteReputation?: boolean;
    reputationOpensAt?: string;
    reputationClosesAt?: string;
    eventDate: string;
    participantLimit: number;
    currentParticipants: number;
    tags: string[];
    photos: string[];
    userStatus?: 'PENDING' | 'JOINED' | 'NOT_PARTICIPATING' | 'REJECTED' | 'BANNED' | 'KICKED' | 'RE_PENDING';
}

interface DistrictMapSectionProps {
    activeCategory: EventCategory | 'ALL';
    onUpdateCounts?: (counts: { all: number; sos: number; dvizh: number; events: number }) => void;
    onCancelEvent?: (event: any) => void;
    onEditEvent?: (event: any) => void;
    onEventsChange?: (events: EventDto[]) => void;
    active?: boolean;
}
// Оборачиваем компонент в forwardRef, чтобы предоставить родительской странице доступ к openEvent
const DistrictMapSection = forwardRef<any, DistrictMapSectionProps>((
    {
        activeCategory,
        onUpdateCounts,
        onCancelEvent,
        onEditEvent,
        onEventsChange,
        active = true
    },
    ref
) => {
    const { user } = useAuth();
    const [events, setEvents] = useState<EventDto[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedEvent, setSelectedEvent] = useState<EventDto | null>(null);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [clickedCoords, setClickedCoords] = useState<{ lat: number; lng: number } | null>(null);
    const [editingEvent, setEditingEvent] = useState<EventDto | null>(null);
    const mapRef = useRef<L.Map | null>(null);
    const boundsRef = useRef<MapBounds | null>(null);
    const fetchEventsRef = useRef<(view?: MapBounds | null) => Promise<void>>(async () => {});
    const boundsFetchTimer = useRef<number | null>(null);
    const gpsRequestedRef = useRef(false);
    const [gpsPosition, setGpsPosition] = useState<[number, number] | null>(null);
    const [locating, setLocating] = useState(false);

    useEffect(() => {
        if (!active) return;
        const timer = window.setTimeout(() => mapRef.current?.invalidateSize(), 80);
        return () => window.clearTimeout(timer);
    }, [active]);

    const homeCenter = readLatLng(user?.homeLatitude, user?.homeLongitude);
    const defaultCenter: [number, number] = homeCenter || FALLBACK_CENTER;

    const flyTo = (target: [number, number], animate = true) => {
        const map = mapRef.current;
        if (!map) return;
        if (animate) map.flyTo(target, Math.max(map.getZoom(), MAP_DEFAULT_ZOOM), { duration: 0.65 });
        else map.setView(target, Math.max(map.getZoom(), MAP_DEFAULT_ZOOM), { animate: false });
    };

    const requestGps = (opts?: { silent?: boolean; fly?: boolean }) => {
        if (!navigator.geolocation) {
            if (!opts?.silent) showAppInfoToast('Местоположение', 'Браузер не отдаёт геолокацию');
            return;
        }
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const next: [number, number] = [pos.coords.latitude, pos.coords.longitude];
                setGpsPosition(next);
                setLocating(false);
                if (opts?.fly !== false) flyTo(next, !opts?.silent);
            },
            () => {
                setLocating(false);
                if (!opts?.silent) {
                    showAppInfoToast('Местоположение', 'Нет доступа к геолокации. Можно открыть район дома.');
                }
            },
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 }
        );
    };

    const fetchEvents = async (viewBounds?: MapBounds | null) => {
        const view = viewBounds ?? boundsRef.current;
        if (!view) return;
        setLoading(true);
        try {
            const params: any = {
                minLat: view.minLat,
                maxLat: view.maxLat,
                minLng: view.minLng,
                maxLng: view.maxLng,
            };
            if (activeCategory !== 'ALL') {
                params.category = activeCategory;
            }

            const [eventsResponse, statusesResponse] = await Promise.all([
                api.get('/api/v1/social/events', { params }),
                user?.id
                    ? api.get('/api/v1/social/events/anyEventId/participants/statuses').catch(() => ({ data: {} }))
                    : Promise.resolve({ data: {} })
            ]);

            const fetchedEvents = eventsResponse.data || [];
            const userStatusesMap = statusesResponse.data || {};

            const mappedEvents = fetchedEvents.map((e: any) => {
                const serverStatus = userStatusesMap[String(e.id)] || userStatusesMap[Number(e.id)];
                return {
                    ...e,
                    userStatus: serverStatus ? serverStatus.toUpperCase() : 'NOT_PARTICIPATING'
                };
            });

            setEvents(mappedEvents);

            if (onEventsChange) {
                onEventsChange(mappedEvents);
            }

            if (onUpdateCounts) {
                onUpdateCounts({
                    all: mappedEvents.length,
                    sos: mappedEvents.filter((e: any) => e.category === 'SOS').length,
                    dvizh: mappedEvents.filter((e: any) => e.category === 'ДВИЖ').length,
                    events: mappedEvents.filter((e: any) => e.category === 'СОБЫТИЯ').length,
                });
            }
        } catch (error) {
            console.error("Ошибка при загрузке маркеров событий:", error);
        } finally {
            setLoading(false);
        }
    };
    fetchEventsRef.current = fetchEvents;

    useImperativeHandle(ref, () => ({
        openEvent(event: EventDto) {
            setSelectedEvent(event);
        },
        fetchEvents() {
            void fetchEventsRef.current();
        },
        setEvents,
    }));

    useEffect(() => {
        void fetchEventsRef.current();
    }, [activeCategory]);

    const handleBoundsChange = (next: MapBounds) => {
        boundsRef.current = next;
        if (boundsFetchTimer.current) window.clearTimeout(boundsFetchTimer.current);
        boundsFetchTimer.current = window.setTimeout(() => {
            void fetchEventsRef.current(next);
        }, 150);
    };

    useEffect(() => {
        return () => {
            if (boundsFetchTimer.current) window.clearTimeout(boundsFetchTimer.current);
        };
    }, []);

    useEffect(() => {
        (window as any).refreshMapAfterDelete = async () => {
            await fetchEventsRef.current();
            if (mapRef.current) {
                const currentCenter = mapRef.current.getCenter();
                mapRef.current.setView([currentCenter.lat + 0.00001, currentCenter.lng], mapRef.current.getZoom(), { animate: false });
                mapRef.current.setView(currentCenter, mapRef.current.getZoom(), { animate: false });
            }
        };
        return () => {
            delete (window as any).refreshMapAfterDelete;
        };
    }, []);

    useEffect(() => {
        const handleOpenSharedModal = async (e: Event) => {
            const customEvent = e as CustomEvent;
            const { eventId } = customEvent.detail;

            if (!eventId || isNaN(Number(eventId))) return;

            try {
                const res = await api.get(`/api/v1/social/events/${Number(eventId)}`);

                if (res.data) {
                    setSelectedEvent(res.data);
                }
            } catch (err) {
                console.error("Не удалось открыть карточку расшаренной встречи:", err);
            }
        };
        window.addEventListener('openSharedEventModal', handleOpenSharedModal);

        return () => {
            window.removeEventListener('openSharedEventModal', handleOpenSharedModal);
        };
    }, [setSelectedEvent]);

    useEffect(() => {
        const handleLiveStatusRefresh = () => {
            void fetchEventsRef.current();
        };
        window.addEventListener('refreshNeighborStatuses', handleLiveStatusRefresh);
        return () => {
            window.removeEventListener('refreshNeighborStatuses', handleLiveStatusRefresh);
        };
    }, []);


    const handleParticipantAction = async (event: EventDto, action: 'JOIN' | 'APPLY' | 'LEAVE') => {
        try {
            let endpoint = `/api/v1/social/events/${event.id}/participants/leave`;
            if (action === 'JOIN') endpoint = `/api/v1/social/events/${event.id}/participants/join`;
            if (action === 'APPLY') endpoint = `/api/v1/social/events/${event.id}/participants/apply`;

            const response = await api.post(endpoint);
            const statusResponse = await api.get(`/api/v1/social/events/${event.id}/participants/status`).catch(() => ({ data: { status: '' } }));

            const serverStatusStr = statusResponse.data?.status;
            const realStatus = serverStatusStr || (action === 'JOIN' ? 'JOINED' : action === 'APPLY' ? 'PENDING' : 'NOT_PARTICIPATING');

            const finalEvent: EventDto = {
                ...event,
                ...(response.data || {}),
                userStatus: realStatus.toUpperCase()
            };

            const finalEventsList = events.map(e => String(e.id) === String(event.id) ? finalEvent : e);
            setEvents(finalEventsList);
            setSelectedEvent(finalEvent as any);

            if (action === 'APPLY') {
                const wasRejected = String(event.userStatus || '').toUpperCase() === 'REJECTED';
                const title = event.title || 'встречу';
                showAppInfoToast(
                    wasRejected ? 'Повторная заявка' : 'Заявка отправлена',
                    wasRejected
                        ? `Повторная заявка на «${title}» отправлена организатору`
                        : `Заявка на приватную встречу «${title}» отправлена организатору`
                );
            }

            if (onEventsChange) {
                onEventsChange(finalEventsList);
            }

            window.dispatchEvent(new CustomEvent('refreshApplicationsData'));
        } catch (error) {
            console.error(`Ошибка при действии ${action} с участниками:`, error);
        }
    };

    const handleCloseCreate = () => {
        setIsCreateOpen(false);
        setClickedCoords(null);
    };
    return (
        <div className="space-y-4">
            <div data-district-map className="w-full h-[52dvh] min-h-[280px] md:h-[480px] md:min-h-0 rounded-3xl overflow-hidden border border-[#1C1824]/10 shadow-sm relative z-10">
                <MapContainer
                    center={defaultCenter}
                    zoom={MAP_DEFAULT_ZOOM}
                    zoomControl={false}
                    className="w-full h-full district-map"
                    attributionControl={false}
                >
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    <BindMapRef
                        mapRef={mapRef}
                        onReady={() => {
                            if (gpsRequestedRef.current) return;
                            gpsRequestedRef.current = true;
                            whenDevicePromptsDone(() => {
                                void maybeAskGeo().then((ok) => {
                                    if (ok) requestGps({ silent: true, fly: true });
                                });
                            });
                        }}
                    />
                    <MapViewportSync
                        onBoundsChange={handleBoundsChange}
                        onMapClick={(lat, lng) => {
                            setClickedCoords({ lat, lng });
                            setIsCreateOpen(true);
                        }}
                    />
                    {homeCenter ? (
                        <Marker
                            position={homeCenter}
                            icon={HOME_MAP_ICON}
                            zIndexOffset={-200}
                        />
                    ) : null}
                    {gpsPosition ? (
                        <Marker
                            position={gpsPosition}
                            icon={GPS_MAP_ICON}
                            interactive={false}
                            zIndexOffset={400}
                        />
                    ) : null}
                    {(() => {
                        const groups: { [key: string]: EventDto[] } = {};

                        events.forEach((event) => {
                            const isPast = event.eventDate ? new Date(event.eventDate).getTime() < Date.now() : false;
                            if (isPast) return;

                            const key = locationGroupKey(event);
                            if (!groups[key]) groups[key] = [];
                            groups[key].push(event);
                        });

                        return Object.keys(groups).map((key) => {
                            const eventsInLocation = groups[key];
                            const firstEvent = eventsInLocation[0];
                            return (
                                <Marker
                                    key={`${key}_${activeCategory}_cluster_${eventsInLocation.length}`}
                                    position={[firstEvent.latitude, firstEvent.longitude]}
                                    icon={createGroupedMarkerIcon(eventsInLocation)}
                                    eventHandlers={{
                                        click: () => {
                                            setSelectedEvent(eventsInLocation as any);
                                        }
                                    }}
                                />
                            );
                        });
                    })()}
                </MapContainer>
                <div className="absolute top-3 left-3 z-[400] flex flex-col gap-2 pointer-events-auto">
                    <div className="district-map-tools">
                        <button type="button" aria-label="Приблизить" onClick={() => mapRef.current?.zoomIn()}>
                            <Plus className="w-4 h-4" />
                        </button>
                        <button type="button" aria-label="Отдалить" onClick={() => mapRef.current?.zoomOut()}>
                            <Minus className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="district-map-tools">
                        <button
                            type="button"
                            title="Дом"
                            aria-label="К дому"
                            disabled={!homeCenter}
                            onClick={() => {
                                if (!homeCenter) {
                                    showAppInfoToast('Дом', 'Сначала укажите адрес проживания в настройках');
                                    return;
                                }
                                flyTo(homeCenter);
                            }}
                        >
                            <Home className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            title="Моё местоположение"
                            aria-label="Моё местоположение"
                            disabled={locating}
                            onClick={() => requestGps({ silent: false, fly: true })}
                        >
                            <LocateFixed className={`w-4 h-4 ${locating ? 'animate-pulse' : ''}`} />
                        </button>
                    </div>
                </div>
                <div className="pointer-events-none absolute left-4 bottom-4 z-[400]">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFFCFA]/95 px-3 py-1.5 text-[11px] font-bold text-[#5C4B7A] shadow-sm border border-[#5C4B7A]/10">
                        <Plus className="w-3.5 h-3.5" />
                        Клик по карте — создать событие
                    </span>
                </div>
            </div>

            {/* МОДАЛЬНОЕ ОКНО ПРОСМОТРА ДЕТАЛЕЙ СОБЫТИЙ */}
            {selectedEvent && (
                <EventDetailsModal
                    event={selectedEvent}
                    onClose={() => setSelectedEvent(null)}
                    onJoin={(ev) => handleParticipantAction(ev, 'JOIN')}
                    onApply={(ev) => handleParticipantAction(ev, 'APPLY')}
                    onLeave={(id) => {
                        const source = Array.isArray(selectedEvent) ? selectedEvent : selectedEvent ? [selectedEvent] : [];
                        const current = source.find((e) => Number(e.id) === Number(id));
                        void handleParticipantAction({ ...(current || {}), id } as any, 'LEAVE');
                    }}
                    onCancelEvent={(ev) => { if (onCancelEvent) onCancelEvent(ev); setSelectedEvent(null); }}
                    onEditEvent={(ev) => {
                        setEditingEvent(ev);
                        setSelectedEvent(null);
                        setIsCreateOpen(true);
                    }}
                />
            )}

            {/* УНИВЕРСАЛЬНАЯ ПЛАШКА СОЗДАНИЯ СОБЫТИЙ ПО КЛИКУ НА КАРТУ */}
            <CreateEventDrawer
                open={isCreateOpen}
                clickedCoords={clickedCoords}

                // ОПРЕДЕЛЯЕМ РЕЖИМ: если черновик есть — включаем 'edit', если пустой — 'create'
                mode={editingEvent ? 'edit' : 'create'}

                // Передаем сам объект встречи для автозаполнения полей формы
                initialDraft={editingEvent}

                onClose={() => {
                    setIsCreateOpen(false);
                    setClickedCoords(null);
                    setEditingEvent(null); // Очищаем черновик при закрытии, чтобы следующее открытие было "Создать"
                }}
                onSuccess={() => {
                    setIsCreateOpen(false);
                    setClickedCoords(null);
                    setEditingEvent(null); // Очищаем черновик при успешном сохранении изменений
                    fetchEvents(); // Обновляем живые маркеры на карте
                }}
            />
        </div>
    );
});

export default DistrictMapSection;