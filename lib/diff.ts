type DiffOp =
  | { type: "equal"; line: string }
  | { type: "add"; line: string }
  | { type: "remove"; line: string };

function buildLineDiff(before: string, after: string): DiffOp[] {
  const left = before.split("\n");
  const right = after.split("\n");
  const dp = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0)
  );

  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      if (left[i] === right[j]) {
        dp[i]![j] = (dp[i + 1]![j + 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0);
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      ops.push({ type: "equal", line: left[i] ?? "" });
      i++;
      j++;
      continue;
    }

    if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      ops.push({ type: "remove", line: left[i] ?? "" });
      i++;
    } else {
      ops.push({ type: "add", line: right[j] ?? "" });
      j++;
    }
  }

  while (i < left.length) {
    ops.push({ type: "remove", line: left[i] ?? "" });
    i++;
  }

  while (j < right.length) {
    ops.push({ type: "add", line: right[j] ?? "" });
    j++;
  }

  return ops;
}

export function renderLineDiff(before: string, after: string): string {
  return buildLineDiff(before, after)
    .map((op) => {
      if (op.type === "equal") return ` ${op.line}`;
      if (op.type === "add") return `+${op.line}`;
      return `-${op.line}`;
    })
    .join("\n");
}
