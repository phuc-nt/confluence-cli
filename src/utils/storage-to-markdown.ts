/**
 * Confluence storage format -> Markdown conversion.
 *
 * Storage format is an XHTML dialect: tag soup with HTML entities, macro
 * elements in the `ac:` namespace, and no line structure. Handed to an AI
 * agent verbatim it costs several times the tokens of the text it carries and
 * arrives with non-ASCII text mangled into entities (`Ng&agrave;y`), which the
 * agent then has to decode itself.
 *
 * This module renders the constructs Confluence pages actually contain into
 * Markdown. It is the read-direction counterpart of markdown-to-storage.ts;
 * the two are not exact inverses, so tools that need to write a body back
 * unchanged must ask for the raw storage instead.
 */

/**
 * Latin-1 letter entities, generated from the naming rule HTML follows:
 * the letter, then the accent name (`&agrave;`, `&Ocirc;`, `&ntilde;`).
 *
 * Confluence escapes every non-ASCII letter this way, so a page written in
 * Vietnamese, French or German arrives almost entirely entity-encoded. Listing
 * them by hand invites gaps; deriving them from the Unicode code points does
 * not.
 */
const ACCENTED: Record<string, string> = (() => {
  const table: Record<string, string> = {};
  const accents: Array<[string, string]> = [
    ['grave', '̀'],
    ['acute', '́'],
    ['circ', '̂'],
    ['tilde', '̃'],
    ['uml', '̈'],
    ['ring', '̊'],
    ['cedil', '̧'],
  ];

  for (const [name, mark] of accents) {
    for (const letter of 'aeiounycsgzAEIOUNYCSGZ') {
      // Compose letter + combining mark; keep only pairs that are a real
      // precomposed Latin-1/Latin-A character, which is exactly the set HTML
      // gives an entity name.
      const composed = (letter + mark).normalize('NFC');
      if (composed.length === 1) table[`${letter}${name}`] = composed;
    }
  }

  Object.assign(table, {
    szlig: 'ß',
    aelig: 'æ',
    AElig: 'Æ',
    oslash: 'ø',
    Oslash: 'Ø',
    eth: 'ð',
    ETH: 'Ð',
    thorn: 'þ',
    THORN: 'Þ',
    iexcl: '¡',
    iquest: '¿',
    ordf: 'ª',
    ordm: 'º',
  });

  return table;
})();

/** Named entities that appear in real Confluence pages. */
const NAMED_ENTITIES: Record<string, string> = {
  ...ACCENTED,
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  times: '×',
  middot: '·',
  bull: '•',
  deg: '°',
  euro: '€',
  pound: '£',
  yen: '¥',
  copy: '©',
  reg: '®',
  trade: '™',
  larr: '←',
  uarr: '↑',
  rarr: '→',
  darr: '↓',
  harr: '↔',
  laquo: '«',
  raquo: '»',
  sect: '§',
  para: '¶',
  dagger: '†',
  permil: '‰',
  prime: '′',
  Prime: '″',
  minus: '−',
  plusmn: '±',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  sup2: '²',
  sup3: '³',
  micro: 'µ',
  ne: '≠',
  le: '≤',
  ge: '≥',
  infin: '∞',
  check: '✓',
  cross: '✗',
};

/**
 * Decode XML/HTML entities.
 *
 * Numeric forms cover the accented Latin and CJK characters Confluence emits
 * for non-ASCII page text; the named table covers the punctuation and symbols
 * its editor inserts. Unknown named entities are left as written rather than
 * silently deleted.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    const named = NAMED_ENTITIES[body];
    return named === undefined ? match : named;
  });
}

/** Escape the Markdown characters that would otherwise change the rendering. */
function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]])/g, '\\$1');
}

/** A parsed element: its tag, its attributes, and the raw markup inside it. */
interface Element {
  tag: string;
  attrs: Record<string, string>;
  inner: string;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)\s*=\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const name = m[1] ?? m[3];
    const value = m[2] ?? m[4] ?? '';
    attrs[name.toLowerCase()] = decodeEntities(value);
  }
  return attrs;
}

/**
 * Find the element opening at `from`, returning it and the index after its
 * close tag. Nested same-name tags are matched by depth counting, which a
 * single regex cannot do.
 *
 * Returns null when the markup at `from` is not an element open tag.
 */
function readElement(html: string, from: number): { el: Element; end: number } | null {
  const open = /^<([\w:-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/.exec(html.slice(from));
  if (!open) return null;

  const tag = open[1].toLowerCase();
  const attrs = parseAttrs(open[2] ?? '');
  const selfClosing = open[3] === '/' || VOID_TAGS.has(tag);
  const afterOpen = from + open[0].length;

  if (selfClosing) {
    return { el: { tag, attrs, inner: '' }, end: afterOpen };
  }

  // Walk forward counting same-name opens so nested lists and tables close
  // against the right tag.
  const scan = new RegExp(`<${escapeRegExp(open[1])}\\b[^>]*>|</${escapeRegExp(open[1])}\\s*>`, 'gi');
  scan.lastIndex = afterOpen;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = scan.exec(html))) {
    if (m[0][1] === '/') {
      depth--;
      if (depth === 0) {
        return {
          el: { tag, attrs, inner: html.slice(afterOpen, m.index) },
          end: m.index + m[0].length,
        };
      }
    } else if (!m[0].endsWith('/>')) {
      depth++;
    }
  }

  // Unclosed tag: treat the rest of the document as its content.
  return { el: { tag, attrs, inner: html.slice(afterOpen) }, end: html.length };
}

const VOID_TAGS = new Set(['br', 'hr', 'img', 'col', 'colgroup', 'meta', 'link']);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Read the `ac:parameter` values and plain-text body of a structured macro. */
function macroParts(inner: string): { params: Record<string, string>; body: string } {
  const params: Record<string, string> = {};
  const paramRe = /<ac:parameter\b[^>]*ac:name="([^"]+)"[^>]*>([\s\S]*?)<\/ac:parameter>/gi;
  let m: RegExpExecArray | null;
  while ((m = paramRe.exec(inner))) {
    params[m[1]] = decodeEntities(m[2]).trim();
  }

  const bodyMatch =
    /<ac:plain-text-body>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/ac:plain-text-body>/i.exec(inner) ??
    /<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>/i.exec(inner);

  return { params, body: bodyMatch ? bodyMatch[1] : '' };
}

/**
 * Render inline content: everything that belongs on one line.
 *
 * Block elements encountered here (a stray list inside a table cell, say) are
 * rendered through the block renderer and flattened onto the line, which is
 * the best a single-line context can do.
 */
function renderInline(html: string): string {
  let out = '';
  let i = 0;

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      out += escapeMarkdown(decodeEntities(html.slice(i)));
      break;
    }

    out += escapeMarkdown(decodeEntities(html.slice(i, lt)));

    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt);
      i = close === -1 ? html.length : close + 3;
      continue;
    }

    const read = readElement(html, lt);
    if (!read) {
      // A bare '<' that does not open a tag is literal text.
      out += '\\<';
      i = lt + 1;
      continue;
    }

    const { el, end } = read;
    switch (el.tag) {
      case 'strong':
      case 'b':
        out += wrapIfContent(renderInline(el.inner), '**');
        break;
      case 'em':
      case 'i':
        out += wrapIfContent(renderInline(el.inner), '*');
        break;
      case 's':
      case 'del':
      case 'strike':
        out += wrapIfContent(renderInline(el.inner), '~~');
        break;
      case 'code':
        out += wrapCode(stripTags(el.inner));
        break;
      case 'br':
        out += '\n';
        break;
      case 'a': {
        const href = el.attrs.href ?? '';
        const label = renderInline(el.inner).trim();
        out += href ? `[${label || href}](${href})` : label;
        break;
      }
      case 'ac:link':
        out += renderAcLink(el.inner);
        break;
      case 'ac:image':
      case 'ri:attachment':
        out += renderImage(el);
        break;
      case 'img': {
        const alt = el.attrs.alt ?? 'image';
        const src = el.attrs.src ?? '';
        out += src ? `![${alt}](${src})` : `![${alt}]`;
        break;
      }
      case 'time':
        out += el.attrs['datetime'] ?? renderInline(el.inner);
        break;
      case 'span':
      case 'u':
      case 'sub':
      case 'sup':
      case 'font':
      case 'div':
        out += renderInline(el.inner);
        break;
      case 'ac:structured-macro':
        out += renderInlineMacro(el);
        break;
      default:
        out += renderInline(el.inner);
        break;
    }
    i = end;
  }

  return out;
}

/** Apply an emphasis marker only when there is something to emphasise. */
function wrapIfContent(text: string, marker: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;
  // Keep surrounding spaces outside the markers, or Markdown will not render.
  const lead = text.slice(0, text.length - text.trimStart().length);
  const tail = text.slice(text.trimEnd().length);
  return `${lead}${marker}${trimmed}${marker}${tail}`;
}

/** Wrap a code span, widening the fence when the content contains backticks. */
function wrapCode(text: string): string {
  if (!text) return '';
  const longest = (text.match(/`+/g) ?? []).reduce((n, run) => Math.max(n, run.length), 0);
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** Remove tags and decode entities, for contexts that cannot hold markup. */
function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ''));
}

/** `<ac:link>` wraps a page or user reference plus an optional link body. */
function renderAcLink(inner: string): string {
  const page = /<ri:page\b[^>]*ri:content-title="([^"]*)"/i.exec(inner);
  const user = /<ri:user\b[^>]*ri:account-id="([^"]*)"/i.exec(inner);
  const bodyMatch = /<ac:(?:plain-text-)?link-body>([\s\S]*?)<\/ac:(?:plain-text-)?link-body>/i.exec(inner);
  const label = bodyMatch ? renderInline(bodyMatch[1]).trim() : '';

  if (page) {
    const title = decodeEntities(page[1]);
    return label && label !== title ? `${label} (${title})` : title;
  }
  if (user) {
    return label || `@${decodeEntities(user[1])}`;
  }
  return label;
}

function renderImage(el: Element): string {
  const filename =
    /<ri:attachment\b[^>]*ri:filename="([^"]*)"/i.exec(el.inner)?.[1] ??
    el.attrs['ri:filename'];
  const url = /<ri:url\b[^>]*ri:value="([^"]*)"/i.exec(el.inner)?.[1];
  const alt = el.attrs['ac:alt'] ?? filename ?? 'image';
  const src = url ?? filename;
  return src ? `![${decodeEntities(alt)}](${decodeEntities(src)})` : `![${decodeEntities(alt)}]`;
}

/** Macros that carry inline meaning; block macros are handled separately. */
function renderInlineMacro(el: Element): string {
  const name = (el.attrs['ac:name'] ?? '').toLowerCase();
  const { params, body } = macroParts(el.inner);

  switch (name) {
    case 'status':
      return `**[${params.title ?? ''}]**`;
    case 'jira':
      return params.key ?? '';
    case 'anchor':
      return '';
    default:
      return body ? renderInline(body) : '';
  }
}

/**
 * Render a `<table>` as a GitHub-style Markdown table.
 *
 * Markdown has no merged cells, so `rowspan`/`colspan` are expanded into
 * repeated cells. Dropping them instead would shift every later cell in the
 * row one column to the left, silently pairing values with the wrong header.
 */
function renderTable(inner: string): string {
  const rows: Array<{ cells: string[]; header: boolean }> = [];
  // Cells owed to later rows by a rowspan above them, keyed by column index.
  const carry = new Map<number, { text: string; rows: number }>();

  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(inner))) {
    const cells: string[] = [];
    let header = false;
    let column = 0;

    /** Emit any cell a previous row's rowspan reserved for this column. */
    const drainCarry = () => {
      let pending = carry.get(column);
      while (pending) {
        cells.push(pending.text);
        pending.rows -= 1;
        if (pending.rows <= 0) carry.delete(column);
        column += 1;
        pending = carry.get(column);
      }
    };

    const cellRe = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      drainCarry();

      if (cellMatch[1].toLowerCase() === 'th') header = true;
      const attrs = parseAttrs(cellMatch[2] ?? '');
      const colspan = Math.max(1, Math.min(20, Number(attrs.colspan) || 1));
      const rowspan = Math.max(1, Math.min(100, Number(attrs.rowspan) || 1));

      // Cells cannot contain line breaks in a Markdown table.
      const text = renderBlocks(cellMatch[3])
        .replace(/\s*\n+\s*/g, ' ')
        .replace(/\|/g, '\\|')
        .trim();

      for (let n = 0; n < colspan; n++) {
        cells.push(text);
        if (rowspan > 1) carry.set(column, { text, rows: rowspan - 1 });
        column += 1;
      }
    }

    drainCarry();
    if (cells.length) rows.push({ cells, header });
  }

  if (!rows.length) return '';

  const width = rows.reduce((n, row) => Math.max(n, row.cells.length), 0);
  const pad = (cells: string[]) => {
    const padded = cells.slice();
    while (padded.length < width) padded.push('');
    return padded;
  };

  // Markdown requires a header row; a table that has none gets an empty one so
  // the remaining rows still render as a table rather than as a paragraph.
  const hasHeader = rows[0].header;
  const headerCells = hasHeader ? pad(rows[0].cells) : new Array(width).fill('');
  const bodyRows = hasHeader ? rows.slice(1) : rows;

  const lines = [
    `| ${headerCells.join(' | ')} |`,
    `| ${new Array(width).fill('---').join(' | ')} |`,
    ...bodyRows.map((row) => `| ${pad(row.cells).join(' | ')} |`),
  ];

  return lines.join('\n');
}

/** Render `<ul>`/`<ol>` items, indenting any list nested inside an item. */
function renderList(inner: string, ordered: boolean, depth: number): string {
  const lines: string[] = [];
  const indent = '  '.repeat(depth);
  let index = 1;

  let i = 0;
  while (i < inner.length) {
    const lt = inner.indexOf('<li', i);
    if (lt === -1) break;
    const read = readElement(inner, lt);
    if (!read) break;

    const marker = ordered ? `${index++}.` : '-';
    const content = renderListItem(read.el.inner, depth);
    const [first = '', ...rest] = content.split('\n');
    lines.push(`${indent}${marker} ${first}`.trimEnd());
    for (const line of rest) {
      lines.push(line ? `${line}` : '');
    }
    i = read.end;
  }

  return lines.join('\n');
}

/**
 * Render one `<li>`: its own inline text, then any nested list beneath it.
 */
function renderListItem(inner: string, depth: number): string {
  const parts: string[] = [];
  let ownText = '';
  let i = 0;

  while (i < inner.length) {
    const lt = inner.indexOf('<', i);
    if (lt === -1) {
      ownText += renderInline(inner.slice(i));
      break;
    }

    const read = readElement(inner, lt);
    if (read && (read.el.tag === 'ul' || read.el.tag === 'ol')) {
      ownText += renderInline(inner.slice(i, lt));
      parts.push(renderList(read.el.inner, read.el.tag === 'ol', depth + 1));
      i = read.end;
      continue;
    }

    if (read && BLOCK_IN_ITEM.has(read.el.tag)) {
      ownText += renderInline(inner.slice(i, lt));
      const block = renderBlocks(read.el.inner).trim();
      if (block) parts.push(indentLines(block, depth + 1));
      i = read.end;
      continue;
    }

    ownText += renderInline(inner.slice(i, read ? read.end : lt + 1));
    i = read ? read.end : lt + 1;
  }

  const head = ownText.replace(/[ \t]+/g, ' ').trim();
  return [head, ...parts.filter(Boolean)].filter(Boolean).join('\n');
}

const BLOCK_IN_ITEM = new Set(['table', 'blockquote', 'ac:structured-macro']);

function indentLines(text: string, depth: number): string {
  const indent = '  '.repeat(depth);
  return text
    .split('\n')
    .map((line) => (line ? indent + line : line))
    .join('\n');
}

/** Render a block-level macro: code blocks, panels, info boxes, TOC. */
function renderBlockMacro(el: Element): string {
  const name = (el.attrs['ac:name'] ?? '').toLowerCase();
  const { params, body } = macroParts(el.inner);

  switch (name) {
    case 'code': {
      const language = params.language ?? '';
      const code = body.replace(/\s+$/, '');
      return `\`\`\`${language}\n${code}\n\`\`\``;
    }
    case 'noformat':
      return `\`\`\`\n${body.replace(/\s+$/, '')}\n\`\`\``;
    case 'info':
    case 'note':
    case 'warning':
    case 'tip':
    case 'panel': {
      const label = params.title ? `**${params.title}**\n\n` : '';
      const content = renderBlocks(body).trim();
      const quoted = `${label}${content}`
        .split('\n')
        .map((line) => `> ${line}`.trimEnd())
        .join('\n');
      return quoted;
    }
    case 'toc':
    case 'children':
    case 'anchor':
      // Navigation aids with no content of their own.
      return '';
    case 'expand': {
      const title = params.title ? `**${params.title}**\n\n` : '';
      return `${title}${renderBlocks(body).trim()}`;
    }
    default:
      return renderBlocks(body).trim();
  }
}

/**
 * Render block-level markup into Markdown blocks separated by blank lines.
 */
function renderBlocks(html: string): string {
  const blocks: string[] = [];
  let pending = '';

  const flush = () => {
    const text = pending.replace(/[ \t]+/g, ' ').trim();
    if (text) blocks.push(text);
    pending = '';
  };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      pending += renderInline(html.slice(i));
      break;
    }

    pending += renderInline(html.slice(i, lt));

    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt);
      i = close === -1 ? html.length : close + 3;
      continue;
    }

    const read = readElement(html, lt);
    if (!read) {
      pending += '\\<';
      i = lt + 1;
      continue;
    }

    const { el, end } = read;
    const heading = /^h([1-6])$/.exec(el.tag);

    if (heading) {
      flush();
      const text = renderInline(el.inner).replace(/\s+/g, ' ').trim();
      if (text) blocks.push(`${'#'.repeat(Number(heading[1]))} ${text}`);
    } else if (el.tag === 'p') {
      flush();
      const text = renderInline(el.inner).replace(/[ \t]+/g, ' ').trim();
      if (text) blocks.push(text);
    } else if (el.tag === 'ul' || el.tag === 'ol') {
      flush();
      const list = renderList(el.inner, el.tag === 'ol', 0);
      if (list.trim()) blocks.push(list);
    } else if (el.tag === 'table') {
      flush();
      const table = renderTable(el.inner);
      if (table) blocks.push(table);
    } else if (el.tag === 'blockquote') {
      flush();
      const quoted = renderBlocks(el.inner)
        .trim()
        .split('\n')
        .map((line) => `> ${line}`.trimEnd())
        .join('\n');
      if (quoted.trim()) blocks.push(quoted);
    } else if (el.tag === 'pre') {
      flush();
      blocks.push(`\`\`\`\n${stripTags(el.inner).replace(/\s+$/, '')}\n\`\`\``);
    } else if (el.tag === 'hr') {
      flush();
      blocks.push('---');
    } else if (el.tag === 'br') {
      pending += '\n';
    } else if (el.tag === 'ac:structured-macro') {
      flush();
      const macro = renderBlockMacro(el);
      if (macro.trim()) blocks.push(macro);
    } else if (el.tag === 'ac:layout' || el.tag === 'ac:layout-section' || el.tag === 'ac:layout-cell' || el.tag === 'div' || el.tag === 'section' || el.tag === 'ac:adf-extension') {
      flush();
      const nested = renderBlocks(el.inner).trim();
      if (nested) blocks.push(nested);
    } else if (el.tag === 'ac:task-list') {
      flush();
      const tasks = renderTaskList(el.inner);
      if (tasks) blocks.push(tasks);
    } else {
      pending += renderInline(html.slice(lt, end));
    }

    i = end;
  }

  flush();
  return blocks.join('\n\n');
}

/** Confluence task lists map onto Markdown checkboxes. */
function renderTaskList(inner: string): string {
  const lines: string[] = [];
  const taskRe = /<ac:task>([\s\S]*?)<\/ac:task>/gi;
  let m: RegExpExecArray | null;
  while ((m = taskRe.exec(inner))) {
    const status = /<ac:task-status>([\s\S]*?)<\/ac:task-status>/i.exec(m[1])?.[1]?.trim();
    const bodyMatch = /<ac:task-body>([\s\S]*?)<\/ac:task-body>/i.exec(m[1]);
    const text = bodyMatch ? renderInline(bodyMatch[1]).replace(/\s+/g, ' ').trim() : '';
    lines.push(`- [${status === 'complete' ? 'x' : ' '}] ${text}`.trimEnd());
  }
  return lines.join('\n');
}

/**
 * Convert a Confluence storage-format body to Markdown.
 *
 * Returns an empty string for empty input. Never throws: unrecognised markup
 * degrades to its text content rather than failing the tool call.
 */
export function storageToMarkdown(storage: string): string {
  if (!storage || !storage.trim()) return '';
  try {
    return renderBlocks(storage)
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch {
    // A malformed page must still return something readable.
    return stripTags(storage).replace(/\s+/g, ' ').trim();
  }
}
