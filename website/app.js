const root = document.documentElement;
const themeToggle = document.querySelector('[data-theme-toggle]');
const header = document.querySelector('[data-header]');
const menuToggle = document.querySelector('[data-menu-toggle]');
const mobileNav = document.querySelector('[data-mobile-nav]');

const preferredTheme = () => {
  const stored = localStorage.getItem('magic-printer-theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
};

const setTheme = (theme) => {
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  localStorage.setItem('magic-printer-theme', theme);
};

setTheme(preferredTheme());

themeToggle?.addEventListener('click', () => {
  setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
});

const updateHeader = () => {
  header?.classList.toggle('scrolled', window.scrollY > 16);
};

updateHeader();
window.addEventListener('scroll', updateHeader, { passive: true });

menuToggle?.addEventListener('click', () => {
  const open = mobileNav?.classList.toggle('open') ?? false;
  menuToggle.setAttribute('aria-expanded', String(open));
});

mobileNav?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    mobileNav.classList.remove('open');
    menuToggle?.setAttribute('aria-expanded', 'false');
  });
});

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    });
  },
  { threshold: 0.12, rootMargin: '0px 0px -30px' },
);

document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));

const releaseStatus = document.querySelector('[data-release-status]');
const releaseSummary = document.querySelector('[data-release-summary]');
const releaseLink = document.querySelector('[data-release-link]');

fetch('https://api.github.com/repos/remixjc/Magic-Printer/releases/latest', {
  headers: { Accept: 'application/vnd.github+json' },
})
  .then((response) => {
    if (!response.ok) throw new Error('release unavailable');
    return response.json();
  })
  .then((release) => {
    if (!release?.tag_name) throw new Error('release unavailable');
    if (releaseStatus) releaseStatus.textContent = 'LATEST RELEASE';
    if (releaseSummary) releaseSummary.textContent = `${release.tag_name} 已发布，支持 Windows、macOS 和 Linux。安装包与校验信息可在 GitHub Releases 中获取。`;
    if (releaseLink) {
      releaseLink.href = release.html_url || 'https://github.com/remixjc/Magic-Printer/releases';
      const label = releaseLink.querySelector('span');
      if (label) label.textContent = release.tag_name;
    }
  })
  .catch(() => {
    if (releaseStatus) releaseStatus.textContent = 'RELEASES';
  });
