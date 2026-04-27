type DiffOp =
  | { type: "equal"; line: string }
  | { type: "add"; line: string }
  | { type: "remove"; line: string };

function buildLineDiff(before: string, after: string): DiffOp[] {
  const left = before.split("\n");
  const right = after.split("\n");
  const n = left.length;
  const m = right.length;
  const cols = m + 1;
  const dp = new Uint32Array((n + 1) * cols);

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const idx = i * cols + j;
      if (left[i] === right[j]) {
        dp[idx] = dp[(i + 1) * cols + (j + 1)] + 1;
      } else {
        dp[idx] = Math.max(dp[(i + 1) * cols + j], dp[idx + 1]);
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    const idx = i * cols + j;
    if (left[i] === right[j]) {
      ops.push({ type: "equal", line: left[i] ?? "" });
      i++;
      j++;
      continue;
    }

    if (dp[(i + 1) * cols + j] >= dp[idx + 1]) {
      ops.push({ type: "remove", line: left[i] ?? "" });
      i++;
    } else {
      ops.push({ type: "add", line: right[j] ?? "" });
      j++;
    }
  }

  while (i < n) {
    ops.push({ type: "remove", line: left[i] ?? "" });
    i++;
  }

  while (j < m) {
    ops.push({ type: "add", line: right[j] ?? "" });
    j++;
  }

  return ops;
}

const MAX_DIFF_LINES = 5_000;
const MAX_DIFF_CELLS = 1_000_000;

export function renderLineDiff(before: string, after: string): string {
  const left = before.split("\n");
  const right = after.split("\n");
  if (left.length > MAX_DIFF_LINES || right.length > MAX_DIFF_LINES) {
    return "# Diff omitted: one of the files exceeds the maximum line limit for diff generation.";
  }
  if (left.length * right.length > MAX_DIFF_CELLS) {
    return "# Diff omitted: file size combination exceeds safe computation limits.";
  }
  return buildLineDiff(before, after)
    .map((op) => {
      if (op.type === "equal") return ` ${op.line}`;
      if (op.type === "add") return `+${op.line}`;
      return `-${op.line}`;
    })
    .join("\n");
}
