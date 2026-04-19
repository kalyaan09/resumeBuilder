export type Theme = 'light' | 'dark' | 'system';

let _mq: MediaQueryList | null = null;
let _listener: ((e: MediaQueryListEvent) => void) | null = null;

function setDark(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
}

function removeSystemListener() {
  if (_mq && _listener) {
    _mq.removeEventListener('change', _listener);
    _mq = null;
    _listener = null;
  }
}

export function applyTheme(theme: Theme) {
  removeSystemListener();
  if (theme === 'dark') {
    setDark(true);
  } else if (theme === 'light') {
    setDark(false);
  } else {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setDark(mq.matches);
    _mq = mq;
    _listener = (e) => setDark(e.matches);
    mq.addEventListener('change', _listener);
  }
}
