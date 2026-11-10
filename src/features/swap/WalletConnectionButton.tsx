import { useWallet } from "@solana/wallet-adapter-react";
import {
  WalletMultiButton,
  useWalletModal,
} from "@solana/wallet-adapter-react-ui";
import type { ComponentProps } from "react";

export function WalletConnectionButton(
  props: ComponentProps<typeof WalletMultiButton>,
) {
  const walletContext = useWallet();
  const { connected, connecting } = walletContext;
  const { setVisible } = useWalletModal();

  if (connected) return <WalletMultiButton {...props} />;

  return (
    <button
      type="button"
      className={`wallet-adapter-button wallet-adapter-button-trigger ${props.className ?? ""}`}
      disabled={props.disabled}
      style={props.style}
      tabIndex={props.tabIndex}
      aria-haspopup="dialog"
      onClick={() => {
        // A remembered wallet can be uninstalled or unavailable in this browser.
        // Reset selection so even choosing the same wallet starts a fresh attempt.
        walletContext.select(null);
        setVisible(true);
      }}
    >
      {props.startIcon}
      {connecting
        ? "Choose another wallet"
        : (props.children ?? "Connect wallet")}
      {props.endIcon}
    </button>
  );
}
