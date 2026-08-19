import React, { useState } from 'react';
import { FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react';
import { formatFileSize } from '@/features/chat/ChatFileBubble';
import type { useChatMediaAttach } from '@/features/chat/useChatMediaAttach';

type Media = ReturnType<typeof useChatMediaAttach>;

export const COMPOSER_BTN =
  'w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition disabled:opacity-40';
export const COMPOSER_BTN_MUTED = `${COMPOSER_BTN} text-slate-500 hover:bg-slate-100 hover:text-[#5C4B7A]`;
export const COMPOSER_BTN_SEND = `${COMPOSER_BTN} bg-[#5C4B7A] text-white hover:bg-[#4A3C66]`;
export const COMPOSER_ICON = 'w-5 h-5';

/** Не отдаём фокус кнопке «Отправить», иначе на телефоне закрывается клавиатура. */
export function keepComposerFocus(e: { preventDefault: () => void }) {
  e.preventDefault();
}

export function ChatPendingStrip({ media }: { media: Media }) {
  if (media.count === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-3">
      {media.pendingPhotos.map((item) => (
        <div key={item.localId} className="relative w-16 h-16 shrink-0 rounded-xl overflow-hidden bg-[#EDE6F5]">
          <img src={item.url || item.preview} alt="" className="w-full h-full object-cover" />
          {item.uploading && <div className="absolute inset-0 bg-white/50" />}
          <button type="button" onClick={() => media.removePhoto(item.localId)} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-[#1A1916]/70 text-white flex items-center justify-center">
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
      {media.pendingFiles.map((item) => (
        <div key={item.localId} className="relative w-40 h-16 shrink-0 rounded-xl overflow-hidden bg-white border border-[#1A1916]/10 px-2.5 py-2 flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#5C4B7A] shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold truncate text-[#1A1916]">{item.name}</div>
            <div className="text-[10px] text-slate-500">{item.uploading ? 'Загрузка…' : formatFileSize(item.size)}</div>
          </div>
          <button type="button" onClick={() => media.removeFile(item.localId)} className="w-5 h-5 rounded-full bg-[#1A1916]/70 text-white flex items-center justify-center shrink-0">
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function ChatPaperclipButton({ media, disabled }: { media: Media; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <input
        ref={media.photoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={(e) => {
          media.addPhotos(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={media.fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          media.addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={COMPOSER_BTN_MUTED}
        title="Прикрепить"
      >
        <Paperclip className={COMPOSER_ICON} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 bottom-full mb-1 z-50 w-40 bg-white border border-slate-200/80 shadow-xl rounded-xl py-1.5 animate-fadeIn">
            <button
              type="button"
              onClick={() => { setOpen(false); media.openPhotoPicker(); }}
              className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] flex items-center gap-2"
            >
              <ImageIcon className="w-3.5 h-3.5 text-slate-400" />
              Фото
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); media.openFilePicker(); }}
              className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-[#EDE6F5] hover:text-[#5C4B7A] flex items-center gap-2"
            >
              <FileText className="w-3.5 h-3.5 text-slate-400" />
              Файл
            </button>
          </div>
        </>
      )}
    </div>
  );
}
