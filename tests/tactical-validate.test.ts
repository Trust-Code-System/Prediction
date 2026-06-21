import { describe, it, expect } from "vitest";
import { validateTactical } from "@/lib/tactical/validate";

function validObject() {
  return {
    home: {
      formation: "4-3-3",
      style: "Front-foot pressing side that scores freely at home.",
      strengths: ["High-volume attack at 2.1 goals per game", "Strong home form, won 4 of 5"],
      weaknesses: ["Concedes from set pieces"]
    },
    away: {
      formation: "4-2-3-1",
      style: "Compact and counter-attacking on the road.",
      strengths: ["Mean defense, 0.9 conceded per game", "Dangerous on the break"],
      weaknesses: ["Low away scoring", "Thin midfield options"]
    },
    dangerous_areas: ["Home wide areas vs a narrow away block", "Away counters into the channels"],
    key_battles: ["Home winger vs away full back", "Midfield control in the first phase"],
    summary: "Home pressure against a compact away side that wants to counter."
  };
}

describe("validateTactical", () => {
  it("accepts a well-formed object", () => {
    const r = validateTactical(JSON.stringify(validObject()));
    expect(r.ok).toBe(true);
  });

  it("strips code fences before parsing", () => {
    const fenced = "```json\n" + JSON.stringify(validObject()) + "\n```";
    expect(validateTactical(fenced).ok).toBe(true);
  });

  it("rejects non-JSON", () => {
    expect(validateTactical("not json").ok).toBe(false);
  });

  it("rejects a bad formation", () => {
    const o = validObject();
    o.home.formation = "4xx3";
    expect(validateTactical(JSON.stringify(o)).ok).toBe(false);
  });

  it("accepts a four-band formation", () => {
    const o = validObject();
    o.home.formation = "4-2-3-1";
    expect(validateTactical(JSON.stringify(o)).ok).toBe(true);
  });

  it("rejects an empty style", () => {
    const o = validObject();
    o.home.style = "   ";
    expect(validateTactical(JSON.stringify(o)).ok).toBe(false);
  });

  it("rejects out-of-bounds strengths", () => {
    const o = validObject();
    o.home.strengths = ["only one"];
    expect(validateTactical(JSON.stringify(o)).ok).toBe(false);
  });

  it("rejects out-of-bounds dangerous_areas", () => {
    const o = validObject();
    o.dangerous_areas = ["just one"];
    expect(validateTactical(JSON.stringify(o)).ok).toBe(false);
  });

  it("rejects any string containing an em dash", () => {
    const o = validObject();
    o.summary = "Home pressure — against a compact away side.";
    const r = validateTactical(JSON.stringify(o));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/em dash/i);
  });

  it("rejects an em dash hidden in a list item", () => {
    const o = validObject();
    o.home.strengths = ["Solid — at the back", "Quick transitions"];
    expect(validateTactical(JSON.stringify(o)).ok).toBe(false);
  });
});
