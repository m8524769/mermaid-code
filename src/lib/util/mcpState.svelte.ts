export const MCP_KEY = 'mermaid-mcp-enabled';

const _state = $state({
  enabled: typeof localStorage !== 'undefined' ? localStorage.getItem(MCP_KEY) === 'true' : false
});

export const mcpState = {
  get enabled() {
    return _state.enabled;
  },
  set(value: boolean): void {
    _state.enabled = value;
    localStorage.setItem(MCP_KEY, String(value));
  }
};
