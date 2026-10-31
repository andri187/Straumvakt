import { describe, expect, it } from "vitest";
import { CHARGE_POINT_ID, CONNECTION_DOMAIN, chargerAddress, cpoAddress } from "./address";
import * as model from "./model";
import { parseRoute } from "@/lib/ocpp-engine/route";

describe("connection address", () => {
  it("the CPO's endpoint is wss://{cpo-id}.straumvakt.org/ with no installation segment", () => {
    expect(cpoAddress("nordic-charge")).toBe("wss://nordic-charge.straumvakt.org/");
  });

  it("shows no endpoint, and no guessed organisation, while the CPO has no routing id", () => {
    expect(cpoAddress(null)).toBeNull();
    expect(chargerAddress(null, "CP-001")).toBeNull();
  });

  it("completes a charger's address from the charge point id typed for that charger", () => {
    expect(chargerAddress("nordic-charge", "CP-001")).toBe("wss://nordic-charge.straumvakt.org/CP-001");
    expect(chargerAddress("nordic-charge", "  CP-001  ")).toBe("wss://nordic-charge.straumvakt.org/CP-001");
  });

  it("shows no address until the id is a valid single path segment, and never substitutes anything for it", () => {
    for (const bad of ["", "   ", "a/b", "a b", "-lead", "../x", "x?y=1", "x#y", "é", "a".repeat(49)]) {
      expect(chargerAddress("nordic-charge", bad), JSON.stringify(bad)).toBeNull();
    }
    expect(chargerAddress("nordic-charge", "a".repeat(48))).not.toBeNull();
  });

  it("carries no password, credentials, query or installation key in any form", () => {
    for (const a of [cpoAddress("r")!, chargerAddress("r", "CP1")!]) {
      // After the scheme: no userinfo, port, query or fragment, and no password word.
      expect(a.replace(/^wss:\/\//, "")).not.toMatch(/[@?#:]|password/i);
    }
    expect(chargerAddress("r", "CP1")!.split("/").length).toBe(4); // wss: "" host id
  });

  it("every address the editor can show is one the engine's route parser accepts, and parses back to the same CPO and id", () => {
    for (const id of ["CP-001", "zap.257533", "A_b-9", "x", "a".repeat(48)]) {
      const url = new URL(chargerAddress("nordic-charge", id)!.replace("wss:", "https:"));
      expect(parseRoute(url.hostname, url.pathname)).toEqual({ ok: true, route: { routingId: "nordic-charge", chargePointId: id } });
    }
  });

  it("is the same rule the save path enforces on charge point ids", () => {
    expect(model.CHARGE_POINT_ID).toBe(CHARGE_POINT_ID);
    expect(model.CONNECTION_DOMAIN).toBe(CONNECTION_DOMAIN);
    expect(model.cpoAddress).toBe(cpoAddress);
    expect(model.chargerAddress).toBe(chargerAddress);
  });

  it("the stored identity pairs the CPO organisation with the id; the id is never parsed back out of a string", () => {
    expect(model.identityRow("org-1", "CP-001")).toEqual({ cpoOrgId: "org-1", chargePointId: "CP-001", identityString: "org-1/CP-001" });
  });
});
