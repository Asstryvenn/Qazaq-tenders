"use client";

import { useCallback } from "react";
import { useProfile } from "./profile";

/**
 * Guards deep actions (open a lot, «Қатысу», simulation, Telegram) for guests.
 * `guard(action)` runs the action for registered users; for guests it opens the auth wall
 * and returns false. `guardEvent` also stops the click (links, card clicks).
 */
export function useAuthWall() {
  const { hasAccount, loading, openModal } = useProfile();
  const allowed = hasAccount || loading;

  const guard = useCallback(
    (action?: () => void): boolean => {
      if (allowed) {
        action?.();
        return true;
      }
      openModal("gate");
      return false;
    },
    [allowed, openModal]
  );

  const guardEvent = useCallback(
    (e: { preventDefault(): void; stopPropagation(): void }): boolean => {
      if (allowed) return true;
      e.preventDefault();
      e.stopPropagation();
      openModal("gate");
      return false;
    },
    [allowed, openModal]
  );

  return { allowed, guard, guardEvent };
}
