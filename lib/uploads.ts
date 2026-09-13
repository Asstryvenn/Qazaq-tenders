"use client";

import type { UploadAnalysis } from "./upload-types";

const KEY = "qt-uploads";
const MAX_ITEMS = 8;

/** Analysed PDFs live in this browser (the full page text is too large for a profile row). */
export function loadUploads(): UploadAnalysis[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

export function getUpload(id: string): UploadAnalysis | undefined {
  return loadUploads().find((u) => u.id === id);
}

/** Most recent technical specification explicitly attached to a marketplace lot. */
export function getTenderAttachment(tenderId: string): UploadAnalysis | undefined {
  return loadUploads().find((u) => u.linkedTenderId === tenderId);
}

/** Insert or replace; drops the oldest analyses if the browser storage is full. */
export function saveUpload(u: UploadAnalysis): boolean {
  let list = [u, ...loadUploads().filter((x) => x.id !== u.id)].slice(0, MAX_ITEMS);
  while (list.length) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      window.dispatchEvent(new CustomEvent("qt-uploads-changed"));
      return true;
    } catch {
      if (list.length === 1) return false;
      list = list.slice(0, -1);
    }
  }
  return false;
}

export function removeUpload(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadUploads().filter((u) => u.id !== id)));
    window.dispatchEvent(new CustomEvent("qt-uploads-changed"));
  } catch {}
}
