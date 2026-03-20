import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Configure marked once: GFM tables, task lists, line-breaks
marked.use({ breaks: true, gfm: true });

const ALLOWED_TAGS = [
  'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote',
  'pre', 'code',
  'em', 'strong', 'del', 's',
  'a',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'span', 'div',
  'input', // for GFM task lists (checkboxes)
];

const ALLOWED_ATTR = ['href', 'title', 'class', 'target', 'rel', 'type', 'checked', 'disabled'];

/**
 * Safely render Markdown to sanitized HTML.
 * Uses DOMPurify to block any XSS — no raw HTML from model output ever reaches the DOM unsanitized.
 */
export function renderMarkdown(md: string): string {
  const raw = marked.parse(md) as string;
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORCE_BODY: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
  });
}
