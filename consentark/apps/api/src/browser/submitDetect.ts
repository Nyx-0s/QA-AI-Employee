/**
 * Submit-like element classification — evaluated IN THE PAGE against the
 * element page-agent is about to click. Deliberately conservative: any doubt
 * means the gate trips (a needless approval is safe; a missed one is not).
 *
 * Ship as a plain JS string (not a tsx-transformed function): it is evaluated
 * inside the page via the CONFIG_MERGE_JS template, where esbuild's __name
 * wrappers don't exist.
 */
export const SUBMIT_DETECT_JS = `(() => {
  function isSubmitLike(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const text = (el.textContent || '').trim();
    const aria = (el.getAttribute('aria-label') || '').trim();
    const title = (el.getAttribute('title') || '').trim();
    const value = (el.value || '').trim();
    const words = [text, aria, title, value].join(' ');
    // PRIMARY signal — type wins regardless of text: icon-only buttons
    // (aria-label or glyph only) are submit-like and MUST be gated.
    if (tag === 'input' && (type === 'submit' || type === 'image')) return true;
    if (tag === 'button' && (type === 'submit' || type === '')) return true;
    if (el.closest && el.closest('form')) {
      // Inside a form: buttons without an explicit type are submit by spec.
      if (tag === 'button' && type !== 'button' && type !== 'reset') return true;
    }
    return /submit|send|pay|confirm|delete|order/i.test(words);
  }
  function describe(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
      : '';
    const type = el.getAttribute('type') ? '[' + el.getAttribute('type') + ']' : '';
    return tag + id + cls + type;
  }
  return { isSubmitLike, describe };
})()`;
