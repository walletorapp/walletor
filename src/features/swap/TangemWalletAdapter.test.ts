import { describe, expect, it, vi } from "vitest";
import {
  BaseSignerWalletAdapter,
  WalletAdapterNetwork,
  WalletReadyState,
  type WalletName,
} from "@solana/wallet-adapter-base";
import {
  PublicKey,
  type Transaction,
  VersionedTransaction,
  TransactionMessage,
} from "@solana/web3.js";
import { TangemWalletAdapter } from "./TangemWalletAdapter";

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  sign: vi.fn(),
  connect: vi.fn(),
}));
vi.mock("@solana/wallet-adapter-walletconnect", () => ({
  WalletConnectWalletAdapter: class extends BaseSignerWalletAdapter {
    name = "WalletConnect" as WalletName<"WalletConnect">;
    url = "https://walletconnect.com";
    icon = "";
    publicKey: PublicKey | null = null;
    connecting = false;
    readyState = WalletReadyState.Loadable;
    supportedTransactionVersions = new Set<"legacy" | 0>(["legacy", 0]);
    constructor(config: unknown) {
      super();
      mocks.config(config);
    }
    connect() {
      mocks.connect();
      this.publicKey = new PublicKey("11111111111111111111111111111111");
      this.emit("connect", this.publicKey);
      return Promise.resolve();
    }
    disconnect() {
      this.publicKey = null;
      this.emit("disconnect");
      return Promise.resolve();
    }
    async signTransaction<T extends Transaction | VersionedTransaction>(
      transaction: T,
    ): Promise<T> {
      await mocks.sign(transaction);
      return transaction;
    }
    async signMessage(message: Uint8Array) {
      await mocks.sign(message);
      return message;
    }
  },
}));

describe("Tangem WalletConnect bridge", () => {
  it("requires a project and configures mainnet with Walletor identity", () => {
    expect(() => new TangemWalletAdapter("")).toThrow();
    const adapter = new TangemWalletAdapter("a".repeat(32));
    expect(adapter.name).toBe("Tangem");
    expect(mocks.config).toHaveBeenLastCalledWith(
      expect.objectContaining({
        network: WalletAdapterNetwork.Mainnet,
        options: expect.objectContaining({
          projectId: "a".repeat(32),
          metadata: expect.objectContaining({ url: "https://walletor.com" }),
        }),
      }),
    );
  });
  it("does not prompt automatically and forwards explicit connect/disconnect events", async () => {
    mocks.connect.mockClear();
    const adapter = new TangemWalletAdapter("a".repeat(32));
    const connected = vi.fn();
    const disconnected = vi.fn();
    adapter.on("connect", connected);
    adapter.on("disconnect", disconnected);
    await adapter.autoConnect();
    expect(mocks.connect).not.toHaveBeenCalled();
    await adapter.connect();
    expect(connected).toHaveBeenCalledWith(adapter.publicKey);
    expect(adapter.connected).toBe(true);
    await adapter.disconnect();
    expect(disconnected).toHaveBeenCalledOnce();
    expect(adapter.connected).toBe(false);
  });
  it("forwards versioned transactions unchanged and propagates rejected signatures", async () => {
    const adapter = new TangemWalletAdapter("a".repeat(32));
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: new PublicKey("11111111111111111111111111111111"),
        recentBlockhash: "11111111111111111111111111111111",
        instructions: [],
      }).compileToV0Message(),
    );
    expect(await adapter.signTransaction(transaction)).toBe(transaction);
    expect(mocks.sign).toHaveBeenLastCalledWith(transaction);
    mocks.sign.mockRejectedValueOnce(new Error("User rejected"));
    await expect(adapter.signTransaction(transaction)).rejects.toThrow(
      "User rejected",
    );
  });
});
