---
title: "CRDTs Explained Without the Algebra"
summary: "Convergence falls out of three properties, and you can hold all three in your head at once."
thumbnail: "../images/thumb-3.jpg"
thumbnailAlt: "Abstract gradient cover art for CRDTs Explained Without the Algebra"
publishedAt: 2026-01-07
author: abhilakshsinghreen
tags: ["distributed", "crdt"]
draft: false
---

Convergence falls out of three properties, and you can hold all three in your head at once. This post is placeholder content used to exercise the build
pipeline: frontmatter validation, image optimisation, syntax highlighting and
the author card all get touched on the way through.

## Where the problem starts

The first version always looks fine. It survives review, it passes the tests,
and it behaves perfectly until the day the input distribution shifts. What
follows is the walk-through of that failure and the reasoning that fixed it.

![Diagram showing the initial approach for CRDTs Explained Without the Algebra](../images/fig-3-a.jpg)

A few things are worth pulling out before the code:

- The naive version is correct on the happy path, which is what makes it dangerous.
- The cost shows up as tail latency long before it shows up as errors.
- Every mitigation here trades memory for predictability.

## The shape of the fix

```typescript
type GCounter = Record<string, number>;
const merge = (a: GCounter, b: GCounter): GCounter =>
  Object.fromEntries(
    [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .map((k) => [k, Math.max(a[k] ?? 0, b[k] ?? 0)]),
  );
```

That is the whole change. It reads as a small refactor, but it moves the
expensive decision from request time to build time, which is the only reason
the numbers move at all.

> The fastest work is the work that was already done before anyone asked.

## Measuring it

| Approach | p50 | p99 | Memory |
| --- | --- | --- | --- |
| Naive | 12 ms | 480 ms | 40 MB |
| Batched | 9 ms | 110 ms | 96 MB |
| Precomputed | 3 ms | 14 ms | 180 MB |

![Benchmark results after applying the fix](../images/fig-3-b.jpg)

The p99 column is the one that matters. Median latency barely moved, which is
exactly why averages kept hiding the problem in the first place.

## What I would do differently

Start by writing down what varies per request. If the answer is *nothing*, the
work belongs in a build step, not a server. That single question would have
saved the first two attempts described above.
