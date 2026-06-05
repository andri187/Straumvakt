// Shared sidebar/nav icon normaliser for the persona concept mockups.
// Each concept's nav originally used colored emoji. This swaps them for the
// EXACT Lucide icons the real app sidebar uses (lucide-react -> same glyphs),
// rendered monochrome via Lucide's web build (vendored as lucide.min.js).
// Loaded as <script src="icons.js"></script> at the end of each concept HTML.
(function () {
  // Glyph (emoji / symbol) -> Lucide kebab-case name, aligned to the app's
  // sidebar.tsx icon set (LayoutDashboard, MapPin, Plug, Cable, Zap, ...).
  var MAP = {
    '▦': 'layout-dashboard', '📊': 'activity',
    '📍': 'map-pin',
    '🔌': 'plug',
    '🧵': 'cable',
    '⚡': 'zap',
    '📈': 'activity',
    '🆔': 'fingerprint',
    '🩺': 'stethoscope',
    '🔐': 'shield-check', '🔒': 'lock',
    '🏛': 'network',
    '🏢': 'building-2', '🏗': 'building-2', '🏘': 'building-2',
    '👪': 'users', '👥': 'users',
    '🧑💼': 'user-cog', '👤': 'user',
    '🧮': 'receipt', '🧾': 'receipt',
    '🏷': 'tag',
    '💼': 'wallet',
    '🤝': 'handshake',
    '📄': 'file-text', '📑': 'file-text',
    '🔋': 'battery',
    '💡': 'lightbulb',
    '✉': 'inbox', '📧': 'mail', '🔔': 'bell',
    '🔑': 'key-round',
    '📚': 'book-open',
    '🔧': 'wrench', '🧰': 'wrench',
    '📱': 'smartphone',
    '🛰': 'radio-tower', '📡': 'radio-tower', '🌐': 'globe',
    '🔬': 'flask-conical', '🧪': 'flask-conical',
    '💳': 'credit-card',
    '🗓': 'calendar',
    '🛟': 'life-buoy',
    '＋': 'plus-circle', '➕': 'plus-circle',
    '⚙': 'settings'
  };

  function strip(s) { return (s || '').replace(/[️‍]/g, '').trim(); }

  // Swap glyphs for <i data-lucide="name"> placeholders.
  document.querySelectorAll('.nav-item .ico, .bnav .it .ic').forEach(function (el) {
    var name = MAP[strip(el.textContent)];
    if (name) el.innerHTML = '<i data-lucide="' + name + '"></i>';
  });

  // Normalise sizing/colour (Lucide svgs inherit currentColor by default).
  var st = document.createElement('style');
  st.textContent =
    '.nav-item .ico{width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;filter:none !important;opacity:1 !important;}' +
    '.nav-item .ico svg{width:18px;height:18px;}' +
    '.bnav .it .ic{filter:none !important;}' +
    '.bnav .it .ic svg{width:22px;height:22px;}';
  document.head.appendChild(st);

  function render() {
    if (window.lucide && window.lucide.createIcons) {
      window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 } });
    }
  }

  if (window.lucide) {
    render();
  } else {
    var s = document.createElement('script');
    s.src = 'lucide.min.js';
    s.onload = render;
    document.head.appendChild(s);
  }
})();
