import JSZip from 'jszip';

// ---------------------------------------------------------------------------
// File type allowlist — only extract text/code files, skip binaries
// ---------------------------------------------------------------------------
const CODE_EXTENSIONS = new Set([
  // Web / JS
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte',
  // Backend languages
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'cpp', 'h', 'cs', 'php',
  // Markup / config
  'md', 'mdx', 'txt', 'json', 'yaml', 'yml', 'toml', 'xml', 'env',
  // Styles
  'css', 'scss', 'sass', 'less',
  // Templates / markup
  'html', 'htm', 'njk', 'hbs', 'ejs',
  // Data / query
  'sql', 'graphql', 'gql', 'prisma',
  // Shell
  'sh', 'bash', 'zsh', 'fish',
]);

// Paths to always skip regardless of extension
const SKIP_PATTERNS: RegExp[] = [
  /node_modules\//,
  /\.git\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /\.next\//,
  /\.nuxt\//,
  /\.svelte-kit\//,
  /coverage\//,
  /\.cache\//,
  /(^|\/)vendor\//,
  /\.min\.(js|css)/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /composer\.lock$/,
  /Gemfile\.lock$/,
  /\.DS_Store/,
  /Thumbs\.db$/,
  /\.pyc$/,
  /__pycache__\//,
  /\.class$/,
  /\.o$/,
];

// Limits to keep the context window sane
const PER_FILE_CHAR_LIMIT = 5000;
const TOTAL_CHAR_LIMIT    = 120000;
const MAX_FILES           = 120;

function getExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

function shouldInclude(normalizedPath: string): boolean {
  if (SKIP_PATTERNS.some(p => p.test(normalizedPath))) return false;
  return CODE_EXTENSIONS.has(getExt(normalizedPath));
}

// Lower number = extracted earlier (README and package info first, then src)
function priorityOf(path: string): number {
  if (/readme/i.test(path))              return 0;
  if (/package\.json$/.test(path))       return 1;
  if (/\.(md|mdx)$/.test(path))         return 2;
  if (/\bsrc\b/.test(path))             return 3;
  if (/\bapp\b/.test(path))             return 3;
  if (/\blib\b|\butils?\b/.test(path))  return 4;
  return 5;
}

export interface ProjectMeta {
  id: string;
  fileName: string;    // original zip file name
  fileCount: number;
  totalChars: number;
  fileNames: string[]; // list of extracted paths
}

export interface ZipExtractionResult {
  context: string;
  meta: ProjectMeta;
}

export async function extractProjectFromZip(file: File): Promise<ZipExtractionResult> {
  const id = `${file.name}-${file.size}-${file.lastModified}`;
  const zip    = new JSZip();
  const buffer = await file.arrayBuffer();
  const loaded = await zip.loadAsync(buffer);

  // Build candidate list, stripping the single top-level directory that GitHub
  // and most zip tools add (e.g. "my-repo-main/src/..." → "src/...")
  type Candidate = { path: string; obj: JSZip.JSZipObject };
  const candidates: Candidate[] = [];

  loaded.forEach((rawPath, obj) => {
    if (obj.dir) return;
    // Strip leading "folder/" prefix if every file shares the same root
    const stripped = rawPath.replace(/^[^/]+\//, '');
    const normalizedPath = stripped || rawPath;
    if (shouldInclude(normalizedPath)) {
      candidates.push({ path: normalizedPath, obj });
    }
  });

  // Sort by priority (README etc. first), then alphabetical within tier
  candidates.sort((a, b) => {
    const pd = priorityOf(a.path) - priorityOf(b.path);
    return pd !== 0 ? pd : a.path.localeCompare(b.path);
  });

  const selected = candidates.slice(0, MAX_FILES);
  const sections: string[] = [];
  const fileNames: string[] = [];
  let totalChars = 0;

  for (const { path, obj } of selected) {
    if (totalChars >= TOTAL_CHAR_LIMIT) break;
    try {
      const raw = (await obj.async('string')).trim();
      if (!raw) continue;

      const body = raw.length > PER_FILE_CHAR_LIMIT
        ? raw.slice(0, PER_FILE_CHAR_LIMIT) + '\n[…truncated]'
        : raw;

      const section = `=== ${path} ===\n${body}`;
      const remaining = TOTAL_CHAR_LIMIT - totalChars;

      if (section.length > remaining) {
        if (remaining > 300) {
          sections.push(section.slice(0, remaining) + '\n[…truncated]');
          fileNames.push(path);
          totalChars = TOTAL_CHAR_LIMIT;
        }
        break;
      }

      sections.push(section);
      fileNames.push(path);
      totalChars += section.length;
    } catch {
      // binary or unreadable — skip silently
    }
  }

  return {
    context: sections.join('\n\n'),
    meta: {
      id,
      fileName:   file.name,
      fileCount:  fileNames.length,
      totalChars,
      fileNames,
    },
  };
}
