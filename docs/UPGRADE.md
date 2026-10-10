# Upgrade to V1.0

1. Save files in the old application and export a project ZIP or make an external backup.
2. Stop the old server. Extract the new release into a separate application directory; keep your paper directory where it is.
3. Use Node.js >=22.13 and pnpm 11.18.0. Run `start.cmd` on Windows or `sh start.sh` on macOS/Linux. Source-checkout users run `pnpm install --frozen-lockfile`, `pnpm build`, then `pnpm start`.
4. Open the existing paper folder. V1.0 reads version-1 snapshots without converting them. Parser caches invalidate automatically; paper sources and snapshot bytes are preserved.

The new browser session cache starts at V1.0; it cannot recover unsaved text lost before this upgrade. It is scoped to both workspace path and browser origin. Use the same browser profile and address for subsequent sessions. Private browsing and clearing site data may remove stored drafts.

Saving now checks the disk contents against the editor's last saved version. After a restore, replace-all or external edit, dirty tabs keep their text and may require **Review disk changes**. Select a version explicitly instead of repeatedly pressing Save. Clean tabs follow external source changes.

Snapshot restores verify all selected source bytes before applying changes, including deleted files. V1.0 rejects malformed manifests and unsupported snapshot versions without rewriting them. An I/O failure during publication can still leave a partial restore; the `pre-restore` snapshot and the failed-file report remain the recovery path.

The application still uses a single workspace per server. Open separate server instances on different ports for independent projects; simultaneous browser tabs share the same server workspace.

To roll back, stop V1.0 and start the previous application. V1.0 keeps the existing snapshot format. Draft recovery is browser storage, so save recovered work before rolling back or changing the server address.
