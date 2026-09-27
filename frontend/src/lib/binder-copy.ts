/**
 * Confirm-dialog body for deleting ONE binder — identical copy across
 * BindersIndexPage, BinderTabs and BinderPage before this was pulled out, so a
 * wording tweak needed three hand-synced edits. `deleteBinder`
 * (store/collection.ts) always shows an Undo toast, so this must not claim
 * finality.
 */
export const BINDER_DELETE_CONFIRM_BODY =
  'Its cards route to your other binders. Anything that no longer matches falls back to the Collection view. You can undo from the toast.';
