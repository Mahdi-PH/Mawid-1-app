"use client";

import { useEffect } from "react";

/**
 * Makes a same-route "sub-view" — a plain useState step within one page,
 * never a real navigation (e.g. /find/book's menu->book, /find's
 * category->results, /signup's type->form) — participate in real back
 * navigation, not just this page's own in-page "‹ رجوع" link/button.
 *
 * Why this exists: Android's physical/gesture back button (and a real
 * browser back button, and — in a Trusted Web Activity — the OS back
 * press, which Android delegates to the WebView's own back-navigation,
 * i.e. the same History API this hook uses) all operate on the actual
 * browser history stack, never on React state. A sub-view built with
 * nothing but `useState` has no entry of its own on that stack, so any
 * of those back mechanisms skip straight past it to whichever real page
 * preceded this route — landing the visitor somewhere further back than
 * the one-step-at-a-time behavior this app's navigation is supposed to
 * guarantee everywhere else. Call `enter()` the instant the deeper view
 * opens (same click that flips local state to it); call `leave()`
 * instead of resetting that state directly wherever the UI itself offers
 * a "go back" affordance for it. `onPop` — the single place that actually
 * resets state back to the shallow view — then fires identically whether
 * the visitor pressed a real back button/gesture or tapped `leave()`'s own
 * UI control, so both paths are provably the same one step, not two
 * separately-maintained mechanisms that can drift apart.
 *
 * `enter()` pushes a same-URL history marker (no visible address change).
 * `leave()` pops it via `history.back()` when present — which fires
 * `popstate` and lets the listener below call `onPop()` — or, if no
 * marker is on the stack (e.g. this sub-view was entered through a
 * bypass that skipped `enter()` entirely), calls `onPop()` directly,
 * since there is nothing to pop.
 */
export function useLocalBackStep(onPop: () => void) {
  useEffect(() => {
    function handlePopState(event: PopStateEvent) {
      const state = event.state as { mawidLocalStep?: boolean } | null;
      if (!state?.mawidLocalStep) onPop();
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function enter() {
    window.history.pushState({ mawidLocalStep: true }, "", window.location.href);
  }

  function leave() {
    const state = window.history.state as { mawidLocalStep?: boolean } | null;
    if (state?.mawidLocalStep) {
      window.history.back();
    } else {
      onPop();
    }
  }

  return { enter, leave };
}
