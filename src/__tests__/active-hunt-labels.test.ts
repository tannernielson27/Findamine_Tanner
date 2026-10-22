import { describe, expect, it } from "vitest";
import { activeHuntLabels, activeHuntStopLabel, isAllStopsDone } from "@/lib/play/active-hunt-labels";

describe("active hunt labels", () => {
  it("shows the current stop mid-hunt", () => {
    expect(activeHuntLabels({ currentStop: 3, totalStops: 7, completedStops: 2 })).toEqual({
      allStopsDone: false,
      stopLabel: "Stop 3 of 7",
      actionLabel: "Resume hunt",
      shortActionLabel: "Resume",
    });
  });

  it("says all stops are done when every stop is complete but the session is open", () => {
    expect(activeHuntLabels({ currentStop: 4, totalStops: 4, completedStops: 4 })).toEqual({
      allStopsDone: true,
      stopLabel: "All stops done",
      actionLabel: "Finish hunt",
      shortActionLabel: "Finish",
    });
  });

  it("is not done on the last stop until it is completed", () => {
    expect(activeHuntStopLabel({ currentStop: 4, totalStops: 4, completedStops: 3 })).toBe("Stop 4 of 4");
    expect(isAllStopsDone({ currentStop: 4, totalStops: 4, completedStops: 3 })).toBe(false);
  });

  it("clamps the stop to the total", () => {
    expect(activeHuntStopLabel({ currentStop: 9, totalStops: 7, completedStops: 1 })).toBe("Stop 7 of 7");
  });

  it("omits the total when the session doesn't report one", () => {
    expect(activeHuntLabels({ currentStop: 2, totalStops: 0, completedStops: 0 })).toMatchObject({
      allStopsDone: false,
      stopLabel: "Stop 2",
      actionLabel: "Resume hunt",
    });
  });
});
