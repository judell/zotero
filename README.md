# zotero
sync hypothesis &lt;-> zotero

This tool reads your Zotero library, finds items imported by URL, looks for associated Hypothesis annotations, and syncs them to Zotero as child notes.

Existing annotations added to Hypothesis will sync to Zotero.

If you resync with no changes in Zotero or Hypothesis, nothing will happen.

If you delete a Hypothesis-synced note from Zotero, then resync, it will reappear.

If you update an annotation in Hypothesis, it won't resync to Zotero unless you delete the corresponding note in Zotero.

Only top-level annotations will sync, replies are ignored.

Demo: http://jonudell.info/h/zotero-sync-02.mp4
