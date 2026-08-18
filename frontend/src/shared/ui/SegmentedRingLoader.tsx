import React, { useId } from 'react';
import styles from './SegmentedRingLoader.module.css';

const TICKS = Array.from({ length: 20 }, (_, i) => i);

export default function SegmentedRingLoader({ label = 'Загрузка...' }: { label?: string }) {
    const uid = useId().replace(/:/g, '');
    const maskId = `seg-ring-${uid}`;

    const ticks = TICKS.map((i) => (
        <rect
            key={i}
            x="48.15"
            y="10"
            width="3.7"
            height="13"
            rx="0.9"
            transform={`rotate(${i * 18} 50 50)`}
        />
    ));

    return (
        <div className={styles.wrap} role="status" aria-live="polite" aria-label={label}>
            <svg className={styles.svg} width="72" height="72" viewBox="0 0 100 100" aria-hidden="true">
                <defs>
                    <mask id={maskId}>
                        <rect width="100" height="100" fill="#000" />
                        <circle
                            className={`${styles.wipe} ${styles.reveal}`}
                            cx="50"
                            cy="50"
                            r="36"
                            fill="none"
                            stroke="#fff"
                            strokeWidth="14"
                            strokeDasharray="226.2"
                            strokeDashoffset="226.2"
                        />
                        <circle
                            className={`${styles.wipe} ${styles.erase}`}
                            cx="50"
                            cy="50"
                            r="36"
                            fill="none"
                            stroke="#000"
                            strokeWidth="14"
                            strokeDasharray="226.2"
                            strokeDashoffset="226.2"
                        />
                    </mask>
                </defs>
                <g fill="#EDE6F5">{ticks}</g>
                <g fill="#5C4B7A" mask={`url(#${maskId})`}>{ticks}</g>
            </svg>
            <p className={styles.label}>{label}</p>
        </div>
    );
}

export function ParticipantsLoadRetry({ onRetry }: { onRetry: () => void }) {
    return (
        <button
            type="button"
            onClick={onRetry}
            className="block w-full text-xs text-slate-400 italic text-center py-5 hover:text-[#5C4B7A] cursor-pointer"
        >
            Список не загрузился. Нажмите ещё раз.
        </button>
    );
}
