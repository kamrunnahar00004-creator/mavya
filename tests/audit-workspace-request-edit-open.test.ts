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

  it("adjusts state during render, not in a useEffect -- avoids the one-frame flash a seller reported between the picker closing and the edit modal appearing", () => {
    expect(source).toContain(
      "const [handledRequestEditOpen, setHandledRequestEditOpen] = useState(requestEditOpen);"
    );
    expect(source).toContain("if (requestEditOpen !== handledRequestEditOpen) {");
  });

  it("skips the initial render -- an initial 0/undefined never auto-opens the modal", () => {
    // handledRequestEditOpen's own initial value IS requestEditOpen, so the
    // comparison is false on first render and nothing opens.
    expect(source).toContain("useState(requestEditOpen);");
  });

  it("only a genuine change opens the modal, via the same setEditModalOpen the button uses", () => {
    expect(source).toContain("setHandledRequestEditOpen(requestEditOpen);");
    expect(source).toContain("if (requestEditOpen !== undefined) {\n      setEditModalOpen(true);\n    }");
  });
});
