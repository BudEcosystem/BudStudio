pub const TITLEBAR_HEIGHT: u32 = 36;

pub const TITLEBAR_SCRIPT: &str = r#"
(function() {
  const TITLEBAR_ID = 'bud-titlebar';
  const TITLEBAR_HEIGHT = 36;

  function injectTitlebar() {
    if (document.getElementById(TITLEBAR_ID)) return;

    const titlebar = document.createElement('div');
    titlebar.id = TITLEBAR_ID;
    titlebar.setAttribute('data-tauri-drag-region', '');

    titlebar.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: ${TITLEBAR_HEIGHT}px;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(255, 255, 255, 0.78) 100%);
      border-bottom: 1px solid rgba(0, 0, 0, 0.06);
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.04);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: default;
      user-select: none;
      -webkit-user-select: none;
      -webkit-app-region: drag;
      backdrop-filter: blur(18px) saturate(180%);
      -webkit-backdrop-filter: blur(18px) saturate(180%);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 13px;
      font-weight: 500;
      color: rgba(0, 0, 0, 0.8);
      transition: background 0.3s ease, border-bottom 0.3s ease, box-shadow 0.3s ease;
    `;

    titlebar.textContent = 'Bud Studio';
    document.body.insertBefore(titlebar, document.body.firstChild);

    // Inject global styles
    const style = document.createElement('style');
    style.textContent = `
      :root {
        --bud-titlebar-height: ${TITLEBAR_HEIGHT}px;
      }

      body {
        padding-top: var(--bud-titlebar-height) !important;
      }

      /* Dark mode support */
      .dark #${TITLEBAR_ID} {
        background: linear-gradient(180deg, rgba(18, 18, 18, 0.82) 0%, rgba(18, 18, 18, 0.72) 100%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.2);
        color: rgba(255, 255, 255, 0.8);
      }

      html.dark #${TITLEBAR_ID} {
        background: linear-gradient(180deg, rgba(18, 18, 18, 0.82) 0%, rgba(18, 18, 18, 0.72) 100%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.2);
        color: rgba(255, 255, 255, 0.8);
      }
    `;
    document.head.appendChild(style);
  }

  // Inject on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectTitlebar);
  } else {
    injectTitlebar();
  }

  // Keep titlebar even if DOM changes
  const observer = new MutationObserver(() => {
    if (!document.getElementById(TITLEBAR_ID)) {
      injectTitlebar();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
"#;

pub fn inject_titlebar_script(window: &tauri::WebviewWindow) -> Result<(), tauri::Error> {
    window.eval(TITLEBAR_SCRIPT)?;
    log::info!("Titlebar script injected into window");
    Ok(())
}
