import { describe, it, expect, vi, beforeEach } from "vitest";

const storageMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  findSupervisorByEmail: vi.fn(),
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));

import { canEditSigner, findDuplicateSigner } from "../server/signers";

beforeEach(() => vi.clearAllMocks());

describe("shared signer list — edit rights", () => {
  it("lets the person who added a signer edit it", async () => {
    expect(await canEditSigner({ userId: 7 }, 7)).toBe(true);
  });

  it("lets an admin edit anyone's signer", async () => {
    storageMock.getUser.mockResolvedValue({ id: 1, isAdmin: true });
    expect(await canEditSigner({ userId: 7 }, 1)).toBe(true);
  });

  it("blocks other users from editing someone else's signer", async () => {
    storageMock.getUser.mockResolvedValue({ id: 2, isAdmin: false });
    expect(await canEditSigner({ userId: 7 }, 2)).toBe(false);
  });
});

describe("shared signer list — duplicates", () => {
  it("flags an email already on the list", async () => {
    storageMock.findSupervisorByEmail.mockResolvedValue({ id: 3, name: "Sam", email: "sam@acl.test" });
    expect(await findDuplicateSigner("SAM@acl.test")).toMatchObject({ id: 3 });
  });

  it("ignores the signer being edited", async () => {
    storageMock.findSupervisorByEmail.mockResolvedValue({ id: 3, name: "Sam", email: "sam@acl.test" });
    expect(await findDuplicateSigner("sam@acl.test", 3)).toBeUndefined();
  });

  it("allows a new email", async () => {
    storageMock.findSupervisorByEmail.mockResolvedValue(undefined);
    expect(await findDuplicateSigner("new@acl.test")).toBeUndefined();
  });
});
