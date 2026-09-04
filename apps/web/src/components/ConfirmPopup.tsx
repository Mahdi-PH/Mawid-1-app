"use client";

/** Shared small centered confirm popup — custom-built rather than a native
 *  confirm() for consistent styling, and reused across every sign-out
 *  button in the app (patient, clinic, admin) so the same one-click
 *  confirmation pattern doesn't get re-implemented three different ways. */
export default function ConfirmPopup({
  open,
  title,
  message,
  confirmLabel = "تأكيد",
  cancelLabel = "إلغاء",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onCancel}>
      <div dir="rtl" onClick={(e) => e.stopPropagation()} className="w-full max-w-xs rounded-2xl bg-white p-5 text-center shadow-xl">
        <p className="mb-2 font-bold text-gray-800">{title}</p>
        {message && <p className="mb-5 text-xs text-gray-500">{message}</p>}
        <div className={"flex gap-2" + (message ? "" : " mt-4")}>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white hover:bg-red-700"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
