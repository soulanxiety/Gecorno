// |reftest| shell-option(--enable-temporal) skip-if(!this.hasOwnProperty('Temporal')||!xulRuntime.shell) -- Temporal is not enabled unconditionally, requires shell-options
// Copyright (C) 2022 Igalia, S.L. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-temporal.duration.compare
description: Negative zero, as an extended year, fails
features: [Temporal]
---*/

const duration1 = new Temporal.Duration(1);
const duration2 = new Temporal.Duration(2);
const bad = "-000000-11-01";

assert.throws(
  RangeError,
  () => Temporal.Duration.compare(duration1, duration2, { relativeTo: bad }),
  "Cannot use negative zero as extended year"
);

reportCompare(0, 0);
