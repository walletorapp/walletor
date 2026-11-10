import {
  BaseSignerWalletAdapter,
  WalletAdapterNetwork,
  type WalletName,
} from "@solana/wallet-adapter-base";
import { WalletConnectWalletAdapter } from "@solana/wallet-adapter-walletconnect";
import type { Transaction, VersionedTransaction } from "@solana/web3.js";

/** Tangem connects through the WalletConnect QR/mobile wallet picker. */
export class TangemWalletAdapter extends BaseSignerWalletAdapter {
  readonly name = "Tangem" as WalletName<"Tangem">;
  readonly url = "https://tangem.com/";
  readonly icon = "/assets/tangem-card.svg";
  private readonly transport: WalletConnectWalletAdapter;

  constructor(projectId: string) {
    super();
    if (!/^[a-f0-9]{32}$/i.test(projectId))
      throw new Error("Invalid WalletConnect project ID");
    this.transport = new WalletConnectWalletAdapter({
      network: WalletAdapterNetwork.Mainnet,
      options: {
        projectId,
        relayUrl: "wss://relay.walletconnect.com",
        metadata: {
          name: "Walletor",
          description:
            "Swap Solana tokens on Walletor. Connect using Tangem via WalletConnect.",
          url: "https://walletor.com",
          icons: ["https://walletor.com/assets/walletor-logo.jpg"],
        },
      },
    });
    this.transport.on("connect", (key) => this.emit("connect", key));
    this.transport.on("disconnect", () => this.emit("disconnect"));
    this.transport.on("error", (error) => this.emit("error", error));
    this.transport.on("readyStateChange", (state) =>
      this.emit("readyStateChange", state),
    );
  }

  get publicKey() {
    return this.transport.publicKey;
  }
  get connecting() {
    return this.transport.connecting;
  }
  get readyState() {
    return this.transport.readyState;
  }
  get supportedTransactionVersions() {
    return this.transport.supportedTransactionVersions;
  }
  // Opening a QR/mobile prompt always requires an explicit user action.
  autoConnect() {
    return Promise.resolve();
  }
  connect() {
    return this.transport.connect();
  }
  disconnect() {
    return this.transport.disconnect();
  }
  signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
  ): Promise<T> {
    return this.transport.signTransaction(transaction);
  }
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ): Promise<T[]> {
    return this.transport.signAllTransactions(transactions);
  }
  signMessage(message: Uint8Array): Promise<Uint8Array> {
    return this.transport.signMessage(message);
  }
}
