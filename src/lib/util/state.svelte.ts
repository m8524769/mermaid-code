import type { ErrorHash, MarkerData, State, ValidatedState } from '$/types';
import { resolve } from '$app/paths';
import type { MermaidConfig } from 'mermaid';
import { untrack } from 'svelte';
import { env } from './env';
import {
  extractErrorLineText,
  findMostRelevantLineNumber,
  replaceLineNumberInErrorMessage
} from './errorHandling';
import { parse } from './mermaid';
import { readJSON, writeJSON } from './persist.svelte';
import { pakoSerde, serializeState } from './serde';
import { errorDebug, formatJSON } from './util';

export const defaultState: State = {
  code: '',
  grid: true,
  mermaid: '{}',
  panZoom: true,
  rough: false,
  updateDiagram: true
};

const CODE_STORE_KEY = 'codeStore';

// The single mutable input state; only update() below may write to it.
// The fallback is cloned so mutations never write through to defaultState.
const storedState = readJSON(CODE_STORE_KEY, { ...defaultState });
// Guard against stored states where mermaid is empty or invalid JSON
if (!storedState.mermaid) {
  storedState.mermaid = defaultState.mermaid;
} else {
  try {
    JSON.parse(storedState.mermaid);
  } catch {
    storedState.mermaid = defaultState.mermaid;
  }
}
const input = $state<State>(storedState);

// inputState is shared externally when exporting via URL, History, etc.
// It is reactive for reads; the read-only type keeps writes inside this
// module, where update() persists and re-validates every change.
export const inputState: Readonly<State> = input;

const validatedStateOf = (state: State): ValidatedState => ({
  ...state,
  editorMode: state.editorMode ?? 'code',
  error: undefined,
  errorMarkers: []
});

const initialState = $state.snapshot(input) as State;
// Only ever replaced wholesale, so raw (shallow) reactivity is enough.
let validatedCurrent = $state.raw<ValidatedState>(validatedStateOf(initialState));

const processState = async (state: State) => {
  const processed = validatedStateOf(state);
  // No changes should be done to fields part of `state`.
  if (!state.code.trim()) {
    return processed;
  }
  try {
    const { diagramType } = await parse(state.code);
    processed.diagramType = diagramType;
    JSON.parse(state.mermaid || '{}');
  } catch (error) {
    processed.error = error as Error;
    errorDebug();
    console.error(error);
    if (error && typeof error === 'object' && 'hash' in error) {
      try {
        let errorString = processed.error.toString();
        const errorLineText = extractErrorLineText(errorString);
        const realLineNumber = findMostRelevantLineNumber(errorLineText, state.code);

        let first_line: number, last_line: number, first_column: number, last_column: number;
        try {
          ({ first_line, last_line, first_column, last_column } = (error.hash as ErrorHash).loc);
        } catch {
          const lineNo = findMostRelevantLineNumber(errorString, state.code);
          first_line = lineNo;
          last_line = lineNo + 1;
          first_column = 0;
          last_column = 0;
        }

        if (realLineNumber !== -1) {
          errorString = replaceLineNumberInErrorMessage(errorString, realLineNumber);
        }

        processed.error = new Error(errorString);
        const marker: MarkerData = {
          endColumn: last_column + (first_column === last_column ? 0 : 5),
          endLineNumber: last_line + (realLineNumber - first_line),
          message: errorString || 'Syntax error',
          severity: 8, // Error
          startColumn: first_column,
          startLineNumber: realLineNumber
        };
        processed.errorMarkers = [marker];
      } catch (error) {
        console.error('Error without line helper', error);
      }
    }
  }
  return processed;
};

// Persist the current input state and asynchronously re-validate it,
// publishing the result to `validatedState`. Only called from update(),
// which suppresses dependency tracking.
const persistAndProcess = (): void => {
  const snapshot = $state.snapshot(input) as State;
  writeJSON(CODE_STORE_KEY, snapshot);
  void processState(snapshot).then((processed) => {
    // pan/zoom are not validation outputs and may have been changed by
    // updateViewport while we were parsing. Take the live viewport rather than
    // this snapshot's, so a stale pan/zoom can't revert the viewport when the
    // next render restores it.
    const { pan, zoom } = $state.snapshot(input) as State;
    validatedCurrent = { ...processed, pan, zoom };
  });
};

// The single mutation gateway: every update function funnels its writes
// through here. The mutator runs untracked so effects that call an update
// function never subscribe to the input state it reads, and the trailing
// persist + re-validate cannot be forgotten by a new update function.
const update = (mutate: (state: State) => void): void => {
  untrack(() => {
    mutate(input);
    persistAndProcess();
  });
};

// All internal reads should be done via validatedState, but it should not be
// persisted/shared externally.
export const validatedState = {
  get current(): ValidatedState {
    return validatedCurrent;
  }
};

const urlsCurrent = $derived.by(() => {
  const state = $state.snapshot(input) as State;
  const { code } = state;
  const { domain, krokiRendererUrl, rendererUrl } = env;
  const origin = domain ? `https://${domain}` : window.location.origin;
  // Read only by the Share dialog, so this pako serialization runs lazily —
  // when the dialog is open, not on every keystroke.
  const serialized = serializeState(state);
  const png = rendererUrl ? `${rendererUrl}/img/${serialized}?type=png` : '';
  return {
    kroki: krokiRendererUrl ? `${krokiRendererUrl}/mermaid/svg/${pakoSerde.serialize(code)}` : '',
    mdCode: png ? `[![](${png})](${origin}${resolve('/edit', {})}#${serialized})` : '',
    edit: `${origin}${resolve('/edit', {})}#${serialized}`,
    png,
    svg: rendererUrl ? `${rendererUrl}/svg/${serialized}` : ''
  };
});

export const urls = {
  get current() {
    return urlsCurrent;
  }
};

let renderCount = 0;
const applyPartial = (state: State, newState: Partial<State>): void => {
  renderCount++;
  Object.assign(state, newState, { renderCount });
};

export const updateCodeStore = (newState: Partial<State>): void => {
  update((state) => applyPartial(state, newState));
};

// Persist a viewport (pan/zoom) change without re-validating. The diagram is
// unchanged, so there is nothing to re-parse — we only write the new viewport
// to storage. validatedState is intentionally left untouched: nothing reads
// its pan/zoom until the next real update re-snapshots `input`, and a viewport
// change never triggers a re-render. Routing pan/zoom through update() instead
// would run mermaid's parse() on every (throttled) pan frame for no reason.
export const updateViewport = (pan: State['pan'], zoom: State['zoom']): void => {
  untrack(() => {
    input.pan = pan;
    input.zoom = zoom;
    writeJSON(CODE_STORE_KEY, $state.snapshot(input));
  });
};

export const updateCode = (
  code: string,
  {
    updateDiagram = false,
    resetPanZoom = false,
    pan,
    zoom
  }: {
    updateDiagram?: boolean;
    resetPanZoom?: boolean;
    pan?: State['pan'];
    zoom?: State['zoom'];
  } = {}
): void => {
  errorDebug();

  update((state) => {
    if (resetPanZoom) {
      // Apply the target viewport (undefined => reset to fit) in the same
      // update as the code, so the diagram renders once with the correct
      // pan/zoom. Splitting code and pan/zoom into two updates makes View's
      // render guard skip the second (code unchanged), leaving it reset.
      state.pan = pan;
      state.zoom = zoom;
    }
    state.code = code;
    state.updateDiagram = updateDiagram;
  });
};

export const updateConfig = (config: string): void => {
  updateCodeStore({ mermaid: config });
};

export const toggleDarkTheme = (dark: boolean): void => {
  update((state) => {
    const config = JSON.parse(state.mermaid) as MermaidConfig;
    const lightToDark: Record<string, string> = {
      default: 'dark',
      forest: 'dark',
      neutral: 'dark',
      base: 'dark',
      neo: 'neo-dark',
      redux: 'redux-dark',
      'redux-color': 'redux-dark-color'
    };
    const darkToLight: Record<string, string> = {
      dark: 'default',
      'neo-dark': 'neo',
      'redux-dark': 'redux',
      'redux-dark-color': 'redux-color'
    };
    const current = config.theme ?? 'redux-color';
    if (dark && current in lightToDark) {
      config.theme = lightToDark[current] as MermaidConfig['theme'];
    } else if (!dark && current in darkToLight) {
      config.theme = darkToLight[current] as MermaidConfig['theme'];
    }
    state.mermaid = formatJSON(config);
  });
};

// Replaces the whole input state (e.g. when restoring a history entry),
// dropping keys the next state does not define.
export const replaceInputState = (next: State): void => {
  update((state) => {
    for (const key of Object.keys(state)) {
      if (!(key in next)) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- full-replace semantics
        delete (state as unknown as Record<string, unknown>)[key];
      }
    }
    Object.assign(state, next);
  });
};

export const verifyState = (): void => {
  update((state) => applyPartial(state, state.panZoom ? {} : { panZoom: true }));
};
