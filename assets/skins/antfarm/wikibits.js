/* wikibits.js — the usual toc toggle and a search box focus helper.
   trimmed down for the mirror. no external requests, no tracking. */
(function () {
  function toggleToc() {
    var toc = document.getElementById('toc');
    if (!toc) return;
    var ul = toc.getElementsByTagName('ul')[0];
    var link = document.getElementById('togglelink');
    if (!ul || !link) return;
    var hidden = ul.style.display === 'none';
    ul.style.display = hidden ? '' : 'none';
    link.firstChild.nodeValue = hidden ? 'hide' : 'show';
  }
  function init() {
    var link = document.getElementById('togglelink');
    if (link) {
      link.onclick = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        toggleToc();
        return false;
      };
    }
    var search = document.getElementById('searchInput');
    if (search && /[?&]focus=search/.test(window.location.search)) search.focus();
  }
  if (document.addEventListener) document.addEventListener('DOMContentLoaded', init, false);
  else window.onload = init;
})();
