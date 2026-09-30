export interface Position {
  row: number;
  col: number;
}

export function colToLetters(col: number): string {
  let n = col;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function lettersToCol(letters: string): number {
  let col = 0;
  for (const ch of letters.toUpperCase()) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  return col;
}

export function toAddress(row: number, col: number): string {
  return `${colToLetters(col)}${row}`;
}

const ADDRESS_RE = /^\$?([A-Za-z]{1,3})\$?([1-9][0-9]{0,6})$/;

export function parseAddress(address: string): Position | null {
  const match = ADDRESS_RE.exec(address.trim());
  if (!match) return null;
  return { col: lettersToCol(match[1]), row: Number(match[2]) };
}

/** `Income!B4` style key used for evaluated values across the workbook. */
export function cellKey(sheet: string, address: string): string {
  return `${sheet}!${address}`;
}

export function splitCellKey(key: string): { sheet: string; address: string } {
  const bang = key.lastIndexOf("!");
  return { sheet: key.slice(0, bang), address: key.slice(bang + 1) };
}
