import { describe, expect, it } from 'vitest';
import { serializeState, deserializeState, type SerdeType } from './serde';
import { defaultState } from './state.svelte';
import type { State } from '$lib/types';

const verifySerde = (state: State, serde?: SerdeType): string => {
  const serialized = serializeState(state, serde);
  const deserialized = deserializeState(serialized);
  expect(deserialized).to.deep.equal(state);
  return serialized;
};

describe('Serde tests', () => {
  it('should serialize and deserialize with default serde', () => {
    expect(verifySerde(defaultState)).toMatchInlineSnapshot(
      `"pako:eNo1yjEKgDAMRuG7_HNOkNlTuAUba8GaEpup9O4i6Pj43sBmScEAIXtJ4O6hhKpe5U2MCUKTazWrv7pFPsC7nLcSoiXpuhTJLt8yH_pqHfU"`
    );
  });

  it('should serialize and deserialize with base64 serde', () => {
    expect(verifySerde(defaultState, 'base64')).toMatchInlineSnapshot(
      `"base64:eyJjb2RlIjoiIiwiZ3JpZCI6dHJ1ZSwibWVybWFpZCI6Int9IiwicGFuWm9vbSI6dHJ1ZSwicm91Z2giOmZhbHNlLCJ1cGRhdGVEaWFncmFtIjp0cnVlfQ"`
    );
  });

  it('should serialize and deserialize with pako serde', () => {
    expect(verifySerde(defaultState, 'pako')).toMatchInlineSnapshot(
      `"pako:eNo1yjEKgDAMRuG7_HNOkNlTuAUba8GaEpup9O4i6Pj43sBmScEAIXtJ4O6hhKpe5U2MCUKTazWrv7pFPsC7nLcSoiXpuhTJLt8yH_pqHfU"`
    );
  });

  it('should throw error for unrecognized serde', () => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    expect(() => serializeState(defaultState, 'unknown')).toThrowError(
      'Unknown serde type: unknown'
    );
    expect(() => deserializeState('unknown:hello')).toThrowError('Unknown serde type: unknown');
  });
});
