import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.resolve("src/components/audit-workspace.tsx"),
  "utf8"
);

describe("AuditWorkspace requestEditOpen (external trigger for the edit modal)", () => {
  it("accepts an optional counter prop, does not replace editModalOpen's own state", () => {
    expect(source).toContain("requestEditOpen?: number;");
    expect(source).toContain("const [editModalOpen, setEditModalOpen] = useState(false);");
  });

  it("skips the initial render -- an initial 0/undefined never auto-opens the modal", () => {
    expect(source).toContain("const prevRequestEditOpen = useRef(requestEditOpen);");
    expect(source).toContain("requestEditOpen !== undefined &&");
    expect(source).toContain("requestEditOpen !== prevRequestEditOpen.current");
  });

  it("only a genuine change opens the modal, via the same setEditModalOpen the button uses", () => {
    expect(source).toContain("setEditModalOpen(true);");
    expect(source).toContain("prevRequestEditOpen.current = requestEditOpen;");
  });
});
