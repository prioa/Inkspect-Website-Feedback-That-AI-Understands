import { defineConfig } from 'wxt';

// Strukturell statt aus 'vite' importiert — vite ist nur eine transitive
// Dependency von wxt, tsc findet dessen Typen nicht.
interface Plugin {
  name: string;
  enforce?: 'pre' | 'post';
  generateBundle?: (
    options: unknown,
    bundle: Record<string, { type: string; code?: string }>,
  ) => void;
}

/**
 * Escaped code-unit-weise jedes Nicht-ASCII-Zeichen der JS-Ausgabe zu \uXXXX.
 *
 * Grund: CodeMirror nutzt das Unicode-Non-Character U+FFFF als Sentinel. Der
 * Minifier laesst es roh im Bundle. Chrome validiert Content-Script-Dateien mit
 * base::IsStringUTF8, das Non-Characters (U+FFFE/U+FFFF, U+FDD0-U+FDEF) und
 * Surrogates ablehnt — die Extension liesse sich sonst gar nicht laden
 * ("... ist nicht UTF-8-codiert"). Ohne Regex-Literal geschrieben, damit die
 * Config-Quelle selbst rein ASCII bleibt.
 */
function escapeNonAscii(code: string): string {
  let out = '';
  let changed = false;
  for (let i = 0; i < code.length; i++) {
    const c = code.charCodeAt(i);
    if (c > 0x7f) {
      out += '\\u' + c.toString(16).padStart(4, '0');
      changed = true;
    } else {
      out += code[i];
    }
  }
  return changed ? out : code;
}

function asciiOnlyOutput(): Plugin {
  return {
    name: 'inkspect:ascii-only-output',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk' && file.code != null) file.code = escapeNonAscii(file.code);
      }
    },
  };
}

export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  vite: () => ({
    plugins: [asciiOnlyOutput()],
  }),

  // WXT baut fuer Firefox sonst MV2. Die DNR-Session-Rules, auf denen die
  // Frame-Blockade-Umgehung beruht, gibt es dort erst ab Firefox 113 / MV3.
  manifestVersion: 3,

  manifest: {
    name: 'Inkspect',
    description:
      'Responsive-Preview mit synchronen Device-Frames, Live-CSS-Editor und Feedback direkt auf der Seite.',
    permissions: ['declarativeNetRequestWithHostAccess', 'storage'],

    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },

    // Noetig fuer DNR modifyHeaders, das Nachladen von Cross-Origin-
    // Stylesheets (CDN) im Background und tabs.captureVisibleTab — letzteres
    // akzeptiert wörtlich nur '<all_urls>' oder 'activeTab', kein *://*/*.
    host_permissions: ['<all_urls>'],

    action: {
      default_title: 'Inkspect oeffnen',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
      },
    },

    browser_specific_settings: {
      gecko: {
        id: 'inkspect@dubdev.io',
        strict_min_version: '113.0',
      },
    },
  },
});
