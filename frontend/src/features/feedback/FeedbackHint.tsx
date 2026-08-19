import React, { useEffect, useState } from 'react';
import { FEEDBACK_HINT_KEY } from '@/shared/lib/feedbackForm';
import { whenDevicePromptsDone } from '@/shared/lib/geoPrompt';

export default function FeedbackHint() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(FEEDBACK_HINT_KEY)) return;
    } catch {
      return;
    }
    whenDevicePromptsDone(() => {
      try {
        if (localStorage.getItem(FEEDBACK_HINT_KEY)) return;
      } catch {
        return;
      }
      setVisible(true);
    });
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(FEEDBACK_HINT_KEY, '1');
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0"
      style={{ zIndex: 10001, background: 'rgba(28, 24, 36, 0.45)' }}
      onClick={dismiss}
    >
      <div
        className="absolute left-1/2 top-1/2 w-[min(420px,92vw)] -translate-x-1/2 -translate-y-1/2 bg-[#FFFCFA] shadow-2xl rounded-[28px] p-6 myraion-info-toast-animate text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="myraion-display text-[22px] text-[#1C1824] leading-tight mb-2">
          Баг или идея
        </div>
        <p className="text-sm text-[#5A5566] leading-relaxed text-center">
          Нашли ошибку или есть идея — напишите в настройках, пункт «Баг или идея».
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="mt-5 w-full h-11 rounded-full bg-[#5C4B7A] hover:bg-[#4A3C66] text-white text-xs transition"
        >
          Понятно
        </button>
      </div>
    </div>
  );
}
