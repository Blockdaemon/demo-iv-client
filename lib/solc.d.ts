declare module 'solc' {
  interface ImportResult {
    contents?: string;
    error?: string;
  }

  interface CompileCallbacks {
    import?: (path: string) => ImportResult;
  }

  interface Solc {
    compile(input: string, callbacks?: CompileCallbacks): string;
  }

  const solc: Solc;
  export default solc;
}
