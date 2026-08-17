import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveImportUrl, fetchImportLink, ImportLinkError } from './import-link';

describe('resolveImportUrl', () => {
  it('exports the linked tab of a Sheet, not the first one', () => {
    expect(
      resolveImportUrl('https://docs.google.com/spreadsheets/d/ABC123/edit?usp=sharing#gid=7654')
    ).toBe('https://docs.google.com/spreadsheets/d/ABC123/export?format=csv&gid=7654');
  });

  it('falls back to the first tab when the link names none', () => {
    expect(resolveImportUrl('https://docs.google.com/spreadsheets/d/ABC123/edit')).toBe(
      'https://docs.google.com/spreadsheets/d/ABC123/export?format=csv'
    );
  });

  it('takes the tab from the query when the link is already an export URL', () => {
    expect(
      resolveImportUrl('https://docs.google.com/spreadsheets/d/ABC123/export?format=csv&gid=42')
    ).toBe('https://docs.google.com/spreadsheets/d/ABC123/export?format=csv&gid=42');
  });

  it('turns every shape of Drive file link into the download URL', () => {
    const download = 'https://drive.google.com/uc?export=download&id=FILE9';
    expect(resolveImportUrl('https://drive.google.com/file/d/FILE9/view?usp=drive_link')).toBe(
      download
    );
    expect(resolveImportUrl('https://drive.google.com/open?id=FILE9')).toBe(download);
    expect(resolveImportUrl('https://drive.google.com/uc?export=download&id=FILE9')).toBe(download);
  });

  it('tolerates surrounding whitespace from a sloppy paste', () => {
    expect(resolveImportUrl('  https://drive.google.com/open?id=FILE9\n')).toBe(
      'https://drive.google.com/uc?export=download&id=FILE9'
    );
  });

  // The allowlist is the SSRF boundary — these are the cases that matter most.
  it.each([
    ['a non-Google host', 'https://evil.example.com/list.csv'],
    ['a Google-lookalike host', 'https://drive.google.com.evil.example/list.csv'],
    ['the loopback interface', 'https://127.0.0.1/list.csv'],
    ['the cloud metadata endpoint', 'https://169.254.169.254/latest/meta-data/'],
    ['a plaintext Google URL', 'http://docs.google.com/spreadsheets/d/ABC123/edit'],
    ['a non-http scheme', 'file:///etc/passwd'],
    ['not a URL at all', 'my collection'],
  ])('rejects %s', (_label, url) => {
    expect(() => resolveImportUrl(url)).toThrow(ImportLinkError);
  });

  it('rejects an allowlisted host with no file in it', () => {
    expect(() => resolveImportUrl('https://drive.google.com/drive/my-drive')).toThrow(
      /Couldn't find a file/
    );
  });
});

describe('fetchImportLink', () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (body: string, headers: Record<string, string>, status = 200) =>
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status, headers })));

  it('returns the text and the name Google reports', async () => {
    respond('Name,Quantity\nSol Ring,1\n', {
      'content-type': 'text/csv',
      'content-disposition': 'attachment; filename="My Cards - Sheet1.csv"',
    });
    await expect(fetchImportLink('https://drive.google.com/open?id=FILE9')).resolves.toEqual({
      text: 'Name,Quantity\nSol Ring,1\n',
      name: 'My Cards - Sheet1.csv',
    });
  });

  it('prefers the UTF-8 filename Google sends alongside the stripped one', async () => {
    // Verbatim from a live Sheets export — the unstarred copy loses the spaces.
    respond('Sol Ring\n', {
      'content-type': 'text/csv',
      'content-disposition':
        'attachment; filename="ExampleSpreadsheet-ClassData.csv"; ' +
        "filename*=UTF-8''Example%20Spreadsheet%20-%20Class%20Data.csv",
    });
    const { name } = await fetchImportLink('https://drive.google.com/open?id=FILE9');
    expect(name).toBe('Example Spreadsheet - Class Data.csv');
  });

  it('falls back to a generic name when Google sends no filename', async () => {
    respond('Sol Ring\n', { 'content-type': 'text/csv' });
    const { name } = await fetchImportLink('https://drive.google.com/open?id=FILE9');
    expect(name).toBe('google-import.csv');
  });

  it('treats the sign-in page as a sharing problem, 200 or not', async () => {
    respond('<html>Sign in</html>', { 'content-type': 'text/html; charset=utf-8' });
    await expect(fetchImportLink('https://drive.google.com/open?id=FILE9')).rejects.toThrow(
      /Anyone with the link/
    );
  });

  it('reads a 404 as a sharing problem too', async () => {
    respond('nope', { 'content-type': 'text/plain' }, 404);
    await expect(fetchImportLink('https://drive.google.com/open?id=FILE9')).rejects.toThrow(
      /Anyone with the link/
    );
  });

  it('refuses a file that declares itself over the cap', async () => {
    respond('x', { 'content-type': 'text/csv', 'content-length': '9000000' });
    await expect(fetchImportLink('https://drive.google.com/open?id=FILE9')).rejects.toThrow(
      /too big/
    );
  });

  it('refuses a file that runs past the cap mid-stream', async () => {
    // No content-length — the streaming ceiling is the only thing standing
    // between a mis-pasted link to a huge file and the machine's memory.
    respond('y'.repeat(5_000_001), { 'content-type': 'text/csv' });
    await expect(fetchImportLink('https://drive.google.com/open?id=FILE9')).rejects.toThrow(
      /too big/
    );
  });

  it('refuses an empty file rather than importing nothing', async () => {
    respond('   \n', { 'content-type': 'text/csv' });
    await expect(fetchImportLink('https://drive.google.com/open?id=FILE9')).rejects.toThrow(
      /empty/
    );
  });
});
