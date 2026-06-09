/* Tiny markdown renderer — bold, italic, inline code, fenced code blocks,
 * paragraph breaks, autolinks, and `[text](url)` links. Intentionally NOT a
 * spec-compliant CommonMark parser: agent replies in our use case are short
 * support answers, not arbitrary docs. Anything we don't recognise falls
 * through as a text node so nothing is silently dropped.
 *
 * Security: all input is treated as untrusted (agent output can contain
 * anything the model produces). Plain text segments are appended via
 * createTextNode so no HTML injection is possible; URLs are validated
 * against http/https only.
 *
 * Returns a DocumentFragment ready to append into a bubble.
 */

const SAFE_URL = /^https?:\/\//i;

function appendInline(parent: Node, text: string): void {
  // First split on ` ... ` for inline code so the fence-character itself is
  // never re-interpreted as bold/italic.
  const codeChunks = text.split(/(`[^`\n]+`)/g);
  for (const chunk of codeChunks) {
    if (chunk.startsWith('`') && chunk.endsWith('`') && chunk.length >= 2) {
      const code = document.createElement('code');
      code.textContent = chunk.slice(1, -1);
      parent.appendChild(code);
      continue;
    }
    appendBoldItalicAndLinks(parent, chunk);
  }
}

function appendBoldItalicAndLinks(parent: Node, text: string): void {
  // Pull links [text](url) out first so their URL isn't matched as italic/etc.
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(text)) !== null) {
    if (m.index > last) appendBoldItalic(parent, text.slice(last, m.index));
    const a = document.createElement('a');
    a.textContent = m[1];
    if (SAFE_URL.test(m[2])) {
      a.href = m[2];
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    parent.appendChild(a);
    last = m.index + m[0].length;
  }
  if (last < text.length) appendBoldItalic(parent, text.slice(last));
}

function appendBoldItalic(parent: Node, text: string): void {
  // Greedy bold first, then italic on what remains. **bold** then *italic*.
  // Tokens that don't pair off fall through as text.
  const boldRe = /\*\*([^*\n]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = boldRe.exec(text)) !== null) {
    if (m.index > last) appendItalicOrText(parent, text.slice(last, m.index));
    const strong = document.createElement('strong');
    strong.textContent = m[1];
    parent.appendChild(strong);
    last = m.index + m[0].length;
  }
  if (last < text.length) appendItalicOrText(parent, text.slice(last));
}

function appendItalicOrText(parent: Node, text: string): void {
  const italicRe = /(?<![*\w])\*([^*\n]+)\*(?!\w)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = italicRe.exec(text)) !== null) {
    if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
    const em = document.createElement('em');
    em.textContent = m[1];
    parent.appendChild(em);
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

export function renderMarkdown(input: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  // Split on fenced code blocks first so their contents are inert.
  const fenceRe = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(input)) !== null) {
    if (m.index > last) appendProse(frag, input.slice(last, m.index));
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    if (m[1]) code.setAttribute('data-lang', m[1]);
    code.textContent = m[2].replace(/\n$/, '');
    pre.appendChild(code);
    frag.appendChild(pre);
    last = m.index + m[0].length;
  }
  if (last < input.length) appendProse(frag, input.slice(last));
  return frag;
}

function appendProse(frag: DocumentFragment, text: string): void {
  // Split on blank lines into paragraphs; inside a paragraph, line breaks
  // become <br>. Two trailing spaces aren't required (chat replies skip that).
  const paragraphs = text.split(/\n{2,}/);
  for (const para of paragraphs) {
    const t = para.trim();
    if (!t) continue;
    const p = document.createElement('p');
    const lines = t.split('\n');
    lines.forEach((line, i) => {
      if (i > 0) p.appendChild(document.createElement('br'));
      appendInline(p, line);
    });
    frag.appendChild(p);
  }
}
