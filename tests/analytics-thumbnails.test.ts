import { describe, expect, it } from "vitest";
import { etsyThumb } from "@/components/dashboard/listing-analytics-view";

describe("Etsy thumbnail sizing", () => {
  const url = "https://i.etsystatic.com/31536483/r/il/38cb27/3854281399/il_570xN.3854281399_gop1.jpg";
  it("requests a smaller CDN size for small tiles", () => {
    expect(etsyThumb(url, "il_340x270")).toBe("https://i.etsystatic.com/31536483/r/il/38cb27/3854281399/il_340x270.3854281399_gop1.jpg");
    expect(etsyThumb(url, "il_170x135")).toContain("/il_170x135.3854281399_gop1.jpg");
  });
  it("leaves unknown URL formats and nulls untouched", () => {
    expect(etsyThumb("https://i.etsystatic.com/x/il_fullxfull.1.jpg", "il_170x135")).toBe("https://i.etsystatic.com/x/il_fullxfull.1.jpg");
    expect(etsyThumb(null, "il_170x135")).toBeNull();
  });
});
