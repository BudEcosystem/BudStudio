/**
 * Strip ANSI escape sequences from output for clean LLM consumption.
 *
 * Removes:
 * - CSI sequences: ESC [ ... letter (colors, cursor movement, etc.)
 * - OSC sequences: ESC ] ... BEL (title changes, hyperlinks, etc.)
 * - Control characters: C0 controls except \n (\x0a) and \r (\x0d)
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[?]?[0-9;]*[a-zA-Z]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*\x07/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x09\x0b\x0c\x0e-\x1f]/g, "");
}
