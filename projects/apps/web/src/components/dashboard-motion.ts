import type { Transition, Variants } from 'motion/react';

const dashboardEase = [0.22, 1, 0.36, 1] as const;

export const dashboardRouteTransition = {
    duration: 0.2,
    ease: dashboardEase,
} satisfies Transition;

export const dashboardViewTransition = {
    duration: 0.18,
    ease: dashboardEase,
} satisfies Transition;

export const dashboardSelectionTransition = {
    duration: 0.15,
    ease: dashboardEase,
} satisfies Transition;

export const dashboardListTransition = {
    duration: 0.16,
    ease: dashboardEase,
} satisfies Transition;

export const dashboardConfirmationTransition = {
    duration: 0.14,
    ease: dashboardEase,
} satisfies Transition;

export const dashboardContentTransition = {
    ...dashboardRouteTransition,
} satisfies Transition;

export const dashboardFastTransition = {
    ...dashboardSelectionTransition,
} satisfies Transition;

export const dashboardContentVariants = {
    initial: { opacity: 0, y: 7 },
    enter: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4, pointerEvents: 'none' },
} satisfies Variants;

export const dashboardInlineVariants = {
    initial: { opacity: 0, y: 4 },
    enter: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -2, pointerEvents: 'none' },
} satisfies Variants;

export const dashboardListItemVariants = {
    initial: { opacity: 0, y: 4 },
    enter: { opacity: 1, y: 0 },
    exit: { opacity: 0, pointerEvents: 'none' },
} satisfies Variants;

export const dashboardConfirmationVariants = {
    initial: { opacity: 0, y: 2 },
    enter: { opacity: 1, y: 0 },
    exit: { opacity: 0, pointerEvents: 'none' },
} satisfies Variants;

export const dashboardTactile = {
    whileTap: { scale: 0.985 },
} as const;
