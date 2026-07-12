import type { Transition, Variants } from 'motion/react';

const dashboardEase = [0.22, 1, 0.36, 1] as const;

export const dashboardContentTransition = {
    duration: 0.2,
    ease: dashboardEase,
} satisfies Transition;

export const dashboardFastTransition = {
    duration: 0.15,
    ease: dashboardEase,
} satisfies Transition;

export const dashboardContentVariants = {
    initial: { opacity: 0, y: 7 },
    enter: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4, pointerEvents: 'none' },
} satisfies Variants;

export const dashboardInlineVariants = {
    initial: { opacity: 0, y: -3 },
    enter: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -3, pointerEvents: 'none' },
} satisfies Variants;

export const dashboardListItemVariants = {
    initial: { opacity: 0, y: 5 },
    enter: { opacity: 1, y: 0 },
    exit: { opacity: 0, x: -6, pointerEvents: 'none' },
} satisfies Variants;

export const dashboardTactile = {
    whileTap: { scale: 0.985 },
} as const;
