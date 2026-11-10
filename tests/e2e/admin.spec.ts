import { expect, test } from "@playwright/test";

test("Switchboard randomness client loads in the browser", async ({ page }) => {
  await page.goto("/");

  const client = await page.evaluate(async () => {
    const modulePath = "/src/features/admin/switchboard-randomness.ts";
    const imported: unknown = await import(/* @vite-ignore */ modulePath);
    if (
      typeof imported !== "object" ||
      imported === null ||
      !("loadSwitchboardRandomnessClient" in imported) ||
      typeof imported.loadSwitchboardRandomnessClient !== "function"
    ) {
      throw new Error("Switchboard browser loader is unavailable.");
    }
    const loaded: unknown = await Reflect.apply(
      imported.loadSwitchboardRandomnessClient,
      undefined,
      [],
    );
    if (typeof loaded !== "object" || loaded === null) {
      throw new Error("Switchboard browser client is unavailable.");
    }
    const methodType = (target: unknown, name: string) =>
      (typeof target === "object" && target !== null) ||
      typeof target === "function"
        ? typeof Reflect.get(target, name)
        : "undefined";
    return {
      anchorUtils:
        "AnchorUtils" in loaded
          ? methodType(loaded.AnchorUtils, "loadProgramFromProvider")
          : "undefined",
      randomness:
        "Randomness" in loaded
          ? methodType(loaded.Randomness, "createAndCommitIxs")
          : "undefined",
    };
  });

  expect(client).toEqual({
    anchorUtils: "function",
    randomness: "function",
  });
});

test("admin Solana reads use the protected relay", async ({ page }) => {
  let requestedMethod: string | null = null;
  await page.route("**/admin/api/solana-rpc", async (route) => {
    const request: unknown = route.request().postDataJSON();
    if (
      typeof request !== "object" ||
      request === null ||
      !("id" in request) ||
      !("method" in request)
    ) {
      throw new Error("Unexpected Solana RPC request.");
    }
    requestedMethod = String(request.method);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
      }),
    });
  });
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const modulePath = "/src/features/admin/admin-solana-connection.ts";
    const imported: unknown = await import(/* @vite-ignore */ modulePath);
    if (
      typeof imported !== "object" ||
      imported === null ||
      !("createAdminSolanaConnection" in imported) ||
      typeof imported.createAdminSolanaConnection !== "function"
    ) {
      throw new Error("Admin Solana connection is unavailable.");
    }
    const connection: unknown = Reflect.apply(
      imported.createAdminSolanaConnection,
      undefined,
      [window.location.origin],
    );
    if (
      typeof connection !== "object" ||
      connection === null ||
      !("getGenesisHash" in connection) ||
      typeof connection.getGenesisHash !== "function" ||
      !("rpcEndpoint" in connection)
    ) {
      throw new Error("Admin Solana connection is invalid.");
    }
    const genesisHash: unknown = await Reflect.apply(
      connection.getGenesisHash,
      connection,
      [],
    );
    return {
      genesisHash,
      reportedRpcEndpoint: connection.rpcEndpoint,
    };
  });

  expect(requestedMethod).toBe("getGenesisHash");
  expect(result).toEqual({
    genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    reportedRpcEndpoint: "https://api.mainnet-beta.solana.com",
  });
});

test("Walletor Admin fails closed until Cloudflare Access is configured", async ({
  page,
}) => {
  const response = await page.goto("/admin");
  expect(response?.status()).toBe(503);
  expect(response?.headers()["cache-control"]).toBe("no-store");
  expect(await response?.json()).toMatchObject({
    error: { code: "ADMIN_ACCESS_NOT_CONFIGURED" },
  });
  await expect(page.getByText("Financial safety lock is active")).toHaveCount(
    0,
  );
});
