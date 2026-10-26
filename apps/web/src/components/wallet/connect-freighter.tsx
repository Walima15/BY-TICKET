"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getNetworkDetails, isConnected, requestAccess, signMessage } from "@stellar/freighter-api";
import { Loader2, PlugZap } from "lucide-react";
import { toast } from "sonner";
import { createWalletChallenge, verifyWalletChallenge } from "@/app/account/wallet-actions";
import { Button } from "@/components/ui/button";
import { stellarConfig } from "@/lib/stellar/config";

const networkName = stellarConfig.isTestnet ? "Testnet" : "Mainnet";

/** Older Freighter returns the signature as bytes; newer as a base64 string. */
function signatureToString(signed: unknown): string | null {
  if (typeof signed === "string") return signed;
  if (signed instanceof Uint8Array) return btoa(String.fromCharCode(...signed));
  return null;
}

export function ConnectFreighter() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [needsInstall, setNeedsInstall] = useState(false);

  const connect = () =>
    startTransition(async () => {
      setError(null);
      setNeedsInstall(false);

      const connected = await isConnected();
      if (!connected.isConnected) {
        setNeedsInstall(true);
        return;
      }

      const access = await requestAccess();
      if (access.error || !access.address) {
        setError("Freighter didn't share an address. Unlock Freighter and approve the request.");
        return;
      }

      const network = await getNetworkDetails();
      if (network.error || network.networkPassphrase !== stellarConfig.networkPassphrase) {
        setError(`Switch Freighter to ${networkName} (Freighter settings → Network), then try again.`);
        return;
      }

      const challenge = await createWalletChallenge(access.address);
      if (!challenge.ok) {
        setError(challenge.error);
        return;
      }

      const signed = await signMessage(challenge.message, {
        address: access.address,
        networkPassphrase: stellarConfig.networkPassphrase,
      });
      const signature = signatureToString(signed.signedMessage);
      if (signed.error || !signature) {
        setError("Signing was cancelled. Nothing was linked.");
        return;
      }
      if (signed.signerAddress && signed.signerAddress !== access.address) {
        setError("Freighter signed with a different account. Select the same account and try again.");
        return;
      }

      const result = await verifyWalletChallenge({ challengeId: challenge.challengeId, signature });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Freighter wallet linked");
      router.refresh();
    });

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" onClick={connect} disabled={pending} className="h-10 px-4">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <PlugZap aria-hidden />}
        Connect Freighter
      </Button>
      {needsInstall && (
        <p className="text-muted-foreground text-sm" role="status">
          Freighter isn&apos;t installed in this browser.{" "}
          <a href="https://www.freighter.app/" target="_blank" rel="noreferrer" className="underline">
            Get Freighter
          </a>
          , set it to {networkName}, then reload this page.
        </p>
      )}
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
