// Small helpers shared by the room and the creator.

// Copies an input's text: the Clipboard API where allowed, else the old
// select-and-copy (some file:// and in-app browsers). Leaves the text selected
// either way, so it can still be copied by hand. Resolves to whether it worked.
export async function copyText(input) {
  input.focus(); input.select(); input.setSelectionRange?.(0, input.value.length);
  try { await navigator.clipboard.writeText(input.value); return true; } catch {}
  try { return document.execCommand('copy'); } catch { return false; }
}

// A show/hide button for a password field.
export function showToggle(input, button) {
  const show = on => {
    input.type = on ? 'text' : 'password';
    button.textContent = on ? '隐藏' : '显示';
    button.setAttribute('aria-pressed', String(on));
  };
  button.addEventListener('click', () => show(input.type === 'password'));
  return { show };
}
