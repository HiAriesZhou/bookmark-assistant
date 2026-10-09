// Service Worker Polyfills
// This must run before any other imports to ensure compatibility

console.log('🔧 Initializing service worker polyfills...');

// Immediately check and apply window polyfill
function applyWindowPolyfill() {
  if (typeof window === 'undefined') {
    console.log('📦 Adding window polyfill for service worker');

    // Create a proxy to catch any unexpected window access
    const windowProxy = new Proxy(globalThis, {
      get(target, prop) {
        if (prop === 'location') {
          return {
            href: 'chrome-extension://service-worker',
            origin: 'chrome-extension://service-worker',
          };
        }
        if (prop === 'document') {
          return {
            createElement: () => ({}),
            addEventListener: () => {},
            removeEventListener: () => {},
          };
        }
        if (prop === 'navigator') {
          return {
            userAgent: 'Chrome Extension Service Worker',
          };
        }

        // Log unexpected window access with stack trace
        if (!(prop in target)) {
          console.warn(`⚠️ Accessing window.${String(prop)} in service worker context`);
          console.trace('Window access stack trace:');
        }

        return (target as any)[prop];
      },
    });

    (globalThis as any).window = windowProxy;

    return true;
  } else {
    console.log('🔧 Window object already exists, skipping polyfill');
    return false;
  }
}

// Apply polyfill immediately
applyWindowPolyfill();

// Also apply it again after a short delay to catch any late imports
setTimeout(() => {
  if (typeof window === 'undefined') {
    console.log('🔄 Re-applying window polyfill after delay');
    applyWindowPolyfill();
  }
}, 10);

// Ensure fetch is available
if (typeof fetch === 'undefined') {
  console.warn('⚠️ Fetch not available, this might cause issues');
  (globalThis as any).fetch = globalThis.fetch;
} else {
  console.log('✅ Fetch is available');
}

console.log('✅ Service worker polyfills initialized');
