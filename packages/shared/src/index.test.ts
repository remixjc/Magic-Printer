import test from "node:test";
import assert from "node:assert/strict";
import { printOptionsSchema } from "./index.js";

test("print options apply safe defaults", () => {
  assert.deepEqual(printOptionsSchema.parse({}), {
    copies: 1,
    orientation: "portrait",
    color: "color",
    duplex: "none",
    paperSize: "A4"
  });
});
