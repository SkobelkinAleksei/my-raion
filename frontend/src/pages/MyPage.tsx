import React, { useEffect, useRef, useState } from 'react';
import api from '@/shared/lib/api';
import { useAuth } from '@/shared/context/AuthContext';
import Card from '@/shared/ui/Card';
import Button from '@/shared/ui/Button';
import Badge from '@/shared/ui/Badge';
import PostCard, { Post } from '@/features/feed/PostCard';
import { openMyPhotos, getAvatarUrl } from '@/shared/utils/navigation';
import {
  MapPin,
  Send,
  Award,
  Users,
  Calendar,
  Image as ImageIcon,
  Smile,
  Sparkles,
  Palette,
  Droplets,
  Camera,
} from 'lucide-react';
import MyPostSection from '@/features/feed/MyPostSection';
import AvatarPhotoViewer from '@/features/photos/AvatarPhotoViewer';
import ImageCropModal from '@/features/photos/ImageCropModal';
import ProfilePhotosPreview from '@/features/photos/ProfilePhotosPreview';
import { DEFAULT_COVER_COLOR, fetchPhotos, randomWarmCoverColor, resolvePhotoUrl, updateCover, uploadCoverFile, clearCoverPhoto, uploadAvatarFile } from '@/shared/utils/photoGallery';
import { showAppInfoToast } from '@/shared/utils/appToast';

interface MyPageProps {
  navigate?: (target: string, opts?: { eventsTab?: 'past' | 'upcoming' | 'mine' }) => void;
}

export default function MyPage({ navigate }: MyPageProps) {
  const { user, refreshUser } = useAuth();
  const PAGE_SIZE = 5; // Наш размер пачки
  const [postsState, setPostsState] = useState<{
    items: Post[];
    page: number;
    hasMore: boolean;
  }>({ items: [], page: 0, hasMore: false });
  const [draft, setDraft] = useState('');
  const [commentsAllowed, setCommentsAllowed] = useState(true);
  const [loading, setLoading] = useState(false);
  // Стейты для управления кастомным статусом профиля (Bio)
  const [isEditingBio, setIsEditingBio] = useState(false);
  const [bioText, setBioText] = useState((user as any)?.bio || '');
  const [currentBio, setCurrentBio] = useState((user as any)?.bio || '');

  const [stats, setStats] = useState({
    visitedCount: 0,
    createdCount: 0,
    friendsCount: 0,
    followersCount: 0
  });
  const [photoPreview, setPhotoPreview] = useState<{ total: number; urls: string[] }>({ total: 0, urls: [] });
  const [coverOpen, setCoverOpen] = useState(false);
  const [coverDraft, setCoverDraft] = useState<string | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [coverCrop, setCoverCrop] = useState<File | null>(null);
  const [avatarCrop, setAvatarCrop] = useState<File | null>(null);
  const coverFileRef = useRef<HTMLInputElement>(null);
  const avatarFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      loadMyContent(0);
      loadMyStats();
      loadPhotoPreview();
      setCurrentBio((user as any).bio || '');
      setBioText((user as any).bio || '');
    }
  }, [user]);

  useEffect(() => {
    const handleLiveLike = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { postId, senderId, isRemoved } = customEvent.detail;

      // 1. НАДЁЖНАЯ ЗАЩИТА: Игнорируем собственные клики, чтобы не было накрутки
      if (senderId && user?.id && String(senderId) === String(user.id)) {
        return;
      }

      // 2. Обновляем счетчик для других пользователей
      setPostsState(prev => ({
        ...prev,
        items: prev.items.map(p =>
            p.id === Number(postId) ? { ...p, likesCount: isRemoved ? Math.max(0, p.likesCount - 1) : p.likesCount + 1 } : p
        )
      }));
    };

    window.addEventListener('liveLikeUpdate', handleLiveLike);
    return () => window.removeEventListener('liveLikeUpdate', handleLiveLike);
  }, [user]);



  const handleSaveBio = async () => {
    try {
      await api.put('/api/v1/social/users/status', {
        bio: bioText.trim()
      });
      setCurrentBio(bioText.trim());
      setIsEditingBio(false);
    } catch (error) {
      console.error("Не удалось сохранить статус профиля:", error);
    }
  };
  const loadMyStats = async () => {
    if (!user) return;
    try {
      const [countersRes, friendsRes, subscribersCountRes] = await Promise.all([
        api.get(`/api/v1/social/events/public/user/${user.id}/counters`).catch(() => ({ data: { visited: 0, created: 0 } })),
        api.get(`/api/v1/social/friends/public/${user.id}/count`).catch(() => ({ data: 0 })),
        api.get(`/api/v1/social/friends/requests/count/subscribers/${user.id}`).catch(() => ({ data: 0 }))
      ]);

      setStats({
        visitedCount: countersRes.data?.visited ?? 0,
        createdCount: countersRes.data?.created ?? 0,
        friendsCount: Number(friendsRes.data || 0),
        followersCount: typeof subscribersCountRes.data === 'number' ? subscribersCountRes.data : 0
      });
    } catch (error) {
      console.error("Ошибка при подсчёте статистики профиля:", error);
    }
  };
  const loadPhotoPreview = async () => {
    if (!user) return;
    try {
      const data = await fetchPhotos(Number(user.id), { page: 0, size: 16 });
      setPhotoPreview({
        total: Number(data.total) || 0,
        urls: (data.items || []).map((item) => resolvePhotoUrl(item.url)),
      });
    } catch {
      setPhotoPreview({ total: 0, urls: [] });
    }
  };
  const saveCover = async (mode: 'COLOR' | 'TRANSPARENT', color?: string) => {
    try {
      await updateCover(mode, color);
      await refreshUser();
      setCoverDraft(null);
      setCoverOpen(false);
    } catch (error: any) {
      showAppInfoToast('Обложка', error?.response?.data?.detail || 'Не удалось сохранить фон');
    }
  };
  const closeCoverMenu = async (commit: boolean) => {
    if (commit && coverDraft) {
      await saveCover('COLOR', coverDraft);
      return;
    }
    setCoverDraft(null);
    setCoverOpen(false);
  };
  const saveCoverPhoto = async (file: File) => {
    await uploadCoverFile(file);
    await refreshUser();
    setCoverCrop(null);
    setCoverOpen(false);
  };
  const loadMyContent = async (pageToLoad = 0) => {
    if (!user) return;
    setLoading(true);
    try {
      // Шлем запрос строго на /my-posts с правильными параметрами пагинации
      const postsRes = await api.get('/api/v1/social/posts/my-posts', {
        params: { status: 'PUBLISHED', page: pageToLoad, size: PAGE_SIZE }
      });
      const rawPosts = postsRes.data || [];
      const mappedPosts: Post[] = rawPosts.map((p: any) => ({
        id: p.id,
        authorId: p.authorId,
        content: p.content,
        commentsAllowed: p.commentsAllowed,
        canComment: p.canComment ?? true,
        createdAt: p.createdAt,
        authorName: `${user.firstName} ${user.lastName || ''}`,
        authorAvatarUrl: user.avatarUrl,
        isLiked: Boolean(p.isLiked ?? p.liked),
        likesCount: p.likesCount || 0,
        viewsCount: p.viewsCount || 0,
        commentsCount: p.commentsCount || 0,
        photos: p.photos || []
      }));

      setPostsState(prev => ({
        items: pageToLoad === 0 ? mappedPosts : [...prev.items, ...mappedPosts],
        page: pageToLoad,
        hasMore: rawPosts.length === PAGE_SIZE // Если пришло ровно 5, значит есть еще посты
      }));
    } catch (error) {
      console.error("Ошибка загрузки публикаций профиля:", error);
    } finally {
      setLoading(false);
    }
  };

  const publish = async () => {
    if (!draft.trim() || !user) return;
    try {
      await api.post('/api/v1/social/posts', { content: draft.trim(), commentsAllowed: commentsAllowed });
      setDraft('');
      loadMyContent(0);
    } catch (error) {
      console.error("Ошибка при создании поста:", error);
    }
  };
  if (!user) {
    return <div className="p-8 text-slate-500">Загружаем профиль...</div>;
  }

  const coverMode = String(user.coverMode || '').toUpperCase();
  const hasCoverBanner = coverMode === 'COLOR' || coverMode === 'PHOTO' || !!coverDraft;
  const previewCover = coverDraft || (coverMode === 'COLOR' ? (user.coverColor || DEFAULT_COVER_COLOR) : null);

  return (
      <div className="max-w-3xl mx-auto px-4 sm:px-5 lg:px-6 py-4 md:py-6 lg:py-8 min-h-screen">
        <Card padded={false} className={`relative overflow-visible mb-4 md:mb-5 lg:mb-6 h-auto ${hasCoverBanner ? '' : '!rounded-[24px]'}`}>
          {hasCoverBanner && (
          <div
            className={`h-24 md:h-28 lg:h-32 relative overflow-hidden rounded-t-[24px] lg:rounded-t-[32px] ${previewCover ? '' : 'bg-[#EDE6F5]'}`}
            style={previewCover ? { background: previewCover } : undefined}
          >
            {coverMode === 'PHOTO' && user.coverUrl && !coverDraft && (
              <img src={resolvePhotoUrl(user.coverUrl)} alt="" className="absolute inset-0 w-full h-full object-cover" />
            )}
            {(coverMode !== 'PHOTO' || coverDraft) && (
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(255,255,255,0.25),transparent_60%)]" />
            )}
          </div>
          )}
            <input
              ref={coverFileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setCoverCrop(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (coverOpen) void closeCoverMenu(true);
                else {
                  setCoverDraft(null);
                  setCoverOpen(true);
                }
              }}
              className="absolute top-2.5 right-2.5 md:top-3 md:right-3 z-20 w-8 h-8 md:w-auto md:h-8 md:px-3 rounded-full bg-white/95 md:bg-white text-[#5C4B7A] text-[11px] font-semibold inline-flex items-center justify-center md:gap-1.5 border border-[#1C1824]/12 shadow-sm"
              aria-label="Фон"
              title="Фон"
            >
              <Palette className="w-4 h-4 md:w-3.5 md:h-3.5" />
              <span className="hidden md:inline">Фон</span>
            </button>
          {coverOpen && (
            <>
              <button type="button" className="fixed inset-0 z-[35] cursor-default" aria-label="Закрыть меню фона" onClick={() => {
                if (document.activeElement?.getAttribute?.('type') === 'color') return;
                void closeCoverMenu(true);
              }} />
              <div className="absolute top-12 right-3 z-40 w-52 max-w-[calc(100%-1.5rem)] bg-white rounded-xl shadow-[0_16px_40px_rgba(28,24,36,0.28)] border border-[#1C1824]/15 p-1.5 space-y-0.5">
              <label className="flex items-center justify-between text-[12px] text-[#1C1824] px-2 py-1.5">
                Цвет
                <input
                  type="color"
                  value={coverDraft || user.coverColor || DEFAULT_COVER_COLOR}
                  onInput={(e) => setCoverDraft(e.currentTarget.value)}
                  onChange={(e) => setCoverDraft(e.currentTarget.value)}
                  className="w-7 h-7 rounded cursor-pointer bg-transparent"
                />
              </label>
              {coverDraft && (
                <div className="flex gap-1 px-1.5 pb-1">
                  <button type="button" onClick={() => void closeCoverMenu(false)} className="flex-1 text-[11px] font-semibold px-2 py-1.5 rounded-lg text-[#6B645C] hover:bg-[#F2EBE3]">
                    Отмена
                  </button>
                  <button type="button" onClick={() => void closeCoverMenu(true)} className="flex-1 text-[11px] font-semibold px-2 py-1.5 rounded-lg bg-[#5C4B7A] text-white hover:bg-[#4A3C66]">
                    Готово
                  </button>
                </div>
              )}
              <button type="button" onClick={() => setCoverDraft(randomWarmCoverColor())} className="w-full text-left text-[12px] px-2 py-1.5 rounded-lg hover:bg-[#EDE6F5]">
                Случайный цвет
              </button>
              <button type="button" onClick={() => { coverFileRef.current?.click(); }} className="w-full text-left text-[12px] px-2 py-1.5 rounded-lg hover:bg-[#EDE6F5] inline-flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5" /> Добавить фото на фон
              </button>
              {coverMode === 'PHOTO' && (
                <button type="button" onClick={async () => {
                  try {
                    await clearCoverPhoto();
                    await refreshUser();
                    setCoverOpen(false);
                  } catch (error: any) {
                    showAppInfoToast('Обложка', error?.response?.data?.detail || 'Не удалось убрать фото');
                  }
                }} className="w-full text-left text-[12px] px-2 py-1.5 rounded-lg hover:bg-[#EDE6F5] text-[#B85C5C]">
                  Убрать фото фона
                </button>
              )}
              {hasCoverBanner && (
              <button type="button" onClick={() => saveCover('TRANSPARENT')} className="w-full text-left text-[12px] px-2 py-1.5 rounded-lg hover:bg-[#EDE6F5] inline-flex items-center gap-1.5">
                <Droplets className="w-3.5 h-3.5" /> Убрать фон
              </button>
              )}
              </div>
            </>
          )}
          <div className={`px-4 md:px-5 lg:px-6 relative z-[15] ${hasCoverBanner ? 'pt-0 pb-3 md:pb-4 lg:pb-6 -mt-8 md:-mt-10 lg:-mt-12' : 'py-3.5 md:py-5 lg:py-6'}`}>
            <div className="flex items-start gap-3 md:gap-4 lg:gap-5">
              <div className="relative shrink-0">
                <button type="button" onClick={() => setAvatarOpen(true)}>
                  <img src={getAvatarUrl(user.id, user.avatarUrl)} alt={`${user.firstName}`} className="w-16 h-16 md:w-20 md:h-20 lg:w-28 lg:h-28 rounded-full object-cover border-[3px] lg:border-4 border-white shadow-md" />
                </button>
                <button
                  type="button"
                  className="absolute -bottom-0.5 -right-0.5 md:bottom-0.5 md:right-0.5 lg:bottom-1 lg:right-1 w-6 h-6 lg:w-7 lg:h-7 bg-[#5C4B7A] border-[3px] lg:border-4 border-white rounded-full flex items-center justify-center"
                  onClick={() => avatarFileRef.current?.click()}
                >
                  <Camera className="w-3 h-3 text-white" />
                </button>
              </div>
              <input
                ref={avatarFileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setAvatarCrop(file);
                  e.target.value = '';
                }}
              />
              <div className={`flex-1 min-w-0 pr-9 md:pr-0 ${hasCoverBanner ? 'pt-8 md:pt-10 lg:pt-14' : 'pt-0.5'}`}>
                <div className="flex items-start gap-1.5 min-w-0">
                  <h1 className="myraion-display text-[16px] md:text-[24px] lg:text-[36px] leading-[1.2] lg:leading-[0.95] text-[#1C1824]">
                    {user.firstName} {user.lastName}
                  </h1>
                  <span
                    className={`mt-[5px] md:mt-2 lg:mt-3 w-2.5 h-2.5 lg:w-3 lg:h-3 rounded-full shrink-0 ${user.online === false ? 'bg-slate-300' : 'bg-[#4A8B6F]'}`}
                    title={user.online === false ? 'Не в сети' : 'В сети'}
                  />
                </div>
                <div className="mt-2 lg:mt-3 flex items-center gap-1 text-[12px] md:text-[13px] lg:text-sm text-slate-500 whitespace-nowrap overflow-hidden min-w-0">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{user.city}, {user.districtName}</span>
                </div>
                <div className="mt-1.5 group/bio relative min-w-0 w-full overflow-hidden">
              {isEditingBio ? (
                  <div className="space-y-2 animate-fadeIn">
                <textarea
                    value={bioText}
                    onChange={(e) => setBioText(e.target.value.slice(0, 250))}
                    placeholder="Расскажите немного о себе..."
                    rows={3}
                    maxLength={250}
                    className="w-full min-w-0 resize-none px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#5C4B7A]/20 focus:bg-white focus:border-[#5C4B7A] transition break-words [overflow-wrap:anywhere]"
                />
                    <div className="flex gap-2 justify-end items-center">
                      <span className="mr-auto text-[11px] text-slate-400 tabular-nums">{bioText.length}/250</span>
                      <button type="button" className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-lg transition" onClick={() => { setIsEditingBio(false); setBioText(currentBio); }}>
                        Отмена
                      </button>
                      <Button size="sm" className="text-xs" onClick={handleSaveBio}>Сохранить</Button>
                    </div>
                  </div>
              ) : (
                  <div onClick={() => setIsEditingBio(true)} className="cursor-pointer rounded-xl hover:bg-slate-100/60 py-0.5 -mx-0.5 px-0.5 transition-colors duration-200 min-w-0 max-w-full" title="Нажмите, чтобы изменить статус">
                    <p className={`text-[13px] md:text-sm leading-snug font-normal break-words [overflow-wrap:anywhere] max-w-full ${currentBio ? 'text-slate-600' : 'text-slate-400 italic'}`}>
                      {currentBio || 'Кликните, чтобы написать статус'}
                    </p>
                  </div>
              )}
                </div>
              </div>
            </div>
          </div>
        </Card>
        <div className="grid grid-cols-3 gap-2 md:gap-3 lg:gap-4 mb-4 md:mb-5 lg:mb-6">
          <div className="w-full min-w-0 bg-[#FFFCFA] rounded-2xl lg:rounded-[32px] p-2.5 md:p-3 lg:p-5 flex flex-col justify-between">
            <div className="flex items-center gap-1 md:gap-1.5 text-slate-500 text-[11px] md:text-xs lg:text-sm font-medium mb-1.5 w-full">
              <Award className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-[#5C4B7A] shrink-0" />
              <span className="truncate">Мой вклад</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-1 lg:gap-1.5 w-full pt-0.5">
              <div className="flex items-baseline justify-between gap-1 lg:block">
                <div className="text-[9px] md:text-[10px] uppercase tracking-wide text-slate-400 font-bold">Репутация</div>
                <div className="text-sm lg:text-xl font-bold text-slate-900 leading-tight lg:mt-0.5 tabular-nums">{(user as any).reputation > 0 ? `+${(user as any).reputation}` : (user as any).reputation ?? 0}</div>
              </div>
              <div className="flex items-baseline justify-between gap-1 lg:block lg:border-l lg:border-slate-100 lg:pl-3">
                <div className="text-[9px] md:text-[10px] uppercase tracking-wide text-slate-400 font-bold">Посты</div>
                <div className="text-sm lg:text-xl font-bold text-slate-900 leading-tight lg:mt-0.5 tabular-nums">{postsState.items.length}</div>
              </div>
            </div>
          </div>

          <button type="button" onClick={() => navigate?.('friends')} className="w-full min-w-0 bg-[#FFFCFA] rounded-2xl lg:rounded-[32px] p-2.5 md:p-3 lg:p-5 text-left hover:shadow-md flex flex-col justify-between">
            <div className="flex items-center gap-1 md:gap-1.5 text-slate-500 text-[11px] md:text-xs lg:text-sm font-medium mb-1.5 w-full">
              <Users className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-[#5C4B7A] shrink-0" />
              <span className="truncate"><span className="lg:hidden">Связи</span><span className="hidden lg:inline">Мои связи</span></span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-1 lg:gap-1.5 w-full pt-0.5">
              <div className="flex items-baseline justify-between gap-1 lg:block">
                <div className="text-[9px] md:text-[10px] uppercase tracking-wide text-slate-400 font-bold">Друзья</div>
                <div className="text-sm lg:text-xl font-bold text-slate-900 leading-tight lg:mt-0.5 tabular-nums">{stats.friendsCount}</div>
              </div>
              <div className="flex items-baseline justify-between gap-1 lg:block lg:border-l lg:border-slate-100 lg:pl-3">
                <div className="text-[9px] md:text-[10px] uppercase tracking-wide text-slate-400 font-bold">Подписчики</div>
                <div className="text-sm lg:text-xl font-bold text-[#5C4B7A] leading-tight lg:mt-0.5 tabular-nums">{stats.followersCount}</div>
              </div>
            </div>
          </button>
          <button type="button" onClick={() => navigate?.('events')} className="w-full min-w-0 bg-[#FFFCFA] rounded-2xl lg:rounded-[32px] p-2.5 md:p-3 lg:p-5 text-left hover:shadow-md flex flex-col justify-between">
            <div className="flex items-center gap-1 md:gap-1.5 text-slate-500 text-[11px] md:text-xs lg:text-sm font-medium mb-1.5 w-full">
              <Calendar className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-[#5C4B7A] shrink-0" />
              <span className="truncate">События</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-1 lg:gap-1.5 w-full pt-0.5">
              <div className="flex items-baseline justify-between gap-1 lg:block">
                <div className="text-[9px] md:text-[10px] uppercase tracking-wide text-slate-400 font-bold">Посетил</div>
                <div className="text-sm lg:text-xl font-bold text-slate-900 leading-tight lg:mt-0.5 tabular-nums">{stats.visitedCount}</div>
              </div>
              <div className="flex items-baseline justify-between gap-1 lg:block lg:border-l lg:border-slate-100 lg:pl-3">
                <div className="text-[9px] md:text-[10px] uppercase tracking-wide text-slate-400 font-bold">Создал</div>
                <div className="text-sm lg:text-xl font-bold text-[#5C4B7A] leading-tight lg:mt-0.5 tabular-nums">{stats.createdCount}</div>
              </div>
            </div>
          </button>
        </div>

        <div className="mb-6">
          <ProfilePhotosPreview
            userId={Number(user.id)}
            total={photoPreview.total}
            urls={photoPreview.urls}
            owner
            emptyHint="Добавьте первые снимки в альбом"
            onOpenAll={() => { openMyPhotos(); navigate?.('photos'); }}
            onChanged={loadPhotoPreview}
          />
        </div>

        <MyPostSection onPostCreated={() => loadMyContent(0)} />
        {loading && postsState.items.length === 0 ? (
            <div className="space-y-4 animate-pulse">
              <div className="h-36 rounded-[24px] bg-[#EDE6F5]" />
              <div className="h-36 rounded-[24px] bg-[#EDE6F5]" />
            </div>
        ) : (
            <div className="space-y-4">
              {postsState.items.map((p) => (
                  <PostCard
                      key={p.id}
                      post={p}
                      currentUserId={Number(user.id)}
                      districtName={user.districtName}
                      onPostDeleted={(deletedId) => setPostsState(prev => ({ ...prev, items: prev.items.filter(item => item.id !== deletedId) }))}
                      onPostUpdated={(id, text, photos) => setPostsState(prev => ({ ...prev, items: prev.items.map(item => item.id === id ? { ...item, content: text, photos: photos ?? item.photos } : item) }))}
                      onPostLiked={(id, isLiked, count) => setPostsState(prev => ({
                        ...prev,
                        items: prev.items.map(item => item.id === id ? { ...item, isLiked, likesCount: count } : item)
                      }))}
                  />
              ))}

              {postsState.items.length === 0 && (
                  <div className="text-center py-12 bg-[#FFFCFA] rounded-[32px] text-[#8A8494] text-sm">
                    Публикаций пока нет
                  </div>
              )}

              {postsState.hasMore && (
                  <div className="w-full flex justify-center pt-6 pb-4">
                    <button
                        type="button"
                        onClick={() => loadMyContent(postsState.page + 1)}
                        disabled={loading}
                        className="bg-[#FFFCFA] hover:bg-white text-[#5C4B7A] px-6 py-2.5 rounded-full text-xs cursor-pointer select-none disabled:opacity-50"
                    >
                      {loading ? "Загрузка..." : "Показать другие публикации"}
                    </button>
                  </div>
              )}
            </div>
        )}

        {avatarOpen && (
          <AvatarPhotoViewer
            userId={Number(user.id)}
            owner
            onClose={() => setAvatarOpen(false)}
            onEmpty={() => avatarFileRef.current?.click()}
            onChanged={refreshUser}
          />
        )}
        {avatarCrop && (
          <ImageCropModal
            source={avatarCrop}
            variant="avatar"
            onCancel={() => setAvatarCrop(null)}
            onConfirm={async (file, original) => {
              await uploadAvatarFile(file, original);
              await refreshUser();
              setAvatarCrop(null);
            }}
          />
        )}
        {coverCrop && (
          <ImageCropModal
            source={coverCrop}
            variant="cover"
            onCancel={() => setCoverCrop(null)}
            onConfirm={saveCoverPhoto}
          />
        )}

      </div>
  );
}
