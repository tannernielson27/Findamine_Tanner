import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/v1/admin/_lib/audit", () => ({ writeAudit: vi.fn() }));

import { loadRealNames } from "@/lib/social/real-names-access";
import { ID_BATCH_SIZE } from "@/lib/utils/chunk";

type Row = Record<string, unknown>;

/** A service client stand-in that records every `.in()` filter it is given. */
function fakeClient(tables: Record<string, Row[]>, failTable?: string) {
  const calls: { table: string; ids: string[] }[] = [];
  const client = {
    from(table: string) {
      return {
        select() {
          return {
            in(column: string, ids: string[]) {
              calls.push({ table, ids });
              if (table === failTable) return Promise.resolve({ data: null, error: { message: "boom" } });
              const data = (tables[table] ?? []).filter((r) => ids.includes(r[column] as string));
              return Promise.resolve({ data, error: null });
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

const ids = Array.from({ length: 250 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
const users = ids.map((id) => ({ id, role: "adult", date_of_birth: "1990-01-01", metadata: {}, deleted_at: null }));
const profiles = ids.map((user_id) => ({ user_id, effective_band: "adult" }));

describe("loadRealNames on a full board", () => {
  it("splits the id lookups into batches and still names every player", async () => {
    const { client, calls } = fakeClient({ users, user_profiles: profiles });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const names = await loadRealNames(client as any, ids);

    expect(names.size).toBe(250);
    for (const table of ["users", "user_profiles"]) {
      const batches = calls.filter((c) => c.table === table);
      expect(batches).toHaveLength(Math.ceil(250 / ID_BATCH_SIZE));
      expect(batches.every((b) => b.ids.length <= ID_BATCH_SIZE)).toBe(true);
      expect(batches.flatMap((b) => b.ids).sort()).toEqual([...ids].sort());
    }
  });

  it("returns no names if any batch fails, so a minor can't slip through", async () => {
    const { client } = fakeClient({ users, user_profiles: profiles }, "user_profiles");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const names = await loadRealNames(client as any, ids);
    expect(names.size).toBe(0);
  });
});
