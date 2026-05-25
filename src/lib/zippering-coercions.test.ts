import { describe, it, expect } from "vitest";
import { normalize, UnsafeCoercion } from "./zippering-coercions";

describe("normalize — identity", () => {
  it("returns the same value when from === to (text)", () => {
    expect(normalize("foo", "text", "text")).toBe("foo");
  });

  it("returns the same value when from === to (integer)", () => {
    expect(normalize(42, "integer", "integer")).toBe(42);
  });
});

describe("normalize — registered coercions (happy paths)", () => {
  it("integer→text converts number to string", () => {
    expect(normalize(123, "integer", "text")).toBe("123");
  });

  it("numeric→text converts number to string", () => {
    expect(normalize(3.14, "numeric", "text")).toBe("3.14");
  });

  it("text→integer parses a valid integer string", () => {
    expect(normalize("42", "text", "integer")).toBe(42);
  });

  it("integer→timestamp converts epoch ms to ISO string", () => {
    const epochMs = 0;
    expect(normalize(epochMs, "integer", "timestamp")).toBe("1970-01-01T00:00:00.000Z");
  });

  it("timestamp→integer converts ISO string to epoch ms", () => {
    expect(normalize("1970-01-01T00:00:00.000Z", "timestamp", "integer")).toBe(0);
  });

  it("text→timestamp parses a valid date string to ISO", () => {
    const result = normalize("2024-01-15", "text", "timestamp");
    // The result should be a valid ISO string
    expect(typeof result).toBe("string");
    expect(new Date(result as string).getFullYear()).toBe(2024);
  });

  it("text→string[] wraps the value in a single-element array", () => {
    expect(normalize("hello", "text", "string[]")).toEqual(["hello"]);
  });

  it("string[]→jsonb passes through unchanged", () => {
    const arr = ["a", "b", "c"];
    expect(normalize(arr, "string[]", "jsonb")).toBe(arr);
  });

  it("text→jsonb passes through unchanged", () => {
    expect(normalize("raw text", "text", "jsonb")).toBe("raw text");
  });
});

describe("normalize — unsafe coercions", () => {
  it("text→integer throws UnsafeCoercion for a non-numeric string", () => {
    expect(() => normalize("not-a-number", "text", "integer")).toThrowError(UnsafeCoercion);
  });

  it("text→integer error message names the offending value", () => {
    let caught: unknown;
    try {
      normalize("abc", "text", "integer");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnsafeCoercion);
    expect((caught as UnsafeCoercion).message).toContain("abc");
    expect((caught as UnsafeCoercion).name).toBe("UnsafeCoercion");
  });

  it("text→timestamp throws UnsafeCoercion for an invalid date string", () => {
    expect(() => normalize("not-a-date", "text", "timestamp")).toThrowError(UnsafeCoercion);
  });

  it("unregistered pair (boolean→string[]) throws UnsafeCoercion", () => {
    expect(() => normalize(true, "boolean", "string[]")).toThrowError(UnsafeCoercion);
  });

  it("unregistered pair (jsonb→integer) throws UnsafeCoercion", () => {
    expect(() => normalize({}, "jsonb", "integer")).toThrowError(UnsafeCoercion);
  });
});
