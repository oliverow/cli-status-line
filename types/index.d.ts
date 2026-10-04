// One run of text in the line, colored as the script's ANSI codes color it
export type Seg = { text: string; color?: string; dim?: boolean }

declare module 'claude-code' {
  interface PluginState {
    'cli-status-line': { line: Seg[] | null; effort: string | null; cacheAt: number | null; isMac: boolean }
  }
}
