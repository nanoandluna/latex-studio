import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client';
import { useEditorStore } from '../src/stores/editorStore';
vi.mock('../src/api/client', () => ({ api: { readFile: vi.fn(), saveFile: vi.fn() } }));
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value) });
vi.stubGlobal('window', { dispatchEvent: vi.fn() });
const state = () => useEditorStore.getState();
beforeEach(async () => {
  vi.clearAllMocks();
  storage.clear();
  await state().activateWorkspace(null);
  vi.mocked(api.readFile).mockResolvedValue({ path: 'main.tex', content: 'disk' });
  vi.mocked(api.saveFile).mockResolvedValue({ ok: true });
  await state().activateWorkspace('/project-a');
});

describe('editor save races and recovery', () => {
  it('retries draft storage after a quota error and clears stale draft bytes after saving', async () => {
    await state().openFile('main.tex');
    const write = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => { throw new Error('quota'); });
    state().updateContent('main.tex', 'save this to disk');
    expect(state().recoveryError).toContain('full');
    await state().saveFile('main.tex');
    expect(state().recoveryError).toBeNull();
    expect(JSON.parse(storage.get('latex-studio-session-v1:/project-a')!).tabs).toEqual([{ path: 'main.tex' }]);
    write.mockRestore();
  });
  it('preserves an unsupported stored session rather than replacing it with an empty one', async () => {
    await state().activateWorkspace(null);
    const original = JSON.stringify({ version: 999, tabs: [{ path: 'main.tex', content: 'important draft' }] });
    storage.set('latex-studio-session-v1:/project-a', original);
    await state().activateWorkspace('/project-a');
    expect(state().recoveryError).toContain('kept');
    expect(storage.get('latex-studio-session-v1:/project-a')).toBe(original);
  });
  it('only marks the sent bytes saved if typing continues during a save', async () => {
    await state().openFile('main.tex');
    state().updateContent('main.tex', 'sent');
    let finish!: () => void;
    vi.mocked(api.saveFile).mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ ok: true }); }));
    const save = state().saveFile('main.tex');
    await vi.waitFor(() => expect(api.saveFile).toHaveBeenCalled());
    state().updateContent('main.tex', 'newer typing');
    finish();
    await save;
    expect(state().tabs[0].savedContent).toBe('sent');
    expect(state().isDirty(state().tabs[0])).toBe(true);
  });
  it('serializes saves with the preceding saved bytes as the next baseline', async () => {
    await state().openFile('main.tex');
    state().updateContent('main.tex', 'one');
    let finish!: () => void;
    vi.mocked(api.saveFile).mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ ok: true }); }));
    const first = state().saveFile('main.tex');
    await vi.waitFor(() => expect(api.saveFile).toHaveBeenCalledTimes(1));
    state().updateContent('main.tex', 'two');
    const second = state().saveFile('main.tex');
    finish();
    await Promise.all([first, second]);
    expect(api.saveFile).toHaveBeenNthCalledWith(2, 'main.tex', 'two', 'one', '/project-a');
    expect(state().tabs[0].savedContent).toBe('two');
  });
  it('recovers drafts in their own project and retains the old disk baseline', async () => {
    await state().openFile('main.tex');
    state().updateContent('main.tex', 'unsaved draft');
    await state().activateWorkspace('/project-b');
    expect(state().tabs).toEqual([]);
    vi.mocked(api.readFile).mockResolvedValue({ path: 'main.tex', content: 'changed externally' });
    await state().activateWorkspace('/project-a');
    expect(state().tabs[0]).toEqual({ path: 'main.tex', content: 'unsaved draft', savedContent: 'disk' });
    expect(state().recoveryNotice).toContain('Recovered 1');
  });
  it('keeps a recovered draft even when its disk file was deleted', async () => {
    await state().openFile('main.tex');
    state().updateContent('main.tex', 'last copy');
    await state().activateWorkspace(null);
    vi.mocked(api.readFile).mockRejectedValue(Object.assign(new Error('missing'), { code: 'FILE_NOT_FOUND' }));
    await state().activateWorkspace('/project-a');
    expect(state().tabs[0].content).toBe('last copy');
  });
  it('does not apply a delayed open to another project', async () => {
    let finish!: (value: { path: string; content: string }) => void;
    vi.mocked(api.readFile).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const open = state().openFile('main.tex');
    await state().activateWorkspace('/project-b');
    finish({ path: 'main.tex', content: 'project-a' });
    await open;
    expect(state().tabs).toEqual([]);
  });
  it('does not overwrite edits made while clean-tab reload is pending', async () => {
    await state().openFile('main.tex');
    let finish!: (value: { path: string; content: string }) => void;
    vi.mocked(api.readFile).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const reload = state().reloadCleanTabs();
    state().updateContent('main.tex', 'typing during reload');
    finish({ path: 'main.tex', content: 'replacement on disk' });
    await reload;
    expect(state().tabs[0].content).toBe('typing during reload');
  });
});
