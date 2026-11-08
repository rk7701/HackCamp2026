export type ScanProgress = { label: string; completed?: number; total?: number };

/** Keep implementation names and internal paths out of errors shown to customers. */
export function scanErrorMessage(message: string): string {
  if (/hunyuan|hy3dgen|tencent/i.test(message)) return 'The scan service could not finish this model. Please try again.';
  return message;
}
