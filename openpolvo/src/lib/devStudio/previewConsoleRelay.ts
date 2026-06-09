/**
 * Relay puro (sem dependências) injectado no `index.html` do preview.
 * Mantido como módulo-folha para poder ser usado pelo scaffold sem criar ciclos
 * de import com o auto-heal.
 */

/** Marcador das mensagens emitidas pelo relay dentro da iframe. */
export const PREVIEW_CONSOLE_BRIDGE_SOURCE = "openpolvo-preview-console";

/**
 * Script inline que captura erros de runtime (console.error/warn, window error e
 * unhandledrejection) e os reenvia ao host via `postMessage`. Sem dependências.
 */
export function buildPreviewConsoleRelaySnippet(): string {
  return `<script>(function(){
  if (window.__opPreviewRelay) return;
  window.__opPreviewRelay = true;
  var SRC = ${JSON.stringify(PREVIEW_CONSOLE_BRIDGE_SOURCE)};
  function send(level, parts, sourceId, line){
    try {
      var message = parts.map(function(p){
        if (p instanceof Error) return (p.stack || (p.name + ": " + p.message));
        if (typeof p === "string") return p;
        try { return JSON.stringify(p); } catch (e) { return String(p); }
      }).join(" ");
      if (!message) return;
      parent.postMessage({ source: SRC, level: level, message: message, sourceId: sourceId || "", line: line || 0 }, "*");
    } catch (e) { /* noop */ }
  }
  var origError = console.error.bind(console);
  console.error = function(){ send(3, [].slice.call(arguments)); origError.apply(null, arguments); };
  var origWarn = console.warn.bind(console);
  console.warn = function(){ send(2, [].slice.call(arguments)); origWarn.apply(null, arguments); };
  window.addEventListener("error", function(ev){
    send(3, [ev.message || (ev.error && ev.error.stack) || "Erro de runtime"], ev.filename, ev.lineno);
  });
  window.addEventListener("unhandledrejection", function(ev){
    var r = ev.reason;
    send(3, ["Unhandled promise rejection: " + (r && r.stack ? r.stack : String(r))]);
  });
})();</script>`;
}
