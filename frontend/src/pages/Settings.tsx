import React, { useState, useEffect, useRef } from 'react';
import Card from '@/shared/ui/Card';
import Button from '@/shared/ui/Button';
import { useAuth } from '@/shared/context/AuthContext';
import api from '@/shared/lib/api';
import { apiUrl } from '@/shared/lib/runtime';
import { getAvatarUrl } from '@/shared/utils/navigation';
import { isNotificationSoundEnabled, setNotificationSoundEnabled, playNotificationSound, unlockNotificationSound } from '@/shared/utils/notificationSound';
import { disableWebPush, enableWebPush, isWebPushGranted } from '@/shared/lib/webPush';
import {
  User,
  Bell,
  Lock,
  MapPin,
  LogOut,
  ChevronRight,
  Shield,
  Award,
  Calendar,
  MessageSquare,
  MessageCircle,
  Eye,
  EyeOff,
  Image as ImageIcon,
  X,
  Pencil,
  Check,
  Home,
  Clock,
  Volume2,
  Smartphone,
  Trash2
} from 'lucide-react';
import { showAppConfirm } from '@/shared/utils/appToast';
import { requestChangePage } from '@/shared/utils/navigation';
import { openFeedbackForm } from '@/shared/lib/feedbackForm';

interface AddressSuggestion {
  value: string;
  data: {
    city: string;
    street_with_type: string;
    house: string;
    geo_lat: string;
    geo_lon: string;
    district: string;
  };
}

type SelectedHomeGeo = {
  city: string;
  streetAddress: string;
  districtName: string;
  lat: number;
  lng: number;
};

function revealInputEnd(input: HTMLInputElement) {
  const len = input.value.length;
  try {
    input.setSelectionRange(len, len);
  } catch {
    /* iOS может запретить selection на некоторых типах */
  }
  input.scrollLeft = input.scrollWidth;
}

function queueRevealInputEnd(input: HTMLInputElement | null) {
  if (!input) return;
  revealInputEnd(input);
  requestAnimationFrame(() => revealInputEnd(input));
  window.setTimeout(() => revealInputEnd(input), 50);
}

function displayHomeAddress(user?: { city?: string; streetAddress?: string } | null) {
  return [user?.city, user?.streetAddress].filter(Boolean).join(', ');
}

function geoFromUser(user?: { city?: string; streetAddress?: string; districtName?: string; homeLatitude?: number | null; homeLongitude?: number | null } | null): SelectedHomeGeo | null {
  if (!user?.streetAddress && !user?.city) return null;
  const lat = Number(user?.homeLatitude);
  const lng = Number(user?.homeLongitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    city: user?.city || '',
    streetAddress: user?.streetAddress || '',
    districtName: user?.districtName || '',
    lat,
    lng,
  };
}

export default function Settings() {
  const { user, logout, refreshUser } = useAuth(); // Подтягиваем данные авторизованного соседа

  // 1. ЕДИНЫЙ СТЕЙТ ДЛЯ ВСЕХ ТУМБЛЕРОВ ИЗ БЭКЕНДА
  const [settings, setSettings] = useState({
    allowDmFromAll: true,
    allowCommentsFromAll: true,
    photoVisibility: 'ALL',
    notifyComments: true,
    notifyMessages: true,
    notifyEventRequests: true,
    notifyReputation: true,
    showLastSeen: true
  });

  const [loading, setLoading] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(isNotificationSoundEnabled);
  const [phonePushEnabled, setPhonePushEnabled] = useState(isWebPushGranted);

  // Стейты для редактирования личных данных (UpdateUserDto)
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    email: user?.email || '',
    numberPhone: user?.numberPhone || '',
    city: user?.city || '',
    districtName: user?.districtName || '',
    streetAddress: user?.streetAddress || ''
  });
  const [profileLoading, setProfileLoading] = useState(false);
  const [addressQuery, setAddressQuery] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [selectedAddressValue, setSelectedAddressValue] = useState<string | null>(null);
  const [selectedGeo, setSelectedGeo] = useState<SelectedHomeGeo | null>(null);
  const [addressError, setAddressError] = useState('');
  const addressInputRef = useRef<HTMLInputElement>(null);

  const hydrateProfileFromUser = (nextUser: typeof user) => {
    if (!nextUser) return;
    setProfileForm({
      firstName: nextUser.firstName || '',
      lastName: nextUser.lastName || '',
      email: nextUser.email || '',
      numberPhone: nextUser.numberPhone || '',
      city: nextUser.city || '',
      districtName: nextUser.districtName || '',
      streetAddress: nextUser.streetAddress || ''
    });
    const shown = displayHomeAddress(nextUser);
    setAddressQuery(shown);
    setSelectedAddressValue(shown || null);
    setSelectedGeo(geoFromUser(nextUser));
    setAddressSuggestions([]);
    setAddressError('');
  };

  // Стейты модалки изменения пароля
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  const closePasswordModal = () => {
    setIsPasswordModalOpen(false);
    setOldPassword('');
    setNewPassword('');
    setPasswordError('');
    setPasswordSuccess(false);
    setShowOldPassword(false);
    setShowNewPassword(false);
  };
  // ЭФФЕКТ: Загружаем настройки из базы данных при открытии страницы
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await api.get('/api/v1/social/users/profile/settings');
        if (response.data) {
          setSettings({
            allowDmFromAll: response.data.allowDmFromAll ?? true,
            allowCommentsFromAll: response.data.allowCommentsFromAll ?? true,
            photoVisibility: response.data.photoVisibility || 'ALL',
            notifyComments: response.data.notifyComments ?? true,
            notifyMessages: response.data.notifyMessages ?? true,
            notifyEventRequests: response.data.notifyEventRequests ?? true,
            notifyReputation: response.data.notifyReputation ?? true,
            showLastSeen: response.data.showLastSeen !== false,
          });
        }
      } catch (error) {
        console.error("Не удалось загрузить настройки пользователя:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  // Синхронизируем форму профиля, когда данные юзера подгрузились — не трогаем, пока идёт редактирование
  useEffect(() => {
    if (isEditingProfile) return;
    hydrateProfileFromUser(user);
  }, [user, isEditingProfile]);

  useEffect(() => {
    if (!isEditingProfile) return;
    if (addressQuery.length < 3 || addressQuery === selectedAddressValue) {
      setAddressSuggestions([]);
      return;
    }
    const delayDebounce = setTimeout(async () => {
      try {
        const response = await fetch(apiUrl('/api/v1/geo/suggest/address'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ query: addressQuery, count: 5 }),
        });
        const result = await response.json();
        setAddressSuggestions(result.suggestions || []);
      } catch (err) {
        console.error('Ошибка DaData:', err);
      }
    }, 400);
    return () => clearTimeout(delayDebounce);
  }, [addressQuery, selectedAddressValue, isEditingProfile]);

  const handleSelectAddress = (s: AddressSuggestion) => {
    const street = `${s.data.street_with_type || ''} ${s.data.house ? 'д. ' + s.data.house : ''}`.trim();
    const geo: SelectedHomeGeo = {
      city: s.data.city || 'Москва',
      streetAddress: street || s.value,
      districtName: s.data.district || 'Центральный',
      lat: parseFloat(s.data.geo_lat || '55.7558'),
      lng: parseFloat(s.data.geo_lon || '37.6173'),
    };
    setSelectedAddressValue(s.value);
    setAddressQuery(s.value);
    setSelectedGeo(geo);
    setProfileForm((prev) => ({
      ...prev,
      city: geo.city,
      streetAddress: geo.streetAddress,
      districtName: geo.districtName,
    }));
    setAddressSuggestions([]);
    setAddressError('');
  };

  useEffect(() => {
    if (!isEditingProfile) return;
    if (!selectedAddressValue || addressQuery !== selectedAddressValue) return;
    queueRevealInputEnd(addressInputRef.current);
  }, [addressQuery, selectedAddressValue, isEditingProfile]);

  // УНИВЕРСАЛЬНАЯ ФУНКЦИЯ: Автоматически отправляет PUT-запрос при клике на любой тумблер
  const handleToggleChange = async (field: keyof typeof settings, value: any) => {
    const previous = settings;
    const updatedSettings = { ...settings, [field]: value };
    setSettings(updatedSettings);
    try {
      await api.put('/api/v1/social/users/profile/settings', updatedSettings);
    } catch (error: any) {
      console.error(`Не удалось сохранить поле настроек ${field}:`, error);
      setSettings(previous);
      alert(error?.response?.data?.detail || error?.response?.data?.message || 'Не удалось сохранить настройки');
    }
  };

  // Функция сохранения личных данных
  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGeo) {
      setAddressError('Пожалуйста, выберите точный адрес дома из выпадающего списка подсказок.');
      return;
    }
    setAddressError('');
    setProfileLoading(true);
    try {
      await api.put('/api/v1/social/users/me', {
        ...profileForm,
        city: selectedGeo.city,
        streetAddress: selectedGeo.streetAddress,
        districtName: selectedGeo.districtName,
        homeLatitude: selectedGeo.lat,
        homeLongitude: selectedGeo.lng,
      });
      await refreshUser();
      setIsEditingProfile(false);
    } catch (error: any) {
      console.error("Ошибка обновления личных данных:", error);
      alert(error?.response?.data?.detail || error?.response?.data?.message || 'Не удалось обновить профиль');
    } finally {
      setProfileLoading(false);
    }
  };

  // Функция отправки формы смены пароля
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oldPassword || !newPassword) {
      setPasswordError('Пожалуйста, заполните все поля!');
      return;
    }
    setPasswordLoading(true);
    setPasswordError('');
    setPasswordSuccess(false);
    try {
      await api.put('/api/v1/social/users/me/pass', {
        oldPassword: oldPassword,
        newPassword: newPassword
      });
      setPasswordSuccess(true);
      setOldPassword('');
      setNewPassword('');
      setTimeout(() => {
        setIsPasswordModalOpen(false);
        setPasswordSuccess(false);
      }, 1500);
    } catch (err: any) {
      setPasswordError(err.response?.data?.detail || err.response?.data?.message || 'Неверный старый пароль или новый пароль слишком простой');
    } finally {
      setPasswordLoading(false);
    }
  };

  if (loading) {
    return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#5C4B7A]"></div>
        </div>
    );
  }
  return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 min-h-screen pb-16">
        <div className="mb-8">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#8A8494] mb-2">Профиль · аккаунт</p>
          <h1 className="myraion-display text-[32px] sm:text-[44px] md:text-[52px] leading-[0.92] text-[#1C1824]">Настройки</h1>
          <p className="text-sm text-[#8A8494] mt-3 max-w-xl">Личные данные, приватность и уведомления</p>
        </div>

        <div className="space-y-6">
          {/* РАЗДЕЛ 1: АККАУНТ (ЛИЧНЫЕ ДАННЫЕ) */}
          <Card className="p-5 sm:p-6 overflow-visible">
            <div className="flex items-center justify-between border-b border-[#1C1824]/8 pb-4 mb-4">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-[#5C4B7A]" />
                <h2 className="myraion-display text-xl text-[#1C1824]">Личные данные</h2>
              </div>
              {!isEditingProfile && (
                  <button
                      type="button"
                      onClick={() => {
                        hydrateProfileFromUser(user);
                        setIsEditingProfile(true);
                      }}
                      className="flex items-center justify-center gap-1.5 text-xs font-bold text-[#5C4B7A] hover:text-[#4A3C66] bg-[#EDE6F5] hover:bg-[#DDD4F0] w-9 h-9 md:w-auto md:h-auto md:px-3 md:py-1.5 rounded-full transition"
                      aria-label="Редактировать"
                      title="Редактировать"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">Редактировать</span>
                  </button>
              )}
            </div>

            {!isEditingProfile ? (
                /* РЕЖИМ ПРОСМОТРА ПРОФИЛЯ */
                <div className="flex flex-col sm:flex-row items-center gap-4 bg-[#EFEAF6] p-4 rounded-[24px]">
                  <img
                      src={getAvatarUrl(user?.id, user?.avatarUrl)}
                      alt="Аватар"
                      className="w-16 h-16 rounded-full object-cover border border-slate-200 shadow-sm bg-[#EDE6F5]"
                  />
                  <div className="text-center sm:text-left min-w-0 flex-1">
                    <h3 className="font-bold text-base text-slate-900">{user?.firstName} {user?.lastName}</h3>
                    <p className="text-xs text-slate-400 font-medium truncate mt-0.5">{user?.email}</p>
                    {user?.numberPhone && (
                        <p className="text-xs text-slate-400 font-medium truncate mt-0.5">{user.numberPhone}</p>
                    )}
                    <div className="flex flex-col gap-1.5 mt-3">
                      <div className="flex items-center justify-center sm:justify-start gap-1 text-xs text-slate-600 font-semibold bg-white px-2.5 py-1 border border-slate-100 rounded-lg w-fit shadow-sm">
                        <MapPin className="w-3.5 h-3.5 text-[#5C4B7A]" />
                        <span>{user?.city || 'Лиски'}, {user?.districtName || 'Центральный'}</span>
                      </div>
                      {user?.streetAddress && (
                          <div className="flex items-center justify-center sm:justify-start gap-1 text-[11px] text-slate-400 font-medium px-1">
                            <Home className="w-3 h-3 text-slate-400" />
                            <span>Улица: {user?.streetAddress}</span>
                          </div>
                      )}
                    </div>
                  </div>
                </div>
            ) : (
                /* РЕЖИМ РЕДАКТИРОВАНИЯ ПРОФИЛЯ (ФОРМА) */
                <form onSubmit={handleProfileSubmit} className="space-y-4 bg-slate-50/50 p-4 rounded-2xl border border-slate-100 overflow-visible">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Имя</label>
                      <input
                          type="text"
                          value={profileForm.firstName}
                          onChange={(e) => setProfileForm({ ...profileForm, firstName: e.target.value })}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#5C4B7A]/40 transition"
                          required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Фамилия</label>
                      <input
                          type="text"
                          value={profileForm.lastName}
                          onChange={(e) => setProfileForm({ ...profileForm, lastName: e.target.value })}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#5C4B7A]/40 transition"
                          required
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Email</label>
                      <input
                          type="email"
                          value={profileForm.email}
                          onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#5C4B7A]/40 transition"
                          required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Телефон</label>
                      <input
                          type="tel"
                          value={profileForm.numberPhone}
                          onChange={(e) => setProfileForm({ ...profileForm, numberPhone: e.target.value })}
                          placeholder="+79991234567"
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#5C4B7A]/40 transition"
                          required
                      />
                    </div>
                  </div>
                  <div className="relative z-20">
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Адрес проживания (город, улица, дом)</label>
                    <div className="relative">
                      <MapPin className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                          ref={addressInputRef}
                          type="text"
                          inputMode="text"
                          placeholder="Введите город, улицу и дом..."
                          value={addressQuery}
                          onChange={(e) => {
                            const next = e.target.value;
                            setAddressQuery(next);
                            if (selectedAddressValue && next !== selectedAddressValue) {
                              setSelectedAddressValue(null);
                              setSelectedGeo(null);
                            }
                          }}
                          onFocus={(e) => queueRevealInputEnd(e.currentTarget)}
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          name="home-address"
                          className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#5C4B7A]/40 transition"
                      />
                      {addressSuggestions.length > 0 && (
                        <div
                          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto overscroll-contain bg-white border border-slate-200 rounded-2xl shadow-lg"
                        >
                          {addressSuggestions.map((s, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onPointerDown={(e) => {
                                e.preventDefault();
                                handleSelectAddress(s);
                              }}
                              className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition border-b border-slate-50 last:border-0 focus:outline-none"
                            >
                              {s.value}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">Выберите адрес из подсказок.</p>
                    {addressError && (
                      <p className="text-[11px] text-red-500 font-medium mt-1">{addressError}</p>
                    )}
                  </div>
                  <div className="flex gap-2 justify-end pt-2 border-t border-slate-100">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          hydrateProfileFromUser(user);
                          setIsEditingProfile(false);
                        }}
                        className="text-xs py-2 px-4 font-semibold text-slate-500 border border-slate-200 rounded-xl bg-white"
                    >
                      Отмена
                    </Button>
                    <Button
                        type="submit"
                        disabled={profileLoading}
                        className="text-xs py-2 px-4 bg-[#5C4B7A] hover:bg-[#4A3C66] text-white font-semibold rounded-xl flex items-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      {profileLoading ? 'Сохранение...' : 'Сохранить'}
                    </Button>
                  </div>
                </form>
            )}
          </Card>
          {/* РАЗДЕЛ 2: ПРИВАТНОСТЬ */}
          <Card className="p-5 sm:p-6">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-4 mb-4">
              <Shield className="w-5 h-5 text-[#5C4B7A]" />
              <h2 className="myraion-display text-xl text-[#1C1824]">Приватность</h2>
            </div>
            <div className="space-y-4">
              {/* Тумблер 1: Личные сообщения */}
              <div className="flex items-center justify-between py-1">
                <div className="pr-4">
                  <div className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-slate-400" />
                    <span>Личные сообщения от всех</span>
                  </div>
                  <div className="text-xs text-slate-400 font-medium mt-0.5">Разрешить отправку личных сообщений пользователям, которых нет в ваших друзьях</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 select-none">
                  <input
                      type="checkbox"
                      checked={settings.allowDmFromAll}
                      onChange={(e) => handleToggleChange('allowDmFromAll', e.target.checked)}
                      className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full transition-colors peer peer-checked:bg-[#5C4B7A] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5"></div>
                </label>
              </div>
              {/* Тумблер 2: Комментарии */}
              <div className="flex items-center justify-between py-1 border-t border-slate-50 pt-4">
                <div className="pr-4">
                  <div className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <MessageCircle className="w-4 h-4 text-slate-400" />
                    <span>Комментарии к постам от всех</span>
                  </div>
                  <div className="text-xs text-slate-400 font-medium mt-0.5">Если выключено, комментировать ваши записи на районе смогут только одобренные друзья</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 select-none">
                  <input
                      type="checkbox"
                      checked={settings.allowCommentsFromAll}
                      onChange={(e) => handleToggleChange('allowCommentsFromAll', e.target.checked)}
                      className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full transition-colors peer peer-checked:bg-[#5C4B7A] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5"></div>
                </label>
              </div>
              <div className="flex items-center justify-between py-1 border-t border-slate-50 pt-4">
                <div className="pr-4">
                  <div className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-slate-400" />
                    <span>Показывать, когда я был в сети</span>
                  </div>
                  <div className="text-xs text-slate-400 font-medium mt-0.5">Соседи увидят «В сети» или время последнего визита. Если выключено — только «Не в сети»</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 select-none">
                  <input
                      type="checkbox"
                      checked={settings.showLastSeen !== false}
                      onChange={(e) => handleToggleChange('showLastSeen', e.target.checked)}
                      className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full transition-colors peer peer-checked:bg-[#5C4B7A] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5"></div>
                </label>
              </div>
              <div className="py-1 border-t border-slate-50 pt-4">
                <div className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-1">
                  <ImageIcon className="w-4 h-4 text-slate-400" />
                  <span>Кто видит мои фотографии</span>
                </div>
                <div className="text-xs text-slate-400 font-medium mb-3">Альбомы и личные фото. Аватарка на профиле остаётся видна.</div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'ALL', label: 'Все' },
                    { id: 'FRIENDS', label: 'Только друзья' },
                    { id: 'NONE', label: 'Никто' },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => handleToggleChange('photoVisibility', option.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                        (settings.photoVisibility || 'ALL') === option.id
                          ? 'bg-[#5C4B7A] text-white'
                          : 'bg-[#EDE6F5] text-[#5C4B7A]'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          {/* РАЗДЕЛ 3: УВЕДОМЛЕНИЯ */}
          <Card className="p-5 sm:p-6">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-4 mb-4">
              <Bell className="w-5 h-5 text-[#5C4B7A]" />
              <h2 className="myraion-display text-xl text-[#1C1824]">Уведомления</h2>
            </div>
            <div className="space-y-4">
              {/* Тумблер 1: Комментарии */}
              <div className="flex items-center justify-between py-1">
                <div>
                  <div className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <MessageCircle className="w-4 h-4 text-slate-400" />
                    <span>Комментарии к постам</span>
                  </div>
                  <div className="text-xs text-slate-400 font-medium mt-0.5">Оповещения, когда соседи отвечают на ваши записи в ленте</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 select-none">
                  <input type="checkbox" checked={settings.notifyComments} onChange={(e) => handleToggleChange('notifyComments', e.target.checked)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full transition-colors peer peer-checked:bg-[#5C4B7A] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5"></div>
                </label>
              </div>
              {/* Тумблер 2: Личные сообщения */}
              <div className="flex items-center justify-between py-1 border-t border-slate-50 pt-4">
                <div>
                  <div className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-slate-400" />
                    <span>Личные сообщения</span>
                  </div>
                  <div className="text-xs text-slate-400 font-medium mt-0.5">Всплывающие уведомления о входящих в чатах</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 select-none">
                  <input type="checkbox" checked={settings.notifyMessages} onChange={(e) => handleToggleChange('notifyMessages', e.target.checked)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full transition-colors peer peer-checked:bg-[#5C4B7A] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5"></div>
                </label>
              </div>
              {/* Тумблер 3: Заявки на мои события */}
              <div className="flex items-center justify-between py-1 border-t border-slate-50 pt-4">
                <div>
                  <div className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-slate-400" />
                    <span>Заявки на мои события</span>
                  </div>
                  <div className="text-xs text-slate-400 font-medium mt-0.5">Когда люди регистрируются или отправляют заявку на созданную вами встречу</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 select-none">
                  <input type="checkbox" checked={settings.notifyEventRequests} onChange={(e) => handleToggleChange('notifyEventRequests', e.target.checked)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full transition-colors peer peer-checked:bg-[#5C4B7A] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5"></div>
                </label>
              </div>
              {/* Тумблер 4: Репутация */}
              <div className="flex items-center justify-between py-1 border-t border-slate-50 pt-4">
                <div>
                  <div className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <Award className="w-4 h-4 text-slate-400" />
                    <span>Изменения репутации</span>
                  </div>
                  <div className="text-xs text-slate-400 font-medium mt-0.5">Оповещения, когда жители района повышают или понижают ваш вклад</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 select-none">
                  <input type="checkbox" checked={settings.notifyReputation} onChange={(e) => handleToggleChange('notifyReputation', e.target.checked)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full transition-colors peer peer-checked:bg-[#5C4B7A] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5"></div>
                </label>
              </div>
              <div className="flex items-center justify-between py-1 border-t border-slate-50 pt-4">
                <div>
                  <div className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-slate-400" />
                    <span>Уведомления на телефон</span>
                  </div>
                  <div className="text-xs text-slate-400 font-medium mt-0.5">Баннер на экране, когда район свёрнут</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 select-none">
                  <input
                    type="checkbox"
                    checked={phonePushEnabled}
                    onChange={async (e) => {
                      const next = e.target.checked;
                      if (next) {
                        const ok = await enableWebPush();
                        setPhonePushEnabled(ok);
                      } else {
                        await disableWebPush();
                        setPhonePushEnabled(false);
                      }
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full transition-colors peer peer-checked:bg-[#5C4B7A] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5"></div>
                </label>
              </div>
              <div className="flex items-center justify-between py-1 border-t border-slate-50 pt-4">
                <div>
                  <div className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-slate-400" />
                    <span>Звук уведомлений</span>
                  </div>
                  <div className="text-xs text-slate-400 font-medium mt-0.5">Короткий сигнал, когда приходит новое уведомление</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0 select-none">
                  <input
                    type="checkbox"
                    checked={soundEnabled}
                    onChange={(e) => {
                      const next = e.target.checked;
                      unlockNotificationSound();
                      setNotificationSoundEnabled(next);
                      setSoundEnabled(next);
                      if (next) playNotificationSound();
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full transition-colors peer peer-checked:bg-[#5C4B7A] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5"></div>
                </label>
              </div>
            </div>
          </Card>

          {/* РАЗДЕЛ 4: БЕЗОПАСНОСТЬ (СМЕНА ПАРОЛЯ) */}
          <Card className="p-5 sm:p-6">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-4 mb-4">
              <Lock className="w-5 h-5 text-[#5C4B7A]" />
              <h2 className="myraion-display text-xl text-[#1C1824]">Безопасность</h2>
            </div>
            <button
                type="button"
                onClick={() => setIsPasswordModalOpen(true)}
                className="w-full flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl hover:bg-slate-100/60 transition group text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white border border-slate-200/50 flex items-center justify-center text-slate-400 group-hover:text-[#5C4B7A] transition">
                  <Shield className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-800">Смена пароля аккаунта</div>
                  <div className="text-xs text-slate-400 font-medium mt-0.5">Периодически обновляйте ключ для защиты профиля</div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </Card>

          <Card className="p-5 sm:p-6">
            <button
                type="button"
                onClick={openFeedbackForm}
                className="w-full flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl hover:bg-slate-100/60 transition group text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white border border-slate-200/50 flex items-center justify-center text-slate-400 group-hover:text-[#5C4B7A] transition">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-800">Баг или идея</div>
                  <div className="text-xs text-slate-400 font-medium mt-0.5">Напишите, что сломалось или что улучшить</div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </Card>

          {/* НОВАЯ КНОПКА ВЫХОДА ИЗ АККАУНТА (БЕЗ ФОНА И ОПАСНОЙ ЗОНЫ) */}
          <div className="pt-4 flex flex-col items-center gap-3">
            <Button
                variant="secondary"
                onClick={logout}
                className="w-full py-3 bg-white border border-rose-200 text-rose-600 font-bold text-xs hover:bg-rose-50 hover:border-rose-300 transition rounded-xl flex items-center justify-center gap-2 shadow-sm"
            >
              <LogOut className="w-4 h-4" /> Выйти из аккаунта
            </Button>
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
              <button
                type="button"
                onClick={() => requestChangePage('rules')}
                className="hover:text-[#5C4B7A] underline underline-offset-2 bg-transparent border-none p-0 cursor-pointer"
              >
                Правила сообщества
              </button>
              <span>·</span>
              <button
                type="button"
                onClick={() => requestChangePage('privacy')}
                className="hover:text-[#5C4B7A] underline underline-offset-2 bg-transparent border-none p-0 cursor-pointer"
              >
                Политика конфиденциальности
              </button>
            </div>
            <button
                type="button"
                onClick={async () => {
                  const confirmed = await showAppConfirm({
                    title: 'Удалить аккаунт',
                    message: 'Профиль станет недоступен. Войти больше нельзя. Почту и телефон можно будет использовать снова через неделю.',
                    confirmText: 'Удалить',
                    cancelText: 'Отмена',
                    danger: true,
                  });
                  if (!confirmed) return;
                  try {
                    await api.delete('/api/v1/social/users/me');
                    logout();
                  } catch (error) {
                    console.error('Не удалось удалить аккаунт:', error);
                  }
                }}
                className="text-[11px] font-semibold text-slate-400 hover:text-rose-600 transition flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Удалить аккаунт
            </button>
          </div>
        </div>

        {/* МОДАЛЬНОЕ ОКНО: СМЕНА ПАРОЛЯ */}
        {isPasswordModalOpen && (
            <div
                className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn"
                onClick={closePasswordModal}
            >
              <div
                  className="bg-[#FFFCFA] rounded-[32px] p-5 sm:p-6 w-full max-w-sm relative mx-4"
                  onClick={(e) => e.stopPropagation()}
              >
                <button
                    type="button"
                    onClick={closePasswordModal}
                    className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition"
                >
                  <X className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-2 mb-4">
                  <Lock className="w-5 h-5 text-[#5C4B7A]" />
                  <h3 className="myraion-display text-xl text-[#1C1824]">Смена пароля</h3>
                </div>
                <form onSubmit={handlePasswordSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Старый пароль</label>
                    <div className="relative">
                      <input
                          type={showOldPassword ? 'text' : 'password'}
                          value={oldPassword}
                          onChange={(e) => setOldPassword(e.target.value)}
                          onCopy={(e) => e.preventDefault()}
                          onCut={(e) => e.preventDefault()}
                          onPaste={(e) => e.preventDefault()}
                          autoComplete="current-password"
                          placeholder="••••••••"
                          className="w-full px-3 py-2 pr-10 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#5C4B7A]/40 focus:bg-white transition select-none"
                      />
                      <button
                          type="button"
                          onClick={() => setShowOldPassword((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full text-slate-400 hover:text-[#5C4B7A] flex items-center justify-center"
                          aria-label={showOldPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      >
                        {showOldPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Новый пароль</label>
                    <div className="relative">
                      <input
                          type={showNewPassword ? 'text' : 'password'}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          onCopy={(e) => e.preventDefault()}
                          onCut={(e) => e.preventDefault()}
                          onPaste={(e) => e.preventDefault()}
                          autoComplete="new-password"
                          placeholder="Минимум 6 символов"
                          className="w-full px-3 py-2 pr-10 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-[#5C4B7A]/40 focus:bg-white transition select-none"
                      />
                      <button
                          type="button"
                          onClick={() => setShowNewPassword((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full text-slate-400 hover:text-[#5C4B7A] flex items-center justify-center"
                          aria-label={showNewPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      >
                        {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  {passwordError && (
                      <div className="text-xs text-rose-600 font-semibold bg-rose-50 border border-rose-100 p-2.5 rounded-xl animate-fadeIn">
                        {passwordError}
                      </div>
                  )}
                  {passwordSuccess && (
                      <div className="text-xs text-emerald-600 font-semibold bg-emerald-50 border border-emerald-100 p-2.5 rounded-xl animate-fadeIn">
                        Пароль успешно обновлен!
                      </div>
                  )}
                  <div className="flex gap-2 pt-2">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={closePasswordModal}
                        className="flex-1 text-xs py-2 font-semibold text-slate-500 border border-slate-200 rounded-xl bg-white"
                    >
                      Отмена
                    </Button>
                    <Button
                        type="submit"
                        disabled={passwordLoading}
                        className="flex-1 text-xs py-2 bg-[#5C4B7A] hover:bg-[#4A3C66] text-white font-semibold rounded-xl"
                    >
                      {passwordLoading ? 'Сохранение...' : 'Обновить'}
                    </Button>
                  </div>
                </form>
              </div>
            </div>
        )}
      </div>
  );
}
